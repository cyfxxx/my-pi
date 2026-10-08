/**
 * Subagent Feature — 子进程 runner（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/subagent/runner.ts`。
 * 注意：`pi --mode json -p` 子进程需要 PATH 中有 pi（或从 process.argv 推断）。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { getRpcPool, poolEnabled, pooledProfileKey } from './rpc-pool';
import type { RpcWorker } from './rpc-pool';
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
/**
 * 把一条 agent 事件映射进 `SingleResult`（**两条路径共用**）。
 *
 * 抽出来的原因：rpc 模式用 `output(toJsonEvent(event))` 往外写（`modes/rpc/rpc-mode.ts`），
 * 与 `--mode json` 是**同一个序列化器**，所以池化路径的事件形状与原来完全一致——
 * 共用这份映射就不必维护第二份（也不会两条路径悄悄漂移）。
 */
export function applyAgentEvent(
  result: SingleResult,
  event: { type?: string; message?: unknown },
  emitUpdate: () => void,
): void {
  if (event.type === 'message_end' && event.message) {
    const msg = event.message as {
      role?: string;
      usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
      model?: string;
      stopReason?: string;
      errorMessage?: string;
    };
    result.messages.push(msg);
    if (msg.role === 'assistant') {
      result.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        result.usage.input += usage.input || 0;
        result.usage.output += usage.output || 0;
        result.usage.cacheRead += usage.cacheRead || 0;
        result.usage.cacheWrite += usage.cacheWrite || 0;
        result.usage.cost += usage.cost?.total || 0;
        result.usage.contextTokens = calculateContextTokens(usage);
      }
      if (!result.model && msg.model) result.model = msg.model;
      if (msg.stopReason) result.stopReason = msg.stopReason;
      if (msg.errorMessage) result.errorMessage = msg.errorMessage;
    }
    emitUpdate();
  }
  if (event.type === 'tool_result_end' && event.message) {
    result.messages.push(event.message);
    emitUpdate();
  }
}

/**
 * 常驻池用的启动参数：与 {@link buildSubagentArgs} 同源，但
 *   · `--mode rpc`（常驻、可复用）而不是 `--mode json -p`（一次性）；
 *   · **不带任务文本**（任务走协议里的 `prompt` 请求）；
 *   · 不带 `--fork`（S2 只覆盖非 fork 路径；fork 仍走原 spawn 路径）。
 * `--append-system-prompt` 与 `--model` 是 **worker 级**的固定参数（按 profile 复用），
 * 这样"agent 人设仍是 system prompt"这一语义与现在完全一致。
 */
export function buildPooledSpawnArgs(opts: {
  model?: string;
  promptPath?: string | null;
  allowExtensions?: boolean;
}): string[] {
  const args: string[] = ['--mode', 'rpc'];
  // 默认**不加载扩展**（`--no-extensions`）。逐次 opt-in 才带扩展——这既保住了 `check-seeds-headless`
  // 的前提（定时任务派生的子代理默认仍是裸 pi），也把"子代理能改状态"的风险留在显式请求里。
  if (!opts.allowExtensions) args.push('--no-extensions');
  args.push('--no-session');
  if (opts.model) args.push('--model', opts.model);
  if (opts.promptPath) args.push('--append-system-prompt', opts.promptPath);
  return args;
}

/**
 * 子代理子进程的环境：剥离敏感凭据（通用 `*_API_KEY/*_API_TOKEN/*_AUTH_TOKEN/*_OAUTH_TOKEN`
 * + AWS 凭据 + PI 自身凭据，供任何 provider、不限于固定几个名字）。
 * **spawn 路径与池路径共用同一份**——安全属性不该有第二份实现。
 */
const SENSITIVE_ENV =
  /(_API_KEY|_API_TOKEN|_AUTH_TOKEN|_OAUTH_TOKEN)$|^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)|^PI_(SESSION_ID|AUTH|API_KEY)/i;

export function filteredSubagentEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !SENSITIVE_ENV.test(k)) out[k] = v;
  }
  return out;
}

/**
 * 池化路径：复用常驻 rpc worker 跑一个任务。
 *
 * 语义与 spawn 路径一致：人设仍是 **system prompt**（`--append-system-prompt` 是 worker 级参数）、
 * 每个任务前 `new_session` 保证隔离（已用确定性判据验证，见设计文档第八节）、
 * 事件映射复用 {@link applyAgentEvent}。
 * 与本函数的关系：失败时不吞——由调用方回退到 spawn 路径并往 stderr 留痕。
 */
