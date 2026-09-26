/**
 * 检查点工具（ctx_snap）
 *
 * 迁移自 pi-tools `pi-memory/tools/checkpoint-tools.ts`。保存/恢复便笺集合的命名快照，
 * 适合风险操作前或里程碑节点；`name='list'` 查看，`restore:<name>` 恢复。
 * 落盘目录由 store/storage.ts 的 checkpointsDir() 决定（PI_MEMORY_DIR/checkpoints）。
 *
 * 目录隔离：context 的压缩快照位于 `checkpoints/compact/` 子目录；旧版散落在根目录的
 * `compact-*.json` 也一律不作为用户检查点列出/恢复（保留前缀 compact- 禁止用户命名），
 * 避免 restore 把不含 notes 的压缩快照当成检查点从而清空便笺。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerTool } from '../../../adapters/tool-adapter';

/** Pi API 类型经 adapters 推导：features 逻辑层不直接 import Pi 包 */
type PiApi = Parameters<typeof registerTool>[0];
import { loadNotes, saveNotes } from '../store/notes';
import { checkpointsDir } from '../store/storage';

export const MAX_CHECKPOINTS_LIST = 100;

/** 系统保留前缀：压缩快照（compact-*）与用户检查点共用目录时的防混淆标记 */
export const RESERVED_SNAP_PREFIX = 'compact-';

/** 是否系统保留名（压缩快照） */
export function isReservedSnapName(name: string): boolean {
  return name.toLowerCase().startsWith(RESERVED_SNAP_PREFIX);
}

export interface SnapData {
  timestamp: number;
  notes: Record<string, string>;
  compaction?: boolean;
}

export interface SnapResult {
  text: string;
  isError?: boolean;
}

/** 校验检查点名：仅字母数字与 `._-`，长度 ≤80，禁路径分隔符、`..` 与保留前缀 compact- */
export function sanitizeSnapName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return null;
  if (isReservedSnapName(trimmed)) return null;
  return trimmed;
}

/** 列出全部检查点（按名倒序，最多 MAX_CHECKPOINTS_LIST 条；压缩快照 compact-* 不列出） */
export function listCheckpoints(): string {
  const dir = checkpointsDir();
  if (!existsSync(dir)) return '(no checkpoints)';
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !isReservedSnapName(f))
    .sort()
    .reverse()
    .slice(0, MAX_CHECKPOINTS_LIST);
  if (files.length === 0) return '(no checkpoints)';
  const lines = files.map((f) => {
    const snapName = f.replace(/\.json$/, '');
    try {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as SnapData;
      const isAuto = data.compaction ? ' [auto]' : '';
      const time = new Date(data.timestamp).toISOString();
      const noteCount = Object.keys(data.notes || {}).length;
      const size = statSync(join(dir, f)).size;
      return `  ${snapName}${isAuto}  (${noteCount} notes, ${(size / 1024).toFixed(1)} KB, ${time})`;
    } catch {
      return `  ${snapName}  (corrupted)`;
    }
  });
  return `Checkpoints (${files.length}):\n${lines.join('\n')}`;
}

/** 从检查点恢复便笺集合 */
export function restoreCheckpoint(rawName: string): SnapResult {
  const snapName = sanitizeSnapName(rawName);
  if (!snapName) return { text: `非法检查点名称: "${rawName}"`, isError: true };
  const file = join(checkpointsDir(), `${snapName}.json`);
  if (!existsSync(file)) return { text: `No checkpoint "${snapName}" found`, isError: true };
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8')) as Partial<SnapData>;
    // 必须含 notes 对象：否则（损坏文件/误入目录的压缩快照）恢复会全量清空便笺
    if (!data || typeof data.notes !== 'object' || data.notes === null || Array.isArray(data.notes)) {
      return { text: `检查点 "${snapName}" 不是有效快照（缺少 notes）`, isError: true };
    }
    saveNotes(data.notes as Record<string, string>);
    const count = Object.keys(data.notes).length;
    return {
      text: `Restored checkpoint "${snapName}" (${count} notes, from ${new Date(data.timestamp ?? 0).toISOString()})`,
    };
  } catch (e) {
    return { text: `Failed to restore: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}

/** 保存当前便笺为新检查点（compact- 为压缩快照保留前缀，禁止用作检查点名） */
export function saveCheckpoint(rawName: string): SnapResult {
  const snapName = sanitizeSnapName(rawName);
  if (!snapName) {
    return {
      text: `非法检查点名称: "${rawName}"（仅允许字母/数字/._-，不含路径分隔符，且不得以保留前缀 compact- 开头）`,
      isError: true,
    };
  }
  try {
    mkdirSync(checkpointsDir(), { recursive: true });
  } catch (e) {
    return { text: `无法创建检查点目录: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
  const notes = loadNotes();
  const snap: SnapData = { timestamp: Date.now(), notes };
  writeFileSync(join(checkpointsDir(), `${snapName}.json`), JSON.stringify(snap, null, 2));
  const count = Object.keys(notes).length;
  return { text: `Saved checkpoint "${snapName}" (${count} notes, ${new Date(snap.timestamp).toISOString()})` };
}

/** 单一入口：`list` / `restore:<name>` / `<name>` 保存 */
export function applySnapOp(name: string): SnapResult {
  if (name === 'list') return { text: listCheckpoints() };
  if (name.startsWith('restore:')) return restoreCheckpoint(name.slice(8));
  return saveCheckpoint(name);
}

export function registerCheckpointTools(pi: PiApi): void {
  registerTool(pi, {
    name: 'ctx_snap',
    description:
      '保存当前便笺的命名检查点（含时间戳）。用 restore:<name> 恢复；list 查看全部。适合风险操作前或里程碑节点。',
    parameters: {
      name: {
        type: 'string',
        description: "检查点名（如 'before-refactor'）；'restore:<name>' 恢复；'list' 列出全部",
      },
    },
    execute: async (params) => {
      const name = params.name as string | undefined;
      if (!name) return 'Error: name is required';
      const res = applySnapOp(name);
      return res.isError ? `Error: ${res.text}` : res.text;
    },
  });
}
