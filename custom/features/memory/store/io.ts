/**
 * Memory Feature — 存储底层 I/O 助手（纯逻辑，零 Pi 依赖）
 *
 * 供 notes/summaries/storage 共享：数据目录解析、目录创建、损坏文件备份、JSON 读取。
 */

import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { getMemoryDir } from '../../../core/config';

export function dataDir(): string {
  return process.env.PI_MEMORY_DIR || getMemoryDir();
}

export function ensureDir(): void {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function backupCorruptFile(file: string, kind: string): void {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.corrupt-${stamp}`;
    renameSync(file, backup);
    console.error(`[memory] ${kind} 存储损坏（${file}）：已备份到 ${backup}，请人工检查恢复。`);
  } catch (e) {
    console.error(`[memory] ${kind} 存储损坏（${file}）且备份失败，原文件保持原位：`, e);
  }
}

export function readStoreFile<T>(file: string, kind: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch (err) {
    if (!existsSync(file)) return null;
    const isParseError = err instanceof SyntaxError;
    if (!isParseError) {
      console.error(`[memory] ${kind} 读取失败（非解析错误，不备份）:`, err instanceof Error ? err.message : err);
      return null;
    }
    backupCorruptFile(file, kind);
    return null;
  }
}
