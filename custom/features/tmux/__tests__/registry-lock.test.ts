/**
 * tmux 注册表跨进程并发回归（M8）：
 *   - 写入口持跨进程文件锁完成 RMW；
 *   - 陈旧锁（进程崩溃残留）可被抢占，不死锁；
 *   - 锁忙超时告警降级，绝不无限等待；
 *   - 多进程并发注册不丢更新（真实子进程 + Node TS 直载）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, registerSession, registryLockPath } from '../logic';
import type { RegistryEntry } from '../logic';

const LOADER_SRC = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.')) {
      for (const candidate of [specifier + '.ts', specifier + '/index.ts']) {
        try {
          return await next(candidate, context);
        } catch {
          /* 尝试下一个候选 */
        }
      }
    }
    throw err;
  }
}
`;

const CHILD_SRC = `
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
const { registerSession } = await import(process.env.TEST_REGISTRY_URL);
const id = process.env.TEST_WORKER_ID;
const writes = Number(process.env.TEST_WRITES);
for (let i = 0; i < writes; i++) {
  registerSession({
    name: 'pi-' + id + '-' + i,
    logPath: '/tmp/' + id + '.log',
    command: 'echo',
    createdAt: '2026-01-01T00:00:00.000Z',
    owner: id,
  });
}
`;

function entry(name: string): RegistryEntry {
  return { name, logPath: `/tmp/${name}.log`, command: 'echo', createdAt: 'now', owner: 'test' };
}

function runChild(script: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', script], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.once('close', (code) => resolve({ code, stderr }));
    child.once('error', (e) => resolve({ code: -1, stderr: String(e) }));
  });
}

describe('tmux registry 跨进程锁', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'my-pi-tmux-lock-'));
    process.env.PI_MEMORY_DIR = dir;
    delete process.env.PI_TMUX_REGISTRY;
    delete process.env.PI_TMUX_LOCK_TIMEOUT_MS;
    delete process.env.PI_TMUX_LOCK_STALE_MS;
  });
  afterEach(() => {
    delete process.env.PI_MEMORY_DIR;
    delete process.env.PI_TMUX_REGISTRY;
    delete process.env.PI_TMUX_LOCK_TIMEOUT_MS;
    delete process.env.PI_TMUX_LOCK_STALE_MS;
    rmSync(dir, { recursive: true, force: true });
  });

  it('锁路径与注册表同目录，正常写入后锁被释放', () => {
    expect(registryLockPath()).toBe(join(dir, 'tmux-registry.json.lock'));
    registerSession(entry('pi-a'));
    expect(loadRegistry().sessions['pi-a']?.owner).toBe('test');
    expect(existsSync(registryLockPath())).toBe(false);
  });

  it('陈旧锁（崩溃残留 / 超龄）被抢占并清理，不永久死锁', () => {
    writeFileSync(registryLockPath(), JSON.stringify({ pid: process.pid, ts: Date.now() - 60_000 }));
    registerSession(entry('pi-b'));
    expect(loadRegistry().sessions['pi-b']).toBeTruthy();
    expect(existsSync(registryLockPath())).toBe(false);
  });

  it('锁被存活进程持有：超时告警后降级写入，不无限等待', () => {
    process.env.PI_TMUX_LOCK_TIMEOUT_MS = '30';
    writeFileSync(registryLockPath(), JSON.stringify({ pid: process.pid, ts: Date.now() }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const start = Date.now();
      registerSession(entry('pi-c'));
      expect(Date.now() - start).toBeLessThan(2000);
      expect(spy.mock.calls.some((c) => String(c[0]).includes('[file-lock]'))).toBe(true);
      expect(loadRegistry().sessions['pi-c']).toBeTruthy();
      expect(existsSync(registryLockPath())).toBe(true); // 持有者的锁不被误删
    } finally {
      spy.mockRestore();
      rmSync(registryLockPath(), { force: true });
    }
  });

  it('多进程并发注册不丢更新（真实子进程）', async () => {
    const loader = join(dir, 'loader.mjs');
    const script = join(dir, 'writer.mjs');
    writeFileSync(loader, LOADER_SRC);
    writeFileSync(script, CHILD_SRC);
    const registryUrl = new URL('../registry.ts', import.meta.url).href;
    const workers = 4;
    const writes = 15;

    const results = await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        runChild(script, {
          ...process.env,
          PI_MEMORY_DIR: dir,
          TEST_REGISTRY_URL: registryUrl,
          TEST_WORKER_ID: String(i),
          TEST_WRITES: String(writes),
        }),
      ),
    );
    for (const r of results) {
      expect(r.code, r.stderr).toBe(0);
    }
    const names = Object.keys(loadRegistry().sessions);
    expect(names).toHaveLength(workers * writes);
    for (let i = 0; i < workers; i++) {
      for (let j = 0; j < writes; j++) {
        expect(names).toContain(`pi-${i}-${j}`);
      }
    }
    expect(existsSync(registryLockPath())).toBe(false);
  }, 60_000);
});
