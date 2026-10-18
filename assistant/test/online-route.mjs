/**
 * 在线路线冒烟（**会花额度**，默认不在 verify 里跑）：不选本地模型，直接让宿主用默认在线模型答一句，
 * 并断言 mock 端点**没有**收到请求 —— 否则"在线"和"本地"就没被区分开。
 */
import { execSync } from 'node:child_process';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const mockLog = process.argv[3] ?? 'mock-requests.log';
if (!url) throw new Error('用法：node test/online-route.mjs "<宿主地址>" [mock 日志]');

const before = (() => {
  try {
    return execSync(`wc -l < ${JSON.stringify(mockLog)}`, { encoding: 'utf8' }).trim();
  } catch {
    return '0';
  }
})();

const client = await new HostClient({ url }).connect();
const created = await client.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;
// 显式选在线路线：不依赖"当前默认模型"（选本地模型的用例会把它改成 local）
await client.call('session/selectModel', { request: { sessionId, provider: 'deepseek-official', model: 'deepseek-flash' } });
let reply = '';
client.openStream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, {
  onItem: (item) => {
    const chunk = item.type === 'assistant-stream' ? item.frame?.chunk : undefined;
    if (chunk?.type === 'text-delta') reply += chunk.text;
  },
});
await new Promise((r) => setTimeout(r, 800));
await client.call('session/prompt', {
  request: { requestId: `online-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '只回一个字：好' }] },
});
for (let i = 0; i < 90 && reply === ''; i++) await new Promise((r) => setTimeout(r, 500));

const after = (() => {
  try {
    return execSync(`wc -l < ${JSON.stringify(mockLog)}`, { encoding: 'utf8' }).trim();
  } catch {
    return '0';
  }
})();
const wentOnline = before === after;
console.log(JSON.stringify({ sessionId, reply, mockCallsBefore: before, mockCallsAfter: after, wentOnline }));
process.exit(reply !== '' && wentOnline ? 0 : 1);
