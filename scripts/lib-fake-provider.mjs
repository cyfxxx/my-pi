#!/usr/bin/env node
/**
 * lib-fake-provider.mjs — 本地假 provider（确定性、零网络、可断言）
 *
 * 为什么需要：真实 provider 会让"回合级"断言变成概率事件——实测同一提示词响应 4.6s–145s
 * （免费 provider 抖动，曾把"进程没退出"误报成挂起）。有了假 provider：
 *   - **"这个动作到底有没有产生模型请求"变成确定性事实**（请求计数与请求体可直接断言）；
 *   - 场景不再依赖网络与凭据，也不需要 `PI_OFFLINE` 之类的绕路；
 *   - 还能断言"模型实际收到了什么"（例如续跑指令是否真的带上了"不要凭空开工"）。
 *
 * 用法：
 *   const p = await startFakeProvider({ replyText: 'OK' });
 *   // 把 models.json 的 provider.baseUrl 指向 http://127.0.0.1:${p.port}/v1
 *   p.requests      // 所有请求（含 /v1/models 这类探测）
 *   p.completions   // 只含 /chat/completions（= 真正跑了模型回合的次数）
 *   await p.close()
 *
 * 选项：`hang` = 全部不回应、`hangFirst` = 前 n 次不回应（用于"回合卡在半途"的场景）；
 * `replyText` = 固定回复内容；`delayMs` = 响应延迟（**建议 ≥300ms**：0 延迟会命中 pi 在
 * session_start 触发回合时的初始化竞态，偶发丢回复，让"回合跑完"这类断言假失败）。
 * 运行期可用 `hangNext(n)` / `setReply(text)` 动态调整。
 */
import { createServer } from 'node:http';

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sseChunk(res, model, delta, finish = null) {
  const payload = {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function startFakeProvider({ replyText = 'SCENARIO-REPLY-OK', hang = false, hangFirst = 0, delayMs = 0 } = {}) {
  const sockets = new Set();
  const requests = [];
  let hangCount = Math.max(0, hangFirst);
  let reply = replyText;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c.toString('utf8')));
    req.on('end', () => {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = { __unparsed: raw.slice(0, 200) };
      }
      const entry = { ts: Date.now(), method: req.method, url: req.url, body };
      requests.push(entry);

      // 模型目录探测：给一个最小可用清单（避免 pi 去公网拉目录）
      if (req.method === 'GET' && /\/models\b/.test(req.url ?? '')) {
        json(res, 200, { object: 'list', data: [{ id: 'scenario-model', object: 'model', owned_by: 'fake' }] });
        return;
      }
      if (!/\/chat\/completions\b/.test(req.url ?? '')) {
        json(res, 404, { error: { message: `fake provider: 未实现的路径 ${req.url}` } });
        return;
      }

      // hang：把连接挂住不回应（模拟"回合进行中"）；hangNext(n) 可让接下来 n 次挂住
      if (hang || hangCount > 0) {
        if (hangCount > 0) hangCount--;
        return;
      }

      const model = typeof body?.model === 'string' ? body.model : 'scenario-model';
      const respond = () => {
      if (body?.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        sseChunk(res, model, { role: 'assistant', content: reply });
        sseChunk(res, model, {}, 'stop');
        res.write('data: [DONE]\n\n');
        res.end();
        entry.respondedAt = Date.now();
        return;
      }
      entry.respondedAt = Date.now();
      json(res, 200, {
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
      };
      // 响应延迟：**真实 provider 不会 0ms 回**。实测 0 延迟会命中 pi 的一个初始化竞态
      // （session_start 触发的回合在极速响应下偶发丢回复），让基于"回复落盘"的断言假失败。
      if (delayMs > 0) setTimeout(respond, delayMs);
      else respond();
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    get requests() {
      return requests;
    },
    /** 让接下来 n 次模型请求挂住（模拟"回合进行中被重启"）；返回 n 便于链式断言 */
    hangNext(n = 1) {
      hangCount = Math.max(0, n);
      return hangCount;
    },
    /** 换一个后续回复内容（用来区分不同回合的落盘证据） */
    setReply(text) {
      reply = text;
    },
    /** 只统计真正跑模型回合的请求 */
    get completions() {
      return requests.filter((r) => /\/chat\/completions\b/.test(r.url ?? ''));
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
