/**
 * 压缩三重门限与上下文解析（迁移自 pi-tools `pi-context/{task-gate,context-resolver}.ts`）
 *
 * 门：阈值（auto-compact.ts）+ 进行中计划任务 + 本会话后台任务（tmux）+ 空闲门（IDLE_MS，默认关闭）+ 冷却。
 * 本模块提供各门的信号与阈值环境变量，纯逻辑 + 只读本地文件/进程。
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';
import {
  PRUNE_PROTECT_TOKENS as DEFAULT_PRUNE_PROTECT,
  PRUNE_MINIMUM_TOKENS as DEFAULT_PRUNE_MINIMUM,
  DEFAULT_KEEP_THINKING_TOKENS,
} from './prune';

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 绝对压缩阈值（窗口大于该值时按绝对值；默认 256K） */
export const ABSOLUTE_TOKENS = envNum('PI_CONTEXT_ABSOLUTE_TOKENS', 256_000);
/** 重启提示阈值（超过后在回合开始注入"先 /compact 再重启"提示；默认 100K） */
export const RESTART_TOKENS = envNum('PI_CONTEXT_RESTART_TOKENS', 100_000);
/** 压缩冷却（默认 10 分钟） */
export const COMPACT_COOLDOWN_MS = envNum('PI_CONTEXT_COMPACT_COOLDOWN_MS', 10 * 60_000);
/**
 * 空闲门限（毫秒）。默认 0 = **关闭**。
 *
 * 历史：pi-tools 默认 10 分钟，意图是"活跃工作时压缩会打断思路，且压缩使前缀缓存整体
 * 失效"。2026-09-25 实测（10 小时 / 341K 上下文长会话）证明该取舍是净亏：
 *   - 判定点只有 turn_end，且总是紧跟一次用户输入 → 门在连续工作中**恒不过**，压缩从未发生；
 *   - 零压缩下平均上下文 271K，命中读取（cacheRead）本身就占成本大头；
 *   - 回放估算：开启压缩（阈值 256K）可使 prompt 费用降约 61%，远大于"不压缩保缓存"的收益。
 * 故默认关闭。如仍希望"仅在长时间空闲后才压缩"，设 `PI_CONTEXT_IDLE_MS>0`（毫秒），
 * 此时由 `passesIdleGateAtTurnEnd` 按"回合开始前空闲"正确判定。
 * 打断风险由门1（进行中计划任务）与门2（本会话后台任务）承担。
 */
export const IDLE_MS = (() => {
  const raw = process.env.PI_CONTEXT_IDLE_MS;
  if (raw === undefined || raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
})();
/** 任务门开关（PI_CONTEXT_TASK_GATE=off 关闭） */
export const TASK_GATE = process.env.PI_CONTEXT_TASK_GATE !== 'off';

// ── 确定性擦除阈值（env 可覆盖；默认值定义在 prune.ts，保持单一真值来源） ──
/** 工具输出擦除保护带（默认 60K）：最近这么多 token 的旧输出不擦 */
export const PRUNE_PROTECT = envNum('PI_CONTEXT_PRUNE_PROTECT_TOKENS', DEFAULT_PRUNE_PROTECT);
/** 工具输出擦除最低回收量（默认 30K）：可回收量不足则不擦（避免小碎擦） */
export const PRUNE_MINIMUM = envNum('PI_CONTEXT_PRUNE_MINIMUM_TOKENS', DEFAULT_PRUNE_MINIMUM);
/** thinking 块保留预算（默认 64K）：更早的 thinking 块删除 */
export const KEEP_THINKING_TOKENS = envNum('PI_CONTEXT_KEEP_THINKING_TOKENS', DEFAULT_KEEP_THINKING_TOKENS);

/** 读取 0-1 比例环境变量 */
export function readEnvRatio(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : undefined;
}

export interface ResolvedContext {
  tokens: number;
  window: number;
}

/** 解析会话上下文：优先真实 getContextUsage，回退到最近一轮 provider token 与窗口 */
export function resolveContext(
  ctx: { getContextUsage?: () => unknown },
  lastProviderContextTokens: number,
  fallbackContextWindow: number,
): ResolvedContext | null {
  const usage = ctx.getContextUsage?.() as
    | { tokens?: number | null; contextWindow?: number }
    | undefined;
  if (
    usage &&
    typeof usage.tokens === 'number' &&
    usage.tokens > 0 &&
    typeof usage.contextWindow === 'number' &&
    usage.contextWindow > 0
  ) {
    return { tokens: usage.tokens, window: usage.contextWindow };
  }
  if (lastProviderContextTokens > 0 && fallbackContextWindow > 0) {
    return { tokens: lastProviderContextTokens, window: fallbackContextWindow };
  }
  return null;
}

/** 本会话 tmux 后台任务注册表路径（与 tmux 功能一致：PI_TMUX_REGISTRY 或 memoryDir/tmux-registry.json） */
export function tmuxRegistryPath(): string {
  return process.env.PI_TMUX_REGISTRY || join(getMemoryDir(), 'tmux-registry.json');
}

/**
 * 门2b：本会话是否仍有存活的后台任务。
 * 仅统计注册表中 owner == PI_SESSION_ID 的条目（无法归属时返回 false，保持门惰性安全）。
 */
export function hasBackgroundTask(): boolean {
  const owner = process.env.PI_SESSION_ID || '';
  if (!owner) return false;
  try {
    const regPath = tmuxRegistryPath();
    if (!existsSync(regPath)) return false;
    const reg = JSON.parse(readFileSync(regPath, 'utf-8')) as {
      sessions?: Record<string, { owner?: string; name?: string }>;
    };
    const names: string[] = [];
    for (const e of Object.values(reg.sessions ?? {})) {
      if (e.owner === owner && e.name) names.push(e.name);
    }
    if (names.length === 0) return false;
    const r = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.error || r.status !== 0) return false;
    const alive = new Set(String(r.stdout).split('\n').filter(Boolean));
    return names.some((n) => alive.has(n));
  } catch {
    return false;
  }
}
