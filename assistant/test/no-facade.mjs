/**
 * 断奶断言（M0.2 的守门）：
 *   ① 工具面里**没有**旧 facade 的工具名（按已知前缀点名）
 *   ② 工具面**有**我们自己的 mypi_note
 *   ③ 工具总数在上限内（facade 在时是 80，断奶后应 ≤40）
 * 数据来源：mock 端点记录的 `toolFace=` 行（模型侧真实拿到的工具清单）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const mockLog = process.argv[3] ?? '.run/mock-requests.log';
const limit = Number(process.argv[4] ?? 40);
if (!url) throw new Error('用法：node test/no-facade.mjs "<宿主地址>" <mock 日志> [上限]');

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
  request: { requestId: `nf-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '只回一个字：好' }] },
});
for (let i = 0; i < 60 && reply === ''; i++) await new Promise((r) => setTimeout(r, 500));

const lines = existsSync(mockLog) ? readFileSync(mockLog, 'utf8').trim().split('\n') : [];
// 只取"工具面非空"的那一行：会话标题生成那类请求是 tools=0（toolFace 为空）。
const line = lines.reverse().find((l) => {
  const face = l.split('\ttoolFace=')[1]?.split('\t')[0] ?? '';
  return face.length > 0;
});
const tools = line === undefined ? [] : line.split('\ttoolFace=')[1].split('\t')[0].split(',').filter(Boolean);
const legacy = tools.filter((name) => /^(admin_|autopilot_|browser_|ctx_|memory_|mode_|voice_|link_)/.test(name));
const hasOurs = tools.includes('mypi_note');
const withinLimit = tools.length > 0 && tools.length <= limit;
const ok = legacy.length === 0 && hasOurs && withinLimit;
console.log(JSON.stringify({ toolCount: tools.length, limit, legacy, hasOurs, withinLimit, ok }));
process.exit(ok ? 0 : 1);
