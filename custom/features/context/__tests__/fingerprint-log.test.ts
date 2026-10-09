/**
 * 错误指纹落盘的单测（缺陷 1 修复，2026-10-08）
 *
 * 三条必须被钉住的性质：
 *   ① **字段与隐私边界**：记录只含机器标识，字段集合**恰好**是约定的 8 个（多一个都说明有东西漏进去了）；
 *   ② **append-only**：写入走的是同一个追加通道，顺序保持；
 *   ③ **fail-open**：`ensureDir` / `append` 任一抛错，**都不许把异常抛出去**（落盘是纯诊断）。
 *
 * 判定行为不变由既有测试证明（`error-fingerprint.test.ts` / `tool-health.test.ts` 未改动、全绿）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { appendJSONLRotating, ensureDir } from '../../../core/fs-json';
import {
  appendErrorFingerprintRecord,
  buildErrorFingerprintRecord,
  ERROR_FINGERPRINT_LOG_MAX_BYTES,
  type ErrorFingerprintRecord,
  type FingerprintLogIO,
} from '../budget/fingerprint-log';

const OBS = { key: 'fp-abc123', excerpt: 'TypeError: x is not a function', attempts: 3, distinctArgs: 2, remind: true };
const TS = '2026-10-08T00:00:00.000Z';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('buildErrorFingerprintRecord', () => {
  it('字段齐全且值正确', () => {
    const rec = buildErrorFingerprintRecord(OBS, 'bash', 900_000, TS);
    expect(rec).toEqual({
      ts: TS,
      fingerprint: 'fp-abc123',
      tool: 'bash',
      attempts: 3,
      distinctArgs: 2,
      windowMs: 900_000,
      remind: true,
      excerpt: 'TypeError: x is not a function',
    });
  });

  it('隐私边界：字段集合**恰好**是约定的 8 个（任何额外字段都说明有东西漏进去了）', () => {
    const rec = buildErrorFingerprintRecord(OBS, 'edit', 900_000, TS);
    expect(Object.keys(rec).sort()).toEqual([
      'attempts',
      'distinctArgs',
      'excerpt',
      'fingerprint',
      'remind',
      'tool',
      'ts',
      'windowMs',
    ]);
  });

  it('是纯函数：同样输入给同样输出，且不改动入参', () => {
    const before = JSON.stringify(OBS);
    expect(buildErrorFingerprintRecord(OBS, 'bash', 1, TS)).toEqual(buildErrorFingerprintRecord(OBS, 'bash', 1, TS));
    expect(JSON.stringify(OBS)).toBe(before);
  });
});

describe('appendErrorFingerprintRecord', () => {
  it('append-only：两次调用 → 两次追加，且带上同一个轮转上限', () => {
    const calls: Array<{ file: string; obj: unknown; max: number }> = [];
    const io: FingerprintLogIO = { ensureDir: () => {}, append: (file, obj, max) => calls.push({ file, obj, max }) };
    const rec = buildErrorFingerprintRecord(OBS, 'bash', 900_000, TS);
    expect(appendErrorFingerprintRecord('/x/error-fingerprints.jsonl', rec, io, dirname)).toBe(true);
    expect(appendErrorFingerprintRecord('/x/error-fingerprints.jsonl', rec, io, dirname)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ file: '/x/error-fingerprints.jsonl', obj: rec, max: ERROR_FINGERPRINT_LOG_MAX_BYTES });
  });

  it('fail-open：append 抛错 → 返回 false、**不抛异常**', () => {
    const io: FingerprintLogIO = {
      ensureDir: () => {},
      append: () => {
        throw new Error('EACCES');
      },
    };
    const rec = buildErrorFingerprintRecord(OBS, 'bash', 900_000, TS);
    expect(() => appendErrorFingerprintRecord('/x/f.jsonl', rec, io, dirname)).not.toThrow();
    expect(appendErrorFingerprintRecord('/x/f.jsonl', rec, io, dirname)).toBe(false);
  });

  it('fail-open：ensureDir 抛错 → 同样被吞掉', () => {
    const io: FingerprintLogIO = {
      ensureDir: () => {
        throw new Error('ENOSPC');
      },
      append: () => {},
    };
    const rec = buildErrorFingerprintRecord(OBS, 'bash', 900_000, TS);
    expect(appendErrorFingerprintRecord('/x/f.jsonl', rec, io, dirname)).toBe(false);
  });

  it('真实 IO 冒烟：目录会被创建，文件里是一行合法 JSON 且字段可读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-fplog-'));
    dirs.push(dir);
    const file = join(dir, 'logs', 'error-fingerprints.jsonl');
    const rec = buildErrorFingerprintRecord(OBS, 'grep', 900_000, TS);
    expect(appendErrorFingerprintRecord(file, rec, { ensureDir, append: appendJSONLRotating }, dirname)).toBe(true);
    appendErrorFingerprintRecord(file, { ...rec, attempts: 5 }, { ensureDir, append: appendJSONLRotating }, dirname);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2); // append-only：两次两行
    const first = JSON.parse(lines[0]) as ErrorFingerprintRecord;
    expect(first.fingerprint).toBe('fp-abc123');
    expect(first.tool).toBe('grep');
    expect((JSON.parse(lines[1]) as ErrorFingerprintRecord).attempts).toBe(5);
  });
});

describe('接线守门（tsc 看不见"可选接线漏掉"——本仓库先例）', () => {
  const SRC = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

  it('记录点真的调用了落盘函数，且**只在开关打开时**调用（默认写的惯例：opt-out）', () => {
    expect(SRC).toContain("process.env.PI_ERROR_FINGERPRINT !== 'off'");
    expect(SRC).toContain('appendErrorFingerprintRecord(');
    expect(SRC).toContain('buildErrorFingerprintRecord(o, name, REPAIR_WINDOW_MS, new Date().toISOString())');
    // 目录约定与既有日志一致（logs/ 下），并带 env 覆盖位
    expect(SRC).toContain("PI_ERROR_FINGERPRINT_FILE || join(getMemoryDir(), 'logs', 'error-fingerprints.jsonl')");
  });

  it('落盘在**判定之后**、且不参与判定（先 observe，再记录，最后才按 remind 提醒）', () => {
    const iObs = SRC.indexOf('observeRepairAttempt(repairBudget, {');
    const iLog = SRC.indexOf('appendErrorFingerprintRecord(');
    const iRemind = SRC.indexOf('if (o.remind) out += repairBudgetHint(o);');
    expect(iObs).toBeGreaterThan(-1);
    expect(iLog).toBeGreaterThan(iObs);
    expect(iRemind).toBeGreaterThan(iLog);
  });

  it('轮转上限与既有前缀指纹日志一致（1MB），避免两处常量漂移', () => {
    expect(ERROR_FINGERPRINT_LOG_MAX_BYTES).toBe(1_000_000);
    expect(SRC).toContain("appendJSONLRotating(fingerprintFile, fp, 1_000_000)");
  });
});
