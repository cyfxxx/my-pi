import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, unlinkSync, openSync, closeSync, writeSync, statSync } from 'node:fs';
import { schedulerDir, lockPath } from './paths';

let storeWriteQueue: Promise<unknown> = Promise.resolve();
export function withStoreLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = storeWriteQueue.then(fn, fn);
  storeWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let lockPid: string | null = null;

/**
 * `/proc` 是否**不可用**（非 Linux / 受限容器 / 测试开关）✓。
 * `PI_LOCK_DISABLE_PROC=1` ⇒ 当作没有 `/proc` ✓（**用于在 Linux 上模拟 Windows/macOS** ✓ 与受限环境 ✓）。
 * **调用时**读 env ✓（不在导入时缓存 ✗ —— 否则测试无法切换 ✓）。
 */
function procUnavailable(): boolean {
  return process.env.PI_LOCK_DISABLE_PROC === '1';
}

/**
 * **可移植**的存活判定 ✓（Windows / macOS / Linux 皆可用）—— 用 `process.kill(pid, 0)` 探测 ✓。
 * 语义（必须精确 ✓）：
 *   - `ESRCH` ⇒ 进程**不存在** ⇒ 返回 `false`（**已死是权威信号** ✓，可直接采信 ✓）；
 *   - `EPERM` ⇒ 进程存在但**无权限发信号** ⇒ 返回 `true`（活着 ✓）；
 *   - 其它错误 / 异常 ⇒ 返回 `true`（**保守当作活着** ✓ —— 绝不因为读不到就抢占 ✗，那会**双跑** ✓）。
 * `PI_LOCK_KILL_ERRNO`（**测试/受限环境用** ✓）⇒ 显式模拟 `process.kill` 的 errno ✓：
 *   `ESRCH` ⇒ 当作已死；其它值 ⇒ 当作"未知错误"⇒ 活着 ✓（用于证明保守性 ✓）。
 */
function portablePidAlive(pid: string): boolean {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  const forced = process.env.PI_LOCK_KILL_ERRNO;
  if (forced) return forced !== 'ESRCH';
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    const code = typeof e === 'object' && e !== null && 'code' in e ? String(Reflect.get(e, 'code')) : '';
    if (code === 'ESRCH') return false;
    return true;
  }
}

/** 读 `/proc/<pid>/stat` 的状态字段（第 3 个字段）；读不到 ⇒ 返回 `''`（调用方须**保守**处理 ✓）。 */
function procState(pid: string): string {
  if (procUnavailable()) return '';
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const after = stat.slice(stat.lastIndexOf(')') + 2);
    return after.split(' ')[0] ?? '';
  } catch {
    return '';
  }
}

/**
 * PID 是否"真的还活着" —— **僵尸（`Z`）不算活着** ✗✓。
 *
 * 为什么必须区分：僵尸进程的 `/proc/<pid>` **同样存在** ✗，所以旧的 `existsSync('/proc/<pid>')`
 * 会把"已退出、只等父进程回收"的进程当成持锁者 ⇒ 调度锁**长期显示为被持有** ⇒ `runDueTasks`
 * 每轮"让出" ⇒ **调度器静默停摆**（2026-10-11 实测：僵尸 PID 占用时 `acquireSessionLock()` 返回 false ✗）。
 *
 * 保守性：读不到 stat 时**当作活着** ✓（宁可让出，也不误抢正在执行的锁 ✓）。
 * 非 Linux（无 `/proc`）⇒ 与旧行为一致（视作不活 ✓）。
 */
export function isPidAlive(pid: string): boolean {
  if (!/^[0-9]+$/.test(pid)) return false;
  // ① **可移植判定**（2026-10-11 新增 ✓）：`process.kill(pid, 0)` ⇒ 三平台通用 ✓。
  //    为什么必须加：旧实现只看 `/proc` ✗ —— 在 **Windows/macOS** 上 `existsSync('/proc/<pid>')` 恒为 false ✗
  //    ⇒ 任何存活持锁者都会被判"不活" ⇒ "被持有"分支永不进入 ⇒ 直接走到 unlink ✗✗
  //    ⇒ **删掉别人活着的锁 ⇒ 同一到期任务并行执行（双跑）** ✗，且**不报错、不告警** ✗✗。
  //    （所以这个缺陷在非 Linux 上不是"静默降级"，而是"静默双跑" ✗ —— 比降级更严重 ✓。）
  if (!portablePidAlive(pid)) return false;
  // ② `/proc` **增强**：能读到时再做**僵尸**精化 ✓（僵尸的 `/proc/<pid>` 依然存在 ⇒ 只看存在会误判为活着 ✗）。
  //    读不到（非 Linux / 受限容器 / 开关）⇒ **保守当作活着** ✓（宁可让出，也不误抢 ✓）。
  const st = procState(pid);
  if (st === 'Z') return false;
  return true;
}

