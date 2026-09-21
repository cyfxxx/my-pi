import type { SearchConfig, SearchResponse, SearchResultItem } from './types'
import { isUrlAllowed } from '../../core/net-guard'

// ── 错误分类（wechat-article-exporter 启发）────────────────────
// 5xx / 网络错误 → 可重试（服务端临时故障或连接问题）
// 4xx / 非重试状态码 → 立即失败（客户端错误，重试无意义）
// 429 → 特殊处理：读取 Retry-After 头，否则指数退避
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

/** 可被 signal 取消的 sleep（避免超时已 abort 后仍空等退避） */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function fetchWithRetry(
  url: string,
  opts: { signal: AbortSignal; headers: Record<string, string> },
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts)

      // 4xx（非429）→ 立即失败，不重试
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return res
      }

      // 5xx / 429 / OK → 返回（429 也返回，由调用方决定是否再试）
      if (res.ok || RETRYABLE_STATUS.has(res.status)) {
        if (res.ok || attempt >= maxRetries) return res

        // 重试前释放响应体（避免未消费的 body 占用连接）
        try {
          await res.body?.cancel()
        } catch {
          /* 已释放 */
        }

        // 429: 读 Retry-After 头，否则指数退避
        const retryAfter = res.headers.get('Retry-After')
        const delayMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 10000)
          : Math.min(500 * Math.pow(2, attempt), 8000)
        await sleep(delayMs, opts.signal)
        continue
      }

      return res
    } catch (e) {
      // 取消/超时：立即抛出，不再重试
      if (opts.signal.aborted) throw e
      if (attempt >= maxRetries) throw e
      // 网络错误：指数退避（500ms → 1s → 2s → 4s，上限8s）
      const delayMs = Math.min(500 * Math.pow(2, attempt), 8000)
      await sleep(delayMs, opts.signal)
    }
  }
  throw new Error('重试耗尽')
}

export async function searchWeb(
  config: SearchConfig,
  query: string,
  options?: {
    engines?: string[]
    categories?: string
    pageno?: number
    time_range?: string
    lang?: string
    max_results?: number
    brief?: boolean
  },
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) return '搜索已取消。'

  const params = new URLSearchParams({ format: 'json', q: query })

  if (options?.categories) params.set('categories', options.categories)
  if (options?.pageno) params.set('pageno', String(options.pageno))
  if (options?.time_range) params.set('time_range', options.time_range)
  if (options?.lang) params.set('lang', options.lang)
  if (options?.engines?.length) params.set('engines', options.engines.join(','))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeout)

  const onAbort = () => {
    clearTimeout(timer)
    controller.abort()
  }
  if (signal) signal.addEventListener('abort', onAbort, { once: true })

  try {
    const res = await fetchWithRetry(
      `${config.searxng_url}/search?${params}`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'pi-web-toolkit/1.0' },
      },
      3,
    )

    if (!res.ok) {
      return `搜索失败: SearXNG 返回 ${res.status} ${res.statusText}。请检查 searxng_url 配置是否正确。`
    }

    const data: SearchResponse = await res.json()
    const maxResults = sanitizeMaxResults(options?.max_results)
    return formatResponse(data, query, maxResults, options?.brief ?? false)
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      if (signal?.aborted) return '搜索已取消。'
      return `搜索超时 (${config.timeout}ms)。请检查 SearXNG 实例 ${config.searxng_url} 是否可达。`
    }
    return `搜索失败: ${(err as Error).message}`
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/** max_results 显式校验：非有限或 floor 后 <1 时回退默认 5（避免 slice(0,0) 空结果 / slice(0,-1) 全量泄露） */
export function sanitizeMaxResults(maxResults?: number): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) return 5
  const n = Math.floor(maxResults)
  return n >= 1 ? n : 5
}

