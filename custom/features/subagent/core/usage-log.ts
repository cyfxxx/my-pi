/**
 * Subagent Feature — 子代理用量落盘（纯逻辑，零 Pi 依赖）
 *
 * 子代理以 `--mode json -p --no-session --no-extensions` 独立进程运行：它的 usage
 * 既不写入主会话 jsonl，也不写入 `.usage-diag.jsonl`（后者由 my-pi 扩展写，而被
 * `--no-extensions` 禁用）。结果是 TUI footer 与本地统计都看不到子代理开销，与
 * provider 账单对不上。这里把每次子代理运行的真实 usage（含 cost）追加到
 * `<memoryDir>/subagent/usage.jsonl`，供成本核算。
 *
 * 约定：写盘失败静默吞掉，成本统计属旁路，不得影响子代理主流程。
 *
 * 2026-10-08（用户批复第 4 项）：新增 `writeTools` —— 让"**子代理有没有动文件**"可观测。
 * 起因是 SoL-Pi 的 D6（"不要在没有 verifier 契约时派生成式编辑代理"）在我们这里**无法判断**：
 * 之前既没派过编辑代理的痕迹，也没有任何口径能看出来。没有这个字段，"要不要给编辑类子代理加验收条件"
 * 就只能靠感觉。
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getMemoryDir } from '../../../core/config';
import type { SingleResult } from './types';

export interface SubagentUsageRecord {
  ts: number;
  agent: string;
  agentSource: string;
  model?: string;
  step?: number;
  exitCode: number;
  turns: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  cost: number;
  task: string;
  /**
   * 子代理调用过的**文件编辑类**工具名（去重、保序；只读子代理为 `[]`）。
   *
   * 语义边界（重要，别把当它成"改没改文件"的完备判据）：
   *   · 只认**以编辑文件为主要目的**的工具：`write` / `edit` / `edit_and_run`；
   *   · **不含 `bash` / `ctx_exec` / `tmux_*` 这类 catch-all**——它们当然也能写文件，但含进来会让
   *     这个字段**恒为非空**（几乎每个子代理都会跑一条命令），信息量归零；
   *   · 因此它是"**用过文件编辑工具**"的**下界**，不是完备判据。要判"文件到底变没变"得看盘面（后续项）。
   */
  writeTools: string[];
}

/** 落盘路径；可用 `PI_SUBAGENT_USAGE_FILE` 覆盖（测试用） */
export function subagentUsageFile(): string {
  return process.env.PI_SUBAGENT_USAGE_FILE || join(getMemoryDir(), 'subagent', 'usage.jsonl');
}

/**
 * 视为"文件编辑类"的工具名（**故意不含 `bash`/`ctx_exec`/`tmux_*`**：catch-all 含进来会让
 * 统计恒为非空——见 `SubagentUsageRecord.writeTools` 的语义边界说明）。
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'edit_and_run']);

/**
 * 从子代理消息里提取文件编辑类工具名（**去重、保留首次出现顺序**）。
 *
 * 消息形状取自 pi 的事件流：`{role:'assistant', content:[{type:'toolCall', name:'edit',...}]}`。
 * 对未知/畸形结构**一律跳过**（这是一个旁路统计，绝不能因为形状变化而抛错）。
 */
export function extractWriteTools(messages: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: unknown; name?: unknown };
      if (b.type !== 'toolCall' || typeof b.name !== 'string') continue;
      if (!WRITE_TOOLS.has(b.name) || seen.has(b.name)) continue;
      seen.add(b.name);
      out.push(b.name);
    }
  }
  return out;
}

/** 由 SingleResult 生成用量记录（task 截断，避免把长任务全文写进账本） */
export function buildUsageRecord(result: SingleResult, ts: number = Date.now()): SubagentUsageRecord {
  return {
    ts,
    agent: result.agent,
    agentSource: result.agentSource,
    model: result.model,
    step: result.step,
    exitCode: result.exitCode,
    turns: result.usage.turns,
    input: result.usage.input,
    cacheRead: result.usage.cacheRead,
    cacheWrite: result.usage.cacheWrite,
    output: result.usage.output,
    cost: result.usage.cost,
    task: result.task.slice(0, 200),
    writeTools: extractWriteTools(result.messages ?? []),
  };
}

/** 追加一条子代理用量记录；失败静默（不中断子代理） */
export function recordSubagentUsage(result: SingleResult): void {
  try {
    const file = subagentUsageFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(buildUsageRecord(result))}\n`);
  } catch {
    /* 旁路统计失败不影响子代理 */
  }
}