/**
 * HZ（每秒时钟节拍）—— **只从 `getconf CLK_TCK` 取** ✓；取不到就返回 null ⇒ **不做复用判定**（保守 ✓）。
 * 为什么不猜默认值：Linux 常见 100/250/300，**猜错会让"进程启动时间"算偏** ✗ ——
 * 而偏早会让我们把活着的持锁者误判为"复用"⇒ 误抢 ⇒ **双跑** ✗✗。所以**宁可不判定** ✓。
 * 测试/受限环境可用 `PI_LOCK_CLK_TCK` 显式覆盖 ✓。
 */
let cachedHz: number | null | undefined;
function clockTicksPerSecond(): number | null {
  if (cachedHz !== undefined) return cachedHz;
  const env = process.env.PI_LOCK_CLK_TCK;
  if (env && /^[0-9]+$/.test(env)) {
    cachedHz = Number(env);
    return cachedHz;
  }
  try {
    const out = execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 2000 }).trim();
    cachedHz = /^[0-9]+$/.test(out) ? Number(out) : null;
  } catch {
    cachedHz = null;
  }
  return cachedHz;
}

/**
 * 进程启动的**墙钟毫秒**（`/proc/<pid>/stat` 的 **field 22 = starttime** 节拍 ⇒ 换算）✓。
 * 读不到 / 无 HZ / 非 Linux / 解析失败 ⇒ **返回 null（不判定）** ✓。
 * `PI_LOCK_DISABLE_PROC_START=1` ⇒ 直接不判定（**用于复现修复前行为** ✓ 与受限环境 ✓）。
 */
export function procStartWallClockMs(pid: string): number | null {
  if (procUnavailable()) return null;
  if (process.env.PI_LOCK_DISABLE_PROC_START === '1') return null;
  try {
    const hz = clockTicksPerSecond();
    if (!hz) return null;
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    // comm（field 2）可能含空格与括号 ⇒ 从**最后一个 ')'** 之后开始切，再按 0 基取 field 22：
    // 切后索引 0 = state(field 3) ⇒ starttime(field 22) = 索引 19 ✓
    const close = raw.lastIndexOf(')');
    if (close < 0) return null;
    const fields = raw.slice(close + 2).trim().split(/\s+/);
    const startTicks = Number(fields[19]);
    if (!Number.isFinite(startTicks)) return null;
    let btimeMs: number | null = null;
    const m = /^btime\s+(\d+)/m.exec(readFileSync('/proc/stat', 'utf-8'));
    if (m) btimeMs = Number(m[1]) * 1000;
    if (btimeMs === null) {
      const up = Number(readFileSync('/proc/uptime', 'utf-8').split(/\s+/)[0]);
      if (!Number.isFinite(up)) return null;
      btimeMs = Date.now() - up * 1000;
    }
    // ★ 时钟一致性自证（2026-10-11，**本环境实测逼出来的** ✗✓）：
    // 同一件事有两条独立推法 —— ①`btime + starttime/HZ`；②`now − (uptime − starttime/HZ)`。
    // proot/Android 上实测三者互相矛盾：`/proc/stat btime` = 2023-03-28 ✗、`/proc/uptime` = 124 秒 ✗、
    // 而 `starttime` 是 182 天量级 ✗ ⇒ ① 算成 2023-09-27，与 `Date.now()`（2026-10-11）差**数年** ✗。
    // 若直接采信 ①，就是给复用判定喂一个"自信的错值" ⇒ 判定整体失真 ✗。
    // ⇒ 两条推法**必须互相吻合**（1 小时内）才可信 ✓；否则 **返回 null ⇒ 不判定**（保守 ✓，宁可少跑不可双跑）。
    const fromBtime = btimeMs + (startTicks * 1000) / hz;
    const upSec = Number(readFileSync('/proc/uptime', 'utf-8').split(/\s+/)[0]);
    if (!Number.isFinite(upSec)) return null;
    const fromUptime = Date.now() - (upSec - startTicks / hz) * 1000;
    const CLOCK_SKEW_TOLERANCE_MS = 3600 * 1000;
    if (Math.abs(fromBtime - fromUptime) > CLOCK_SKEW_TOLERANCE_MS) return null;
    return fromBtime;
  } catch {
    return null;
  }
}

/**
 * **PID 复用**判定 ✓：进程启动时间**晚于"写锁时刻"**（留 `REUSE_MARGIN_MS` 余量）⇒ 该 PID 必然是
 * 在锁写完之后才被复用的 ⇒ 锁是**陈旧**的 ⇒ **可安全抢占** ✓（收口"死 PID 被复用 ⇒ 最长 24h 假持有"✗）。
 * 余量理由：starttime 只到节拍精度（约 10ms 级）+ 墙上时钟可能有抖动 ⇒ 留 1 分钟既不会误判"真持有者"✓，
 * 又能把 24h 的假持有压到分钟级 ✓。
 * **保守性（关键）**：任何不确定（读不到 stat / 无 HZ / 非 Linux / 解析失败 / lockTs 非法）⇒ **返回 false**
 * ⇒ **当作未复用、不抢占** ✓（**绝不因为读不到就抢** ✗ —— 那会双跑 ✓）。
 */
