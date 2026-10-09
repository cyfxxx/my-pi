/**
 * `goal` 第二校验来源（独立评审）的端到端探针
 *
 * ## 为什么必须有它
 *
 * 这条链路的每一环都**只有真跑才能证明**：
 *   `goal complete {verify:true}` → `ctx.executeTool('subagent', …)` → **另一个 pi 进程**做评审
 *   → 父级解析它的输出 → 记为 `verified（评审）`。
 *
 * 单元测试用**假 ctx** 驱动（`runGoalJudge` 收一个调用函数），它证明不了"通道在那条真实路径上通"——
 * 本会话已经栽过一次同类问题：池化路径漏传 `allowExtensions`，**编译通过、测试全绿、运行时静默降级**。
 *
 * ## 断言是因果级的，不是"看起来像"
 *
 * ① **评审请求真的到达了 provider**（含评审提示词特征）⇒ 评审是**独立进程**真跑，不是桩；
 * ② 该请求的**消息条数很少** ⇒ 评审确实是**独立上下文**（看不到父会话的自我叙述，这正是"独立判据"的意义）；
 * ③ 父级 `goal` 的工具结果里出现 **`独立评审：DONE`** 与 **`verified`** ⇒ 判定被如实解析并落到三态上。
 *
 * ## 显式 opt-in
 *
 * 要**已构建**的 dist、并会真起父进程 + 至少一个子进程（评审），所以：
 *   · `PI_GOAL_JUDGE_E2E=1` 才跑（与 `nested-tools-e2e.test.ts`、`pool-e2e.test.ts` 同型）；
 *   · dist / bootstrap 缺失时**自跳过**，不会在未构建的机器上变红。
 */

import { describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const CLI = join(ROOT, 'vendor', 'pi', 'packages', 'coding-agent', 'dist', 'cli.js');
const BOOTSTRAP = join(ROOT, 'custom', 'bootstrap.ts');

const enabled = process.env.PI_GOAL_JUDGE_E2E === '1';
const built = existsSync(CLI) && existsSync(BOOTSTRAP);

/** 评审提示词的特征串（`buildGoalJudgePrompt` 里的抬头）——用它区分"谁在问" */
const JUDGE_MARK = '独立验收员';
/** 评审的判定（子代理照约定格式回答） */
const JUDGE_REPLY = '判定：DONE\n理由：E2E：证据充分（评审独立进程）';

interface Msg {
  role?: string;
  content?: unknown;
}
interface CapturedRequest {
  url?: string;
  body?: { model?: string; messages?: Msg[] };
}

interface Chunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{ index: number; delta: Record<string, unknown>; finish_reason: string | null }>;
}

/** 假 provider：按"请求里有没有评审特征"路由；父级按调用次序走 set → complete(verify) → 收尾 */
async function startProvider(): Promise<{ port: number; requests: CapturedRequest[]; close: () => void }> {
  const requests: CapturedRequest[] = [];
  let parentStep = 0;
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
        id: 'chatcmpl-goaljudge',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });
      const text = (s: string): void => {
        res.write(`data: ${JSON.stringify(envelope({ role: 'assistant', content: s }))}\n\n`);
        res.write(`data: ${JSON.stringify(envelope({}, 'stop'))}\n\n`);
      };
      const toolCall = (name: string, args: unknown): void => {
        res.write(
          `data: ${JSON.stringify(
            envelope({
              role: 'assistant',
              content: null,
              tool_calls: [{ index: 0, id: `call_${parentStep}`, type: 'function', function: { name, arguments: '' } }],
            }),
          )}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify(
            envelope({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
          )}\n\n`,
        );
        res.write(`data: ${JSON.stringify(envelope({}, 'tool_calls'))}\n\n`);
      };

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const isJudge = JSON.stringify(body?.messages ?? []).includes(JUDGE_MARK);
      if (isJudge) {
        text(JUDGE_REPLY);
      } else if (parentStep === 0) {
        parentStep++;
        toolCall('goal', { action: 'set', objective: 'E2E：把目标声明出来' });
      } else if (parentStep === 1) {
        // 这一步会经 ctx.executeTool('subagent') 拉起**独立评审子代理**
        parentStep++;
        toolCall('goal', { action: 'complete', verify: true, evidence: 'E2E：改动已完成并有输出' });
      } else {
        text('PROBE-DONE');
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

describe.skipIf(!enabled || !built)('goal 第二校验来源端到端（真 pi + 独立评审子进程）', () => {
  it(
    'verify:true 真的拉起独立评审，并把判定落到 verified（来源=评审）',
    async () => {
      const agentDir = mkdtempSync(join(tmpdir(), 'my-pi-goaljudge-'));
      mkdirSync(join(agentDir, 'memory'), { recursive: true });
      const provider = await startProvider();
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
      writeFileSync(
        join(agentDir, 'settings.json'),
        JSON.stringify({ defaultProvider: 'scenario', defaultModel: 'scenario-model' }),
      );

      const proc = spawn(
        process.execPath,
        [CLI, '--extension', BOOTSTRAP, '--no-context-files', '--no-session', '--mode', 'json', '-p', '做个目标并完成它'],
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
      const judgeReqs = comps.filter((r) => JSON.stringify(r.body?.messages ?? []).includes(JUDGE_MARK));
      const parentToolTexts = comps
        .flatMap((r) => (r.body?.messages ?? []).filter((m) => m.role === 'tool'))
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');

      expect(code, `pi 退出码应为 0；输出尾部：${out.slice(-500)}`).toBe(0);
      // ① 评审是**独立进程**真跑（不是桩）：provider 收到过含评审提示词的请求
      expect(judgeReqs.length, '没有任何带评审提示词的请求 ⇒ 独立评审根本没跑').toBeGreaterThanOrEqual(1);
      // ② 评审是**独立上下文**：那边看到的消息很少（看不到父会话的自我叙述）
      const judgeMsgCount = judgeReqs[0]?.body?.messages?.length ?? 0;
      expect(judgeMsgCount, `评审请求带了 ${judgeMsgCount} 条消息 ⇒ 不是独立上下文`).toBeLessThanOrEqual(4);
      // ③ 判定被如实解析并落到三态（父级工具结果里能看到）
      expect(parentToolTexts, '父级没记成"独立评审：DONE"').toContain('独立评审：DONE');
      expect(parentToolTexts, '完成语义没有标成 verified').toContain('verified');

      provider.close();
      rmSync(agentDir, { recursive: true, force: true });
    },
    240_000,
  );
});
