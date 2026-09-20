/**
 * atomic-write.ts — 原子文件写入（write-tmp + rename）
 *
 * 迁移自 pi-tools services/atomic-write.ts。纯逻辑，零 Pi 依赖。
 */

import { writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** 同步原子 JSON 写入（rename 保证原子性，防多实例互踩） */
export function writeJSONSync(file: string, data: unknown): void {
  const tmp = `${file}.tmp.${process.pid}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, file);
}

/** 异步原子 JSON 写入（rename 保证原子性） */
export async function writeJSONAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  try {
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
