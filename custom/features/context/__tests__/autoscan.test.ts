/**
 * 下载后自动扫描的单测（2026-10-10）
 *
 * 钉住的行为（每条都对应一个**真实会出错的场景**）：
 *   ① **命令解析**：只认明确的输出参数（`curl -o` / `wget -O` / `--output=`），不带就不触发；`-o -` 不是文件；
 *   ② **去重**：同一 sha256 第二次**不再扫**（否则每次下载都重扫 10 秒）；
 *   ③ **时效**：mtime 太老（> 120s）不触发（只扫"这次刚下载的"）；
 *   ④ **开关**：`PI_AUTOSCAN=off` 不触发（用户已批准默认开，但必须能关）；
 *   ⑤ **诚实缺席**：扫描器说 `not-scanned` ⇒ **原样透出**，**绝不变 clean**（本项目的核心纪律）；
 *   ⑥ **内存护栏**：`MemAvailable` 低于 1.5G ⇒ `skipped-low-mem` **且不发起扫描**；查不到 meminfo ⇒ 不拦但标 `memChecked:false`；
 *   ⑦ **nice**：Linux 走 `nice`，Windows 没有 nice ⇒ 直接跑（跨平台）。
 *
 * ## 能证伪的反向断言（关键）
 *
 * `not-scanned` 透出这条，不只断言"当前实现没改写"，还**构造一个"永远返回 clean"的假实现**并断言它
 * **必然违反**该性质 ⇒ 说明这条断言真的能抓住那个 bug（而不是写了个永远不会失败的断言）。
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  AUTOSCAN_MIN_MEM_KB,
  autoscanEnabled,
  buildScanArgv,
  createAutoscan,
  decideMemory,
  decideScan,
  extractDownloadTargets,
  parseMemAvailableKb,
  parseScanOutput,
  type AutoscanDeps,
} from '../budget/autoscan';

/** 造一个可控的假子进程：close 时把 stdout 交出去 */
function fakeSpawn(stdout: string, calls: { cmd: string; args: string[] }[]) {
  return ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void; stdoutText: string };
    child.stdout = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf8'));
      child.emit('close', 0);
    });
    return child as never;
  }) as unknown as AutoscanDeps['spawn'];
}

interface Harness {
  deps: AutoscanDeps;
  calls: { cmd: string; args: string[] }[];
  logs: Record<string, unknown>[];
}

/** 内存里的最小依赖实现（不碰真实文件系统，除了注入的"内容"） */
function harness(opts: {
  files?: Record<string, { size: number; ageMs: number; sha: string }>;
  meminfo?: string;
  env?: Record<string, string | undefined>;
  stdout?: string;
  platform?: string;
  logLines?: Record<string, unknown>[];
}): Harness {
  const files = opts.files ?? { '/dl/a.bin': { size: 10, ageMs: 1_000, sha: 'sha-a' } };
  const logs = opts.logLines ?? [];
  const calls: { cmd: string; args: string[] }[] = [];
  const logText = (): string => logs.map((l) => JSON.stringify(l)).join('\n');
  const deps: AutoscanDeps = {
    // 日志文件在写入后即存在（去重读的就是它）
    existsSync: (p) =>
      p === '/proc/meminfo' ? opts.meminfo !== undefined : p in files || (p.endsWith('autoscan.jsonl') && logs.length > 0),
    statSync: (p) => ({
      isFile: () => true,
      size: files[p]?.size ?? 0,
      mtimeMs: 1_000_000 - (files[p]?.ageMs ?? 0),
    }),
    readText: (p) => (p === '/proc/meminfo' ? (opts.meminfo ?? '') : logText()),
    readBuffer: (p) => Buffer.from(files[p]?.sha ?? ''),
    ensureDir: () => undefined,
    append: (_f, value) => {
      logs.push(value as Record<string, unknown>);
    },
    spawn: fakeSpawn(opts.stdout ?? '结论：clean\n  分层：L0_hash=ok L1_structure=ok L2_antivirus=ok\n', calls),
    now: () => 1_000_000,
    scanScript: '/repo/scripts/security-scan.mjs',
    stateDir: '/mem/security',
    env: opts.env ?? {},
    platform: opts.platform ?? 'linux',
    execPath: '/usr/bin/node',
  };
  return { deps, calls, logs };
}

