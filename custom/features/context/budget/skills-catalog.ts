/**
 * 技能目录（skill catalog）——把它从 system prompt 移到**尾部 append-only 消息**
 *
 * 背景（2026-10-07，对齐 DSH 的做法）：pi 原生把 `<skills>` 段渲染进 system prompt，
 * 每技能是一段 XML（`<skill><name>…</name><description>…</description><location>…</location></skill>`），
 * 4 个技能实测约 2.5KB。两个后果：
 *   1. 它占着**前缀最前处**的体积，每次冷启动/断链都要全价重发；
 *   2. 技能文件一改（本仓库历史里改过 14 次）就作废**整段**前缀——而技能是 my-pi 自己维护的文档。
 *
 * DSH 的做法是：目录不进 system prompt，而是作为一条**消息**（`- name: description` 形式），
 * 内容变化时才追加一份完整替换。这里复刻同一纪律：
 *   · `buildSkillsCatalog` 产出紧凑目录（比 pi 的 XML 省约一半）；
 *   · `skillsCatalogKey` 给出稳定内容键，调用方据此做 **change-only** 追加（旧版本留历史里，
 *     模型按"以最新一块为准"理解——与 `workspace-instructions.ts` 同一取舍）。
 *
 * 注意：**路径必须给出**。DSH 有 `skill` 工具按名字加载，my-pi 没有，模型只能靠 `read` 打开文件，
 * 所以目录要么给每个技能的文件路径，要么在目录同源时给一条根路径规则（见下）。
 *
 * 纯逻辑（零 Pi 依赖）：只依赖 `node:path`，可在 vitest 中直接驱动。
 */

import { dirname } from 'node:path';

/** 结构兼容 pi 的 `Skill`（只取本模块用到的字段，避免反向依赖 vendor） */
export interface SkillLike {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation?: boolean;
}

/** 目录消息的 customType（供 UI 区分来源） */
export const SKILLS_CATALOG_TAG = 'my-pi-skills-catalog';

/** 把可能的多行描述压成一行（目录里每条只占一行） */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 构造技能目录文本；没有可暴露的技能时返回空串（调用方据此跳过注入）。
 *
 * `disableModelInvocation` 的技能与 pi 的行为保持一致：**不进目录**（只能靠 `/skill:<name>` 显式调用）。
 */
export function buildSkillsCatalog(skills: readonly SkillLike[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation && s.name && s.filePath);
  if (visible.length === 0) return '';

  const lines = [
    '## 可用技能（按需加载）',
    '任务与某个技能描述匹配时，先用 read 读取它的 SKILL.md，再按其中步骤执行；',
    '技能内部引用相对路径时，按该技能所在目录解析后使用绝对路径。',
    '',
  ];

  // 技能同源（都在同一个父目录下）时只给一条根路径规则，省掉每条的绝对路径——
  // 这是最常见的情况（my-pi 的技能都在 `agentDir/skills/` 下）。
  const roots = [...new Set(visible.map((s) => dirname(s.baseDir)))];
  const sharedRoot = roots.length === 1 ? roots[0] : null;
  if (sharedRoot) {
    lines.push(`技能文件统一位于：\`${sharedRoot}/<name>/SKILL.md\``, '');
  }

  for (const s of visible) {
    lines.push(`- \`${s.name}\`: ${oneLine(s.description)}`);
    if (!sharedRoot) lines.push(`  - 文件：\`${s.filePath}\``);
  }
  return lines.join('\n');
}

/**
 * 目录内容的稳定键（用于"只在变化时重新注入"）。
 *
 * 只取会影响模型判断的字段（name/description/是否可见）；**不含路径顺序之外的时间/序号**，
 * 保证同一输入必得同一键（否则会每轮重复注入，反而是新的前缀噪音）。
 */
export function skillsCatalogKey(skills: readonly SkillLike[]): string {
  return skills
    .filter((s) => !s.disableModelInvocation && s.name)
    .map((s) => `${s.name}\u0000${oneLine(s.description)}\u0000${s.baseDir}`)
    .join('\u0001');
}
