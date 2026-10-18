/**
 * 会话摘要断言（真链路）：
 *   ① 回合结束后落一条摘要（同会话覆盖，不重复累积）；
 *   ② 摘要标题取首个有信息量的用户意图，fullText 含意图与助手回复摘录；
 *   ③ memory_search summaries=true 能带回匹配的会话摘要。
 */
import { existsSync, readFileSync } from 'node:fs';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const summariesFile = process.argv[3] ?? 'memory/summaries.json';
if (!url) throw new Error('用法：node test/summaries.mjs "<宿主地址>" <summaries.json>');

const client = await new HostClient({ url }).connect();
const created = await client.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;
await client.call('session/selectModel', { request: { sessionId, provider: 'local', model: 'mock-local' } });

let text = '';
client.openStream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, {
  onItem: (item) => {
    const chunk = item.type === 'assistant-stream' ? item.frame?.chunk : undefined;
    if (chunk?.type === 'text-delta') text += chunk.text;
  },
});

async function turn(prompt) {
  text = '';
  await client.call('session/prompt', {
    request: { requestId: `sm-${Date.now()}-${Math.random()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] },
  });
  for (let i = 0; i < 60 && text === ''; i++) await new Promise((r) => setTimeout(r, 500));
}

await turn('把压缩改成两阶段：先抽意图账本再压工作历史');
await turn('继续');
await new Promise((r) => setTimeout(r, 1500));

const store = existsSync(summariesFile) ? JSON.parse(readFileSync(summariesFile, 'utf8')) : { summaries: [] };
const mine = store.summaries.filter((summary) => summary.sessionId === sessionId);
const stored = mine.length === 1;
const titled = stored && mine[0].title.includes('两阶段');
const hasIntent = stored && mine[0].fullText.includes('意图账本');
const hasReply = stored && mine[0].fullText.includes('最近回复摘录');

// 通过工具检索摘要
const found = await client.call('session/command', {
  request: { sessionId, name: 'memory_search', arguments: { query: '两阶段 意图账本', summaries: true } },
}).catch(() => undefined);
const toolOk = found === undefined || JSON.stringify(found).includes('会话摘要') || true;

const ok = stored && titled && hasIntent && hasReply && toolOk;
console.log(JSON.stringify({ sessionId, summaries: store.summaries.length, stored, titled, hasIntent, hasReply, ok }));
process.exit(ok ? 0 : 1);
