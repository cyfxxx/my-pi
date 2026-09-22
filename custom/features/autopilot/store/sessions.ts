/**
 * 会话列表格式化（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `pi-autopilot/sessions.ts` 的展示部分；枚举由 adapters/session-adapter 提供。
 */

export interface SessionLike {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  createdMs: number;
  modifiedMs: number;
  messageCount: number;
  firstMessage: string;
}

/** 按修改时间倒序 */
export function sortByModified(rows: SessionLike[]): SessionLike[] {
  return [...rows].sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/** 格式化会话列表（默认最多 30 条） */
export function formatSessionList(rows: SessionLike[], limit = 30): string {
  if (rows.length === 0) return '(未找到会话)';
  const sorted = sortByModified(rows);
  const lines = [`会话列表 (${rows.length} 个，按修改时间倒序):`];
  for (const s of sorted.slice(0, limit)) {
    const sizeKB = s.messageCount > 0 ? `${s.messageCount} 条消息` : '空';
    const mtime = s.modifiedMs ? new Date(s.modifiedMs).toISOString().slice(0, 19) : '-';
    const name = s.name ? ` (${s.name})` : '';
    lines.push(`  ${s.id}${name}  [${sizeKB}] [${mtime}]`);
    if (s.firstMessage) lines.push(`    摘要: ${s.firstMessage.slice(0, 120)}`);
  }
  if (rows.length > limit) lines.push(`  ... 还有 ${rows.length - limit} 个未显示`);
  return lines.join('\n');
}
