/**
 * cli.ts — 命令参数/补全的通用解析（纯逻辑，零 Pi 依赖）
 *
 * 收敛 8 个命令型 feature 重复的「取首个 token 作子命令」「按前缀过滤补全」。
 */

/** 拆分命令参数：返回小写子命令与其余 token（空输入返回空子命令与空数组） */
export function parseSubcommand(args: string | undefined): { sub: string; rest: string[] } {
  const parts = (args ?? '').trim().split(/\s+/).filter(Boolean);
  return { sub: (parts[0] ?? '').toLowerCase(), rest: parts.slice(1) };
}

/** 按 value 前缀过滤补全项（prefix 为空时返回全部） */
export function filterCompletions<T extends { value: string }>(items: T[], prefix: string | undefined): T[] {
  const p = (prefix ?? '').trim();
  return p ? items.filter((i) => i.value.startsWith(p)) : items;
}
