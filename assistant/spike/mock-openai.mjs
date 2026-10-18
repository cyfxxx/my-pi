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
    const tools = parsed.tools ?? [];
    const toolNames = tools.map((t) => t?.function?.name ?? t?.name ?? '?');
    const last = parsed.messages?.[parsed.messages.length - 1];
    const toolResult = typeof last?.role === 'string' && last.role === 'tool';
    // 只在用户**明确要求记笔记**时才演工具调用：其它用例要的是纯文本回复，
    // 否则每个用例都会被拖进工具循环，断言就测不到原本要测的东西。
    // ★ 最后一条 user 消息不是用户输入：agent loop 会把「运行时上下文」快照追加在末尾。
    //   所以意图要看**全部** user 消息，而不是最后一条（这里踩过一次：工具永远不被调用）。
    const userText = (parsed.messages ?? [])
      .filter((m) => m?.role === 'user')
      .map((m) => (typeof m?.content === 'string'
        ? m.content
        : Array.isArray(m?.content)
          ? m.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
          : ''))
      .join('\n');
    const wantsNote = /笔记|记一条|note/i.test(userText);
    appendFileSync(
      LOG,
      `${new Date().toISOString()}\tmodel=${parsed.model}\tmessages=${parsed.messages?.length}\ttools=${tools.length}`
        + `\ttoolFace=${toolNames.join(',')}\tlastRole=${last?.role ?? '-'}\ttoolResult=${toolResult}`
        + `\tuserText=${JSON.stringify(userText).slice(0, 120)}\n`,
    );
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const id = `chatcmpl-mock-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const base = { id, object: 'chat.completion.chunk', created, model: parsed.model ?? 'mock-local' };
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    if (!toolResult && wantsNote && toolNames.includes('mypi_note')) {
      // 第一次请求：让"模型"调用我们的插件工具，从而真的走一遍工具循环
      sse(res, {
        ...base,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_mock_1',
              type: 'function',
              function: { name: 'mypi_note', arguments: JSON.stringify({ text: '来自本地模型的笔记' }) },
            }],
          },
          finish_reason: null,
        }],
      });
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } });
    } else {
      const reply = toolResult ? '记住啦。' : REPLY;
      for (const piece of reply) {
        sse(res, { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
      }
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: reply.length, total_tokens: 12 + reply.length } });
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock openai on http://127.0.0.1:${PORT}/v1`));