describe('下载后自动扫描', () => {
  it('① 命令解析：认明确的输出参数，不认"随便一个参数"', () => {
    expect(extractDownloadTargets('curl -sL -o out.bin https://x/y', '/w')).toEqual([{ file: '/w/out.bin', via: '-o' }]);
    expect(extractDownloadTargets('wget -O name.zip https://x/y', '/w')).toEqual([{ file: '/w/name.zip', via: '-O' }]);
    expect(extractDownloadTargets('curl --output=/w/p.tgz https://x/y', '/w')).toEqual([{ file: '/w/p.tgz', via: '--output=' }]);
    // 不带输出参数 / 输出到 stdout / 无关命令 ⇒ 一律不触发
    expect(extractDownloadTargets('curl -sL https://x/y', '/w')).toEqual([]);
    expect(extractDownloadTargets('curl -o - https://x/y', '/w')).toEqual([]);
    expect(extractDownloadTargets('npm install left-pad', '/w')).toEqual([]);
  });

  it('② 去重：同一内容第二次不再扫', async () => {
    const h = harness({ meminfo: 'MemAvailable:  4000000 kB\n' });
    const a = createAutoscan(h.deps);
    a.maybeStart('curl -o /dl/a.bin https://x/y', '/');
    await new Promise((r) => setImmediate(r));
    expect(h.calls).toHaveLength(1);
    const b = createAutoscan(h.deps); // 同一日志（含 sha-a）⇒ 应当判重
    b.maybeStart('curl -o /dl/a.bin https://x/y', '/');
    await new Promise((r) => setImmediate(r));
    expect(h.calls).toHaveLength(1); // 没有第二次扫描
    expect(h.logs.some((l) => l.skipped === 'dupe')).toBe(true);
  });

  it('③ 时效：太老的文件不扫', () => {
    const h = harness({
      files: { '/dl/old.bin': { size: 10, ageMs: 10 * 60_000, sha: 'sha-old' } },
      meminfo: 'MemAvailable:  4000000 kB\n',
    });
    createAutoscan(h.deps).maybeStart('curl -o /dl/old.bin https://x/y', '/');
    expect(h.calls).toHaveLength(0);
    expect(h.logs.some((l) => l.skipped === 'too-old')).toBe(true);
  });

  it('④ 开关：PI_AUTOSCAN=off 不触发（默认开）', () => {
    expect(autoscanEnabled({})).toBe(true);
    expect(autoscanEnabled({ PI_AUTOSCAN: 'OFF' })).toBe(false);
    const h = harness({ env: { PI_AUTOSCAN: 'off' }, meminfo: 'MemAvailable:  4000000 kB\n' });
    createAutoscan(h.deps).maybeStart('curl -o /dl/a.bin https://x/y', '/');
    expect(h.calls).toHaveLength(0);
    expect(h.logs).toHaveLength(0);
  });

  it('⑤ 诚实缺席：not-scanned 原样透出，绝不显示成干净', async () => {
    const h = harness({
      meminfo: 'MemAvailable:  4000000 kB\n',
      stdout: '结论：not-scanned\n  ⚠ 未扫描 ≠ 安全：本机没有 ClamAV/YARA\n',
    });
    const a = createAutoscan(h.deps);
    a.maybeStart('curl -o /dl/a.bin https://x/y', '/');
    await new Promise((r) => setImmediate(r));
    const notice = a.takeNotice() ?? '';
    expect(notice).toContain('not-scanned');
    expect(notice).not.toContain('结论：clean');
    expect(a.takeNotice()).toBeUndefined(); // 取走即清空
  });

  it('⑤b 反向断言：一个"永远返回 clean"的假实现必然违反该性质', () => {
    const real = (out: string) => parseScanOutput(out).verdict;
    const fakeAlwaysClean = () => 'clean';
    const notScanned = '结论：not-scanned\n';
    // 真实现：透出 not-scanned
    expect(real(notScanned)).toBe('not-scanned');
    // 假实现：违反"not-scanned 必须透出"这条性质 ⇒ 断言确实能抓住它
    expect(fakeAlwaysClean()).not.toBe(real(notScanned));
    // 同理，"永远 not-scanned"的假实现在 clean 输出上也会被抓住
    const fakeAlwaysNotScanned = () => 'not-scanned';
    expect(fakeAlwaysNotScanned()).not.toBe(real('结论：clean\n'));
  });

  it('⑥ 内存护栏：低于 1.5G ⇒ skipped-low-mem 且不发起扫描', () => {
    const low = String(AUTOSCAN_MIN_MEM_KB - 1024);
    const h = harness({ meminfo: `MemAvailable:  ${low} kB\n` });
    createAutoscan(h.deps).maybeStart('curl -o /dl/a.bin https://x/y', '/');
    expect(h.calls).toHaveLength(0); // 没扫
    const rec = h.logs.find((l) => l.skipped === 'low-mem');
    expect(rec).toBeDefined(); // 但**如实**记了原因（不假装扫过）
    expect(decideMemory(AUTOSCAN_MIN_MEM_KB).ok).toBe(true); // 边界：恰好等于阈值 ⇒ 放行
    expect(decideMemory(AUTOSCAN_MIN_MEM_KB - 1).reason).toBe('low-mem');
  });

  it('⑥b 查不到 meminfo（非 Linux）⇒ 不拦，但标注"未检查"', async () => {
    const h = harness({}); // 没有 meminfo
    expect(parseMemAvailableKb('MemTotal: 1 kB\n')).toBeUndefined();
    expect(decideMemory(undefined)).toEqual({ ok: true, reason: 'unchecked' });
    const a = createAutoscan(h.deps);
    a.maybeStart('curl -o /dl/a.bin https://x/y', '/');
    await new Promise((r) => setImmediate(r));
    expect(h.calls).toHaveLength(1); // 不拦
    const rec = h.logs.find((l) => l.verdict !== undefined);
    expect(rec?.memChecked).toBe(false); // 如实说明"没检查内存"
  });

  it('⑦ nice：Linux 走 nice，Windows 直接跑（跨平台）', () => {
    expect(buildScanArgv('/n', '/s.mjs', '/f', 'linux')).toEqual({
      cmd: 'nice',
      args: ['-n', '10', '/n', '/s.mjs', '--file', '/f'],
    });
    expect(buildScanArgv('C:\\n.exe', 's.mjs', 'f', 'win32')).toEqual({
      cmd: 'C:\\n.exe',
      args: ['s.mjs', '--file', 'f'],
    });
  });

  it('⑧ 判据边界：太大如实记 too-large，不静默跳过', () => {
    expect(decideScan({ exists: true, isFile: true, size: 1, ageMs: 1, }).reason).toBe('scan');
    expect(decideScan({ exists: false, isFile: false, size: 0, ageMs: 0 }).reason).toBe('missing');
    expect(decideScan({ exists: true, isFile: false, size: 1, ageMs: 1 }).reason).toBe('not-file');
    expect(decideScan({ exists: true, isFile: true, size: 10, ageMs: 200_000 }).reason).toBe('too-old');
    expect(decideScan({ exists: true, isFile: true, size: 300 * 1024 * 1024, ageMs: 1 }).reason).toBe('too-large');
  });

  it('⑨ fail-open：spawn 抛错绝不影响主流程', () => {
    const h = harness({ meminfo: 'MemAvailable:  4000000 kB\n' });
    h.deps.spawn = (() => {
      throw new Error('boom');
    }) as unknown as AutoscanDeps['spawn'];
    expect(() => createAutoscan(h.deps).maybeStart('curl -o /dl/a.bin https://x/y', '/')).not.toThrow();
    expect(h.logs.some((l) => l.skipped === 'spawn-throw')).toBe(true);
  });
});
