/**
 * web-terminal/server.ts — HTTP + WebSocket 前端（零 Pi 依赖）
 *
 * 路由表很小，刻意如此：
 *
 *   GET  /            → 令牌换 cookie（`?token=`）或凭 cookie 返回 index.html
 *   GET  /assets/*    → 前端资源（本项目 public/ 与 node_modules 里的 xterm）
 *   GET  /healthz     → 存活探测，不返回任何会话内容，故不鉴权
 *   WS   /ws          → 终端数据面：二进制帧 = pty 原始字节，文本帧 = JSON 控制消息
 *
 * 与 dsh web 的取舍差异：这里没有 `/api` 一元 RPC 通道，也没有多路复用的流。
 * 终端只需要一条全双工连接，直接用二进制帧最省事、延迟最低。
 */

import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

import {
  AUTH_TOKEN_PARAM,
  authCookieHeader,
  authCookieName,
  checkTrust,
  parseCookieHeader,
  safeEqualText,
  signAuthCookie,
  verifyAuthCookie,
  type TrustDecision,
} from './auth'
import type { PtySession } from './pty-session'
import { mimeTypeFor, resolveWithinRoot } from './static'

const SECONDS_PER_DAY = 24 * 60 * 60
const DEFAULT_PING_INTERVAL_MS = 30_000

/** 一个前端静态资源：磁盘路径 + 是否可长缓存（node_modules 里的第三方产物可长缓存）。 */
export interface WebTerminalAsset {
  path: string
  immutable?: boolean
}

export interface WebTerminalServerOptions {
  port: number
  cookieDays: number
  secret: Buffer
  /** 打印给用户的启动令牌，仅在 `GET /?token=` 上接受一次。 */
  launchToken: string
  trustedHosts: readonly string[]
  session: PtySession
  /** 本项目前端资源目录。 */
  publicDir: string
  /** 额外资源映射：URL 路径（以 `/assets/` 开头）→ 磁盘路径。 */
  assets: Readonly<Record<string, WebTerminalAsset>>
  /**
   * 第三方资源的版本戳，替换 index.html 里的 `__ASSET_V__`。
   *
   * 必要性：这些资源带 `immutable` 长缓存（手机上经隧道取 480KB 不该每次重来），
   * 但它们的 URL 固定，换版本后浏览器会继续用旧副本——升级 xterm 时曾因此让修复"看起来没生效"。
   */
  assetVersion: string
  pingIntervalMs?: number
}

export interface WebTerminalServerHandle {
  port: number
  /** 带启动令牌的访问地址。 */
  url: string
  close(): Promise<void>
}

