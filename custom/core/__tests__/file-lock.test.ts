/**
 * core/file-lock 回归测试：互斥、释放、陈旧判定、超时降级与跨 isolate 并发 RMW。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withFileLock,
  tryAcquireFileLock,
  isFileLockStale,
  FILE_LOCK_DEFAULT_STALE_MS,
} from '../file-lock';

const WORKER_SRC = `
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
const { withFileLock } = await import(workerData.lockModuleUrl);
for (let i = 0; i < workerData.iterations; i++) {
  withFileLock(
    workerData.lockPath,
    () => {
      let n = 0;
      try { n = Number(readFileSync(workerData.file, 'utf-8')); } catch { /* 首次写入 */ }
      writeFileSync(workerData.file, String(Number.isFinite(n) ? n + 1 : 1));
    },
    { timeoutMs: 10000, pollMs: 2 },
  );
}
parentPort.postMessage('done');
`;

function runCounterWorker(
  workerPath: string,
  data: { file: string; lockPath: string; lockModuleUrl: string; iterations: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: data, execArgv: ['--experimental-strip-types'] });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker exit code ${code}`));
    });
  });
}

describe('file-lock', () => {
  let dir: string;
  const lockPath = (): string => join(dir, 'x.lock');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'my-pi-filelock-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('tryAcquireFileLock：独占创建、互斥与幂等释放', () => {
    const release = tryAcquireFileLock(lockPath());
    expect(release).toBeTruthy();
    expect(existsSync(lockPath())).toBe(true);
    expect(tryAcquireFileLock(lockPath())).toBeNull();
    release!();
    expect(existsSync(lockPath())).toBe(false);
    const release2 = tryAcquireFileLock(lockPath());
    expect(release2).toBeTruthy();
    release2!();
    release!(); // 重复释放不抛错
    expect(existsSync(lockPath())).toBe(false);
  });

  it('withFileLock：正常执行后释放，异常路径同样释放', () => {
    expect(withFileLock(lockPath(), () => 1)).toBe(1);
    expect(existsSync(lockPath())).toBe(false);
    expect(() =>
      withFileLock(lockPath(), () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(existsSync(lockPath())).toBe(false);
  });

  it('陈旧判定：超龄时间戳 / 已退出 pid / 损坏元数据+旧 mtime 均可抢占', () => {
    // 超龄（同一存活 pid 但持锁过久）
    writeFileSync(
      lockPath(),
      JSON.stringify({ pid: process.pid, ts: Date.now() - FILE_LOCK_DEFAULT_STALE_MS - 1000 }),
    );
    expect(isFileLockStale(lockPath(), FILE_LOCK_DEFAULT_STALE_MS)).toBe(true);
    expect(withFileLock(lockPath(), () => 'ok')).toBe('ok');
    expect(existsSync(lockPath())).toBe(false);

    // 已退出 pid（不可能存在的 pid）
    writeFileSync(lockPath(), JSON.stringify({ pid: 2147483647, ts: Date.now() }));
    expect(isFileLockStale(lockPath())).toBe(true);

    // 损坏元数据 → 退化为 mtime
    writeFileSync(lockPath(), 'not-json');
    const old = (Date.now() - FILE_LOCK_DEFAULT_STALE_MS - 1000) / 1000;
    utimesSync(lockPath(), old, old);
    expect(isFileLockStale(lockPath())).toBe(true);
  });

  it('持有者存活且时间戳新鲜：不抢占，超时告警后降级执行', () => {
    const release = tryAcquireFileLock(lockPath())!;
    const onTimeout = vi.fn();
    const start = Date.now();
    const result = withFileLock(lockPath(), () => 'fallback', { timeoutMs: 30, pollMs: 5, onTimeout });
    expect(result).toBe('fallback');
    expect(Date.now() - start).toBeLessThan(2000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0][0].lockPath).toBe(lockPath());
    release();
    expect(existsSync(lockPath())).toBe(false);
  });

  it('跨 isolate（worker 线程）并发 RMW 不丢更新', async () => {
    const file = join(dir, 'counter.txt');
    writeFileSync(file, '0');
    const workerPath = join(dir, 'counter-worker.mjs');
    writeFileSync(workerPath, WORKER_SRC);
    const lockModuleUrl = new URL('../file-lock.ts', import.meta.url).href;
    await Promise.all(
      [0, 1].map(() =>
        runCounterWorker(workerPath, {
          file,
          lockPath: `${file}.lock`,
          lockModuleUrl,
          iterations: 50,
        }),
      ),
    );
    expect(readFileSync(file, 'utf-8')).toBe('100');
    expect(existsSync(`${file}.lock`)).toBe(false);
  }, 30_000);
});
