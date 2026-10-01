/**
 * system prompt 注入面的**唯一装配点**（缓存前缀纪律的硬约束）
 *
 * 背景（P4 升格通道第一批，2026-10-01）：AGENTS.md 里"system prompt 注入禁止时间戳/精确数值"
 * 一直是**软引导**——靠人自觉。实测这条纪律的价值极高（前缀一变，其后整段上下文按全价重算，
 * 单次 170K–316K token），但没有任何程序阻止下一次编辑往里塞一个日期或百分比。
 * 按 VISION §3.1/§3.2 硬化：
 *   1. 系统层注入只经本文件装配（`buildSystemPrompt`），index.ts 不再手写模板串；
 *   2. 注入文本有**字节预算**（软层条目不得无限增长，VISION §6 P4 判据）；
 *   3. 易变内容模式（日期/时钟/百分比/绝对路径/字节数/commit sha/版本号）由守门测试拒绝
 *      （`custom/features/context/__tests__/injection-stability.test.ts`）。
 *
 * 纪律：本文件是缓存前缀的一部分——改动即让所有会话的前缀失效一次（预期内，但要克制）。
 * 只写常量，不写时间戳/路径/版本号。
 */

import { HARD_RULES, EFFICIENCY_ADVICE } from './hard-rules';

// 注入文本常量住在 `hard-rules.ts`（注入面基线对象），这里只装配与守门；对外重导出保持导入路径。
export { EFFICIENCY_ADVICE, LOW_PRESSURE_DELEGATION, FULL_DELEGATION_ADVICE } from './hard-rules';

/**
 * system 层注入预算上限（字节）。
 *
 * 含义是"预算"而不是"现状"：当前占用约 0.7KB。软层条目增长到这里就必须走 VISION §3.1
 * 的升格通道（要么硬化、要么降权删除），不得直接抬高上限。
 */
export const SYSTEM_INJECTION_MAX_BYTES = 4096;
/** `portable/agent/APPEND_SYSTEM.md`（pi 原生注入 system prompt）的字节上限 */
export const SYSTEM_APPEND_MAX_BYTES = 2048;

/** 禁止出现在 system 前缀注入里的易变内容模式（每条都对应一次实测过的前缀失效） */
export const VOLATILE_PATTERNS: ReadonlyArray<{ readonly name: string; readonly re: RegExp }> = [
  { name: 'ISO 日期', re: /\d{4}-\d{2}-\d{2}/ },
  { name: '斜杠日期', re: /\d{4}\/\d{1,2}\/\d{1,2}/ },
  { name: '时钟时间', re: /\b\d{1,2}:\d{2}(:\d{2})?\b/ },
  { name: '百分比数值', re: /\d+(\.\d+)?\s*%/ },
  { name: '绝对路径', re: /(^|\s)\/(root|home|Users|tmp|var|opt)\//m },
  { name: '字节/容量数值', re: /\b\d+(\.\d+)?\s*(bytes|kb|mb|gb)\b/i },
  // 纯十六进制字母单词（如 "defaced"）也会命中，故要求至少含一位数字
  { name: 'commit sha', re: /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/ },
  { name: '语义化版本号', re: /\bv?\d+\.\d+\.\d+\b/ },
];

/** 系统层真正追加的部分（`APPEND_SYSTEM.md` 由 pi 注入，不在此处） */
export function appendedSystemParts(): readonly string[] {
  return [HARD_RULES, EFFICIENCY_ADVICE];
}

/**
 * 装配 system prompt。
 *
 * 契约：**base 原样保留在最前**（pi 自己的 system prompt 是最稳的一段前缀），
 * 追加内容全部在尾部且逐字节确定（同输入必同输出）。
 */
export function buildSystemPrompt(base: string): string {
  return `${base}\n\n${appendedSystemParts().join('\n\n')}`;
}

/** 在给定文本里找出所有易变内容命中（返回 `模式名: 片段`，空数组表示干净） */
export function findVolatileInjection(text: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of VOLATILE_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(`${name}: ${m[0].trim()}`);
  }
  return hits;
}

export interface InjectionAudit {
  /** system 追加段实际字节 */
  appendedBytes: number;
  warnings: string[];
}

/**
 * 运行期注入面体检（生产路径也跑，不只靠守门测试）。
 *
 * 动机：测试守门只在 CI/提交时跑，而"改一行注入文本"往往发生在会话中——那时不会有人跑 golden。
 * 这里在扩展注册时做一次廉价审计，超预算或出现易变内容就在启动输出里显式告警。
 */
export function auditSystemInjection(opts: { appendSystemText?: string } = {}): InjectionAudit {
  const parts = appendedSystemParts();
  const appendedBytes = Buffer.byteLength(parts.join('\n\n'), 'utf-8');
  const warnings: string[] = [];
  if (appendedBytes > SYSTEM_INJECTION_MAX_BYTES) {
    warnings.push(
      `system 追加段 ${appendedBytes}B 超预算 ${SYSTEM_INJECTION_MAX_BYTES}B（VISION §3.1：先降权删除或硬化，不得直接抬高上限）`,
    );
  }
  for (const part of parts) {
    for (const hit of findVolatileInjection(part)) warnings.push(`system 追加段含易变内容 ${hit}`);
  }
  if (opts.appendSystemText != null) {
    const bytes = Buffer.byteLength(opts.appendSystemText, 'utf-8');
    if (bytes > SYSTEM_APPEND_MAX_BYTES) {
      warnings.push(`APPEND_SYSTEM.md ${bytes}B 超预算 ${SYSTEM_APPEND_MAX_BYTES}B`);
    }
    for (const hit of findVolatileInjection(opts.appendSystemText)) {
      warnings.push(`APPEND_SYSTEM.md 含易变内容 ${hit}`);
    }
  }
  return { appendedBytes, warnings };
}
