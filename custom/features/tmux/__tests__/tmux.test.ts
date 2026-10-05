/**
 * tmux 纯逻辑回归测试（迁移自 pi-tools pi-tmux 的 core 纯函数语义）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeSessionName,
  isPiSession,
  classifySessionProbe,
  rotateLogIfLarge,
  logPathFor,
  loadRegistry,
  clampWaitTimeout,
  registerSession,
  readOutput,
  unregisterSession,
  shutdownCleanup,
  ensureLogDir,
  SESSION_PREFIX,
} from '../logic';
import type { TmuxOpts, SessionInfo, Registry } from '../logic';

describe('normalizeSessionName / isPiSession', () => {
  it('自动补前缀并剥离已有前缀', () => {
    expect(normalizeSessionName('build')).toBe('pi-build');
    expect(normalizeSessionName('pi-build')).toBe('pi-build');
  });

  it('空名/非法字符/超长 → 抛错', () => {
    expect(() => normalizeSessionName('')).toThrow();
    expect(() => normalizeSessionName('../evil')).toThrow();
    expect(() => normalizeSessionName('a'.repeat(41))).toThrow();
  });

  it('isPiSession 前缀判定', () => {
    expect(isPiSession('pi-x', SESSION_PREFIX)).toBe(true);
    expect(isPiSession('user', SESSION_PREFIX)).toBe(false);
  });
});

describe('classifySessionProbe: 三态探测', () => {
  it('exit0 → alive；access not allowed → gone', () => {
    expect(classifySessionProbe({ code: 0, stdout: '', stderr: '' })).toBe('alive');
    expect(classifySessionProbe({ code: 0, stdout: '', stderr: 'access not allowed' })).toBe('gone');
  });

  it('exit1 + can\'t find session → gone', () => {
    expect(classifySessionProbe({ code: 1, stdout: '', stderr: "can't find session: pi-x" })).toBe('gone');
  });

  it('二进制缺失/超时/其他 → unknown', () => {
    expect(classifySessionProbe({ code: 127, stdout: '', stderr: 'command not found' })).toBe('unknown');
    expect(classifySessionProbe({ code: 124, stdout: '', stderr: 'timeout' })).toBe('unknown');
    expect(classifySessionProbe({ code: 1, stdout: '', stderr: 'other' })).toBe('unknown');
  });
});

describe('log + registry 文件语义', () => {
  let dir: string;
  let opts: TmuxOpts;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'my-pi-tmux-'));
    process.env.PI_MEMORY_DIR = dir;
    opts = { bin: 'tmux', prefix: SESSION_PREFIX, logDir: join(dir, 'tmux') };
  });
  afterEach(() => {
    delete process.env.PI_MEMORY_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('rotateLogIfLarge：超限轮转为 .old', () => {
    const logPath = logPathFor(opts, 'pi-a');
    ensureLogDir(opts);
    writeFileSync(logPath, 'y'.repeat(100));
    expect(rotateLogIfLarge(opts, 'pi-a', 50)).toBe(true);
    expect(existsSync(logPath)).toBe(false);
    expect(existsSync(logPath + '.old')).toBe(true);
    expect(rotateLogIfLarge(opts, 'pi-a', 50)).toBe(false);
  });

  it('注册表 register/unregister 落盘', () => {
    registerSession({ name: 'pi-a', logPath: '/tmp/a.log', command: 'echo', createdAt: 'now', owner: 's1' });
    expect(loadRegistry().sessions['pi-a']?.owner).toBe('s1');
    unregisterSession('pi-a');
    expect(loadRegistry().sessions['pi-a']).toBeUndefined();
  });

  it('shutdownCleanup：仅杀 owner 匹配或无主的 pi- 会话', async () => {
    const reg: Registry = {
      sessions: {
        'pi-a': { name: 'pi-a', logPath: '', command: '', createdAt: '', owner: 's1' },
        'pi-b': { name: 'pi-b', logPath: '', command: '', createdAt: '', owner: 's2' },
        'user-x': { name: 'user-x', logPath: '', command: '', createdAt: '' },
      },
    };
    const sessions: SessionInfo[] = [
      { name: 'pi-a', attached: false },
      { name: 'pi-b', attached: false },
      { name: 'user-x', attached: false },
    ];
    const killed: string[] = [];
    const res = await shutdownCleanup(opts, reg, sessions, SESSION_PREFIX, 's1', async (_o, n) => {
      killed.push(n);
    });
    expect(killed).toEqual(['pi-a']);
    expect(res.killed).toEqual(['pi-a']);
    expect(res.skippedOthers).toEqual(['pi-b']);
  });
});

// ── P4 升格通道第一批：同轮内等待的硬上限（原软引导"确需等待 timeout≤60s"）──

describe('clampWaitTimeout', () => {
  it('未给 timeout → 默认值，且受上限截断', () => {
    expect(clampWaitTimeout(undefined, 120, 60)).toEqual({
      seconds: 60,
      clamped: true,
      ceiling: 60,
      requested: 120,
    });
  });

  it('显式正数原样尊重（不超过上限时）', () => {
    expect(clampWaitTimeout(5, 120, 60)).toEqual({ seconds: 5, clamped: false, ceiling: 60, requested: 5 });
    expect(clampWaitTimeout(60, 120, 60).clamped).toBe(false);
  });

  it('超过上限 → 截断并标记 clamped', () => {
    const r = clampWaitTimeout(600, 120, 60);
    expect(r.seconds).toBe(60);
    expect(r.clamped).toBe(true);
  });

  it('非法/非正数回落到默认值', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = clampWaitTimeout(bad, 30, 60);
      expect(r.requested).toBe(30);
      expect(r.seconds).toBe(30);
      expect(r.clamped).toBe(false);
    }
  });

  it('上限 ≤0 表示停用上限', () => {
    expect(clampWaitTimeout(600, 120, 0)).toEqual({ seconds: 600, clamped: false, ceiling: 0, requested: 600 });
    expect(clampWaitTimeout(undefined, 120, -1).seconds).toBe(120);
  });
});

describe('readOutput 截断判定（长日志不得只报一句"已截断"）', () => {
  let logDir: string;
  const opts = (): TmuxOpts => ({ bin: 'tmux', logDir, prefix: SESSION_PREFIX });

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'my-pi-tmux-read-'));
  });
  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  it('日志超过 lines 行 → 报省略行数，不误报字符截断', async () => {
    const all = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    writeFileSync(join(logDir, 'pi-x.log'), all.join('\n'));
    const out = await readOutput(opts(), 'pi-x', 100);
    expect(out.source).toBe('log');
    expect(out.omittedLines).toBe(150);
    expect(out.cutByChars).toBe(false);
    expect(out.truncated).toBe(true);
    expect(out.text.split('\n')[0]).toBe('line 150');
  });

  it('单行超字符上限 → 只报字符截断，省略行数为 0', async () => {
    writeFileSync(join(logDir, 'pi-y.log'), 'x'.repeat(20_000));
    const out = await readOutput(opts(), 'pi-y', 100, 12_000);
    expect(out.omittedLines).toBe(0);
    expect(out.cutByChars).toBe(true);
    expect(out.text.length).toBe(12_000);
    expect(out.truncated).toBe(true);
  });

  it('日志短于 lines 且未超字符上限 → 不报截断', async () => {
    writeFileSync(join(logDir, 'pi-z.log'), 'a\nb\nc');
    const out = await readOutput(opts(), 'pi-z', 100, 12_000);
    expect(out.truncated).toBe(false);
    expect(out.omittedLines).toBe(0);
    expect(out.cutByChars).toBe(false);
    expect(out.text).toBe('a\nb\nc');
  });
});
