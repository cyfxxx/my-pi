/**
 * 便笺工具（ctx_note / ctx_list）
 *
 * 迁移自 pi-tools `pi-memory/tools/notes-tools.ts`。便笺跨对话压缩存活，
 * 用于记录文件编辑/任务状态/用户决定/错误等状态；TTL 由 key 的 `@ttl=<ISO>` 后缀表达，
 * 过期过滤在 store/notes.ts 的 loadNotes（读路径惰性清理，不落盘）。
 */

import { registerTool } from '../../../adapters/tool-adapter';

/** Pi API 类型经 adapters 推导：features 逻辑层不直接 import Pi 包 */
type PiApi = Parameters<typeof registerTool>[0];
import { loadNotes, updateNotes } from '../store/notes';

/** 便笺总量告警阈值（字节） */
export const MAX_NOTES_SIZE = 2 * 1024 * 1024;

/** 便笺占用字节数（排除内部键 `__*` 与 `_ctx.*`） */
export function getNotesSize(notes: Record<string, string>): number {
  return Object.entries(notes)
    .filter(([k]) => !k.startsWith('__') && !k.startsWith('_ctx.'))
    .reduce((sum, [, v]) => sum + Buffer.byteLength(v, 'utf-8'), 0);
}

/** 解析 `key@ttl=<ISO>` 形式；无 TTL 时 ttl 为 undefined */
export function parseNoteKey(rawKey: string): { key: string; ttl?: string } {
  const m = rawKey.match(/^(.*)@ttl=(.+)$/);
  if (!m) return { key: rawKey };
  return { key: m[1], ttl: m[2] };
}

/** 列出便笺（排除内部键），可选前缀过滤 */
export function listNoteKeys(notes: Record<string, string>, prefix?: string): string[] {
  const keys = Object.keys(notes).filter((k) => !k.startsWith('__'));
  return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
}

function kb(len: number): string {
  return (len / 1024).toFixed(1);
}

/**
 * 写入/删除/读取一条便笺。`value` 省略=读取，`'null'`/null=删除。
 * 返回面向模型的文本（与工具返回值一致，便于测试）。
 */
export function applyNoteOp(rawKey: string, value?: string | null): string {
  const { key, ttl } = parseNoteKey(rawKey);

  if (value === undefined) {
    const notes = loadNotes();
    return notes[key] !== undefined ? notes[key] : `(no note for "${key}")`;
  }

  if (value === null || value === 'null') {
    let had = false;
    updateNotes((notes) => {
      had = key in notes;
      delete notes[key];
      delete notes[`__ttl_${key}`];
    });
    return had ? `Deleted note "${key}"` : `(no note "${key}" to delete)`;
  }

  const total = updateNotes((notes) => {
    notes[key] = value;
    const ttlKey = `__ttl_${key}`;
    if (ttl) notes[ttlKey] = ttl;
    else delete notes[ttlKey];
    return getNotesSize(notes);
  });

  let msg = `Saved note "${key}" (${kb(value.length)} KB)`;
  if (total > MAX_NOTES_SIZE) {
    msg += `\nWarning: total notes size ${(total / (1024 * 1024)).toFixed(1)} MB exceeds 2 MB — consider cleaning up with /memory cleanup`;
  }
  if (ttl) msg += `\nExpires: ${ttl}`;
  return msg;
}

/** 渲染便笺列表（`detail=true` 时附带值摘要） */
export function formatNoteList(notes: Record<string, string>, prefix?: string, detail = false): string {
  const keys = listNoteKeys(notes, prefix);
  if (keys.length === 0) return '(no notes)';
  const lines = keys.map((k) => {
    const v = notes[k];
    const ttl = notes[`__ttl_${k}`];
    const ttlStr = ttl ? ` [expires: ${ttl}]` : '';
    if (!detail) return `  ${k}  (${v ? kb(v.length) : '0'} KB)${ttlStr}`;
    const shown = v && v.length > 200 ? `${v.slice(0, 200)}...` : (v ?? '');
    return `  ${k}  (${v ? kb(v.length) : '0'} KB)${ttlStr}\n    ${shown.replace(/\n/g, '\n    ')}`;
  });
  const totalMB = (getNotesSize(notes) / (1024 * 1024)).toFixed(2);
  return `Notes (${keys.length}):\n${lines.join('\n')}\nTotal: ${totalMB} MB`;
}

export function registerNotesTools(pi: PiApi): void {
  registerTool(pi, {
    name: 'ctx_note',
    description:
      '存储跨对话压缩存活的便笺（记录文件编辑/任务状态/用户决定/错误等状态）。value 为 null 时删除；key 追加 @ttl=<ISO 时间戳> 自动过期。',
    parameters: {
      key: {
        type: 'string',
        description: "便笺键（点号命名空间，如 'task.current'）。追加 '@ttl=ISO_TIMESTAMP' 自动过期。",
      },
      value: { type: 'string', description: '存储值。省略=读取；null=删除。', optional: true },
    },
    execute: async (params) => {
      const key = params.key as string | undefined;
      if (!key) return 'Error: key is required';
      const raw = params.value;
      const value = raw === undefined ? undefined : (raw as string | null);
      return applyNoteOp(key, value);
    },
  });

  registerTool(pi, {
    name: 'ctx_list',
    description: '列出已存便笺键及其大小。detail:true 显示值。',
    parameters: {
      prefix: { type: 'string', description: "Filter by key prefix (e.g. 'task')", optional: true },
      detail: { type: 'boolean', description: 'Show full values (default false)', optional: true },
    },
    execute: async (params) => {
      return formatNoteList(loadNotes(), params.prefix as string | undefined, params.detail === true);
    },
  });
}