export function isPidReused(pid: string, lockTs: number): boolean {
  const REUSE_MARGIN_MS = 60 * 1000;
  if (!(lockTs > 0)) return false;
  const startedAt = procStartWallClockMs(pid);
  if (startedAt === null) return false;
  return startedAt > lockTs + REUSE_MARGIN_MS;
}

/**
 * 进程启动的 **starttime 原始节拍数**（`/proc/<pid>/stat` field 22）—— **不做任何换算** ✓✓。
 *
 * ★ 为什么这条比墙钟路线可靠（2026-10-11 本环境实测逼出来的 ✗✓）：
 * 本机 `/proc` 的**跨来源时钟自相矛盾** —— `/proc/uptime` = **124 秒** ✗、`/proc/stat btime` = 2023-03-28 ✗，
 * 而 `starttime` 是 **182 天**量级 ✗ ⇒ "节拍→秒/墙钟"的换算会**差数年** ✗（`procStartWallClockMs` 因此返回 null ✓）。
 * **但节拍本身在进程之间是自洽的** ✓：实测同一个 shell（`1574856374`）与其刚起的子进程（`1574856395`）相差
 * **21 节拍 ≈0.21 秒**，与"父进程早起 0.2 秒"完全吻合 ✓✓。
 * ⇒ **只比较节拍大小**（写锁者的 starttime vs 持有者的 starttime）就足以判"谁先启动" ✓，
 * **不需要 HZ、不需要 btime、不需要 uptime、也不需要墙钟** ✓。
 *
 * 读不到 / 解析失败 / 非 Linux / `PI_LOCK_DISABLE_PROC_START=1` ⇒ **返回 null（不判定）** ✓（保守 ✓）。
 */
export function procStartTicks(pid: string): number | null {
  if (procUnavailable()) return null;
  if (process.env.PI_LOCK_DISABLE_PROC_START === '1') return null;
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const close = raw.lastIndexOf(')');
    if (close < 0) return null;
    const fields = raw.slice(close + 2).trim().split(/\s+/);
    const ticks = Number(fields[19]);
    return Number.isFinite(ticks) ? ticks : null;
  } catch {
    return null;
  }
}

/**
 * **PID 复用**判定（节拍路线 ✓，**首选**）：锁里若记有"写锁者自己的 starttime 节拍"，
 * 而**当前持有该 PID 的进程**的 starttime **严格更晚** ⇒ 它是在锁写完之后才起来的 ⇒ **不是写锁者** ⇒
 * **PID 被复用** ⇒ 锁是陈旧的 ⇒ **可安全抢占** ✓。
 *
 * **为什么不需要余量** ✓：同一个进程的 `starttime` **终生不变** ✓ ⇒ 真持有者读到的是**同一个数**（相等 ⇒ 不抢 ✓）；
 * 严格更大 ⇒ 必然是**另一个进程** ✓。这与墙钟路线不同（那里有抖动与精度问题，故留 60s 余量 ✓）。
 *
 * **保守性（关键）**：任何不确定（无第三段 / 读不到 stat / 解析失败 / 非 Linux / 值非法）⇒ **返回 false**
 * ⇒ 当作"未复用、不抢占" ✓（**绝不因为读不到就抢** ✗ —— 那会造成双跑 ✓）。
 */
export function isPidReusedByTicks(holderPid: string, lockStartTicks: number): boolean {
  if (process.env.PI_LOCK_DISABLE_PROC_START === '1') return false;
  if (!Number.isFinite(lockStartTicks) || lockStartTicks <= 0) return false;
  const holderTicks = procStartTicks(holderPid);
  if (holderTicks === null) return false;
  return holderTicks > lockStartTicks;
}

export function isPidInTasklistOutput(stdout: string, pid: string | number): boolean {
  return stdout.split(/\s+/).includes(String(pid));
}

