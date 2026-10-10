/**
 * 下载后自动扫描（2026-10-10，用户已批准**默认开**）
 *
 * ## 为什么是"异步 + 提示"
 *
 * `scripts/security-scan.mjs` 的 L2 会调 `clamscan` —— **每次载库约 10 秒**（本机实测，峰值 RSS ≈ 966 MB）。
 * 同步等它 ⇒ **每一轮带下载的对话都多停 10 秒** ⇒ 与"别影响效率"直接冲突。
 * 所以：**发起扫描是 fire-and-forget**，结果**落运行时日志**，并在**下一次工具结果**里给一句简短提示。
 *
 * ## 口径（都是硬要求）
 *
 * 1. **只提示、不阻断**：结果只作为提示追加到工具结果里，**不影响**工具是否成功、**不拦截**任何东西。
 * 2. **诚实缺席**：扫描器说 `not-scanned` 时**原样透出** —— **绝不**显示成"干净/安全"。
 *    低内存跳过时同理：记 `skipped-low-mem`，**绝不假装扫过**。
 * 3. **fail-open**：解析/记录/发起任何一步出错都**吞掉**（但尽力落日志），绝不影响主流程。
 *
 * ## 内存护栏（2026-10-10 实测后新增，用户已批准）
 *
 * `clamscan` 峰值 RSS ≈ **966 MB**；而本机 `MemAvailable` 只有约 2.5 GB ⇒ 在内存紧张时扫一个大文件
 * 可能触发内存压力。故：读 `/proc/meminfo` 的 `MemAvailable`，**低于 1.5 GB ⇒ 记 `skipped-low-mem` 并跳过**。
 * 非 Linux（没有 `/proc/meminfo`）⇒ **不拦**，但在日志里注明 `memChecked: false`（不假装检查过）。
 *
 * ## 去重
 *
 * 同一份内容（sha256）**只扫一次**；状态存**运行时目录**的 `security/autoscan.jsonl`（不入库）。
 * 该文件走既有轮转通道 ⇒ 去重窗口 = 日志保留窗口（轮转后同一内容可能被重扫一次，属可接受的优化边界）。
 *
 * ## 可测性
 *
 * 纯逻辑（命令解析 / 判据 / meminfo 解析 / argv 构造 / 输出解析）与 IO（stat/spawn/日志）分离，
 * **IO 全部注入** ⇒ 单测不需要真下载、真装 ClamAV 就能覆盖全部护栏。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { appendJSONLRotating, ensureDir } from '../../../core/fs-json';

/** 只在 120 秒内改动的文件才扫（只扫"这次刚下载的"） */
export const AUTOSCAN_MAX_AGE_MS = 120_000;
/** 超过 200MB 记 skipped-too-large（如实记录，不静默跳过） */
export const AUTOSCAN_MAX_BYTES = 200 * 1024 * 1024;
/** 扫描子进程的硬超时（`clamscan` 载库约 10s，留足余量） */
export const AUTOSCAN_TIMEOUT_MS = 120_000;
/** 内存护栏：MemAvailable 低于此值（kB）就跳过（1.5 GiB） */
export const AUTOSCAN_MIN_MEM_KB = 1_572_864;
/** 日志轮转上限（与错误指纹同一量级） */
export const AUTOSCAN_LOG_MAX_BYTES = 1_000_000;

export interface DownloadTarget {
  /** 绝对路径 */
  file: string;
  /** 怎么得到的（便于日志里说清是 `-o` 还是 `-O`） */
  via: string;
}

/** 默认开；只有 `PI_AUTOSCAN=off`（大小写不敏感）才关 */
export function autoscanEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.PI_AUTOSCAN ?? '').toLowerCase() !== 'off';
}

/** 从命令行里取"下载输出目标"。只认明确的输出参数，**不猜**。 */
export function extractDownloadTargets(command: string, cwd: string): DownloadTarget[] {
  const out: DownloadTarget[] = [];
  const push = (p: string, via: string): void => {
    if (!p || p === '-') return; // `-o -` = 输出到 stdout，不是文件
    const abs = isAbsolute(p) ? p : resolve(cwd, p);
    if (!out.some((t) => t.file === abs)) out.push({ file: abs, via });
  };
  // 逐条管道命令分别解析（`a | b` 里两边都可能是下载）
  for (const seg of command.split(/[|;\n]+/)) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const tool = basename(tokens[0]);
    if (tool !== 'curl' && tool !== 'wget') continue;
    const urls = tokens.filter((t) => /^https?:\/\//i.test(t));
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '-o' || t === '--output' || (tool === 'wget' && t === '-O')) {
        const v = tokens[i + 1];
        if (v && !v.startsWith('-')) push(v, t);
        i++;
        continue;
      }
      if (t.startsWith('--output=')) push(t.slice('--output='.length), '--output=');
      // `-O`（curl）= 用远端文件名；`-O <name>`（wget）后面跟名字
      if (t === '-O') {
        if (tool === 'wget') {
          const v = tokens[i + 1];
          if (v && !v.startsWith('-')) {
            push(v, '-O');
            i++;
            continue;
          }
        }
        const last = urls[urls.length - 1];
        if (last) push(basename(last.split('?')[0]), '-O(远端名)');
      }
    }
  }
  return out;
}

