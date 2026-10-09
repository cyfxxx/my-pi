/**
 * `edit_and_run` 的端到端探针（P6 留下的、唯一能挡住 pi 嵌套调用契约漂移的检查）
 *
 * ## 为什么它必须存在（而不是"一次性验证完就删"）
 *
 * 这个工具**没有任何自己的编辑逻辑**——它完全依赖 pi 的嵌套调用契约：
 *   ① `ctx.executeTool('edit'|'bash')` 可用；
 *   ② 嵌套调用**绕过** pi 的 `prepareArguments`，因此必须发**规范 schema**（`{path, edits:[{oldText,newText}]}`）。
 * ② 是当初探针第一次跑就抓到的真实缺陷（我照 Claude-Code 习惯写成了 `file_path/old_string/new_string`）。
 * 单元测试用假 ctx 驱动，**永远抓不到这类漂移**（它们恰好是"假 ctx 与真 pi 不一致"的地方）。
 * my-pi 是 pi 的硬分叉、按补丁跟进上游 —— 上游一旦改 `edit` 的 schema 或嵌套语义，单元测试会全绿而功能已坏。
 *
 * ## 显式 opt-in（不进默认门禁）
 *
 * 需要**已构建**的 dist 且会真起一个 pi 进程，所以：
 *   · `PI_NESTED_TOOLS_E2E=1` 才跑（与 `pool-e2e.test.ts` 的 `PI_SUBAGENT_POOL_E2E` 同型）；
 *   · dist 不存在时**自跳过**（与真实场景测试同型），不会在未构建的机器上变红。
 *
 * ## 断言是因果级而不是"两半都跑了"
 *
 * 验收命令是 `cat <目标文件>`：若命令输出是 `WORLD`（而不是编辑前的 `HELLO`），就证明
 * **编辑确实发生在命令之前**。另用一次**故意失败**的编辑（oldText 不存在）验证失败保护：
 * 命令必须完全没跑（用 `echo SHOULD-NOT-RUN` 做探针，断言该标记**不出现**）。
 */

import { describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const CLI = join(ROOT, 'vendor', 'pi', 'packages', 'coding-agent', 'dist', 'cli.js');
const BOOTSTRAP = join(ROOT, 'custom', 'bootstrap.ts');

const enabled = process.env.PI_NESTED_TOOLS_E2E === '1';
const built = existsSync(CLI) && existsSync(BOOTSTRAP);

/** SSE 信封（与 pi 期望的 OpenAI 流式 chunk 同形） */
interface Chunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{ index: number; delta: Record<string, unknown>; finish_reason: string | null }>;
}

interface CapturedRequest {
  url?: string;
  body?: { model?: string; messages?: Array<{ role?: string; content?: unknown }> };
}