async function runPooledAgent(
  agent: AgentConfig,
  defaultCwd: string,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
  resolvedModel: string | undefined,
  allowExtensions?: boolean,
): Promise<SingleResult> {
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

    const invocation = getPiInvocation(
      buildPooledSpawnArgs({ model: resolvedModel, promptPath: tmpPromptPath, allowExtensions }),
    );
    // 键按**内容**：用临时文件路径会让每个任务都是新 profile，池就永远不复用（踩过，见 rpc-pool.ts）
    const profileKey = pooledProfileKey({
      model: resolvedModel,
      agentName: agent.name,
      systemPromptText: agent.systemPrompt,
      allowExtensions,
    });
    // 租借：一个 worker 同一时刻只属于一个任务（rpc 协议是单会话，并发复用会互相踩）
    const lease = getRpcPool().lease({
      args: invocation.args,
      command: invocation.command,
      cwd: cwd ?? defaultCwd,
      env: filteredSubagentEnv(),
      profileKey,
    });
    const worker = lease.worker;

    const off = worker.onEvent((msg) => applyAgentEvent(currentResult, msg as { type?: string; message?: unknown }, emitUpdate));
    const settled = worker.waitSettled();
    try {
      // 新 worker 的会话本身就是空的；**复用**的 worker 必须先 new_session（隔离的前提）
      if (pooledUsed.has(worker)) await worker.send({ type: 'new_session' }, 60_000);
      else pooledUsed.add(worker);

      const onAbort = (): void => {
        void worker.send({ type: 'abort' }, 5_000).catch(() => {});
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      await worker.send({ type: 'prompt', message: task }, 120_000);
      await settled;
    } finally {
      off();
      lease.release();
    }

    if (!worker.alive) throw new Error(`worker 在任务执行中退出：${worker.lastError}`);
    if (signal?.aborted) throw new Error('Subagent was aborted');
    currentResult.exitCode = 0;
    recordSubagentUsage(currentResult);
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

/** 该 worker 是否已经跑过至少一个任务（决定复用前是否需要 `new_session`） */
const pooledUsed = new WeakSet<RpcWorker>();

export function buildSubagentArgs(opts: {
  task: string;
  model?: string;
  tools?: readonly string[] | null;
  promptPath?: string | null;
  forkSession?: string | null;
  allowExtensions?: boolean;
}): string[] {
  const fork = typeof opts.forkSession === 'string' && opts.forkSession.length > 0 ? opts.forkSession : null;
  const args: string[] = ['--mode', 'json', '-p'];
  if (!opts.allowExtensions) args.push('--no-extensions');
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
  allowExtensions?: boolean,
): Promise<SingleResult> {
  const resolvedModel = resolveModelId(agent.model, overrideModel, currentModel);

  // ── 常驻池路径（S2，见 docs/design/SUBAGENT-POOL.md）────────────────────────────
  // 省掉每次都 `spawn` 一个新 pi 进程的纯启动开销（本机实测 19.1s）。
  // 只覆盖**非 fork** 路径：fork 的隔离语义（继承父会话）尚未在池上验证，留在原路径。
  // fork **不放行**（已实测，不是"待验证"）：从 `--no-session` 起的 rpc 进程里发
  // `new_session {parentSession}`，**响应是 `success:true`，但随后请求的 messages 只有
  // `[system, user]`、不含父会话的任何内容**——即"接口收下了、分叉没发生"。
  // 若此刻放行，`context: 'fork'` 会静默降级成空上下文（语义变了却不报错）。
  // 实测见 docs/design/SUBAGENT-POOL.md 第十三节。fork 因此仍走已验证的 spawn 路径。
  if (poolEnabled() && !forkSession) {
    try {
      return await runPooledAgent(
        agent,
        defaultCwd,
        task,
        cwd,
        step,
        signal,
        onUpdate,
        makeDetails,
        resolvedModel,
      );
    } catch (e) {
      // 失败开放：池层的任何问题都退回已验证的 spawn 路径，但**要留下痕迹**
      // （静默回退会让"池没生效"这类问题永远查不出来）。
      process.stderr.write(
        `[subagent] 常驻池路径失败，已回退 spawn：${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

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
      allowExtensions,
    });
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      // 剥离敏感凭据：通用 *_API_KEY/*_API_TOKEN/*_AUTH_TOKEN/*_OAUTH_TOKEN 结尾
      // + AWS 凭据 + PI 自身凭据（供任何 provider、不限于原 5 个固定名）
      const filteredEnv = filteredSubagentEnv();
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
        applyAgentEvent(currentResult, event, emitUpdate);
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
  allowExtensions?: boolean,
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
      allowExtensions,
    );
  }
  return runSubprocessAgent(agent, defaultCwd, task, cwd, step, signal, onUpdate, makeDetails, currentModel, overrideModel, forkSession, allowExtensions);
}
