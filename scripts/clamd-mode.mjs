#!/usr/bin/env node
/**
 * clamd-mode.mjs — `clamd` 常驻的「条件自检 + 一键启用/停用」（2026-10-10）
 *
 * ## 为什么要有这个脚本
 *
 * `clamscan`（瞬态）与 `clamd`（常驻）是**取舍**，不是"哪个更好"：
 *   - `clamscan`：每次扫描**重新载库** ⇒ 本机实测 **≈10 秒、峰值 RSS ≈966 MB（瞬时）**；
 *   - `clamd`：库常驻 ⇒ **亚秒级**，但要 **≈1 GB 常驻内存**。
 * 已定判断规则：**内存 ≥ 8 GiB 且平时可用 ≥ 4 GiB，且每天扫很多次/想下载即扫 ⇒ 上常驻**；否则保持瞬态。
 *
 * ⇒ 本脚本的价值：把"能不能启用"变成**可复跑的判定**，而不是让人凭感觉启。
 * **绝不自动启**：只能被显式调用，不放进启动流程/定时任务/任何默认路径。
 *
 * ## 四道检查（任一条 fail ⇒ 不可启用，不许含糊）
 *   1. 内存：`MemTotal ≥ 8 GiB` 且 `MemAvailable ≥ 4 GiB`（读 `/proc/meminfo`；读不到 ⇒ **无法判定**，
 *      按"不可启用"处理，**绝不当作 pass** ✗）；
 *   2. `clamdscan` 在 PATH 中（纯 Node 扫 PATH；Windows 用 PATHEXT 近似）；
 *   3. `clamd` 可执行文件存在；
 *   4. socket 可用：**已在响应**（能连上并答 PONG ✓）或**父目录可写**（能绑）；
 *      连不上 ⇒ fail 并给出原因（陈旧 socket 之类）✓。
 *
 * ## --enable 的边界（重要）
 * **只启动，不改系统**：不改 `/etc`、不写 systemd 单元、不动系统配置 ✗。
 * 做法：把系统 `/etc/clamav/clamd.conf` 读进来，**在我们自己的临时配置里**改写
 * `LocalSocket`/`PidFile`/`LogFile`/`DatabaseDirectory`/`User`（并**注释掉 TCPSocket**，不开网络监听 ✓），
 * 写到用户可写的临时路径，然后 `clamd --config-file=<临时配置>` 启动（可非 root 用户 `clamav` ✓）。
 *
 * ## --disable 的边界（重要）
 * **只按自己记录的 pid/socket 停**：没有记录 ⇒ **如实报"没找到，可能本来就没在跑"** ✓；
 * **杀之前核对 `/proc/<pid>/comm` 确实是 `clamd`** ⇒ **绝不错杀别的进程** ✗。
 *
 * ## 用法
 *   node scripts/clamd-mode.mjs --check      # 四道检查 + 结论（可启用 ⇒ exit 0；不可启用 ⇒ exit 1）
 *   node scripts/clamd-mode.mjs --enable     # 全过才启用，否则拒绝并打印原因（exit 1）
 *   node scripts/clamd-mode.mjs --disable    # 按记录停止（没有记录就如实报）
 *   node scripts/clamd-mode.mjs --self-check # 注入式自证（双向、可证伪）
 *
 * 环境变量（给自证/测试用，正常不用）：
 *   PI_CLAMD_SOCKET  覆盖 socket 路径（默认 <tmpdir>/clamd.sock）
 *   PI_CLAMD_CONF    覆盖临时配置路径
 *   PI_CLAMD_NO_SPAWN=1  只打印将要执行的命令，不真的启动（预演）
 */

