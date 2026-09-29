/**
 * web-terminal/pty-session.ts — pty 会话（零 Pi 依赖）
 *
 * 为什么需要这一层：浏览器要跑的是 my-pi 的**交互式 TUI**，而 `main.ts` 只有在 stdin/stdout
 * 都是 TTY 时才进 interactive 模式，否则静默掉进 print 模式（一次性输出后退出）。Node 自身
 * 没有分配 pty 的 API，本项目也不引入 node-pty（需要本地编译）。这里改用 util-linux 的
 * `script(1)` 分配 pty：
 *
 *   script -q -e -f -E never -c '<prelude>; exec <command>' /dev/null
 *
 * prelude 做两件事：把自己的 tty 路径写进临时文件（供外部改尺寸用）、设置初始行列数。
 * 之后每次浏览器改窗口大小时，对那个 pty 执行
 *
 *   stty -F <pty> rows R cols C
 *
 * 内核会给该 pty 前台进程组发 SIGWINCH，pi 的 TUI 据此重绘——实测有效（见 DECISIONS）。
 * 这条路径不需要额外依赖，`script`/`stty` 在 util-linux/coreutils 里，任何 Linux 都有。
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** 尺寸下限/上限：防止前端传 0 或异常大值把 TUI 挤坏。 */
export const PTY_MIN_COLS = 20
export const PTY_MAX_COLS = 500
export const PTY_MIN_ROWS = 5
export const PTY_MAX_ROWS = 200

const DEFAULT_BUFFER_LIMIT = 4 * 1024 * 1024
const DEFAULT_TTY_DISCOVERY_MS = 2000

export interface PtySize {
  cols: number
  rows: number
}

/** 夹取尺寸到安全区间；NaN/非数字折回默认值，±Infinity 则夹到上下界。 */
export function clampPtySize(cols: number, rows: number): PtySize {
  return { cols: clampAxis(cols, 80, PTY_MIN_COLS, PTY_MAX_COLS), rows: clampAxis(rows, 24, PTY_MIN_ROWS, PTY_MAX_ROWS) }
}