/** 启动服务并返回句柄；`close()` 会一并结束 pty 会话。 */
export async function startWebTerminalServer(
  options: WebTerminalServerOptions,
): Promise<WebTerminalServerHandle> {
  const server = createServer()
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set<WebSocket>()
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS

  const sendText = (ws: WebSocket, payload: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }
  const broadcastText = (payload: unknown): void => {
    for (const ws of clients) sendText(ws, payload)
  }
  const hello = (): Record<string, unknown> => {
    const size = options.session.terminalSize
    return {
      t: 'hello',
      cols: size.cols,
      rows: size.rows,
      alive: options.session.alive,
      exit: options.session.exit,
      command: options.session.command,
      clients: clients.size,
    }
  }

  const trustOf = (req: IncomingMessage, authority: string): TrustDecision =>
    checkTrust({
      host: authority,
      origin: headerText(req.headers.origin),
      secFetchSite: headerText(req.headers['sec-fetch-site']),
      trustedHosts: options.trustedHosts,
    })

  const authorize = (
    req: IncomingMessage,
    res: ServerResponse,
    authority: string,
    url: URL,
  ): boolean => {
    const cookieName = authCookieName(authority)
    const token = url.searchParams.get(AUTH_TOKEN_PARAM)
    if (token !== null) {
      if (!safeEqualText(token, options.launchToken)) {
        reject(res, 401, '启动令牌不正确；请使用 web-terminal 启动时打印的完整地址')
        return false
      }
      const value = signAuthCookie(options.secret, authority, Date.now(), options.cookieDays)
      res.writeHead(303, {
        location: '/',
        'set-cookie': authCookieHeader(cookieName, value, options.cookieDays * SECONDS_PER_DAY),
        'cache-control': 'no-store',
      })
      res.end()
      return false
    }
    const cookies = parseCookieHeader(headerText(req.headers.cookie))
    if (!verifyAuthCookie(options.secret, authority, cookies[cookieName], Date.now())) {
      reject(res, 401, '需要先授权；请打开 web-terminal 启动时打印的带 token 地址')
      return false
    }
    return true
  }

  server.on('request', (req, res) => {
    void handleRequest(req, res)
  })
  server.on('clientError', (_error, socket) => {
    socket.destroy()
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const authority = headerText(req.headers.host)
    const trust = trustOf(req, authority)
    if (!trust.ok) {
      reject(res, trust.status, trust.reason)
      return
    }

    let url: URL
    try {
      url = new URL(req.url ?? '/', `http://${authority}`)
    } catch {
      reject(res, 400, '请求路径无法解析')
      return
    }

    if (url.pathname === '/healthz') {
      const size = options.session.terminalSize
      respondJSON(res, req.method === 'HEAD', {
        ok: true,
        alive: options.session.alive,
        cols: size.cols,
        rows: size.rows,
        clients: clients.size,
        terminal: options.session.terminalPath !== undefined,
      })
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reject(res, 405, '只接受 GET/HEAD')
      return
    }
    const head = req.method === 'HEAD'

    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!authorize(req, res, authority, url)) return
      await serveFile(res, join(options.publicDir, 'index.html'), {
        head,
        immutable: false,
        replace: [['__ASSET_V__', options.assetVersion]],
      })
      return
    }

    if (url.pathname.startsWith('/assets/')) {
      const asset = options.assets[url.pathname]
      if (asset !== undefined) {
        await serveFile(res, asset.path, { head, immutable: asset.immutable === true })
        return
      }
      // 先查第三方资源映射（xterm 等来自 node_modules），再回落到本项目 public/。
      // 注意剥掉 `/assets` 前缀：项目前端资源是 public/app.js 而非 public/assets/app.js。
      const filePath = resolveWithinRoot(options.publicDir, url.pathname.slice('/assets'.length))
      if (filePath === undefined) {
        reject(res, 403, '路径越界')
        return
      }
      await serveFile(res, filePath, { head, immutable: false })
      return
    }

    reject(res, 404, '未找到')
  }

  server.on('upgrade', (req, socket, head) => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', `http://${headerText(req.headers.host) || '127.0.0.1'}`)
    } catch {
      writeRawHTTP(socket, 400, 'bad request')
      return
    }
    if (url.pathname !== '/ws') {
      writeRawHTTP(socket, 404, 'not found')
      return
    }
    const authority = headerText(req.headers.host)
    const trust = trustOf(req, authority)
    if (!trust.ok) {
      writeRawHTTP(socket, trust.status, trust.reason)
      return
    }
    const cookies = parseCookieHeader(headerText(req.headers.cookie))
    const cookieName = authCookieName(authority)
    if (!verifyAuthCookie(options.secret, authority, cookies[cookieName], Date.now())) {
      writeRawHTTP(socket, 401, 'unauthorized')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws) => {
    clients.add(ws)
    const { snapshot, detach } = options.session.attach((chunk) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk)
    })
    sendText(ws, hello())
    if (snapshot.length > 0 && ws.readyState === WebSocket.OPEN) ws.send(snapshot)

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        options.session.write(toBuffer(data))
        return
      }
      void handleControl(ws, toBuffer(data).toString('utf8'))
    })
    ws.on('close', () => {
      detach()
      clients.delete(ws)
    })
    ws.on('error', () => {
      // 连接级错误（移动网络切换等）不需要上抛，close 会做清理。
    })
  })

  async function handleControl(ws: WebSocket, text: string): Promise<void> {
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (typeof message !== 'object' || message === null) return
    const t = (message as { t?: unknown }).t
    if (t === 'resize') {
      const cols = Number((message as { cols?: unknown }).cols)
      const rows = Number((message as { rows?: unknown }).rows)
      const changed = await options.session.resize(cols, rows)
      if (changed) {
        const size = options.session.terminalSize
        broadcastText({ t: 'size', cols: size.cols, rows: size.rows })
      }
      return
    }
    if (t === 'restart') {
      await options.session.restart()
      broadcastText(hello())
      return
    }
    if (t === 'redraw') {
      await options.session.forceRedraw()
      return
    }
    if (t === 'ping') {
      sendText(ws, { t: 'pong' })
    }
  }

  options.session.onExit((info) => {
    broadcastText({ t: 'exit', code: info.code, signal: info.signal })
  })

  const pinger = setInterval(() => {
    for (const ws of clients) {
      try {
        ws.ping()
      } catch {
        // 已关闭的连接由 close 事件清理
      }
    }
  }, pingIntervalMs)
  pinger.unref()

  await new Promise<void>((resolve, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(options.port, '127.0.0.1', () => {
      server.removeListener('error', rejectPromise)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port

  return {
    port,
    url: `http://127.0.0.1:${port}/?${AUTH_TOKEN_PARAM}=${options.launchToken}`,
    async close(): Promise<void> {
      clearInterval(pinger)
      for (const ws of clients) {
        try {
          ws.close(1001, 'server shutting down')
        } catch {
          // 忽略
        }
      }
      clients.clear()
      await options.session.dispose()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}

function headerText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

async function serveFile(
  res: ServerResponse,
  filePath: string,
  options: { head: boolean; immutable: boolean; replace?: ReadonlyArray<readonly [string, string]> },
): Promise<void> {
  try {
    let body = await readFile(filePath)
    if (options.replace !== undefined) {
      let text = body.toString('utf8')
      for (const [from, to] of options.replace) text = text.split(from).join(to)
      body = Buffer.from(text, 'utf8')
    }
    res.writeHead(200, {
      'content-type': mimeTypeFor(filePath),
      'content-length': String(body.length),
      'cache-control': options.immutable ? 'public, max-age=86400' : 'no-store',
    })
    res.end(options.head ? undefined : body)
  } catch {
    reject(res, 404, '未找到')
  }
}

function respondJSON(res: ServerResponse, head: boolean, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(head ? undefined : body)
}

function reject(res: ServerResponse, status: number, reason: string): void {
  const body = Buffer.from(`${reason}\n`, 'utf8')
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 在裸 socket 上回一个 HTTP 错误（upgrade 阶段还没有 res 对象）。 */
function writeRawHTTP(socket: Duplex, status: number, reason: string): void {
  const statusText = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Error'
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      'content-type: text/plain; charset=utf-8\r\n' +
      'connection: close\r\n' +
      `content-length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`,
  )
}