import { accessSync, constants as fsConstants, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter as pathDelimiter, dirname, join } from 'node:path';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { platform, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const GIB = 1024 ** 3;
export const MIN_TOTAL_BYTES = 8 * GIB; // ≥ 8 GiB
export const MIN_AVAIL_BYTES = 4 * GIB; // ≥ 4 GiB
export const DEFAULT_SOCKET = process.env.PI_CLAMD_SOCKET || join(tmpdir(), 'clamd.sock');
export const CONF_FILE = process.env.PI_CLAMD_CONF || join(tmpdir(), 'clamd-pi.conf');
export const PID_FILE = join(tmpdir(), 'clamd-pi.pid');
export const LOG_FILE = join(tmpdir(), 'clamd-pi.log');
export const STATE_FILE = join(tmpdir(), 'clamd-pi.state.json');

const giB = (bytes) => (bytes / GIB).toFixed(2);

/* ------------------------------------------------------------------ 纯逻辑（可注入、可测） */

/** 解析 /proc/meminfo ⇒ { totalBytes, availBytes }；读不到/字段缺失 ⇒ null（**不猜**） */
export function parseMeminfo(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const pick = (key) => {
    const m = text.match(new RegExp('^' + key + ':\\s+(\\d+)\\s+kB', 'm'));
    return m ? Number(m[1]) * 1024 : null;
  };
  const totalBytes = pick('MemTotal');
  const availBytes = pick('MemAvailable');
  if (totalBytes === null || availBytes === null) return null;
  return { totalBytes, availBytes };
}

export function checkMemory(mem) {
  const name = `内存：MemTotal ≥ 8 GiB 且 MemAvailable ≥ 4 GiB`;
  if (!mem) {
    return { id: 'memory', name, pass: false, detail: '无法判定：读不到 /proc/meminfo（非 Linux？）⇒ 按"不可启用"处理，绝不当作 pass' };
  }
  const ok = mem.totalBytes >= MIN_TOTAL_BYTES && mem.availBytes >= MIN_AVAIL_BYTES;
  const bad = [];
  if (mem.totalBytes < MIN_TOTAL_BYTES) bad.push(`总内存不足（${giB(mem.totalBytes)} < 8 GiB）`);
  if (mem.availBytes < MIN_AVAIL_BYTES) bad.push(`可用内存不足（${giB(mem.availBytes)} < 4 GiB）`);
  return {
    id: 'memory',
    name,
    pass: ok,
    detail: `MemTotal ${giB(mem.totalBytes)} GiB、MemAvailable ${giB(mem.availBytes)} GiB` + (ok ? '' : ` ⇒ ${bad.join('；')}`),
    values: { totalGiB: giB(mem.totalBytes), availGiB: giB(mem.availBytes) },
  };
}

/** 纯 Node 扫 PATH（不调外部命令；Windows 用 PATHEXT 近似） */
export function makeFindBin(pathValue, plat, exists) {
  const exts = plat === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return (name) => {
    for (const dir of String(pathValue || '').split(plat === 'win32' ? ';' : pathDelimiter)) {
      if (!dir) continue;
      for (const ext of exts) {
        const full = join(dir, name + ext);
        if (exists(full)) return full;
      }
    }
    return null;
  };
}

/** socket 判定：已有且在响应 ⇒ pass；有文件但连不上 ⇒ fail；无文件 ⇒ 看父目录可写 */
export async function checkSocket({ socketPath, hasSocketFile, responds, parentWritable }) {
  const name = `socket：能绑（父目录可写）或已有守护在响应`;
  if (hasSocketFile(socketPath)) {
    const ok = await responds(socketPath);
    return {
      id: 'socket',
      name,
      pass: ok,
      detail: ok
        ? `${socketPath} 上已有守护在响应（PONG）`
        : `${socketPath} 上存在 socket 文件但**连不上**（陈旧 socket？）⇒ 先清理它或换路径`,
    };
  }
  const ok = parentWritable(socketPath);
  return {
    id: 'socket',
    name,
    pass: ok,
    detail: ok ? `${socketPath} 不存在，但父目录 ${dirname(socketPath)} 可写 ⇒ 能绑` : `父目录 ${dirname(socketPath)} 不可写 ⇒ 无法绑 socket`,
  };
}

/** 四道检查（依赖全注入 ⇒ 可测） */
export async function evaluateChecks(deps) {
  const checks = [];
  if (deps.platform === 'win32') {
    return {
      verdict: '不适用',
      checks: [{ id: 'platform', name: '平台', pass: false, detail: 'Windows：本脚本只处理 Linux 的 clamd 常驻（如实报"不适用"，不假装支持）' }],
    };
  }
  checks.push(checkMemory(deps.mem ? parseMeminfo(deps.mem()) : null));
  const clamdscan = deps.findBin('clamdscan');
  checks.push({
    id: 'clamdscan',
    name: 'clamdscan 在 PATH 中（没有它就无法"快速扫描"）',
    pass: Boolean(clamdscan),
    detail: clamdscan ? `找到 ${clamdscan}` : 'PATH 里没有 clamdscan ⇒ 装了 clamav-daemon 也未必带它（本机实测就不带）',
  });
  const clamd = deps.findBin('clamd');
  checks.push({
    id: 'clamd',
    name: 'clamd 可执行文件存在',
    pass: Boolean(clamd),
    detail: clamd ? `找到 ${clamd}` : 'PATH 里没有 clamd（需要 clamav-daemon 包）',
  });
  checks.push(await checkSocket({ socketPath: deps.socketPath, hasSocketFile: deps.hasSocketFile, responds: deps.responds, parentWritable: deps.parentWritable }));
  const failed = checks.filter((c) => !c.pass);
  return { verdict: failed.length === 0 ? '可启用' : '不可启用', checks, failedIds: failed.map((c) => c.id) };
}

/* ------------------------------------------------------------------ 真实依赖 */

function realFindBin(name) {
  return makeFindBin(process.env.PATH, platform(), (p) => existsSync(p))(name);
}

/** 真连 socket 并说 PING，等待 PONG（clamd 的协议）⇒ 只有**真答话**才算"在响应" */
export function clamdPing(socketPath, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let done = false;
    let buf = '';
    const sock = connect(socketPath);
    const fin = (ok) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* 忽略 */
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => fin(false));
    sock.on('error', () => fin(false));
    sock.on('connect', () => {
      try {
        sock.write('PING\n');
      } catch {
        fin(false);
      }
    });
    sock.on('data', (d) => {
      buf += d.toString();
      if (/PONG/i.test(buf)) fin(true);
    });
    sock.on('end', () => fin(/PONG/i.test(buf)));
  });
}

