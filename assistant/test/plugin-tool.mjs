/**
 * 断言「自写插件工具」这条接缝真的通了，而且是**一个工具面、两端共享**：
 *   ① 模型请求的工具清单里出现 `mypi_note`（工具面对模型可见）
 *   ② 模型调用它 ⇒ 宿主真的执行 ⇒ 笔记文件被写入
 *   ③ 工具结果回灌给模型 ⇒ 最终文本进会话流（终端与 Web 读的是同一条流）
 */
import { readFileSync, existsSync } from 'node:fs';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const mockLog = process.argv[3] ?? 'mock-requests.log';
const notesFile = process.argv[4] ?? 'notes.md';
if (!url) throw new Error('用法：node test/plugin-tool.mjs "<宿主地址>" <mock 日志> <笔记文件>');

const client = await new HostClient({ url }).connect();
const created = await client.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;
await client.call('session/selectModel', { request: { sessionId, provider: 'local', model: 'mock-local' } });

const toolEvents = [];
let reply = '';
client.openStream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, {
  onItem: (item) => {
    if (item.type === 'assistant-stream') {
      const chunk = item.frame?.chunk;
      if (chunk?.type === 'text-delta') reply += chunk.text;
      return;
    }
    if (item.type === 'event' && /tool/.test(item.event?.type ?? '')) toolEvents.push(item.event.type);
  },
  onError: (error) => console.log('stream error', JSON.stringify(error).slice(0, 200)),
});
await new Promise((r) => setTimeout(r, 800));
await client.call('session/prompt', {
  request: { requestId: `tool-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '记一条笔记' }] },
});
for (let i = 0; i < 90 && !reply.includes('记住'); i++) await new Promise((r) => setTimeout(r, 500));

const log = existsSync(mockLog) ? readFileSync(mockLog, 'utf8').trim().split('\n').filter(Boolean) : [];
const faceLine = log.find((line) => line.includes('toolFace=') && line.includes('mypi_note'));
const toolResultLine = log.find((line) => line.includes('lastRole=tool'));
const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : '';
const wroteNote = notes.includes('来自本地模型的笔记');

console.log(JSON.stringify({
  sessionId,
  toolFaceSeen: Boolean(faceLine),
  toolResultSeen: Boolean(toolResultLine),
  toolEvents,
  wroteNote,
  reply,
}, null, 0));
process.exit(faceLine && toolResultLine && wroteNote && reply.includes('记住') ? 0 : 1);
