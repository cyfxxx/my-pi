/**
 * 本地窗口的压缩判据：连续灌轮次，统计宿主日志里的压缩行为。
 *   - 修复前：出现 `leaving no pressure budget` 的 warn，且**没有** `compaction (pressure)`；
 *   - 修复后：出现 `compaction (pressure): shadowed …`。
 */
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const turns = Number(process.argv[3] ?? 40);
if (!url) throw new Error('用法：node test/compaction.mjs "<宿主地址>" [轮数]');

const client = await new HostClient({ url }).connect();
const created = await client.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;
await client.call('session/selectModel', { request: { sessionId, provider: 'local', model: 'mock-local' } });

let text = '';
const events = [];
client.openStream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, {
  onItem: (item) => {
    if (item.type === 'event') {
      const type = item.event?.type ?? '';
      if (type.startsWith('compaction/') || type === 'session/error') events.push(type);
      return;
    }
    const chunk = item.type === 'assistant-stream' ? item.frame?.chunk : undefined;
    if (chunk?.type === 'text-delta') text += chunk.text;
  },
});

for (let i = 1; i <= turns; i++) {
  text = '';
  await client.call('session/prompt', {
    request: {
      requestId: `c-${Date.now()}-${i}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: `第 ${i} 轮：请用一句话描述这个项目现在在做什么（不要超过 30 字）。` }],
    },
  });
  for (let k = 0; k < 40 && text === ''; k++) await new Promise((r) => setTimeout(r, 250));
  if (text === '') {
    console.log(JSON.stringify({ sessionId, turns: i, stopped: 'empty-reply' }));
    process.exit(1);
  }
}
console.log(JSON.stringify({ sessionId, turns, compactionEvents: events, ok: true }));
process.exit(0);
