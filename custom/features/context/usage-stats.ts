/**
 * Context Feature — 用量/缓存统计（纯逻辑，零 Pi 依赖）
 *
 * 度量基建（VISION §6 P1）：把工具调用的 token 与缓存命中写入 append-only JSONL，
 * 产出「缓存命中率 / token 成本」可对比数字。落盘 `portable/memory/context/usage.jsonl`。
 */

import { join } from 'node:path';
import { getMemoryDir } from '../../core/config';
import { appendJSONLRotating } from '../../core/fs-json';

export interface UsageEvent {
  ts: string;
  tool: string;
  ok: boolean;
  /** 输入 token（若 provider 返回 usage） */
  input?: number;
  /** 输出 token */
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** 输出内容估算 token（无 usage 时的兜底） */
  outputTokens?: number;
  durationMs?: number;
  /** 仅 bash：命令是否为"合并调用"（含 `;`/`&&`/`||`/`|`/换行 等连接符） */
  merged?: boolean;
  /** 仅 bash：命令段数（引号内的连接符不计） */
  segments?: number;
}

/** 去掉引号内的内容，避免把 `echo "a;b"` 里的分号当成命令连接符 */
function stripQuoted(cmd: string): string {
  let out = '';
  let i = 0;
  while (i < cmd.length) {
    const ch = cmd[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i++;
      while (i < cmd.length && cmd[i] !== ch) {
        if (cmd[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * 判断一条 bash 命令是否"合并调用"（P4 第三批：把 APPEND_SYSTEM.md 的软规则变成可度量指标）。
 *
 * 语义：引号外出现 `;`、`&&`、`||`、`|`、换行 任一即视为合并；段数 = 连接符数 + 1。
 * 实测基线（1103 条真实命令）：单命令占比仅 1.4%——规则本身被稳定遵守，故只做**可观测**，不另加限制。
 */
export function analyzeBashCommand(cmd: string): { segments: number; merged: boolean } {
  const bare = stripQuoted(cmd);
  const connectors = (bare.match(/&&|\|\||;|\||\n/g) ?? []).length;
  return { segments: connectors + 1, merged: connectors > 0 };
}

const MAX_SIZE = 4 * 1024 * 1024;

export function usageFilePath(): string {
  return process.env.PI_USAGE_FILE || join(getMemoryDir(), 'context', 'usage.jsonl');
}

export function appendUsage(event: UsageEvent): void {
  try {
    appendJSONLRotating(usageFilePath(), event, MAX_SIZE);
  } catch {
    /* fail-open：度量不阻塞主流程 */
  }
}

