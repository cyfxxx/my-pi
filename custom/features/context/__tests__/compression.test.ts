import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jsonBytes,
  shrinkHalf,
  compactJson,
  snapshotBeforeCompact,
  pruneSnapshots,
  SNAPSHOT_MAX_FILES,
  SNAPSHOT_MAX_AGE_MS,
} from '../budget/compression';

let memDir: string;
const orig = process.env.PI_MEMORY_DIR;
const origSnapshotDir = process.env.PI_COMPACT_SNAPSHOT_DIR;

beforeEach(() => {
  memDir = mkdtempSync(join(tmpdir(), 'my-pi-compress-'));
  process.env.PI_MEMORY_DIR = memDir;
  delete process.env.PI_COMPACT_SNAPSHOT_DIR;
});

afterEach(() => {
  if (orig === undefined) delete process.env.PI_MEMORY_DIR;
  else process.env.PI_MEMORY_DIR = orig;
  if (origSnapshotDir === undefined) delete process.env.PI_COMPACT_SNAPSHOT_DIR;
  else process.env.PI_COMPACT_SNAPSHOT_DIR = origSnapshotDir;
  rmSync(memDir, { recursive: true, force: true });
});

describe('compression: JSON 结构性压缩', () => {
  it('shrinkHalf 对数组/对象各保一半', () => {
    expect(shrinkHalf([1, 2, 3, 4])).toEqual([1, 2]);
    expect(shrinkHalf({ a: 1, b: 2, c: 3, d: 4 })).toEqual({ a: 1, b: 2 });
    expect(shrinkHalf('x')).toBe('x');
  });

  it('compactJson 超预算时收缩，未超/非 JSON 返回 undefined', () => {
    const big = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ i, v: 'x'.repeat(20) })));
    const r = compactJson(big, 500);
    expect(r).toBeTruthy();
    expect(r!.omittedBytes).toBeGreaterThan(0);
    expect(Buffer.byteLength(r!.text, 'utf8')).toBeLessThan(big.length);

    expect(compactJson('{"a":1}', 1000)).toBeUndefined();
    expect(compactJson('not json', 1)).toBeUndefined();
  });

  it('jsonBytes 计算 UTF-8 字节', () => {
    expect(jsonBytes({ a: '中' })).toBe(Buffer.byteLength(JSON.stringify({ a: '中' }), 'utf8'));
  });
});

describe('compression: 压缩前快照与保留', () => {
  it('写入独立子目录 checkpoints/compact 并裁剪到上限', () => {
    expect(snapshotBeforeCompact(null, 0, 0)).toBeNull();
    for (let i = 0; i < SNAPSHOT_MAX_FILES + 4; i++) {
      const f = snapshotBeforeCompact([{ role: 'user', content: `m${i}` }], 1000 + i, 800, 'threshold');
      expect(f).toBeTruthy();
      expect(f!.startsWith(join(memDir, 'checkpoints', 'compact') + '/')).toBe(true);
    }
    const dir = join(memDir, 'checkpoints', 'compact');
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir).filter((x) => x.startsWith('compact-') && x.endsWith('.json'));
    expect(files.length).toBeLessThanOrEqual(SNAPSHOT_MAX_FILES);
    // 根目录不得混入快照（ctx_snap 用户检查点目录保持干净）
    const root = join(memDir, 'checkpoints');
    expect(readdirSync(root).filter((x) => x.endsWith('.json'))).toEqual([]);
    // 原子写不残留 tmp 文件
    expect(readdirSync(dir).filter((x) => x.includes('.tmp.'))).toEqual([]);
    expect(pruneSnapshots()).toBe(0);
  });

  it('同一毫秒内多次快照文件名不冲突（随机后缀）', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    let a: string | null;
    let b: string | null;
    try {
      a = snapshotBeforeCompact([{ role: 'user', content: 'a' }], 1, 1);
      b = snapshotBeforeCompact([{ role: 'user', content: 'b' }], 1, 1);
    } finally {
      spy.mockRestore();
    }
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    const dir = join(memDir, 'checkpoints', 'compact');
    expect(readdirSync(dir).filter((x) => x.endsWith('.json'))).toHaveLength(2);
  });

  it('向后兼容：旧版 checkpoints/compact-*.json 超龄仍被 prune 清理', () => {
    const root = join(memDir, 'checkpoints');
    mkdirSync(root, { recursive: true });
    const legacy = join(root, 'compact-old.json');
    writeFileSync(legacy, '{}');
    const old = (Date.now() - SNAPSHOT_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(legacy, old, old);
    expect(pruneSnapshots()).toBe(1);
    expect(existsSync(legacy)).toBe(false);
  });

  it('向后兼容：旧版快照计入总保留上限', () => {
    const root = join(memDir, 'checkpoints');
    mkdirSync(root, { recursive: true });
    for (let i = 0; i < SNAPSHOT_MAX_FILES; i++) {
      const p = join(root, `compact-legacy-${i}.json`);
      writeFileSync(p, '{}');
      const t = (Date.now() - 10 * 60_000 - i * 1000) / 1000;
      utimesSync(p, t, t);
    }
    expect(snapshotBeforeCompact([{ role: 'user', content: 'x' }], 1, 1)).toBeTruthy();
    const remainingLegacy = readdirSync(root).filter((f) => f.startsWith('compact-') && f.endsWith('.json'));
    // 新旧合并后总上限 SNAPSHOT_MAX_FILES：新目录 1 份 + 旧目录至多 7 份
    expect(remainingLegacy.length).toBeLessThanOrEqual(SNAPSHOT_MAX_FILES - 1);
  });
});
