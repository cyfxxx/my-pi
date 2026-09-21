/**
 * atomic-write.ts — 原子文件写入（write-tmp + rename）
 *
 * 迁移自 pi-tools services/atomic-write.ts。纯逻辑，零 Pi 依赖。
 *
 * 临时文件名带 pid + 随机后缀：同一进程内并发写同一目标不会共用同一 tmp 路径。
 * 写失败时清理 tmp，避免残留。
 */

import { writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

function tmpPath(file: string): string {
  const suffix = randomBytes(6).toString('hex');
  return `${file}.tmp.${process.pid}.${suffix}`;
}

/** 同步原子文本写入（write-tmp + rename，写失败清理 tmp） */
export function writeTextSync(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = tmpPath(file);
  try {
    writeFileSync(tmp, text, 'utf-8');
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* tmp 可能未创建 */
    }
    throw err;
  }
}

/** 同步原子 JSON 写入（rename 保证原子性，防多实例互踩） */
export function writeJSONSync(file: string, data: unknown): void {
  writeTextSync(file, JSON.stringify(data, null, 2));
}

/** 异步原子 JSON 写入（rename 保证原子性） */
export async function writeJSONAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = tmpPath(file);
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
