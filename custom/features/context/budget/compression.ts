/**
 * 压缩模块 — 压缩前快照与 JSON 结构性压缩（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-context/compression.ts`，快照落点改为
 * `portable/memory/checkpoints/`（与 memory 功能一致），并加保留策略。
 */

import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';

export const SNAPSHOT_MAX_FILES = 8;
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// JSON 压缩配置
export const MAX_JSON_PARSE_BYTES = 2 * 1024 * 1024;
export const JSON_MIN_ITEMS = 2;
export const MARK_BUDGET = 64;

export function snapshotDir(): string {
  return process.env.PI_COMPACT_SNAPSHOT_DIR || join(getMemoryDir(), 'checkpoints');
}

/** 计算 JSON 对象的字节大小 */
export function jsonBytes(data: unknown): number {
  const s = JSON.stringify(data);
  return s === undefined ? 0 : Buffer.byteLength(s, 'utf8');
}

/** 二分收缩一层：数组保前一半元素；对象保前一半键 */
export function shrinkHalf(data: unknown): unknown {
  if (Array.isArray(data)) {
    if (data.length <= JSON_MIN_ITEMS) return data;
    return data.slice(0, Math.ceil(data.length / 2));
  }
  if (data && typeof data === 'object') {
    const keys = Object.keys(data as Record<string, unknown>);
    if (keys.length <= JSON_MIN_ITEMS) return data;
    const half = Math.ceil(keys.length / 2);
    const out: Record<string, unknown> = {};
    for (const k of keys.slice(0, half)) out[k] = (data as Record<string, unknown>)[k];
    return out;
  }
  return data;
}

/** JSON 结构性压缩：合法 JSON 且超限时二分收缩到预算内 */
export function compactJson(text: string, cap: number): { text: string; omittedBytes: number } | undefined {
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_PARSE_BYTES) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (jsonBytes(data) <= cap) return undefined;
  const budget = Math.max(1, cap - MARK_BUDGET);
  let current = data;
  for (let i = 0; i < 32; i++) {
    const shrunk = shrinkHalf(current);
    if (shrunk === current) break;
    current = shrunk;
    if (jsonBytes(current) <= budget) break;
  }
  const outBytes = jsonBytes(current);
  if (outBytes > budget) return undefined;
  const omittedBytes = Buffer.byteLength(text, 'utf8') - outBytes;
  if (omittedBytes <= 0) return undefined;
  return {
    text: `${JSON.stringify(current)}\n\n[...truncated ${omittedBytes} bytes]`,
    omittedBytes,
  };
}

/** 清理过期/超量的快照，返回删除数量 */
export function pruneSnapshots(dir = snapshotDir()): number {
  try {
    if (!existsSync(dir)) return 0;
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('compact-') && f.endsWith('.json'))
      .map((f) => ({ f, p: join(dir, f), m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    const cutoff = Date.now() - SNAPSHOT_MAX_AGE_MS;
    let removed = 0;
    for (let i = 0; i < files.length; i++) {
      if (i >= SNAPSHOT_MAX_FILES || files[i].m < cutoff) {
        try {
          unlinkSync(files[i].p);
          removed++;
        } catch {
          /* 忽略 */
        }
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

/** 压缩前保存快照（失败不阻塞压缩） */
export function snapshotBeforeCompact(
  lastContextMessages: unknown[] | null,
  contextTokens: number,
  threshold: number,
  reason: 'overflow' | 'threshold' = 'threshold',
): string | null {
  try {
    if (!lastContextMessages || lastContextMessages.length === 0) return null;
    const dir = snapshotDir();
    mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const file = join(dir, `compact-${ts}.json`);
    const payload = {
      ts,
      contextTokens,
      threshold,
      reason,
      messageCount: lastContextMessages.length,
      messages: lastContextMessages,
    };
    writeFileSync(file, JSON.stringify(payload), 'utf-8');
    pruneSnapshots(dir);
    return file;
  } catch {
    return null;
  }
}
