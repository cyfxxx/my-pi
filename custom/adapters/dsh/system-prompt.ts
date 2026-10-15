/**
 * 注入面接线：把 my-pi 的**静态 system 注入**接到 DSH 的提示词服务上。
 *
 * ## 背景（为什么这是换底座必须做的一步）
 *
 * pi 原生支持 `APPEND_SYSTEM.md`（pi 自己把它拼到 system prompt 末尾）。DSH 没有这个约定，
 * 它提供的是 `SystemPrompt` **服务**：谁都可以 `ctx.systemPrompt.section({name, order, text})`
 * 注册有序提示段（`dsh-system-prompt/lib/types/index.d.ts:165-230`）。
 * 不接这一步，"输出要求/重要事项"这段指令在 DSH 上**根本不会出现在模型提示里**——
 * 而且不会报错（静默失效，本项目最忌讳的形态）。
 *
 * ## 落位
 *
 * `APPEND_SYSTEM.md` 在 pi 里的语义是"附在 system prompt 末尾"⇒ 这里取
 * **所有工具段之后的顺序**：遍历 harness 已知的工具段名求最大 order 再 +100；
 * 求不到（版本变化/服务缺方法）时回退 `FALLBACK_ORDER = 9000` 并**上报**。
 * ✗ 诚实缺口：若未来 harness 新增了 order > 我们的段，我们的内容会前移（不是末尾）——
 *   这一点写在 `docs/design/DSH-MIGRATION-PLAN.md` 的 P6 里，由提示词基线守门覆盖。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DshContext, DshDisposer, DshSystemPromptService } from './types';

/** 无等价物/降级的上报通道 */
export type SystemPromptReporter = (member: string, detail: string) => void;

const defaultReporter: SystemPromptReporter = (member, detail) => {
  console.warn(`[dsh-system-prompt] ${member}：${detail}`);
};

/** 我们的段名（唯一，重名 DSH 会抛） */
export const MY_PI_APPEND_SECTION = 'my-pi:append-system';

/** 排不上工具段时用的兜底顺序（报告里会说明） */
export const FALLBACK_ORDER = 9000;

/** harness 已知的工具段名（用于算"排在全部工具段之后"）；取自 SECTION_ORDERS 的键 */
const KNOWN_TOOL_SECTIONS = [
  'TOOL_BASH',
  'TOOL_PWSH',
  'TOOL_READ',
  'TOOL_WRITE',
  'TOOL_EDIT',
  'TOOL_GLOB',
  'TOOL_GREP',
  'TOOL_JOBS',
  'TOOL_PTY',
  'TOOL_WEB_SEARCH',
  'TOOL_WEB_FETCH',
  'TOOL_LSP',
  'TOOL_SESSION_QUERY',
  'TOOL_GOAL',
];

/** 求"排在全部工具段之后"的 order */
export function resolveAppendOrder(service: DshSystemPromptService, report: SystemPromptReporter = defaultReporter): number {
  if (typeof service.getSectionOrder !== 'function') {
    report('systemPrompt.getSectionOrder', `服务未暴露该方法 ⇒ 用兜底顺序 ${FALLBACK_ORDER}（可能不落在末尾）`);
    return FALLBACK_ORDER;
  }
  let max: number | undefined;
  for (const name of KNOWN_TOOL_SECTIONS) {
    try {
      const order = service.getSectionOrder(name);
      if (typeof order === 'number' && Number.isFinite(order)) max = max === undefined ? order : Math.max(max, order);
    } catch {
      // 该名字在本版本里不存在 ⇒ 跳过（不求全，只求"已知的最大"）
    }
  }
  if (max === undefined) {
    report('systemPrompt.getSectionOrder', `已知工具段名一个都没解析出来 ⇒ 用兜底顺序 ${FALLBACK_ORDER}（可能不落在末尾）`);
    return FALLBACK_ORDER;
  }
  return max + 100;
}

export interface RegisterSystemPromptOptions {
  /** my-pi 仓库根（`APPEND_SYSTEM.md` 位于 `<root>/portable/agent/`） */
  readonly root: string;
  readonly report?: SystemPromptReporter;
  /** 跳过注册（例如只想量工具面时的测试路径） */
  readonly disabled?: boolean;
}

/**
 * 把 `portable/agent/APPEND_SYSTEM.md` 注册为 DSH 的提示段，返回 disposer。
 *
 * 语义选择：
 *   - `interpolate: false`：我们的文案里若出现 `{{...}}` 应原样保留（不被 harness 变量插值）；
 *   - 文件不存在 ⇒ **上报**（pi 侧缺该文件是允许的，但 DSH 侧要知道"没有注入任何东西"）；
 *   - 服务缺失 ⇒ **上报**（不静默当作已注入）。
 */
export function registerMyPiSystemPrompt(
  ctx: DshContext,
  options: RegisterSystemPromptOptions,
): DshDisposer {
  const report = options.report ?? defaultReporter;
  if (options.disabled) return () => undefined;

  const service = ctx.systemPrompt as DshSystemPromptService | undefined;
  if (!service || typeof service.section !== 'function') {
    report('systemPrompt', 'DSH 未加载提示词服务（@deepseek-ai/dsh-system-prompt）⇒ APPEND_SYSTEM.md 无法注入');
    return () => undefined;
  }

  const file = join(options.root, 'portable', 'agent', 'APPEND_SYSTEM.md');
  if (!existsSync(file)) {
    report('APPEND_SYSTEM.md', `文件不存在（${file}）⇒ 没有静态注入；若这是有意的，请显式记录`);
    return () => undefined;
  }

  const text = readFileSync(file, 'utf8');
  const order = resolveAppendOrder(service, report);
  const disposer = service.section({
    name: MY_PI_APPEND_SECTION,
    order,
    text,
    interpolate: false,
  });
  report('systemPrompt.section', `已注入 ${MY_PI_APPEND_SECTION}（order=${order}，${Buffer.byteLength(text)} B）`);
  return disposer;
}