function clampAxis(value: number, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return Math.min(max, Math.max(min, fallback))
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * 构造交给 `script -c` 的 shell 片段。
 *
 * `command` 是一段 shell 片段而非 argv（默认 `bash '<root>/my-pi.sh'`），这样 `--command`
 * 覆盖时可以传管道/复合命令，便于自检。
 */
export function buildPtyShellCommand(options: {
  ttyFile: string
  cols: number
  rows: number
  command: string
}): string {
  const size = clampPtySize(options.cols, options.rows)
  const prelude = [
    `tty > ${shellQuote(options.ttyFile)} 2>/dev/null`,
    `stty rows ${size.rows} cols ${size.cols} 2>/dev/null`,
  ].join('; ')
  return `${prelude}; exec ${options.command}`
}

export interface PtyExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface PtySessionOptions {
  /** shell 片段，例如 `bash '/root/my-pi/my-pi.sh'`。 */
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
  /** 输出回放缓冲上限（字节）。超出后丢弃最旧的整块。 */
  bufferLimit?: number
  /** 等待 pty 从设备路径出现的上限（毫秒）。 */
  ttyDiscoveryTimeoutMs?: number
}

export type PtyDataListener = (chunk: Buffer) => void
export type PtyExitListener = (info: PtyExitInfo) => void

/**
 * 单个 pty 会话：spawn `script`、广播输出、转发输入、改尺寸、退出后重启。
 *
 * 允许多个订阅者（多个浏览器标签页）同时观察同一会话；输入来自任意订阅者。
 */
export class PtySession {
  private readonly options: PtySessionOptions
  private readonly bufferLimit: number
  private readonly ttyDiscoveryTimeoutMs: number
  private readonly dataListeners = new Set<PtyDataListener>()
  private readonly exitListeners = new Set<PtyExitListener>()
  private readonly chunks: Buffer[] = []

  private child: ChildProcess | null = null
  private ttyFile: string | undefined
  private ttyPath: string | undefined
  private bufferedBytes = 0
  private stderrTail = ''
  private size: PtySize
  private exitInfo: PtyExitInfo | null = null

  constructor(options: PtySessionOptions) {
    this.options = options
    this.bufferLimit = options.bufferLimit ?? DEFAULT_BUFFER_LIMIT
    this.ttyDiscoveryTimeoutMs = options.ttyDiscoveryTimeoutMs ?? DEFAULT_TTY_DISCOVERY_MS
    this.size = clampPtySize(options.cols, options.rows)
  }

  /** 启动 `script` 并等待 pty 从设备路径被发现（通常 < 100ms）。 */
  async start(): Promise<void> {
    if (this.child !== null) throw new Error('pty 会话已启动')
    this.ttyFile = join(tmpdir(), `mypi-web-tty-${process.pid}-${randomBytes(4).toString('hex')}`)
    rmSync(this.ttyFile, { force: true })
    this.exitInfo = null

    const command = buildPtyShellCommand({
      ttyFile: this.ttyFile,
      cols: this.size.cols,
      rows: this.size.rows,
      command: this.options.command,
    })

    const child = spawn('script', ['-q', '-e', '-f', '-E', 'never', '-c', command, '/dev/null'], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // 独立进程组：退出时用 kill(-pid) 连带收拾 pi 及其子进程。
      detached: true,
    })
    this.child = child

    child.stdout?.on('data', (chunk: Buffer) => this.pushOutput(chunk))
    child.stderr?.on('data', (chunk: Buffer) => this.appendStderr(chunk))
    child.on('error', (error) => {
      this.appendStderr(Buffer.from(`spawn script 失败: ${error.message}\n`, 'utf8'))
      this.finish({ code: null, signal: null })
    })
    child.on('exit', (code, signal) => this.finish({ code, signal }))

    await this.discoverTty()
  }

  /** 是否仍在运行。 */
  get alive(): boolean {
    return this.exitInfo === null
  }

  /** 当前（已生效或待生效的）尺寸。 */
  get terminalSize(): PtySize {
    return { cols: this.size.cols, rows: this.size.rows }
  }

  /** 退出信息；运行中为 null。 */
  get exit(): PtyExitInfo | null {
    return this.exitInfo
  }

  /** `script` 自身 stderr 的尾部（诊断用；子进程 stderr 走 pty，不在这里）。 */
  get diagnostics(): string {
    return this.stderrTail
  }

  /** 启动时使用的 shell 片段（前端标题/诊断展示用）。 */
  get command(): string {
    return this.options.command
  }

  /** pty 从设备路径；未发现时为 undefined（此时 resize 会静默失败）。 */
  get terminalPath(): string | undefined {
    return this.ttyPath
  }

  /** 回放缓冲：从会话开始（或缓冲上限内最早的）到现在的原始输出。 */
  replay(): Buffer {
    return Buffer.concat(this.chunks)
  }

  /** 写入输入（键盘字节）。会话已退出时静默忽略。 */
  write(data: Buffer): void {
    const stdin = this.child?.stdin
    if (!stdin || stdin.destroyed) return
    try {
      stdin.write(data)
    } catch {
      // 对端已关闭（用户刚退出 agent）：丢弃本次输入即可，不必上抛。
    }
  }

  /**
   * 调整 pty 尺寸。返回尺寸是否真的变更**且已应用到 pty**（供调用方决定是否广播）。
   * 尺寸变化即使 pty 尚未发现也会被记住，发现后会用于后续改尺寸。
   */
  async resize(cols: number, rows: number): Promise<boolean> {
    const next = clampPtySize(cols, rows)
    const changed = next.cols !== this.size.cols || next.rows !== this.size.rows
    this.size = next
    if (!changed) return false
    const tty = this.ttyPath
    if (tty === undefined) return false
    return runStty(tty, next.cols, next.rows)
  }

  /**
   * 注册输出监听并**原子地**拿到当前回放缓冲。
   *
   * 分两步（先 subscribe 再 replay）会漏掉两步之间的输出，或者重复发送；先 replay
   * 再 subscribe 则会丢块。这里在同一个同步调用里完成，JS 单线程保证期间不会有 `data`
   * 事件插入，因此既无缺口也无重复。
   */
  attach(listener: PtyDataListener): { snapshot: Buffer; detach: () => void } {
    const snapshot = this.replay()
    this.dataListeners.add(listener)
    return {
      snapshot,
      detach: () => {
        this.dataListeners.delete(listener)
      },
    }
  }

  /**
   * 触发一次 TUI 全屏重绘。
   *
   * 用途：客户端重放缓冲可能从中途开始（缓冲上限截断），画面会是半截状态；重连时
   * 尺寸往往没变，`resize()` 不会发 SIGWINCH，于是需要一个"抖动"：先把行数改 1 再改回来，
   * 两次 TIOCSWINSZ 都会给前台进程组发 SIGWINCH，pi 的 TUI 遂整屏重画。
   */
  async forceRedraw(): Promise<boolean> {
    const tty = this.ttyPath
    if (tty === undefined) return false
    const { cols, rows } = this.size
    const nudgedRows = rows > PTY_MIN_ROWS ? rows - 1 : rows + 1
    const first = await runStty(tty, cols, nudgedRows)
    const second = await runStty(tty, cols, rows)
    return first && second
  }

  onExit(listener: PtyExitListener): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  /** 结束当前进程组与负载，并清空回放缓冲（用于「重启会话」）。 */
  async restart(): Promise<void> {
    await this.terminate()
    this.chunks.length = 0
    this.bufferedBytes = 0
    this.stderrTail = ''
    this.ttyPath = undefined
    this.child = null
    await this.start()
  }

  /** 结束负载（含子进程树）并删除临时 tty 文件。 */
  async dispose(): Promise<void> {
    await this.terminate()
    if (this.ttyFile !== undefined) rmSync(this.ttyFile, { force: true })
  }

  /**
   * 结束 `script` 及其负载。
   *
   * 关键细节：`script` 会让负载 `setsid()` 另立会话（这样 pty 才成为它的控制终端），
   * 于是负载在**另一个进程组**里——只对 `script` 自己的进程组发信号波及不到 agent。
   * 实测：`script` pid 14560（pgid 14560）→ `sh -c sleep 300` pid 14561（pgid 14561）。
   * 因此这里两处都发：`script` 的进程组 + 全部后代所在进程组；并 SIGTERM→SIGKILL 升级，
   * 因为负载可能阻塞在子进程上而推迟处理 SIGTERM。
   */
  private async terminate(): Promise<void> {
    const child = this.child
    if (child === null || child.pid === undefined) return

    const groups = await descendantProcessGroups(child.pid)
    const targets = new Set<number>([child.pid, ...groups])

    for (const pid of targets) signalGroup(pid, 'SIGTERM')
    await delay(TERMINATE_GRACE_MS)
    for (const pid of targets) signalGroup(pid, 'SIGKILL')
  }

  private pushOutput(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.bufferedBytes += chunk.length
    while (this.bufferedBytes > this.bufferLimit && this.chunks.length > 1) {
      const dropped = this.chunks.shift()
      if (dropped === undefined) break
      this.bufferedBytes -= dropped.length
    }
    for (const listener of this.dataListeners) listener(chunk)
  }

  private appendStderr(chunk: Buffer): void {
    this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-4096)
  }

  private finish(info: PtyExitInfo): void {
    if (this.exitInfo !== null) return
    this.exitInfo = info
    for (const listener of this.exitListeners) listener(info)
  }

  private async discoverTty(): Promise<void> {
    const ttyFile = this.ttyFile
    if (ttyFile === undefined) return
    const deadline = Date.now() + this.ttyDiscoveryTimeoutMs
    while (Date.now() < deadline) {
      if (existsSync(ttyFile)) {
        const value = readFileSync(ttyFile, 'utf8').trim()
        if (value.startsWith('/dev/')) {
          this.ttyPath = value
          return
        }
      }
      if (this.exitInfo !== null) return
      await delay(50)
    }
  }
}