export function formatResponse(data: SearchResponse, query: string, maxResults: number = 5, brief: boolean = false): string {
  const lines: string[] = []
  lines.push(`搜索: "${query}"`, '')

  const rawResults = data.results ?? []
  // W1: 多引擎结果按 URL 去重（同一链接多引擎命中时合并 engine 标签），
  // 避免同一结果在不同引擎下重复输出
  const seen = new Map<string, SearchResultItem>()
  const results: SearchResultItem[] = []
  for (const r of rawResults) {
    const key = r.url || r.title
    if (!key) {
      results.push(r)
      continue
    }
    const existing = seen.get(key)
    if (existing) {
      if (r.engine && existing.engine && !existing.engine.includes(r.engine)) {
        existing.engine = `${existing.engine},${r.engine}`
      } else if (r.engine && !existing.engine) {
        existing.engine = r.engine
      }
      continue
    }
    seen.set(key, r)
    results.push(r)
  }
  const answers = data.answers ?? []
  const suggestions = data.suggestions ?? []
  const corrections = data.corrections ?? []
  const unresponsive = data.unresponsive_engines ?? []
  const infoboxes = data.infoboxes ?? []

  if (brief && results.length > 0) {
    lines.push(`找到 ${data.number_of_results ?? results.length} 条结果（简要模式）：`)
    lines.push('')
    for (const r of results.slice(0, maxResults)) {
      const tag = r.engine ? ` [${r.engine}]` : ''
      lines.push(`- ${r.title}${tag}`)
      lines.push(`  ${r.url}`)
    }
    if (results.length > maxResults) {
      lines.push(`  ... 还有 ${results.length - maxResults} 条结果。使用 max_results:N 展开更多。`)
    }
    if (answers.length > 0) {
      lines.push('')
      lines.push('直接答案：')
      for (const a of answers) lines.push(`- ${a}`)
    }
    lines.push('')
    return lines.join('\n')
  }

  if (results.length > 0) {
    lines.push(`找到 ${data.number_of_results ?? results.length} 条结果：`)
    lines.push('')
    for (const r of results.slice(0, maxResults)) {
      const tag = r.engine ? ` [${r.engine}]` : ''
      lines.push(`### ${r.title}${tag}`)
      lines.push(r.url)
      if (r.content) lines.push(truncate(r.content, 250))
      if (r.publishedDate) lines.push(`时间: ${r.publishedDate}`)
      lines.push('')
    }
    if (results.length > maxResults) {
      lines.push(`... 还有 ${results.length - maxResults} 条结果未显示。使用 max_results:N 查看更多。`)
    }
  } else {
    lines.push('未找到结果。')
  }

  if (answers.length > 0) {
    lines.push('---\n直接答案：')
    for (const a of answers) lines.push(`- ${a}`)
    lines.push('')
  }

  if (suggestions.length > 0) {
    lines.push('搜索建议：`' + suggestions.join('` `') + '`')
    lines.push('')
  }

  if (corrections.length > 0) {
    lines.push('拼写纠正：')
    for (const c of corrections) lines.push(`- ${c}`)
    lines.push('')
  }

  if (unresponsive.length > 0) {
    lines.push(`⚠ 以下引擎无响应：${unresponsive.join('、')}`)
    lines.push('可尝试减少 engines 参数或切换 categories。')
    lines.push('')
  }

  if (infoboxes.length > 0) {
    lines.push('信息框：')
    for (const ib of infoboxes) {
      lines.push(`- ${ib.title ?? ib.content ?? JSON.stringify(ib)}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + '...'
}

// ── 共享 HTTP 超时常量 ────────────────────────────────────────
// 与 config.ts DEFAULT_CONFIG.search.timeout 同源口径（15000ms），
// 避免各处硬编码漂移；调用方可用 searchDirect 的 timeoutMs 参数覆盖。
export const HTTP_TIMEOUT_MS = 15000

export async function searchDirect(
  query: string,
  maxResults = 5,
  signal?: AbortSignal,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<string> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  // 审计修复：用户停止生成（signal）转发到内部 controller，与内部超时
  // 任一触发即中断（与 fetch_url 同模式）；abort 均从 fetch 抛 AbortError
  const onUserAbort = () => controller.abort()
  signal?.addEventListener?.('abort', onUserAbort)
  try {
    return await doSearch(url, maxResults, query, controller.signal)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener?.('abort', onUserAbort)
  }
}

async function doSearch(
  url: string,
  maxResults: number,
  query: string,
  reqSignal: AbortSignal,
): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
    signal: reqSignal,
  })
  // fetch 失败必抛异常（网络/DNS/超时 abort），不会返回 null——此分支为死代码，已移除
  if (!res.ok) {
    // 取消未消费的响应体，避免连接悬挂（socket 无法复用/泄漏）
    try { await res.body?.cancel() } catch { /* 已释放 */ }
    return `搜索失败: HTTP ${res.status}`
  }
  const html = await res.text()
  const results: string[] = []
  const linkRe = /<h2><a href="(https?:\/\/[^"]+)"[^>]*>(.+?)<\/a>/g
  let match: RegExpExecArray | null
  let count = 0
  while ((match = linkRe.exec(html)) !== null && count < maxResults) {
    const title = match[2].replace(/<[^>]+>/g, "").trim()
    if (title) {
      results.push(`${count + 1}. ${title}`)
      results.push(`   ${match[1]}`)
      count++
    }
  }
  if (results.length === 0) {
    return `搜索 "${query}" 无结果（Bing 可能返回了验证页面）`
  }
  return `搜索: "${query}"\n\n${results.join("\n")}`
}

// ── fetch_url 支撑：分块读取响应体（最多 cap 字节，防大文件全量入内存）──

export async function readBodyLimited(
  res: Response,
  cap: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    return { text: await res.text(), truncated: false }
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  while (total < cap) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const room = cap - total
    if (value.length > room) {
      // 单块即超出 cap：直接判定截断（否则会漏报，pi-tools 原实现在此有缺陷）
      chunks.push(value.subarray(0, room))
      total = cap
      truncated = true
      break
    }
    chunks.push(value)
    total += value.length
  }
  if (truncated || total >= cap) {
    // 恰好读满 cap 且未确认剩余：再读一块判断（防 truncated 误报）；无论结果都 cancel 释放连接
    if (!truncated) {
      try {
        const { done } = await reader.read()
        truncated = !done
      } catch {
        truncated = true
      }
    }
    try {
      await reader.cancel()
    } catch {
      /* 流已结束 */
    }
  }
  return { text: Buffer.concat(chunks).toString('utf-8'), truncated }
}

export const FETCH_BODY_CAP = 512 * 1024

/** 轻量 HTTP GET（协议白名单 + 超时 + 响应体上限），返回格式化文本 */
export async function fetchUrl(
  url: string,
  maxLength = 8000,
  timeoutMs = HTTP_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `无效 URL：${url}`
  }
  // 协议白名单：仅放行 http/https（纵深防御，本地 SearXNG 等合法用途不受影响）
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `不支持的协议 "${parsed.protocol}"：fetch_url 仅允许 http:/https: URL`
  }
  // SSRF 防护：拒绝回环/内网/链路本地/云元数据主机
  if (!isUrlAllowed(url)) {
    return `拒绝访问内网/回环地址：${parsed.hostname}（fetch_url 仅允许公网 http/https）`
  }
  const cap = Math.max(0, Math.min(maxLength, 200000))
  const controller = new AbortController()
  const onUserAbort = () => controller.abort()
  signal?.addEventListener?.('abort', onUserAbort)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PiBot/1.0)' },
    })
    if (!res.ok) {
      try {
        await res.body?.cancel()
      } catch {
        /* 已释放 */
      }
      return `HTTP ${res.status}: ${res.statusText}`
    }
    const { text, truncated: bodyTruncated } = await readBodyLimited(res, FETCH_BODY_CAP)
    const out =
      text.length > cap
        ? text.slice(0, cap) + `\n\n...（共 ${text.length} 字符，仅显示前 ${cap} 字符）`
        : text
    const suffix = bodyTruncated ? '\n\n[响应体超过 512KB 已截断读取]' : ''
    return out + suffix
  } catch (e) {
    return `请求失败: ${(e as Error).message}`
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener?.('abort', onUserAbort)
  }
}

// ── 并发限制器（wechat-article-exporter P-Queue 启发）────────────
// 限制同时进行的异步操作数量，防止批量请求时 IP 被封或资源耗尽。
// 适用于：批量 URL 抓取、知识源并发拉取、多引擎搜索等场景。

export interface ConcurrencyLimiter {
  /** 当前正在执行的任务数 */
  readonly running: number
  /** 队列中等待的任务数 */
  readonly queued: number
  /** 执行一个任务（自动排队，完成后自动释放槽位） */
  run<T>(fn: () => Promise<T>): Promise<T>
  /** 排空队列（等待所有已提交任务完成） */
  drain(): Promise<void>
}

export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  if (maxConcurrent < 1) throw new Error('maxConcurrent 必须 ≥ 1')

  let running = 0
  const queue: Array<() => void> = []

  function acquire(): Promise<void> {
    if (running < maxConcurrent) {
      running++
      return Promise.resolve()
    }
    return new Promise(resolve => queue.push(resolve))
  }

  function release(): void {
    running--
    if (queue.length > 0) {
      running++
      queue.shift()!()
    }
  }

  return {
    get running() { return running },
    get queued() { return queue.length },

    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await fn()
      } finally {
        release()
      }
    },

    async drain(): Promise<void> {
      // 等待队列清空即可（running 会在每次 release 后自动递减）
      while (running > 0 || queue.length > 0) {
        await new Promise(r => setTimeout(r, 50))
      }
    },
  }
}

// ── 带重试的批量 fetch（组合 fetchWithRetry + ConcurrencyLimiter）─

export interface BatchFetchOptions {
  /** 最大并发数（默认 3） */
  concurrency?: number
  /** 单个请求超时 ms（默认 15000） */
  timeout?: number
  /** 最大重试次数（默认 2） */
  maxRetries?: number
  /** 自定义 headers */
  headers?: Record<string, string>
}

export interface BatchFetchResult {
  url: string
  ok: boolean
  status: number
  text: string
  durationMs: number
}

/**
 * 批量并发 fetch，带并发限制和重试。
 * 适用于知识源批量拉取、文章批量下载等场景。
 */
export async function batchFetch(
  urls: string[],
  options: BatchFetchOptions = {},
): Promise<BatchFetchResult[]> {
  const {
    concurrency = 3,
    timeout = 15000,
    maxRetries = 2,
    headers = {},
  } = options

  const limiter = createConcurrencyLimiter(concurrency)
  const results: BatchFetchResult[] = []

  const tasks = urls.map(url =>
    limiter.run(async () => {
      const start = Date.now()
      let lastError: Error | null = null

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)

        try {
          const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'pi-web-search/1.0', ...headers },
          })

          clearTimeout(timer)

          // 4xx 不重试
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            results.push({
              url,
              ok: false,
              status: res.status,
              text: await res.text().catch(() => ''),
              durationMs: Date.now() - start,
            })
            return
          }

          // 5xx / 429 重试
          if (!res.ok && attempt < maxRetries) {
            // 释放未消费的响应体，避免 socket/连接泄漏
            try {
              await res.body?.cancel()
            } catch {
              /* 已释放 */
            }
            const delay = Math.min(500 * Math.pow(2, attempt), 4000)
            await new Promise(r => setTimeout(r, delay))
            continue
          }

          results.push({
            url,
            ok: res.ok,
            status: res.status,
            text: await res.text().catch(() => ''),
            durationMs: Date.now() - start,
          })
          return
        } catch (e) {
          clearTimeout(timer)
          lastError = e instanceof Error ? e : new Error(String(e))

          if (attempt < maxRetries) {
            const delay = Math.min(500 * Math.pow(2, attempt), 4000)
            await new Promise(r => setTimeout(r, delay))
          }
        }
      }

      // 所有重试耗尽
      results.push({
        url,
        ok: false,
        status: 0,
        text: lastError?.message || 'unknown error',
        durationMs: Date.now() - start,
      })
    })
  )

  await Promise.allSettled(tasks)
  return results
}
