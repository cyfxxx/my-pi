/**
 * 检查点工具（ctx_snap）
 *
 * 迁移自 pi-tools `pi-memory/tools/checkpoint-tools.ts`。保存/恢复便笺集合的命名快照，
 * 适合风险操作前或里程碑节点；`name='list'` 查看，`restore:<name>` 恢复。
 * 落盘目录由 store/storage.ts 的 checkpointsDir() 决定（PI_MEMORY_DIR/checkpoints）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerTool } from '../../../adapters/tool-adapter';

/** Pi API 类型经 adapters 推导：features 逻辑层不直接 import Pi 包 */
type PiApi = Parameters<typeof registerTool>[0];
import { loadNotes, saveNotes } from '../store/notes';
import { checkpointsDir } from '../store/storage';

export const MAX_CHECKPOINTS_LIST = 100;

export interface SnapData {
  timestamp: number;
  notes: Record<string, string>;
  compaction?: boolean;
}

export interface SnapResult {
  text: string;
  isError?: boolean;
}

/** 校验检查点名：仅字母数字与 `._-`，长度 ≤80，禁路径分隔符与 `..` */
export function sanitizeSnapName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

/** 列出全部检查点（按名倒序，最多 MAX_CHECKPOINTS_LIST 条） */
export function listCheckpoints(): string {
  const dir = checkpointsDir();
  if (!existsSync(dir)) return '(no checkpoints)';
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
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
    const data = JSON.parse(readFileSync(file, 'utf-8')) as SnapData;
    saveNotes(data.notes || {});
    const count = Object.keys(data.notes || {}).length;
    return {
      text: `Restored checkpoint "${snapName}" (${count} notes, from ${new Date(data.timestamp).toISOString()})`,
    };
  } catch (e) {
    return { text: `Failed to restore: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}

/** 保存当前便笺为新检查点 */
export function saveCheckpoint(rawName: string): SnapResult {
  const snapName = sanitizeSnapName(rawName);
  if (!snapName) {
    return { text: `非法检查点名称: "${rawName}"（仅允许字母/数字/._-，且不含路径分隔符）`, isError: true };
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
