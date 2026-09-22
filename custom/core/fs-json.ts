/**
 * fs-json.ts — 文件 JSON/JSONL 读写基元（纯逻辑，零 Pi 依赖）
 *
 * 收敛各 feature 反复实现的「容错读取 / 追加 / 轮转追加」。语义保持显式：
 *   - 读取失败一律不抛，返回 null / [] / fallback，由调用方决定策略
 *   - 追加不吞错，抛给调用方（度量类调用方自行 fail-open）
 *   - 轮转阈值由调用方传入，不设默认（各 feature 保留各自保留策略）
 *
 * 需要「读到后合并再原子写」的读改写临界区不在此处，仍由各 feature 的锁 + core/atomic-write 组合。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** 确保目录存在（递归） */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** 读取整份 JSON；文件缺失或解析失败返回 null（不抛） */
export function readJSONSync<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** 读取整份 JSON，失败返回 fallback */
export function readJSONOr<T>(file: string, fallback: T): T {
  const value = readJSONSync<T>(file);
  return value === null ? fallback : value;
}

/** 容错读取 JSONL：逐行解析、空行与坏行跳过；可选类型过滤 */
export function readJSONL<T = unknown>(file: string, filter?: (record: unknown) => record is T): T[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!filter || filter(parsed)) out.push(parsed as T);
    } catch {
      /* 跳过损坏行 */
    }
  }
  return out;
}

/** 追加一行 JSON（自动建目录）；写失败抛出 */
export function appendJSONL(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(value) + '\n', 'utf8');
}

/**
 * 追加一行 JSON，超过 maxBytes 时先把旧文件轮转为 `<file><suffix>` 再追加。
 * 轮转/stat 失败不阻断追加；追加本身失败仍抛出。
 */
export function appendJSONLRotating(file: string, value: unknown, maxBytes: number, suffix = '.old'): void {
  try {
    if (existsSync(file) && statSync(file).size > maxBytes) {
      renameSync(file, `${file}${suffix}`);
    }
  } catch {
    /* 轮转失败：继续追加 */
  }
  appendJSONL(file, value);
}
