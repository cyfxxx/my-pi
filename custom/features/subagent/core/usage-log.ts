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
}

/** 落盘路径；可用 `PI_SUBAGENT_USAGE_FILE` 覆盖（测试用） */
export function subagentUsageFile(): string {
  return process.env.PI_SUBAGENT_USAGE_FILE || join(getMemoryDir(), 'subagent', 'usage.jsonl');
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
