/**
 * web-terminal/stale-sessions.ts — 孤儿 pty 会话识别（纯逻辑，零 Pi 依赖）
 *
 * 为什么需要：`PtySession` 的 teardown 只在进程**正常退出**时运行（SIGINT/SIGTERM → handle.close()）。
 * 服务器若被 SIGKILL、崩溃或断电，`script` → `pi-supervisor.sh` → `pi` 这条链会被 reparent 到
 * PID 1，**永远不会自己退出**——每发生一次就永久泄漏一个 my-pi TUI 与一个 pty。
 * 实测：一次排查过程因探针 SIGKILL 服务器，留下 12 个孤儿会话（24 个进程）。
 *
 * 识别依据：临时 tty 文件名内嵌了**创建它的服务器进程 pid**：
 *   `<tmpdir>/mypi-web-tty-<serverPid>-<8 位随机 hex>`
 * 于是"属主 pid 已不存在"就是"该会话已无人在管"的可靠判据：
 *   - 同一台机器上的另一个**活着的**服务器，其 pid 存在 → 不会被误回收（天然支持多实例）；
 *   - pid 复用只会造成**漏回收**（保守失败），不会误杀活会话。
 *
 * 本模块只做判定，不做任何进程操作（信号/ps 在 pty-session.ts 侧）。
 */

/** 临时 tty 文件名前缀（创建与识别共用，改这里即改全局） */
export const TTY_FILE_PREFIX = 'mypi-web-tty-'

/** 从临时文件名解析属主 pid；不是本服务的文件或格式不符时返回 null */
export function parseOwnerPid(fileName: string): number | null {
  if (!fileName.startsWith(TTY_FILE_PREFIX)) return null
  const rest = fileName.slice(TTY_FILE_PREFIX.length)
  const match = /^(\d+)-[0-9a-f]+$/.exec(rest)
  if (match === null) return null
  const pid = Number(match[1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

export interface StaleSessionCandidate {
  name: string
  ownerPid: number
}

/**
 * 从候选文件名中挑出**可以回收**的孤儿会话。
 *
 * @param fileNames         `tmpdir()` 下以 `TTY_FILE_PREFIX` 开头的文件名
 * @param isAlive           属主 pid 是否仍存在（EPERM 也算存在）
 * @param selfPid           当前进程 pid；属主等于自己时永不回收（防御性，启动时本不存在）
 */
export function selectStaleSessions(
  fileNames: readonly string[],
  isAlive: (pid: number) => boolean,
  selfPid: number = process.pid,
): StaleSessionCandidate[] {
  const out: StaleSessionCandidate[] = []
  for (const name of fileNames) {
    const ownerPid = parseOwnerPid(name)
    if (ownerPid === null) continue
    if (ownerPid === selfPid) continue
    if (isAlive(ownerPid)) continue
    out.push({ name, ownerPid })
  }
  return out
}

/**
 * 属主 pid 是否仍存在。
 *
 * `process.kill(pid, 0)` 在**无权限**时抛 EPERM —— 那也是"存在"，必须算活着，
 * 否则会把别的用户的会话当孤儿回收。
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === 'EPERM'
  }
}
