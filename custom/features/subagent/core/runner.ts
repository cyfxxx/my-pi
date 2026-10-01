/**
 * Subagent Feature — 子进程 runner（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/subagent/runner.ts`。
 * 注意：`pi --mode json -p` 子进程需要 PATH 中有 pi（或从 process.argv 推断）。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { AgentConfig } from './agents';
import type { SingleResult, SubagentDetails, OnUpdateCallback } from './types';
import { getFinalOutput, resolveAgentTools, buildAgentPrompt, scheduleKillChain, calculateContextTokens } from './helpers';
import { findActivePlan } from '../../plan-mode/logic';
import { recordSubagentUsage } from './usage-log';

/**
 * 子代理模型优先级（高 → 低）：
 *   1. `overrideModel` — 调用级显式指定（主模型可为本次子任务挑模型）
 *   2. `agentModel`   — agent `.md` frontmatter 的 `model:`（角色固定）
 *   3. `currentModel` — 主会话实时模型（默认继承）
 *   4. 都为空 → 不传 `--model`，子进程用 settings.json 默认
 */
export function resolveModelId(
  agentModel: string | undefined,
  overrideModel: string | undefined,
  currentModel: { id?: string; provider?: string } | undefined,
): string | undefined {
  if (overrideModel) return overrideModel;
  if (agentModel) return agentModel;
  if (currentModel?.id && currentModel?.provider) return `${currentModel.provider}/${currentModel.id}`;
  return undefined;
}

/**
 * 读取当前活跃计划内容（复用 plan-mode 的恢复语义：PI_PLANS_DIR 优先、7 天窗口、
 * statSync 判目录、含未完成任务），供子代理系统提示注入；超过 2048 字符截断。
 */
export function getActivePlanSnippet(): string | null {
  const plan = findActivePlan();
  if (!plan) return null;
  return plan.content.length > 2048 ? plan.content.slice(0, 2048) + '\n...（已截断）' : plan.content;
}

function writePromptToTempFile(agentName: string, prompt: string): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-subagent-'));
  const safeName = agentName.replace(/[^\w.-]+/g, '_');
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: 'utf-8', mode: 0o600 });
  return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith('/$bunfs/root/');
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }
  return { command: 'pi', args };
}

/**
 * 组装子代理命令行（纯函数，便于单测）。
 *
 * 两种会话模式（`context` 参数）：
 *   - **spawn（默认）**：`--no-session` —— 空上下文，只带 system + 工具声明 + 任务。
 *     最便宜的一次请求，但子代理看不到父会话。
 *   - **fork**：`--fork <父会话文件>` —— 继承父会话历史（pi 会新建一个 fork 会话）。
 *     父会话刚发过请求时，那段前缀在 provider 侧是**暖的**，子代理首请求按 cacheRead 计价（约为全价的 1/50），
 *     于是"既拿到上下文又便宜"；反之若缓存已冷，则为整段历史付全价。
 *     故它是**显式 opt-in**，适合"需要父上下文的短任务"且紧接着父会话请求时使用（对齐 DSH 的 fork/spawn 之分）。
 *
 * 注意：fork 时不能带 `--no-session`（fork 本身要创建会话）；`--no-extensions` 两者都保留。
 */
export function buildSubagentArgs(opts: {
  task: string;
  model?: string;
  tools?: readonly string[] | null;
  promptPath?: string | null;
  forkSession?: string | null;
}): string[] {
  const fork = typeof opts.forkSession === 'string' && opts.forkSession.length > 0 ? opts.forkSession : null;
  const args: string[] = ['--mode', 'json', '-p', '--no-extensions'];
  if (fork) args.push('--fork', fork);
  else args.push('--no-session');
  if (opts.model) args.push('--model', opts.model);
  if (opts.tools && opts.tools.length > 0) args.push('--tools', opts.tools.join(','));
  if (opts.promptPath) args.push('--append-system-prompt', opts.promptPath);
  args.push(`Task: ${opts.task}`);
  return args;
}

