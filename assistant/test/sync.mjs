/**
 * 断言：同一会话上两个独立客户端（模拟「终端」与「浏览器」）收到**逐字相同**的直播流。
 * 这是「TUI 与 Web 数据同步」的可执行证据 —— 同步来自同一个宿主会话，
 * 不是镜像、不是轮询。
 */
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
if (!url) throw new Error('用法：node test/sync.mjs "<带 token 的宿主地址>"');

const a = await new HostClient({ url }).connect();
const b = await new HostClient({ url }).connect();

const created = await b.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;
// 固定走本机端点：断言不依赖额度，也不依赖宿主当前默认模型
await b.call('session/selectModel', { request: { sessionId, provider: 'local', model: 'mock-local' } });
const follow = (client, sink) =>
  client.openStream(
    'session/follow',
    { request: { address: { kind: 'session', sessionId }, assistantStream: true } },
    {
      onItem: (item) => {
        const chunk = item.type === 'assistant-stream' ? item.frame?.chunk : undefined;
        if (chunk?.type === 'text-delta') sink(chunk.text);
      },
    },
  );

let aText = '';
let bText = '';
follow(a, (t) => (aText += t));
follow(b, (t) => (bText += t));
await new Promise((r) => setTimeout(r, 1000));

await b.call('session/prompt', {
  request: { requestId: `sync-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '只回两个字：同步' }] },
});
for (let i = 0; i < 60 && aText === ''; i++) await new Promise((r) => setTimeout(r, 500));

const same = aText !== '' && aText === bText;
console.log(JSON.stringify({ sessionId, a: aText, b: bText, same }));
process.exit(same ? 0 : 1);
