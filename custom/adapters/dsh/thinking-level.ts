/**
 * thinking 档位 → DSH 的 `reasoningEffort`（纯映射，可在无模型路由的情况下单测）
 *
 * ## 背景（为什么这不是"无对应"）
 *
 * pi 有 `thinking_level_select` 事件（选中档位时触发），处理器可以做**缓存安全夹档**
 * （`custom/features/context/index.ts:354` 起：选中 high 但设了上限 ⇒ 夹到 clamped 并 `setThinkingLevel`）。
 * 换到 DSH 后：
 *   - **触发点没有等价物**：DSH 没有"思考级别选中"事件 ✗（`DSH-HOOK-MAPPING.md` §6.4 的检索面）。
 *   - **但应用点是存在的** ✓：请求的冻结配置里有 `reasoningEffort?: ReasoningEffortId`
 *     （`dsh-llm/lib/types/call-config.d.ts:19`），而模块注释明说 **"request waterfalls replace them"**
 *     ⇒ `agent/request`（waterfall，"Replace the frozen call configuration"）就是应用点。
 *   - 可选的档位来自模型能力查询：`LlmModelReasoningInfo { efforts: LlmReasoningEffortInfo[]; defaultEffort? }`
 *     （`dsh-llm/lib/types/types.d.ts:338-357`），每项是 `{id, name, description?}`。
 *
 * ⇒ 正确的移植形态是**把夹档逻辑搬到请求点**（每请求幂等），而不是去找一个等价事件。
 * 本模块只做"级别 → 可选档位"的**纯映射**（下一步接 `agent/request` 时才需要模型路由）。
 *
 * ## 夹档方向：只降不升（安全性来自这里）
 *
 * pi 那个处理器的目的是**缓存安全**——不允许把档位抬到超过上限（升档会让整段前缀缓存失效）。
 * 因此当目标档位在模型的可选档位里**不存在**时，本模块**向下取最近的**可用档位，绝不向上取；
 * 连一个不高于目标的档位都没有时，返回失败原因（由调用方决定是保持现状还是显式报错）。
 */

/** 目标档位（pi 的 low/medium/high；DSH 的档位是适配器自定义标识，见下） */
export type ThinkingLevel = 'low' | 'medium' | 'high' | string;

/** 一个可选档位（`LlmReasoningEffortInfo` 的最小快照） */
export interface ReasoningEffortLike {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

/** 映射结果 */
export type EffortMapping =
  | { readonly ok: true; readonly effort: string; readonly matched: 'exact' | 'alias' | 'clamped-down'; readonly note?: string }
  | { readonly ok: false; readonly reason: string };

/**
 * 常见别名（把不同适配器的命名归一到 low/medium/high 序）。
 * 索引即"档位序"：数字越小越省（缓存越安全）。
 */
const LEVEL_ORDER: readonly string[][] = [
  ['minimal', 'min', 'off', 'none', 'lowest', 'low', 'fast', 'short'],
  ['medium', 'mid', 'default', 'normal', 'standard', 'balanced'],
  ['high', 'max', 'maximum', 'highest', 'deep', 'long', 'extended'],
];

/** 把任意档位名归一成 0/1/2；认不出返回 undefined */
export function levelRank(level: string): number | undefined {
  const needle = level.trim().toLowerCase();
  if (!needle) return undefined;
  for (let i = 0; i < LEVEL_ORDER.length; i += 1) {
    if (LEVEL_ORDER[i].includes(needle)) return i;
  }
  return undefined;
}

/** 把可选档位按"档位序"归类（优先看 name，其次 id；认不出就跳过） */
function rankEfforts(efforts: readonly ReasoningEffortLike[]): Array<{ effort: ReasoningEffortLike; rank: number }> {
  const out: Array<{ effort: ReasoningEffortLike; rank: number }> = [];
  for (const effort of efforts) {
    const rank = levelRank(effort.name ?? '') ?? levelRank(effort.id);
    if (rank !== undefined) out.push({ effort, rank });
  }
  return out;
}

/**
 * 目标档位 → 可用档位。
 *
 * 匹配顺序：**同名/同 id 精确**（含大小写不敏感）→ **别名同序**（如目标 `high`、可用 `max`）
 * → **向下取最近**（绝不向上）→ 失败。
 */
export function mapThinkingLevelToEffort(
  level: ThinkingLevel,
  efforts: readonly ReasoningEffortLike[],
): EffortMapping {
  const target = String(level ?? '').trim();
  if (!target) return { ok: false, reason: '目标档位为空' };
  if (!Array.isArray(efforts) || efforts.length === 0) {
    return { ok: false, reason: '模型没有暴露任何可选档位（LlmModelReasoningInfo.efforts 为空）' };
  }

  const needle = target.toLowerCase();
  const exact = efforts.find((e) => e.id.toLowerCase() === needle || (e.name ?? '').toLowerCase() === needle);
  if (exact) return { ok: true, effort: exact.id, matched: 'exact' };

  const targetRank = levelRank(target);
  const ranked = rankEfforts(efforts);
  if (targetRank === undefined) {
    // 目标档位认不出序：只能精确匹配（已失败）⇒ 不猜
    return {
      ok: false,
      reason: `目标档位 "${target}" 认不出档位序，且没有同名/同 id 的可选档位（不猜测，避免把成本调高）`,
    };
  }

  const sameRank = ranked.find((r) => r.rank === targetRank);
  if (sameRank) {
    return {
      ok: true,
      effort: sameRank.effort.id,
      matched: 'alias',
      note: `"${target}" 与可选档位 ${sameRank.effort.id}（${sameRank.effort.name ?? '无 name'}）同序`,
    };
  }

  const lower = ranked.filter((r) => r.rank < targetRank).sort((a, b) => b.rank - a.rank);
  const best = lower[0];
  if (best) {
    return {
      ok: true,
      effort: best.effort.id,
      matched: 'clamped-down',
      note: `"${target}" 在可选档位里不存在 ⇒ 向下取最近的 ${best.effort.id}（绝不向上：升档会整段前缀缓存失效）`,
    };
  }

  return {
    ok: false,
    reason: `可选档位里没有不高于 "${target}" 的档位（只有更高的：${efforts.map((e) => e.id).join(', ')}）⇒ 保持现状更安全`,
  };
}