export interface ScanMeta {
  exists: boolean;
  isFile: boolean;
  size: number;
  ageMs: number;
}

export interface ScanDecision {
  scan: boolean;
  /** 不扫时的原因（**如实**，会进日志） */
  reason: 'scan' | 'missing' | 'not-file' | 'too-old' | 'too-large';
}

/** 纯判据：能不能扫（内存与去重是另两步，因为它们分别需要 meminfo 与内容哈希） */
export function decideScan(meta: ScanMeta, maxAgeMs = AUTOSCAN_MAX_AGE_MS, maxBytes = AUTOSCAN_MAX_BYTES): ScanDecision {
  if (!meta.exists) return { scan: false, reason: 'missing' };
  if (!meta.isFile) return { scan: false, reason: 'not-file' };
  if (meta.ageMs > maxAgeMs) return { scan: false, reason: 'too-old' };
  if (meta.size > maxBytes) return { scan: false, reason: 'too-large' };
  return { scan: true, reason: 'scan' };
}

/**
 * 解析 `/proc/meminfo` 的 `MemAvailable`（返回 kB）。
 * 拿不到（非 Linux / 格式变了）⇒ 返回 `undefined` ⇒ **不拦**，但调用方要注明"未检查"。
 */
export function parseMemAvailableKb(meminfo: string): number | undefined {
  const m = meminfo.match(/^MemAvailable:\s+(\d+)\s*kB/m);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** 内存够不够扫（够 / 不够 / 没查到⇒按"不拦"处理） */
export function decideMemory(
  availableKb: number | undefined,
  minKb = AUTOSCAN_MIN_MEM_KB,
): { ok: boolean; reason: 'ok' | 'low-mem' | 'unchecked' } {
  if (availableKb === undefined) return { ok: true, reason: 'unchecked' };
  return availableKb < minKb ? { ok: false, reason: 'low-mem' } : { ok: true, reason: 'ok' };
}

/** 扫描 argv：Linux/mac 用 `nice` 降优先级；Windows 没有 nice ⇒ 直接跑 */
export function buildScanArgv(
  execPath: string,
  scanScript: string,
  file: string,
  platform: string = process.platform,
): { cmd: string; args: string[] } {
  const args = [scanScript, '--file', file];
  if (platform === 'win32') return { cmd: execPath, args };
  return { cmd: 'nice', args: ['-n', '10', execPath, ...args] };
}

/** 扫描器输出 → 结论（**not-scanned 原样透出**，绝不改写为 clean） */
export function parseScanOutput(stdout: string): { verdict: string; layers: string; hits: string[] } {
  const verdict = (stdout.match(/^结论：(\S+)/m) ?? [])[1] ?? 'unknown';
  const layers = (stdout.match(/分层：(.+)$/m) ?? [])[1]?.trim() ?? '';
  const hits = stdout
    .split('\n')
    .filter((l) => /^\s*⚠/.test(l))
    .map((l) => l.replace(/^\s*⚠\s*/, '').trim())
    .slice(0, 5);
  return { verdict, layers, hits };
}

export interface AutoscanDeps {
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { isFile: () => boolean; size: number; mtimeMs: number };
  /** 读文本（meminfo / 日志） */
  readText: (p: string) => string;
  /** 读二进制（算 sha256） */
  readBuffer: (p: string) => Buffer;
  ensureDir: (p: string) => void;
  /** 追加一条 JSON 记录（走既有轮转通道） */
  append: (file: string, value: unknown, maxBytes: number) => void;
  spawn: typeof spawn;
  now: () => number;
  /** 扫描器脚本绝对路径 */
  scanScript: string;
  /** 运行时状态目录（不入库） */
  stateDir: string;
  env: Record<string, string | undefined>;
  platform: string;
  execPath: string;
}

export interface Autoscan {
  /** 看本次 bash 命令是不是下载：是则按护栏决定是否发起扫描（fire-and-forget） */
  maybeStart: (command: string, cwd: string) => void;
  /** 取"上一次扫描的结果提示"（取走即清空，避免重复刷屏） */
  takeNotice: () => string | undefined;
}

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

export function createAutoscan(deps: AutoscanDeps): Autoscan {
  const logFile = join(deps.stateDir, 'autoscan.jsonl');
  let pending: string | undefined;

  const append = (rec: Record<string, unknown>): void => {
    try {
      deps.ensureDir(deps.stateDir);
      deps.append(logFile, rec, AUTOSCAN_LOG_MAX_BYTES);
    } catch {
      /* fail-open：日志失败不影响任何东西 */
    }
  };

  const readMemAvailableKb = (): number | undefined => {
    try {
      return parseMemAvailableKb(deps.readText('/proc/meminfo'));
    } catch {
      return undefined; // 非 Linux / 读不到 ⇒ 不拦，但下面会记 unchecked
    }
  };

  const seenSha = (): Set<string> => {
    const set = new Set<string>();
    try {
      if (!deps.existsSync(logFile)) return set;
      for (const line of deps.readText(logFile).split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as { sha256?: string };
          if (r.sha256) set.add(r.sha256);
        } catch {
          /* 跳过坏行 */
        }
      }
    } catch {
      /* fail-open */
    }
    return set;
  };

  const maybeStart = (command: string, cwd: string): void => {
    if (!autoscanEnabled(deps.env)) return;
    for (const target of extractDownloadTargets(command, cwd)) {
      let meta: ScanMeta;
      let digest: string;
      let memChecked = false;
      try {
        if (!deps.existsSync(target.file)) continue;
        const st = deps.statSync(target.file);
        meta = { exists: true, isFile: st.isFile(), size: st.size, ageMs: deps.now() - st.mtimeMs };
        const d = decideScan(meta);
        if (!d.scan) {
          append({ ts: new Date(deps.now()).toISOString(), file: target.file, via: target.via, skipped: d.reason });
          continue;
        }
        // 内存护栏：**先查再扫**（大文件扫描峰值 ≈ 966MB 是实测值）
        const availableKb = readMemAvailableKb();
        const mem = decideMemory(availableKb);
        if (!mem.ok) {
          append({
            ts: new Date(deps.now()).toISOString(),
            file: target.file,
            via: target.via,
            skipped: 'low-mem',
            memAvailableKb: availableKb,
            minMemKb: AUTOSCAN_MIN_MEM_KB,
          });
          continue;
        }
        memChecked = mem.reason === 'ok';
        digest = sha256(deps.readBuffer(target.file));
      } catch {
        continue; // fail-open：读不到就跳过
      }
      if (seenSha().has(digest)) {
        append({ ts: new Date(deps.now()).toISOString(), file: target.file, via: target.via, skipped: 'dupe', sha256: digest });
        continue;
      }
      const t0 = deps.now();
      try {
        const { cmd, args } = buildScanArgv(deps.execPath, deps.scanScript, target.file, deps.platform);
        const child = deps.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout?.on('data', (b: Buffer) => {
          stdout += b.toString('utf8');
        });
        const killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* fail-open */
          }
        }, AUTOSCAN_TIMEOUT_MS);
        child.on('close', () => {
          clearTimeout(killTimer);
          const parsed = parseScanOutput(stdout);
          append({
            ts: new Date(deps.now()).toISOString(),
            file: target.file,
            via: target.via,
            sha256: digest,
            verdict: parsed.verdict,
            layers: parsed.layers,
            hits: parsed.hits,
            ms: deps.now() - t0,
            memChecked,
          });
          // 提示**原样**带上扫描器的结论（含 not-scanned）——绝不改写成"干净"
          const head = parsed.verdict === 'suspicious' ? '⚠ 自动扫描**发现问题**' : '自动扫描';
          pending =
            `\n[${head}] 上次下载 ${basename(target.file)} ⇒ 结论：${parsed.verdict}` +
            (parsed.layers ? `（${parsed.layers}）` : '') +
            (parsed.hits.length ? `\n  ${parsed.hits.join('\n  ')}` : '') +
            `\n  （只提示不阻断；详见运行时日志 ${logFile}）`;
        });
        child.on('error', () => {
          clearTimeout(killTimer);
          append({ ts: new Date(deps.now()).toISOString(), file: target.file, via: target.via, skipped: 'spawn-error' });
        });
      } catch {
        append({ ts: new Date(deps.now()).toISOString(), file: target.file, via: target.via, skipped: 'spawn-throw' });
      }
    }
  };

  const takeNotice = (): string | undefined => {
    const n = pending;
    pending = undefined;
    return n;
  };

  return { maybeStart, takeNotice };
}

/** 生产环境的依赖（状态与日志：<memoryDir>/security/autoscan.jsonl；扫描器：<repo>/scripts/security-scan.mjs） */
export function defaultAutoscanDeps(memoryDir: string, repoRoot: string): AutoscanDeps {
  return {
    existsSync,
    statSync: statSync as unknown as AutoscanDeps['statSync'],
    readText: (p) => readFileSync(p, 'utf8') as string,
    readBuffer: (p) => readFileSync(p) as Buffer,
    ensureDir,
    append: (file, value, maxBytes) => appendJSONLRotating(file, value, maxBytes),
    spawn,
    now: () => Date.now(),
    scanScript: join(repoRoot, 'scripts', 'security-scan.mjs'),
    stateDir: join(memoryDir, 'security'),
    env: process.env,
    platform: process.platform,
    execPath: process.execPath,
  };
}

/** 供 index.ts 用的一行式构造 */
export function createDefaultAutoscan(memoryDir: string, repoRoot: string): Autoscan {
  return createAutoscan(defaultAutoscanDeps(memoryDir, repoRoot));
}
