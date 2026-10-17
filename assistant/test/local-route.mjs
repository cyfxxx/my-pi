/**
 * 断言：切到「本地模型」路线后，请求真的打到本机端点（mock 的 OpenAI 兼容服务），
 * 且模型回复进入了会话流。证明「在线 / 本地两种运行模式」是**按会话选择的路由**，
 * 不是两套代码。
 */
import { readFileSync, existsSync } from 'node:fs';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const proofFile = process.argv[3] ?? 'mock-requests.log';
if (!url) throw new Error('用法：node test/local-route.mjs "<宿主地址>" <mock 请求日志>');

const client = await new HostClient({ url }).connect();
const created = await client.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;

await client.call('session/selectModel', { request: { sessionId, provider: 'local', model: 'mock-local' } });
let reply = '';
client.openStream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, {
  onItem: (item) => {
    const chunk = item.type === 'assistant-stream' ? item.frame?.chunk : undefined;
    if (chunk?.type === 'text-delta') reply += chunk.text;
  },
});
await new Promise((r) => setTimeout(r, 800));
await client.call('session/prompt', {
  request: { requestId: `local-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '你是谁' }] },
});
for (let i = 0; i < 60 && reply === ''; i++) await new Promise((r) => setTimeout(r, 500));

const hits = existsSync(proofFile) ? readFileSync(proofFile, 'utf8').trim().split('\n').filter(Boolean).length : 0;
const ok = reply !== '' && hits > 0;
console.log(JSON.stringify({ sessionId, reply, mockHits: hits, ok }));
process.exit(ok ? 0 : 1);
