/**
 * text.ts — 通用文本/数值格式化（纯逻辑，零 Pi 依赖）
 *
 * 只收敛「字节级一致」的重复实现；带单位/精度/标记差异的格式化保留在各自 feature，
 * 避免悄悄改变用户可见输出（如 KB/MB 精度、截断省略号、百分比小数位）。
 */

/** 本地日 YYYY-MM-DD（按本机时区，用于按天聚合） */
export function localDay(d: Date | string | number): string {
  const date = typeof d === 'object' ? d : new Date(d);
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 10);
}

/** 按字符截断并追加省略号（长度不足时原样返回） */
export function truncateChars(s: string, max: number, ellipsis = '…'): string {
  return s.length <= max ? s : `${s.slice(0, max)}${ellipsis}`;
}

/** 把任意值压成单行文本（对象走 JSON.stringify），失败返回空串 */
export function oneLine(value: unknown): string {
  try {
    const s = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    return s.replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** token 数量紧凑显示（1.5k / 2.0M）；阈值与被替换实现保持一致 */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}
