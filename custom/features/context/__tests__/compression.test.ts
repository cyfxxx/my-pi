import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jsonBytes,
  shrinkHalf,
  compactJson,
  snapshotBeforeCompact,
  pruneSnapshots,
  SNAPSHOT_MAX_FILES,
} from '../budget/compression';

let memDir: string;
const orig = process.env.PI_MEMORY_DIR;

beforeEach(() => {
  memDir = mkdtempSync(join(tmpdir(), 'my-pi-compress-'));
  process.env.PI_MEMORY_DIR = memDir;
});

afterEach(() => {
  if (orig === undefined) delete process.env.PI_MEMORY_DIR;
  else process.env.PI_MEMORY_DIR = orig;
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
  it('写入快照并裁剪到上限', () => {
    expect(snapshotBeforeCompact(null, 0, 0)).toBeNull();
    for (let i = 0; i < SNAPSHOT_MAX_FILES + 4; i++) {
      const f = snapshotBeforeCompact([{ role: 'user', content: `m${i}` }], 1000 + i, 800, 'threshold');
      expect(f).toBeTruthy();
    }
    const dir = join(memDir, 'checkpoints');
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir).filter((x) => x.startsWith('compact-'));
    expect(files.length).toBeLessThanOrEqual(SNAPSHOT_MAX_FILES);
    expect(pruneSnapshots()).toBe(0);
  });
});
