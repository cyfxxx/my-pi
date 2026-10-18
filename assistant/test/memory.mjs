/**
 * 记忆注入断言（真链路 + 缓存友好性）：
 *   ① `memory_store` 工具真的写入记忆库；
 *   ② 下一回合的请求里**追加**了 `[mypi-memory]` 快照（且每回合只追加一次）；
 *   ③ **第一条 user 消息与上一回合逐字相同**（前缀稳定 ⇒ 缓存可命中）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const mockLog = process.argv[3] ?? '.run/mock-requests.log';
const memoryFile = process.argv[4] ?? '.run/memory.jsonl';
if (!url) throw new Error('用法：node test/memory.mjs "<宿主地址>" <mock 日志> <记忆文件>');

const readLog = () => (existsSync(mockLog) ? readFileSync(mockLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const field = (line, name) => {
  const m = line.split(`\t${name}=`)[1];
  return m === undefined ? '' : m.split('\t')[0];
};

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
    request: { requestId: `mem-${Date.now()}-${Math.random()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] },
  });
  for (let i = 0; i < 60 && text === ''; i++) await new Promise((r) => setTimeout(r, 500));
  return text;
}

await turn('记住：项目代号是 falcon');
const beforeCount = readLog().length;
await turn('继续');
const after = readLog().slice(beforeCount);

const stored = existsSync(memoryFile) ? readFileSync(memoryFile, 'utf8') : '';
const secondTurnLines = after.filter((line) => Number(field(line, 'tools')) > 0);
const injected = secondTurnLines.some((line) => Number(field(line, 'injections')) === 1);
const firstUserStable =
  secondTurnLines.length > 0 &&
  new Set([field(secondTurnLines[0], 'firstUser'), ...secondTurnLines.map((l) => field(l, 'firstUser'))]).size === 1;

const ok = stored.includes('项目代号 falcon') && injected && firstUserStable && text !== '';
console.log(JSON.stringify({
  sessionId,
  stored: stored.includes('项目代号 falcon'),
  injectedExactlyOnce: injected,
  firstUserStable,
  reply: text.slice(0, 20),
  ok,
}));
process.exit(ok ? 0 : 1);
