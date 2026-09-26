/**
 * 压缩模块 — 压缩前快照与 JSON 结构性压缩（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-context/compression.ts`。
 *
 * 落点：`portable/memory/checkpoints/compact/`（与 memory 的 ctx_snap 用户检查点
 * 分离）；旧版写在 `checkpoints/` 根下的 `compact-*.json` 仍会被 pruneSnapshots
 * 识别清理（向后兼容），但不再作为用户检查点列出/恢复。
 */

import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';
import { writeTextSync } from '../../../core/atomic-write';

export const SNAPSHOT_MAX_FILES = 8;
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// JSON 压缩配置
export const MAX_JSON_PARSE_BYTES = 2 * 1024 * 1024;
export const JSON_MIN_ITEMS = 2;
export const MARK_BUDGET = 64;

/** 旧版快照目录（`checkpoints/` 根）：曾与 ctx_snap 用户检查点混放，仅用于向后兼容清理 */
export function legacySnapshotDir(): string {
  return join(getMemoryDir(), 'checkpoints');
}

/** 压缩快照目录：`checkpoints/compact/`；PI_COMPACT_SNAPSHOT_DIR 可整体覆盖 */
export function snapshotDir(): string {
  return process.env.PI_COMPACT_SNAPSHOT_DIR || join(legacySnapshotDir(), 'compact');
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

/** 收集目录内 `compact-*.json` 快照（含 mtime，供保留策略排序） */
function listSnapshotFiles(dir: string): { path: string; mtimeMs: number }[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith('compact-') && f.endsWith('.json'))
      .flatMap((f) => {
        const p = join(dir, f);
        try {
          return [{ path: p, mtimeMs: statSync(p).mtimeMs }];
        } catch {
          return []; // 已被并发删除
        }
      });
  } catch {
    return [];
  }
}

/**
 * 清理过期/超量的压缩快照，返回删除数量。
 * 默认同时扫描新目录与旧版根目录（旧文件仍被识别），合并后按 mtime 保留最新
 * SNAPSHOT_MAX_FILES 份；显式传入 dir 时只扫描该目录（测试/自定义落点）。
 */
export function pruneSnapshots(dir?: string): number {
  const dirs =
    dir !== undefined
      ? [dir]
      : process.env.PI_COMPACT_SNAPSHOT_DIR
        ? [snapshotDir()]
        : [snapshotDir(), legacySnapshotDir()];
  const files = dirs.flatMap(listSnapshotFiles).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cutoff = Date.now() - SNAPSHOT_MAX_AGE_MS;
  let removed = 0;
  for (let i = 0; i < files.length; i++) {
    if (i >= SNAPSHOT_MAX_FILES || files[i].mtimeMs < cutoff) {
      try {
        unlinkSync(files[i].path);
        removed++;
      } catch {
        /* 忽略 */
      }
    }
  }
  return removed;
}

/** 压缩前保存快照（失败不阻塞压缩）。reason 区分触发来源：自动阈值 / 溢出 / 手动 /compact。 */
export function snapshotBeforeCompact(
  lastContextMessages: unknown[] | null,
  contextTokens: number,
  threshold: number,
  reason: 'overflow' | 'threshold' | 'manual' = 'threshold',
): string | null {
  try {
    if (!lastContextMessages || lastContextMessages.length === 0) return null;
    const dir = snapshotDir();
    mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    // 同一毫秒内多次压缩（自动+手动）会产生同名文件互相覆盖 → 附加随机后缀
    const file = join(dir, `compact-${ts}-${randomBytes(3).toString('hex')}.json`);
    const payload = {
      ts,
      contextTokens,
      threshold,
      reason,
      messageCount: lastContextMessages.length,
      messages: lastContextMessages,
    };
    writeTextSync(file, JSON.stringify(payload));
    pruneSnapshots();
    return file;
  } catch {
    return null;
  }
}
