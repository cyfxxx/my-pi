/**
 * web-terminal/args.ts — 命令行参数解析（纯逻辑，零 Pi 依赖）
 *
 * 单独成文件是为了可单测：端口/cookie 天数这类输入会被夹取到安全范围，
 * 非法值必须回退默认而不是把 NaN 传进 `listen()`。
 */

import { DEFAULT_COOKIE_DAYS } from './auth'

export const DEFAULT_PORT = 7717

export interface WebTerminalArgs {
  port: number
  cookieDays: number
  trustedHosts: string[]
  /** 覆盖被拉起的命令（调试用）；undefined 表示使用默认的 my-pi.sh。 */
  command: string | undefined
  cwd: string | undefined
  /** 只回收孤儿 pty 会话后退出（不起服务）：清理服务器被 SIGKILL 后留下的 my-pi TUI。 */
  sweep: boolean
  help: boolean
}

export function parseArgs(argv: readonly string[]): WebTerminalArgs {
  const args: WebTerminalArgs = {
    port: DEFAULT_PORT,
    cookieDays: DEFAULT_COOKIE_DAYS,
    trustedHosts: [],
    command: undefined,
    cwd: undefined,
    sweep: false,
    help: false,
  }
  // `Number('')` 是 0、`Number('abc')` 是 NaN：这里把"缺值/空值"显式排除，
  // 否则 `--port ''` 会被当成合法的 0（系统分配端口），掩盖手误。
  const numeric = (value: string | undefined): number | undefined => {
    if (value === undefined || value.trim() === '') return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--port': {
        const parsed = numeric(value)
        if (parsed !== undefined) args.port = parsed
        i++
        break
      }
      case '--cookie-days': {
        const parsed = numeric(value)
        if (parsed !== undefined) args.cookieDays = parsed
        i++
        break
      }
      case '--trusted-host':
        if (value !== undefined) args.trustedHosts.push(value)
        i++
        break
      case '--command':
        args.command = value
        i++
        break
      case '--cwd':
        args.cwd = value
        i++
        break
      case '--sweep':
        args.sweep = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        break
    }
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) args.port = DEFAULT_PORT
  if (!Number.isFinite(args.cookieDays) || args.cookieDays <= 0) args.cookieDays = DEFAULT_COOKIE_DAYS
  return args
}

export const HELP_TEXT = `my-pi web-terminal — 用浏览器访问 my-pi（只绑定 127.0.0.1）

用法: bash scripts/web-terminal.sh [选项]

  --port <n>          监听端口，默认 ${DEFAULT_PORT}；0 表示由系统分配
  --cookie-days <n>   授权 cookie 有效期（天），默认 ${DEFAULT_COOKIE_DAYS}
  --trusted-host <h>  额外允许的 Host，可重复（默认只信任回环）
  --command <shell>   覆盖被拉起的命令（调试用）
  --cwd <dir>         工作目录，默认项目根
  --sweep             只回收孤儿 pty 会话（服务器被强杀后留下的 my-pi TUI）后退出，不起服务
  -h, --help          显示本帮助

远程访问：先建隧道，再用打印出的带 token 地址打开
  ssh -N -L ${DEFAULT_PORT}:127.0.0.1:${DEFAULT_PORT} <user>@<host>

启动时会自动回收孤儿会话（属主服务器已消失的 pty）；设 PI_WEB_TERMINAL_SWEEP=off 可关闭。
`
