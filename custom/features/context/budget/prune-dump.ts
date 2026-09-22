/**
 * 擦除溯源 refs（迁移自 pi-tools `pi-context/prune-dump.ts`）
 *
 * 借鉴 TencentDB-Agent-Memory 的 refs 卸载 + Reclaimer 清理：工具输出被分层擦除
 * 时，把原文落盘到 `portable/memory/logs/prune-refs/<sessionId>.md`，占位符带 ref
 * 路径，便于回溯。由 `sweepPruneRefs` 按天数/总量清理。
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';

export function pruneRefsDir(): string {
  return process.env.PI_PRUNE_REFS_DIR || join(getMemoryDir(), 'logs', 'prune-refs');
}

export const PRUNE_REFS_RETENTION_DAYS = 14;

type PruneDumpCtx = { sessionManager?: { getSessionId?: () => string | null | undefined } };

/** 构造擦除落盘回调：返回 ref 文件路径（null 表示跳过） */
export function buildPruneDumpRef(ctx: PruneDumpCtx | undefined) {
  if (process.env.PI_DISABLE_PRUNE_DUMP === '1') return undefined;
  let sessionId = 'adhoc';
  try {
    sessionId = String(ctx?.sessionManager?.getSessionId?.() || 'adhoc');
  } catch {
    /* 取不到会话身份时退化为共享文件 */
  }
  // 会话 ID 可能含路径分隔符，做最小净化
  const safeId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'adhoc';
  const dir = pruneRefsDir();
  const file = join(dir, `${safeId}.md`);
  let dirReady = false;
  let seq = 0;
  return (text: string, meta: { index: number; chars: number }): string | null => {
    if (text.includes('[pruned:')) return null;
    if (!dirReady) {
      mkdirSync(dir, { recursive: true });
      dirReady = true;
    }
    seq++;
    appendFileSync(
      file,
      `\n## 擦除条目 e${seq} · ${new Date().toISOString()} · 消息#${meta.index} · ${meta.chars} 字符\n\n${text}\n`,
      'utf8',
    );
    return file;
  };
}
