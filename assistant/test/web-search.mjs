/**
 * 网络搜索接缝断言：
 *   ① 模型调用 `web_search` ⇒ 请求落到我们的 SearXNG provider（mock 端点收到 query）
 *   ② 会话流里出现 `tool/call name=web_search` 与 `tool/result`
 *   ③ 工具结果回灌后模型继续生成（文本非空）
 */
import { existsSync, readFileSync } from 'node:fs';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const searxngLog = process.argv[3] ?? '.run/searxng-requests.log';
if (!url) throw new Error('用法：node test/web-search.mjs "<宿主地址>" <searxng 请求日志>');

const client = await new HostClient({ url }).connect();
const preset = process.env.MYPI_AGENT_PRESET;
const created = await client.call('session/create', {
  request: { cwd: process.cwd(), ...(preset ? { agentPreset: preset } : {}) },
});
const sessionId = created.value.sessionId;
await client.call('session/selectModel', { request: { sessionId, provider: 'local', model: 'mock-local' } });

const events = [];
let text = '';
client.openStream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, {
  onItem: (item) => {
    if (item.type === 'event' && /^tool\//.test(item.event?.type ?? '')) events.push(item.event.type);
    const chunk = item.type === 'assistant-stream' ? item.frame?.chunk : undefined;
    if (chunk?.type === 'text-delta') text += chunk.text;
  },
});
await new Promise((r) => setTimeout(r, 800));
await client.call('session/prompt', {
  request: { requestId: `ws-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '搜索一下 deepseek harness' }] },
});
for (let i = 0; i < 60 && text === ''; i++) await new Promise((r) => setTimeout(r, 500));

const log = existsSync(searxngLog) ? readFileSync(searxngLog, 'utf8') : '';
const hit = /q=deepseek%20harness|q=deepseek harness/.test(log);
const ok = hit && events.includes('tool/call') && events.includes('tool/result') && text !== '';
console.log(JSON.stringify({ sessionId, searxngHit: hit, events, reply: text.slice(0, 30), ok }));
process.exit(ok ? 0 : 1);
