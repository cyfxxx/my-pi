import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDir, readJSONSync, readJSONOr, readJSONL, appendJSONL, appendJSONLRotating } from '../fs-json';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-fsjson-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fs-json: 读取', () => {
  it('readJSONSync 缺失/损坏返回 null', () => {
    expect(readJSONSync(join(dir, 'none.json'))).toBeNull();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(readJSONSync(bad)).toBeNull();
  });

  it('readJSONOr 回退默认值', () => {
    expect(readJSONOr(join(dir, 'x.json'), { a: 1 })).toEqual({ a: 1 });
    const f = join(dir, 'ok.json');
    writeFileSync(f, JSON.stringify({ a: 2 }));
    expect(readJSONOr(f, { a: 1 })).toEqual({ a: 2 });
  });

  it('readJSONL 跳过空行与坏行', () => {
    const f = join(dir, 'l.jsonl');
    writeFileSync(f, '{"n":1}\n\n{bad}\n{"n":2}\n');
    expect(readJSONL<{ n: number }>(f)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('readJSONL 支持类型过滤', () => {
    const f = join(dir, 'l.jsonl');
    writeFileSync(f, '{"type":"a","n":1}\n{"type":"b","n":2}\n');
    const onlyA = readJSONL<{ type: 'a'; n: number }>(f, (r): r is { type: 'a'; n: number } => {
      return typeof r === 'object' && r !== null && (r as { type?: unknown }).type === 'a';
    });
    expect(onlyA).toEqual([{ type: 'a', n: 1 }]);
  });

  it('readJSONL 文件缺失返回空数组', () => {
    expect(readJSONL(join(dir, 'none.jsonl'))).toEqual([]);
  });
});

describe('fs-json: 追加', () => {
  it('appendJSONL 自动建目录并追加一行', () => {
    const f = join(dir, 'nested', 'a.jsonl');
    appendJSONL(f, { n: 1 });
    appendJSONL(f, { n: 2 });
    expect(readFileSync(f, 'utf-8')).toBe('{"n":1}\n{"n":2}\n');
  });

  it('appendJSONLRotating 超阈值轮转', () => {
    const f = join(dir, 'r.jsonl');
    appendJSONL(f, { n: 1 });
    const size = statSync(f).size;
    appendJSONLRotating(f, { n: 2 }, size - 1, '.1');
    expect(existsSync(`${f}.1`)).toBe(true);
    expect(readJSONL<{ n: number }>(f)).toEqual([{ n: 2 }]);
  });

  it('ensureDir 幂等', () => {
    const d = join(dir, 'a', 'b');
    ensureDir(d);
    ensureDir(d);
    expect(existsSync(d)).toBe(true);
  });
});