export function acquireSessionLock(): boolean {
  const lockF = lockPath();
  const myPid = String(process.pid);
  const LOCK_TTL_MS = 24 * 3600 * 1000;
  // 锁文件创建与内容写入之间存在极短的空文件窗口。旧实现把空内容当作「无主锁」直接
  // unlink，多个 pi 实例同刻启动（session_start 并发跑 runDueTasks）时会互相删锁，
  // 导致同一到期任务被并行执行（daily-review 双跑即由此而来）。
  // 空内容且 mtime 在宽限期内视为「正在写入」→ 退让；超期才视为崩溃残留并抢占。
  const EMPTY_LOCK_GRACE_MS = 60 * 1000;
  const tryOnce = (): boolean => {
    if (existsSync(lockF)) {
      try {
        const raw = readFileSync(lockF, 'utf-8').trim();
        const oldPid = raw.split(':')[0] ?? '';
        let lockTs = Number(raw.split(':')[1] ?? 0);
        // 第三段 = 写锁者**自己的 starttime 节拍**（2026-10-11 新增 ✓，向后兼容：旧格式只有两段 ✓）
        const lockStartTicks = Number(raw.split(':')[2] ?? NaN);
        if (!Number.isFinite(lockTs) || lockTs <= 0) {
          try {
            lockTs = statSync(lockF).mtimeMs;
          } catch {
            lockTs = 0;
          }
        }
        const age = lockTs > 0 ? Date.now() - lockTs : Number.POSITIVE_INFINITY;
        if (!oldPid) {
          if (age < EMPTY_LOCK_GRACE_MS) return false;
        } else if (oldPid !== myPid && age <= LOCK_TTL_MS && isPidAlive(oldPid)) {
          // ★ PID 复用收口（2026-10-11）：进程"活着"但**启动时间晚于写锁时刻** ⇒ 该 PID 是后来复用的 ⇒
          // 锁其实是陈旧的 ⇒ **可安全抢占** ✓（旧判据会把它当持有者 ⇒ 最长 24h 假持有 ✗）。
          // 不确定时 isPidReused 返回 false ⇒ 保持旧行为（让出）✓ —— 宁可少跑，不可双跑 ✓。
          // ★ 首选**节拍路线** ✓（同源、无需换算 ⇒ 在本机也可用 ✓）；
          // 旧格式（缺第三段）或节拍读不到 ⇒ 回退**墙钟路线** ✓（本机为 null ⇒ 保守让出 ✓）。
          const reuseByTicks =
            Number.isFinite(lockStartTicks) && lockStartTicks > 0
              ? isPidReusedByTicks(oldPid, lockStartTicks)
              : false;
          const reuseByWallClock =
            Number.isFinite(lockStartTicks) && lockStartTicks > 0 ? false : isPidReused(oldPid, lockTs);
          if (reuseByTicks || reuseByWallClock) {
            console.error(
              `[autopilot-lock] 判定 PID 复用（PID ${oldPid} 启动于锁写入之后；` +
                `${reuseByTicks ? '节拍路线' : '墙钟路线'}）⇒ 陈旧锁，抢占回收 ✓`,
            );
          } else {
            return false;
          }
        }
        // ★ 比较后再删（2026-10-11）：旧实现直接 unlink ✗ —— 两个实例可能**同时**判定同一把锁陈旧，
        // 于是 A 删旧锁+建新锁后，B 仍按**先前读到**的内容把 **A 的新锁**删掉 ✗✗ ⇒ 两边都以为持有 ⇒
        // 同一到期任务被并行执行（正是注释里说的"互相删锁"）。现在：只有内容**仍等于**判定时看到的那份才删 ✓。
        const recheck = readFileSync(lockF, 'utf-8').trim();
        if (recheck === raw) unlinkSync(lockF);
        else return false; // 期间有人动过锁 ⇒ 让出本轮，下次再试 ✓（宁可少跑，不可双跑 ✓）
      } catch {}
    }
    try {
      mkdirSync(schedulerDir(), { recursive: true });
      // 原子写入：open('wx') 成功即持锁，内容与创建同一时刻落盘，消除空文件窗口。
      const fd = openSync(lockF, 'wx');
      try {
        // 写入第三段 = **本进程**的 starttime 节拍 ✓（拿不到就只写两段 ⇒ 旧格式 ⇒ 后继者保守 ✓）
        const myStartTicks = procStartTicks(myPid);
        writeSync(fd, myStartTicks ? `${myPid}:${Date.now()}:${myStartTicks}` : `${myPid}:${Date.now()}`);
      } finally {
        closeSync(fd);
      }
      // ★ 建锁后回读校验（2026-10-11）：确认锁里**是我们**的 PID ✓ ——
      // 若在"创建"与"回读"之间被别人抢占，就不能认为自己持锁 ✗（否则仍是双跑 ✓）。
      const back = readFileSync(lockF, 'utf-8').trim();
      if (back.split(':')[0] !== myPid) return false;
      return true;
    } catch {
      return false;
    }
  };
  if (tryOnce()) {
    lockPid = myPid;
    return true;
  }
  return false;
}

export function releaseSessionLock(): void {
  if (!lockPid) return;
  try {
    const raw = readFileSync(lockPath(), 'utf-8').trim();
    if (raw.split(':')[0] === lockPid) unlinkSync(lockPath());
  } catch {}
  lockPid = null;
}
