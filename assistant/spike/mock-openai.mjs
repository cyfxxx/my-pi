/**
 * 一个最小的「本地模型」端点：OpenAI 兼容（/v1/models + /v1/chat/completions 流式）。
 * 它的用途不是冒充大模型，而是**证明本地路由这条链路真的接通了**：
 *   pi-ai 适配器 → dsh-llm-pi-ai → llm 服务 → agent 循环 → TUI。
 * 每收到一次请求就追加一行到 mock-requests.log，便于断言。
 */
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.argv[2] ?? 11435);
const LOG = process.argv[3] ?? 'mock-requests.log';
const REPLY = process.argv[4] ?? '我是本地模型，在你机器上跑。';

const sse = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-local', object: 'model', owned_by: 'local' }] }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || '{}');
    const tools = parsed.tools?.length ?? 0;
    appendFileSync(LOG, `${new Date().toISOString()}\tmodel=${parsed.model}\tmessages=${parsed.messages?.length}\ttools=${tools}\n`);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const id = `chatcmpl-mock-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const base = { id, object: 'chat.completion.chunk', created, model: parsed.model ?? 'mock-local' };
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    for (const piece of REPLY) {
      sse(res, { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
    }
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: REPLY.length, total_tokens: 12 + REPLY.length } });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock openai on http://127.0.0.1:${PORT}/v1`));
