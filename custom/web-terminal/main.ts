/**
 * web-terminal/main.ts — 浏览器终端入口
 *
 * 用法（经 `scripts/web-terminal.sh` 调用，或直接 `bash scripts/run-ts.sh custom/web-terminal/main.ts`）：
 *   --port <n>            监听端口（默认 7717；0 表示由系统分配）
 *   --cookie-days <n>     授权 cookie 有效期，默认 30
 *   --trusted-host <h>    额外允许的 Host（可重复）。默认只信任回环地址。
 *   --command <shell>     覆盖被拉起的命令（调试用），默认 `bash <root>/my-pi.sh`
 *   --cwd <dir>           工作目录，默认项目根
 *   --sweep               只回收孤儿 pty 会话后退出（不起服务）
 *
 * 启动时会先回收**孤儿 pty 会话**：服务器若被 SIGKILL/崩溃，`dispose()` 来不及运行，
 * `script` → supervisor → pi 会被 reparent 到 PID 1 后永不退出。属主 pid 内嵌在临时
 * 文件名里，故"属主不存在"即"无人管理"，可安全回收（详见 stale-sessions.ts）。
 * `PI_WEB_TERMINAL_SWEEP=off` 关闭该行为。
 *
 * 只绑定 127.0.0.1：远程访问请走 SSH 隧道。这不是"保守默认"，而是本服务没有 TLS，
 * 且会话 cookie 刻意不带 `Secure`（回环 HTTP 下浏览器会丢弃带 Secure 的 cookie）。
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import { getAgentDir, getProjectRoot } from '../core/config'
import { HELP_TEXT, parseArgs } from './args'
import { mintLaunchToken, newSigningSecret } from './auth'
import { PtySession, reapStaleSessions } from './pty-session'
import { startWebTerminalServer, type WebTerminalAsset } from './server'

const SECRET_FILE = 'web-terminal-secret.json'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 读取或创建 cookie 签名密钥；文件在 agentDir（每环境独立、不入库）。 */
function loadOrCreateSecret(agentDir: string): Buffer {
  const file = join(agentDir, SECRET_FILE)
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { secret?: unknown }
    if (typeof parsed.secret === 'string') {
      const secret = Buffer.from(parsed.secret, 'base64')
      if (secret.length >= 32) return secret
    }
  } catch {
    // 文件不存在或损坏：重新生成即可（代价只是已授权的浏览器需要重新用 token 打开）
  }
  const secret = newSigningSecret()
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(
    file,
    `${JSON.stringify({ secret: secret.toString('base64'), createdAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  )
  return secret
}

function resolveAssets(): { assets: Record<string, WebTerminalAsset>; version: string } {
  const require = createRequire(import.meta.url)
  const resolveAsset = (specifier: string): string => {
    try {
      return require.resolve(specifier)
    } catch {
      throw new Error(`找不到前端资源 ${specifier}：请先在项目根运行 npm install`)
    }
  }
  const assets: Record<string, WebTerminalAsset> = {
    '/assets/xterm.js': { path: resolveAsset('@xterm/xterm/lib/xterm.js'), immutable: true },
    '/assets/xterm.css': { path: resolveAsset('@xterm/xterm/css/xterm.css'), immutable: true },
    '/assets/addon-fit.js': { path: resolveAsset('@xterm/addon-fit/lib/addon-fit.js'), immutable: true },
  }
  // 版本戳取自资源文件的大小+mtime：换 xterm 版本后 URL 变化，浏览器不会继续用旧副本。
  const fingerprint = createHash('sha1')
  for (const [url, asset] of Object.entries(assets)) {
    const stat = statSync(asset.path)
    fingerprint.update(`${url}:${stat.size}:${stat.mtimeMs}`)
  }
  return { assets, version: fingerprint.digest('hex').slice(0, 10) }
}

const resolvedAssets = resolveAssets()

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  process.stdout.write(HELP_TEXT)
  process.exit(0)
}

const sweepEnabled = process.env.PI_WEB_TERMINAL_SWEEP !== 'off'
if (args.sweep) {
  if (!sweepEnabled) {
    process.stdout.write('孤儿回收已由 PI_WEB_TERMINAL_SWEEP=off 关闭，未做任何事。\n')
    process.exit(0)
  }
  const swept = await reapStaleSessions()
  process.stdout.write(
    `扫描到 ${swept.scanned} 个会话文件，回收孤儿 ${swept.reaped.length} 个` +
      (swept.reaped.length > 0 ? `：\n${swept.reaped.map((n) => `  ${n}`).join('\n')}\n` : '\n'),
  )
  process.exit(0)
}

if (sweepEnabled) {
  try {
    const swept = await reapStaleSessions()
    if (swept.reaped.length > 0) {
      process.stdout.write(`已回收 ${swept.reaped.length} 个孤儿 pty 会话（属主服务器已消失）\n`)
    }
  } catch (error) {
    // 回收失败不阻塞启动：最坏情况与旧行为一致（留着孤儿）
    process.stdout.write(`孤儿会话回收失败（忽略）: ${(error as Error).message}\n`)
  }
}

const projectRoot = getProjectRoot()
const agentDir = getAgentDir()
const session = new PtySession({
  command: args.command ?? `bash ${shellQuote(join(projectRoot, 'my-pi.sh'))}`,
  cwd: args.cwd !== undefined ? resolve(args.cwd) : projectRoot,
  env: {
    ...process.env,
    // 没有 TTY 时 TERM 常为 dumb/空，pi 的 TUI 会画不出颜色；这里显式指定。
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  },
  cols: 80,
  rows: 24,
})

await session.start()

const handle = await startWebTerminalServer({
  port: args.port,
  cookieDays: args.cookieDays,
  secret: loadOrCreateSecret(agentDir),
  launchToken: mintLaunchToken(),
  trustedHosts: args.trustedHosts,
  session,
  publicDir: join(projectRoot, 'custom', 'web-terminal', 'public'),
  assets: resolvedAssets.assets,
  assetVersion: resolvedAssets.version,
})

process.stdout.write(
  [
    '',
    'my-pi web-terminal 已启动',
    `  访问地址（含一次性令牌）: ${handle.url}`,
    `  会话命令                : ${session.command}`,
    session.terminalPath !== undefined
      ? `  pty                     : ${session.terminalPath}（支持动态改尺寸）`
      : '  pty                     : 未发现，窗口改尺寸不会生效（检查 util-linux 的 script/stty）',
    '',
    '  远程访问需先建隧道，再用上面的地址打开浏览器：',
    `    ssh -N -L ${handle.port}:127.0.0.1:${handle.port} <user>@<host>`,
    '  停止：Ctrl-C',
    '',
  ].join('\n'),
)

let closing = false
const shutdown = async (signal: string): Promise<void> => {
  if (closing) return
  closing = true
  process.stdout.write(`\n收到 ${signal}，正在关闭 web-terminal 与 agent…\n`)
  await handle.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
