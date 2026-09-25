/**
 * 工具输出归档 — 截断/擦除时原文落盘，占位符附路径可读回。
 *
 * 借鉴 OpenViking tool_output_externalization（synopsis stub + ref）：截断不再丢信息，
 * 模型凭占位符中的路径用 read 取回原文（读回是新消息，不碰历史前缀 → 缓存友好）。
 *
 * 确定性保证：文件名 = sha256(原文) 前 16 hex + 字符长度 → 同内容同路径，
 * 占位符字节级稳定（缓存友好）；重复归档 existsSync 跳过写。
 * fail-open：任何写盘异常静默返回 null，调用方退化为无路径占位符。
 *
 * 默认目录：portable/memory/tool-outputs（数据收敛）。
 * 测试注入：PI_OUTPUT_ARCHIVE_DIR 覆盖默认目录。
 *
 * 纯 Node 逻辑，零 Pi 依赖。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';
import { writeTextSync } from '../../../core/atomic-write';
import { scrubSecrets } from '../../../core/secrets';

/** 归档保留期与总量上限（归档是"读回原文"的凭据，保留窗口比 prune-refs 宽） */
export const ARCHIVE_RETENTION_DAYS = 14;
export const ARCHIVE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/** 归档根目录（每次调用时读 env，便于测试注入） */
export function archiveDir(): string {
  return process.env.PI_OUTPUT_ARCHIVE_DIR || join(getMemoryDir(), 'tool-outputs');
}

/**
 * 归档原文，返回可读回的绝对路径；空文本或写盘失败返回 null。
 * 写盘前脱敏（工具输出常含 token/env dump），并用原子写避免半截文件占用最终路径。
 */
export function archiveOutput(text: string): string | null {
  try {
    if (!text) return null;
    const safe = scrubSecrets(text);
    const hash = createHash('sha256').update(safe).digest('hex').slice(0, 16);
    const dir = join(archiveDir(), hash.slice(0, 2));
    const file = join(dir, `${hash}-${safe.length}.txt`);
    if (!existsSync(file)) writeTextSync(file, safe);
    return file;
  } catch {
    return null;
  }
}

/** 归档并在基础说明后附加存档路径（归档失败时仅返回基础说明） */
export function archivedStub(text: string, base: string): string {
  const path = archiveOutput(text);
  return path ? `${base} 原文 ${text.length} 字符已存档: ${path}` : base;
}

export interface SweepArchiveOptions {
  retentionDays?: number;
  maxTotalBytes?: number;
}

export interface SweepArchiveStats {
  scanned: number;
  deletedByAge: number;
  deletedBySize: number;
  freedBytes: number;
}

/**
 * 清理归档目录：先按保留期删除过期文件，再在总量超限时从最旧删起。
 * 归档按内容哈希分两层子目录（`<hh>/<hash>-<len>.txt`），故需递归一层。
 * 任何单文件失败都忽略（fail-open），不影响会话启动。
 */
export async function sweepArchive(opts: SweepArchiveOptions = {}): Promise<SweepArchiveStats> {
  const retentionDays = opts.retentionDays ?? ARCHIVE_RETENTION_DAYS;
  const maxTotalBytes = opts.maxTotalBytes ?? ARCHIVE_MAX_TOTAL_BYTES;
  const stats: SweepArchiveStats = { scanned: 0, deletedByAge: 0, deletedBySize: 0, freedBytes: 0 };
  const root = archiveDir();
  const files: { path: string; mtime: number; size: number }[] = [];

  const collect = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      // 以 stat 为权威：dirent 的 d_type 在 overlayfs/沙箱下不可靠（实测把普通文件报成 DT_LNK），
      // 依赖 e.isFile() 会让这些归档文件永远不被清理。
      const st = await stat(p).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) {
        await collect(p);
        continue;
      }
      if (!st.isFile()) continue;
      files.push({ path: p, mtime: st.mtimeMs, size: st.size });
    }
  };
  await collect(root);

  stats.scanned = files.length;
  if (retentionDays >= 0) {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    for (const f of files) {
      if (f.mtime >= cutoff) continue;
      try {
        await unlink(f.path);
        stats.deletedByAge++;
        stats.freedBytes += f.size;
        f.size = 0;
      } catch {
        /* 单文件失败忽略 */
      }
    }
  }
  let remaining = files.reduce((s, f) => s + f.size, 0);
  if (remaining > maxTotalBytes) {
    for (const f of [...files].sort((a, b) => a.mtime - b.mtime)) {
      if (remaining <= maxTotalBytes) break;
      if (f.size === 0) continue;
      try {
        await unlink(f.path);
        stats.deletedBySize++;
        stats.freedBytes += f.size;
        remaining -= f.size;
        f.size = 0;
      } catch {
        /* 单文件失败忽略 */
      }
    }
  }
  return stats;
}
