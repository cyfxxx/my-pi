/**
 * 意图账本断言（真链路）：
 *   ① 有信息量的用户输入逐字进账本；纯推进语（"继续"）不进；
 *   ② 下一回合的请求里带上 `[mypi-intent]` 账本块；
 *   ③ 重复同一意图会折叠成一条（次数 ×2），账本不重复膨胀。
 */
import { existsSync, readFileSync } from 'node:fs';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const mockLog = process.argv[3] ?? '.run/mock-requests.log';
const intentsDir = process.argv[4] ?? '.run/intents';
if (!url) throw new Error('用法：node test/intent.mjs "<宿主地址>" <mock 日志> <intents 目录>');

const readLog = () => (existsSync(mockLog) ? readFileSync(mockLog, 'utf8').trim().split('\n').filter(Boolean) : []);

const client = await new HostClient({ url }).connect();
const created = await client.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;
await client.call('session/selectModel', { request: { sessionId, provider: 'local', model: 'mock-local' } });

let text = '';
const memoryBlocks = [];
client.openStream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, {
  onItem: (item) => {
    if (item.type === 'event' && item.event?.type === 'user/message') {
      const kind = item.event?.data?.source?.kind;
      if (kind === 'mypi-intent') memoryBlocks.push(item.event?.data?.content);
    }
    const chunk = item.type === 'assistant-stream' ? item.frame?.chunk : undefined;
    if (chunk?.type === 'text-delta') text += chunk.text;
  },
});

async function turn(prompt) {
  text = '';
  await client.call('session/prompt', {
    request: { requestId: `it-${Date.now()}-${Math.random()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] },
  });
  for (let i = 0; i < 60 && text === ''; i++) await new Promise((r) => setTimeout(r, 500));
}

await turn('把项目底座的记忆检索换成 BM25 加 MMR');
await turn('继续');                       // 纯推进语：不应进账本
await turn('把项目底座的记忆检索换成 BM25 加 MMR'); // 重复同一意图：应折叠成一条

const dir = intentsDir;
const file = existsSync(dir) ? `${dir}/${sessionId}.jsonl` : '';
const ledger = file && existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
const texts = ledger.map((line) => JSON.parse(line));
const hasIntent = texts.some((r) => r.text.includes('BM25'));
const noFiller = !texts.some((r) => r.text.trim() === '继续');
const folded = texts.filter((r) => r.text.includes('BM25')).length === 1 && texts.find((r) => r.text.includes('BM25'))?.count >= 2;
const injected = readLog().some((line) => line.includes('[mypi-intent]') && line.includes('BM25')) || memoryBlocks.length > 0;

const ok = hasIntent && noFiller && folded && injected && text !== '';
console.log(JSON.stringify({ sessionId, ledgerLines: texts.length, hasIntent, noFiller, folded, injected, ok }));
process.exit(ok ? 0 : 1);
