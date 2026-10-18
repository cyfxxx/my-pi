/**
 * tmux 工具断言（真链路）：
 *   ① mock 模型调用 `tmux_run` ⇒ 宿主真的建了 `mypi-demo` 会话
 *   ② 工具结果回灌后模型继续输出
 *   ③ 收尾时 `tmux_stop` 能把它清掉（前缀保护）
 */
import { execFileSync } from 'node:child_process';
import { HostClient } from '../src/transport.mjs';

const url = process.argv[2];
const prefix = process.env.MYPI_TMUX_PREFIX ?? 'mypi-';
if (!url) throw new Error('用法：node test/tmux.mjs "<宿主地址>"');

const has = (name) => {
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' })
      .split('\n').includes(name);
  } catch {
    return false;
  }
};

const client = await new HostClient({ url }).connect();
const created = await client.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;
await client.call('session/selectModel', { request: { sessionId, provider: 'local', model: 'mock-local' } });

let text = '';
const events = [];
client.openStream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, {
  onItem: (item) => {
    if (item.type === 'event' && /^tool\//.test(item.event?.type ?? '')) events.push(item.event.type);
    const chunk = item.type === 'assistant-stream' ? item.frame?.chunk : undefined;
    if (chunk?.type === 'text-delta') text += chunk.text;
  },
});
await new Promise((r) => setTimeout(r, 800));
await client.call('session/prompt', {
  request: { requestId: `tx-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '用 tmux 跑一下 echo hi' }] },
});
for (let i = 0; i < 60 && text === ''; i++) await new Promise((r) => setTimeout(r, 500));

const name = `${prefix}demo`;
const createdSession = has(name);
let cleaned = false;
if (createdSession) {
  execFileSync('tmux', ['kill-session', '-t', name]);
  cleaned = !has(name);
}
const ok = createdSession && cleaned && events.includes('tool/call') && text !== '';
console.log(JSON.stringify({ sessionId, tmuxSession: name, createdSession, cleaned, events, reply: text.slice(0, 20), ok }));
process.exit(ok ? 0 : 1);