export async function runSubprocessAgent(
  agent: AgentConfig,
  defaultCwd: string,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
  currentModel?: { id?: string; provider?: string },
  overrideModel?: string,
  forkSession?: string,
): Promise<SingleResult> {
  const resolvedModel = resolveModelId(agent.model, overrideModel, currentModel);
  const effectiveTools = resolveAgentTools(agent);

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  const currentResult: SingleResult = {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: '',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    model: resolvedModel,
    step,
  };

  const emitUpdate = (): void => {
    onUpdate?.({
      content: [{ type: 'text', text: getFinalOutput(currentResult.messages) || '(running...)' }],
      details: makeDetails([currentResult]),
    });
  };

  try {
    if (agent.systemPrompt.trim()) {
      let fullPrompt = buildAgentPrompt(agent);
      const activePlan = getActivePlanSnippet();
      if (activePlan) {
        fullPrompt += `\n\n---\n## 当前活跃计划（plan.md）\n以下是最新的执行计划，请确保你的工作对齐此计划：\n\n${activePlan}`;
      }
      const tmp = writePromptToTempFile(agent.name, fullPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
    }

    const args = buildSubagentArgs({
      task,
      model: resolvedModel,
      tools: effectiveTools,
      promptPath: tmpPromptPath,
      forkSession,
    });
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      // 剥离敏感凭据：通用 *_API_KEY/*_API_TOKEN/*_AUTH_TOKEN/*_OAUTH_TOKEN 结尾
      // + AWS 凭据 + PI 自身凭据（供任何 provider、不限于原 5 个固定名）
      const SENSITIVE_ENV =
        /(_API_KEY|_API_TOKEN|_AUTH_TOKEN|_OAUTH_TOKEN)$|^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)|^PI_(SESSION_ID|AUTH|API_KEY)/i;
      const filteredEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && !SENSITIVE_ENV.test(k)) filteredEnv[k] = v;
      }
      const proc = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: filteredEnv,
      });
      const totalTimer = setTimeout(() => {
        wasAborted = true;
        scheduleKillChain(proc);
      }, 30 * 60 * 1000);
      totalTimer.unref?.();
      let buffer = '';

      const processLine = (line: string): void => {
        if (!line.trim()) return;
        let event: { type?: string; message?: unknown };
        try {
          event = JSON.parse(line) as { type?: string; message?: unknown };
        } catch {
          return;
        }
        if (event.type === 'message_end' && event.message) {
          const msg = event.message as {
            role?: string;
            usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
            model?: string;
            stopReason?: string;
            errorMessage?: string;
          };
          currentResult.messages.push(msg);
          if (msg.role === 'assistant') {
            currentResult.usage.turns++;
            const usage = msg.usage;
            if (usage) {
              currentResult.usage.input += usage.input || 0;
              currentResult.usage.output += usage.output || 0;
              currentResult.usage.cacheRead += usage.cacheRead || 0;
              currentResult.usage.cacheWrite += usage.cacheWrite || 0;
              currentResult.usage.cost += usage.cost?.total || 0;
              currentResult.usage.contextTokens = calculateContextTokens(usage);
            }
            if (!currentResult.model && msg.model) currentResult.model = msg.model;
            if (msg.stopReason) currentResult.stopReason = msg.stopReason;
            if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
          }
          emitUpdate();
        }
        if (event.type === 'tool_result_end' && event.message) {
          currentResult.messages.push(event.message);
          emitUpdate();
        }
      };

      proc.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      });
      proc.stderr!.on('data', (data: Buffer) => {
        currentResult.stderr += data.toString();
        if (currentResult.stderr.length > 50 * 1024) currentResult.stderr = currentResult.stderr.slice(-50 * 1024);
      });
      proc.on('close', (code) => {
        clearTimeout(totalTimer);
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });
      proc.on('error', (err: Error) => {
        clearTimeout(totalTimer);
        currentResult.errorMessage = `子进程启动失败: ${err.message}`;
        currentResult.stderr += `子进程启动失败: ${err.message}\n`;
        resolve(1);
      });

      if (signal) {
        const killProc = (): void => {
          wasAborted = true;
          scheduleKillChain(proc);
        };
        if (signal.aborted) killProc();
        else signal.addEventListener('abort', killProc, { once: true });
      }
    });

    currentResult.exitCode = exitCode;
    // 子代理用量单独落盘：它既不在主会话 jsonl，也不在 .usage-diag.jsonl
    recordSubagentUsage(currentResult);
    if (wasAborted) throw new Error('Subagent was aborted');
    return currentResult;
  } finally {
    if (tmpPromptPath) {
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        /* ignore */
      }
    }
    if (tmpPromptDir) {
      try {
        fs.rmdirSync(tmpPromptDir);
      } catch {
        /* ignore */
      }
    }
  }
}

export async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string | undefined,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
  currentModel?: { id?: string; provider?: string },
  overrideModel?: string,
  forkSession?: string,
): Promise<SingleResult> {
  const agent = agents.find((a) => a.name === agentName);
  if (!agent) {
    return runSubprocessAgent(
      {
        name: agentName || 'default',
        description: '通用子代理（无预定义角色时使用）',
        systemPrompt: '你是通用子代理，在独立上下文中执行委派的任务。',
        source: 'user',
        filePath: '',
      },
      defaultCwd,
      task,
      cwd,
      step,
      signal,
      onUpdate,
      makeDetails,
      currentModel,
      overrideModel,
      forkSession,
    );
  }
  return runSubprocessAgent(agent, defaultCwd, task, cwd, step, signal, onUpdate, makeDetails, currentModel, overrideModel, forkSession);
}