function realDeps() {
  return {
    platform: platform(),
    mem: () => {
      try {
        return readFileSync('/proc/meminfo', 'utf8');
      } catch {
        return null;
      }
    },
    findBin: realFindBin,
    socketPath: DEFAULT_SOCKET,
    hasSocketFile: (p) => existsSync(p),
    responds: (p) => clamdPing(p),
    parentWritable: (p) => {
      try {
        accessSync(dirname(p), fsConstants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/* ------------------------------------------------------------------ 输出 */

function printResult(res) {
  console.log(`结论：${res.verdict}`);
  for (const c of res.checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name} —— ${c.detail}`);
}

/* ------------------------------------------------------------------ --enable / --disable */

const PATCH_KEYS = [
  'LocalSocket',
  'LocalSocketGroup',
  'LocalSocketMode',
  'PidFile',
  'LogFile',
  'LogTime',
  'DatabaseDirectory',
  'User',
  'Foreground',
  'TCPSocket',
  'TCPAddr',
  'FixStaleSocket',
];

export function readPasswdUser(name) {
  try {
    const txt = readFileSync('/etc/passwd', 'utf8');
    return txt.split('\n').some((l) => l.startsWith(name + ':'));
  } catch {
    return false;
  }
}

/** 生成**我们自己的**临时配置：不改 /etc，只把关键项改写成用户可写路径，并关掉 TCP 监听 */
export function buildConf({ base, socket, pidFile, logFile, dbDir, user }) {
  const lines = String(base || '')
    .split('\n')
    .filter((l) => {
      const bare = l.trim().replace(/^#\s*/, '');
      return !PATCH_KEYS.some((k) => bare.startsWith(k));
    })
    .filter((l, i, arr) => !(l.trim() === '' && arr[i - 1] !== undefined && arr[i - 1].trim() === ''));
  const add = [
    '# 由 scripts/clamd-mode.mjs 生成（临时文件；不改系统 /etc，不写 systemd 单元）',
    `DatabaseDirectory ${dbDir}`,
    `LocalSocket ${socket}`,
    'LocalSocketMode 660',
    `PidFile ${pidFile}`,
    `LogFile ${logFile}`,
    'LogTime yes',
    'FixStaleSocket yes',
    'Foreground no',
    '# TCPSocket/TCPAddr 一律不设 ⇒ 不开网络监听（只走本地 unix socket）',
  ];
  if (user) add.splice(1, 0, `User ${user}`);
  return [add.join('\n'), ...lines].join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

async function pollSocket(socketPath, timeoutMs = 90000, stepMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await clamdPing(socketPath, 1200)) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

async function cmdEnable() {
  const res = await evaluateChecks(realDeps());
  printResult(res);
  if (res.verdict !== '可启用') {
    console.error(`拒绝启用：${res.verdict}（未通过：${(res.failedIds || []).join(', ') || '平台不适用'}）。`);
    console.error('说明：这四道检查是**门槛**，不是建议 —— 不满足就保持瞬态（clamscan），别硬启。');
    process.exit(1);
  }
  const user = readPasswdUser('clamav') ? 'clamav' : null;
  let base = '';
  try {
    base = readFileSync('/etc/clamav/clamd.conf', 'utf8');
  } catch {
    base = '';
  }
  const conf = buildConf({ base, socket: DEFAULT_SOCKET, pidFile: PID_FILE, logFile: LOG_FILE, dbDir: '/var/lib/clamav', user });
  writeFileSync(CONF_FILE, conf, 'utf8');
  rmSync(STATE_FILE, { force: true });
  rmSync(PID_FILE, { force: true });
  const clamd = realFindBin('clamd');
  console.log(`将启动：${clamd} --config-file=${CONF_FILE}`);
  console.log(`socket：${DEFAULT_SOCKET}｜pid 文件：${PID_FILE}｜日志：${LOG_FILE}` + (user ? `｜运行用户：${user}` : '｜运行用户：当前用户'));
  if (process.env.PI_CLAMD_NO_SPAWN === '1') {
    console.log('（PI_CLAMD_NO_SPAWN=1：预演，不真的启动）');
    return;
  }
  const child = spawn(clamd, [`--config-file=${CONF_FILE}`], { detached: true, stdio: 'ignore' });
  child.unref();
  const ok = await pollSocket(DEFAULT_SOCKET);
  if (!ok) {
    console.error('启动后等待 socket 响应超时 ⇒ 如实报失败（可能库缺失/权限问题）。日志尾部：');
    try {
      console.error(readFileSync(LOG_FILE, 'utf8').split('\n').slice(-8).join('\n'));
    } catch {
      console.error('（读不到日志文件）');
    }
    process.exit(1);
  }
  let pid = null;
  try {
    pid = Number(readFileSync(PID_FILE, 'utf8').trim()) || null;
  } catch {
    pid = null;
  }
  writeFileSync(STATE_FILE, JSON.stringify({ pid, socket: DEFAULT_SOCKET, startedAt: new Date().toISOString(), by: 'clamd-mode.mjs' }, null, 1), 'utf8');
  console.log(`✅ 已启用：socket ${DEFAULT_SOCKET} 在响应（PONG）` + (pid ? `，pid=${pid}` : '（未读到 pid 文件，仍是启动成功；--disable 会如实处理）'));
}

async function cmdDisable() {
  let st = null;
  try {
    st = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    st = null;
  }
  if (!st || !st.pid) {
    const responding = await clamdPing(DEFAULT_SOCKET, 1200);
    console.log('没找到由本脚本记录的 pid 状态文件（可能本来就没在跑，或不是本脚本启动的）。');
    console.log(responding ? `注意：${DEFAULT_SOCKET} 上**有**守护在响应，但它不是本脚本启的 ⇒ 不擅自停止 ✗（要停请自行处理）。` : '并且目标 socket 也没有响应 ⇒ 无需处理 ✓。');
    return;
  }
  let comm = '';
  try {
    comm = readFileSync(`/proc/${st.pid}/comm`, 'utf8').trim();
  } catch {
    comm = '';
  }
  if (comm !== 'clamd') {
    console.error(`拒绝停止：pid ${st.pid} 的进程名是 "${comm || '读不到'}"，不是 clamd ⇒ 绝不错杀 ✗。请人工核对。`);
    process.exit(1);
  }
  try {
    process.kill(st.pid, 'SIGTERM');
  } catch (e) {
    console.error(`发送 SIGTERM 失败：${e.message}（进程可能已退出）`);
  }
  const deadline = Date.now() + 20000;
  let stopped = false;
  while (Date.now() < deadline) {
    if (!(await clamdPing(DEFAULT_SOCKET, 800))) {
      stopped = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  rmSync(STATE_FILE, { force: true });
  console.log(stopped ? `✅ 已停止 clamd（pid ${st.pid}），socket 不再响应 ✓` : `已发送 SIGTERM，但 socket 仍在响应 ⇒ 如实报"可能没停干净"，请人工确认 ✗`);
}

/* ------------------------------------------------------------------ --self-check（双向、可证伪） */

const MEM_OK = 'MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n'; // 16 GiB / 8 GiB
const MEM_LOW_TOTAL = 'MemTotal:        4194304 kB\nMemAvailable:    3145728 kB\n'; // 4 GiB / 3 GiB
const MEM_LOW_AVAIL = 'MemTotal:       16777216 kB\nMemAvailable:    1048576 kB\n'; // 16 GiB / 1 GiB

async function selfCheck() {
  const mk = ({ mem, hasClamdscan = true, hasClamd = true, sockFile = false, sockResponds = false, parentWritable = true }) => ({
    platform: 'linux',
    mem: () => mem,
    findBin: (n) => (n === 'clamdscan' ? (hasClamdscan ? '/usr/bin/clamdscan' : null) : hasClamd ? '/usr/sbin/clamd' : null),
    socketPath: '/tmp/clamd.sock',
    hasSocketFile: () => sockFile,
    responds: async () => sockResponds,
    parentWritable: () => parentWritable,
  });

  const cases = [
    { label: '全部满足', deps: mk({ mem: MEM_OK }), expect: '可启用', expectFail: null },
    { label: '内存不足（总内存）', deps: mk({ mem: MEM_LOW_TOTAL }), expect: '不可启用', expectFail: 'memory' },
    { label: '内存不足（可用）', deps: mk({ mem: MEM_LOW_AVAIL }), expect: '不可启用', expectFail: 'memory' },
    { label: '读不到 /proc/meminfo', deps: mk({ mem: null }), expect: '不可启用', expectFail: 'memory' },
    { label: '没有 clamdscan', deps: mk({ mem: MEM_OK, hasClamdscan: false }), expect: '不可启用', expectFail: 'clamdscan' },
    { label: '没有 clamd', deps: mk({ mem: MEM_OK, hasClamd: false }), expect: '不可启用', expectFail: 'clamd' },
    { label: 'socket 存在但连不上', deps: mk({ mem: MEM_OK, sockFile: true, sockResponds: false }), expect: '不可启用', expectFail: 'socket' },
    { label: 'socket 已在响应', deps: mk({ mem: MEM_OK, sockFile: true, sockResponds: true }), expect: '可启用', expectFail: null },
    { label: '无 socket 但父目录不可写', deps: mk({ mem: MEM_OK, parentWritable: false }), expect: '不可启用', expectFail: 'socket' },
  ];

  let bad = 0;
  for (const c of cases) {
    const r = await evaluateChecks(c.deps);
    const okVerdict = r.verdict === c.expect;
    const okFail = c.expectFail === null ? true : (r.failedIds || []).includes(c.expectFail);
    const pass = okVerdict && okFail;
    if (!pass) bad++;
    console.log(`  ${pass ? '✓' : '✗'} ${c.label} ⇒ ${r.verdict}` + (c.expectFail ? `（未通过项应含 ${c.expectFail}：${okFail ? '是' : '否'}）` : ''));
  }

  // 反向断言：一个"永远返回可启用"的假实现**必须**在至少一个用例上失败（否则断言无能）
  const fakeAlwaysEnable = async () => ({ verdict: '可启用', checks: [], failedIds: [] });
  const fakeResults = [];
  for (const c of cases) {
    const r = await fakeAlwaysEnable(c.deps);
    fakeResults.push(r.verdict === c.expect);
  }
  const fakeFailsSomewhere = fakeResults.some((ok) => ok === false);
  const fakeMatchesAll = fakeResults.every(Boolean);
  console.log(`  反向断言：假实现"永远可启用"在 ${fakeResults.filter((x) => !x).length}/${cases.length} 个用例上与期望不符 ⇒ ${fakeFailsSomewhere ? '断言有分辨力 ✓' : '断言无分辨力 ✗'}`);
  if (fakeMatchesAll) bad++;
  if (fakeFailsSomewhere === false) bad++;

  console.log(bad === 0 ? '✅ 自证通过（九种情形 + 反向断言：假实现必然被抓）' : `❌ 自证失败（${bad} 项）`);
  process.exit(bad === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ main */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-check')) return selfCheck();
  if (argv.includes('--check')) {
    const res = await evaluateChecks(realDeps());
    printResult(res);
    process.exit(res.verdict === '可启用' ? 0 : 1);
  }
  if (argv.includes('--enable')) return cmdEnable();
  if (argv.includes('--disable')) return cmdDisable();
  console.error('用法：--check ｜ --enable ｜ --disable ｜ --self-check（见文件头注释）');
  process.exit(2);
}

// **只有作为主程序运行时才执行**（2026-10-10 修）：否则 `import` 本模块做单测/复用纯函数时，
// 会连带执行 main() 并把调用方的参数当成自己的参数（实测表现：只打印用法并 exit 2）✗。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

// 说明：本脚本**不被任何东西自动调用**（不进启动流程/定时任务/默认路径）；
// 每次运行都要有人显式敲命令 ⇒ 这是"不自动启"的保证。
