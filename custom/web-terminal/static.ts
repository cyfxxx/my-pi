/**
 * web-terminal/static.ts — 静态资源解析（纯逻辑，零 Pi 依赖）
 *
 * 只做两件事：把 URL 路径安全地映射到磁盘路径、按扩展名给 MIME。
 * 安全要点：这是唯一接收外部字符串并用于文件读取的地方，必须挡住目录穿越、
 * 空字节与绝对路径。解码后的路径一律 normalize，再验证仍落在根目录内。
 */

import { extname, resolve, sep } from 'node:path'

/**
 * 把 URL 路径解析为根目录内的绝对路径；越界或畸形返回 `undefined`。
 *
 * 拒绝：解码失败、含空字节、含反斜杠（Windows 风格穿越）、normalize 后逃出根目录。
 */
export function resolveWithinRoot(root: string, urlPath: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined

  const rootAbs = resolve(root)
  const relative = decoded.replace(/^\/+/, '')
  const candidate = resolve(rootAbs, relative)
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + sep)) return undefined
  return candidate
}

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/** 按扩展名给 Content-Type；未知扩展名回退 `application/octet-stream`。 */
export function mimeTypeFor(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