/** 造一个假 provider：按调用次序依次回"失败的 edit_and_run" → "成功的 edit_and_run" → 文本 */
async function startProvider(target: string): Promise<{ port: number; requests: CapturedRequest[]; close: () => void }> {
  const requests: CapturedRequest[] = [];
  let step = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      let body: CapturedRequest['body'];
      try {
        body = raw ? (JSON.parse(raw) as CapturedRequest['body']) : undefined;
      } catch {
        body = undefined;
      }
      requests.push({ url: req.url, body });
      if (req.method === 'GET' && /\/models\b/.test(req.url ?? '')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'scenario-model', object: 'model', owned_by: 'fake' }] }));
        return;
      }
      if (!/\/chat\/completions\b/.test(req.url ?? '')) {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      const model = body?.model ?? 'scenario-model';
      const envelope = (delta: Record<string, unknown>, finish: string | null = null): Chunk => ({
        id: 'chatcmpl-nested',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });
      const emit = (delta: Record<string, unknown>, finish: string | null, args?: string): void => {
        res.write(`data: ${JSON.stringify(envelope({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: `call_${step}`, type: 'function', function: { name: 'edit_and_run', arguments: '' } }] }))}\n\n`);
        if (args !== undefined) {
          res.write(`data: ${JSON.stringify(envelope({ tool_calls: [{ index: 0, function: { arguments: args } }] }))}\n\n`);
        }
        res.write(`data: ${JSON.stringify(envelope(delta, finish))}\n\n`);
      };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      if (step === 0) {
        step++;
        // 故意让 oldText 不存在：编辑必失败 ⇒ 命令**不许**执行
        emit({}, 'tool_calls', JSON.stringify({ path: target, edits: [{ oldText: 'NOT-IN-FILE', newText: 'X' }], command: 'echo SHOULD-NOT-RUN' }));
      } else if (step === 1) {
        step++;
        emit({}, 'tool_calls', JSON.stringify({ path: target, edits: [{ oldText: 'HELLO', newText: 'WORLD' }], command: `cat ${target}` }));
      } else {
        res.write(`data: ${JSON.stringify(envelope({ role: 'assistant', content: 'NESTED-PROBE-DONE' }))}\n\n`);
        res.write(`data: ${JSON.stringify(envelope({}, 'stop'))}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { port, requests, close: () => server.close() };
}

describe.skipIf(!enabled || !built)('edit_and_run 端到端（真 pi + 嵌套调用）', () => {
  it(
    '失败保护与因果顺序同时成立',
    async () => {
      const agentDir = mkdtempSync(join(tmpdir(), 'my-pi-nested-'));
      const target = join(agentDir, 'target.txt');
      writeFileSync(target, 'HELLO\n');
      mkdirSync(join(agentDir, 'memory'), { recursive: true });
      const provider = await startProvider(target);
      writeFileSync(
        join(agentDir, 'models.json'),
        JSON.stringify({
          providers: {
            scenario: {
              baseUrl: `http://127.0.0.1:${provider.port}/v1`,
              api: 'openai-completions',
              apiKey: 'scenario-not-needed',
              models: [{ id: 'scenario-model', name: 'Scenario Model', contextWindow: 131072, maxTokens: 8192 }],
            },
          },
        }),
      );
      writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'scenario', defaultModel: 'scenario-model' }));

      const proc = spawn(
        process.execPath,
        [CLI, '--extension', BOOTSTRAP, '--no-context-files', '--no-session', '--mode', 'json', '-p', '改文件并验证'],
        {
          cwd: agentDir,
          env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_MEMORY_DIR: join(agentDir, 'memory') },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let out = '';
      proc.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
      proc.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')));
      const code: number | null = await new Promise((r) => proc.on('close', r));

      const comps = provider.requests.filter((r) => /chat\/completions/.test(r.url ?? ''));
      // **只看最后一次请求**：tool 消息在后续请求里是**累积**的，跨请求 flatMap 会得到
      // [失败, 失败, 成功] 这种重复序列（移植时踩过），按最后一次请求取才是 [失败, 成功]。
      const lastMsgs = comps[comps.length - 1]?.body?.messages ?? [];
      const toolMsgs = lastMsgs
        .filter((m) => m.role === 'tool')
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
      const first = toolMsgs[0] ?? '';
      const second = toolMsgs[1] ?? '';

      expect(comps.length, '应有 3 次模型请求：失败编辑 → 成功编辑 → 收尾').toBeGreaterThanOrEqual(3);

      expect(code, `pi 退出码应为 0；输出尾部：${out.slice(-400)}`).toBe(0);
      // ① 失败保护：编辑失败 ⇒ 命令一次都没跑（用 SHOULD-NOT-RUN 做探针）
      expect(first, '第一次工具结果应是 [edit] 失败 + [run] 已跳过').toContain('[edit] 失败');
      expect(first).toContain('已跳过');
      expect(first, '编辑失败时命令绝不许执行').not.toContain('SHOULD-NOT-RUN');
      // ② 因果顺序：命令输出是 WORLD 而不是 HELLO ⇒ 编辑先于命令发生
      expect(second).toContain('[edit] 成功');
      expect(second, '命令必须看到编辑后的内容（因果顺序）').toContain('WORLD');
      expect(readFileSync(target, 'utf8')).toBe('WORLD\n');

      provider.close();
      rmSync(agentDir, { recursive: true, force: true });
    },
    180_000,
  );
});