function runStty(tty: string, cols: number, rows: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {    execFile('stty', ['-F', tty, 'rows', String(rows), 'cols', String(cols)], (error) => {
      resolve(error === null)
    })
  })
}

/** SIGTERM 之后等待多久升级到 SIGKILL（负载可能正阻塞在子进程上而不处理 SIGTERM）。 */
const TERMINATE_GRACE_MS = 400

/** 向进程组发信号；组不存在时退回单进程；两者都失败视为已退出。 */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // 已经退出
    }
  }
}

/**
 * 列出 `pid` 全部后代所在的进程组。
 *
 * 用 `ps` 而不是读 `/proc`：macOS 没有 procfs，而 `ps -eo pid=,ppid=,pgid=` 两个平台都支持。
 * 只取直接子进程不够——`script` 的子进程 setsid 之后，孙进程在启用作业控制时还可能另立进程组。
 */
function descendantProcessGroups(pid: number): Promise<number[]> {
  return new Promise<number[]>((resolve) => {
    execFile('ps', ['-eo', 'pid=,ppid=,pgid='], (error, stdout) => {
      if (error !== null) {
        resolve([])
        return
      }
      const childrenOf = new Map<number, number[]>()
      const pgidOf = new Map<number, number>()
      for (const line of stdout.split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
        if (match === null) continue
        const childPid = Number(match[1])
        const parentPid = Number(match[2])
        pgidOf.set(childPid, Number(match[3]))
        const siblings = childrenOf.get(parentPid)
        if (siblings === undefined) childrenOf.set(parentPid, [childPid])
        else siblings.push(childPid)
      }
      const groups = new Set<number>()
      const seen = new Set<number>([pid])
      const queue = [pid]
      while (queue.length > 0) {
        const current = queue.pop()
        if (current === undefined) break
        for (const childPid of childrenOf.get(current) ?? []) {
          if (seen.has(childPid)) continue
          seen.add(childPid)
          const group = pgidOf.get(childPid)
          if (group !== undefined) groups.add(group)
          queue.push(childPid)
        }
      }
      resolve([...groups])
    })
  })
}
