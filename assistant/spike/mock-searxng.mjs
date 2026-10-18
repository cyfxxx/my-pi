/** 最小 SearXNG 替身：只实现 `GET /search?format=json&q=…`，把收到的 query 追加到日志。 */
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.argv[2] ?? 8899);
const LOG = process.argv[3] ?? 'searxng-requests.log';

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/search') return res.writeHead(404).end('not found');
  const q = url.searchParams.get('q') ?? '';
  appendFileSync(LOG, `${new Date().toISOString()}\tq=${q}\n`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    query: q,
    results: [
      { url: `https://example.com/${encodeURIComponent(q)}`, title: `结果一：${q}`, content: '来自 mock searxng 的摘要', publishedDate: '2026-10-01T00:00:00Z' },
      { url: 'https://example.org/second', title: '结果二', content: '第二条摘要' },
    ],
  }));
}).listen(PORT, '127.0.0.1', () => console.log(`mock searxng on http://127.0.0.1:${PORT}`));
