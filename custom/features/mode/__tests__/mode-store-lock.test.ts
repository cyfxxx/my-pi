/**
 * mode 运行时状态的**跨进程**锁（真多进程）
 *
 * 背景：`modes-sessions.json` 与 `mode-restart-guard.json` 都是"读 → 改 → 写"，而多实例并存是
 * 实测过的（同一天出现过两个 supervisor）。原子写只防半截文件，防不住"A 读 → B 读 → A 写 →
 * B 写"的丢更新——表现是"切了模式又变回 default"、单槽防环标记被顶掉后"来回重启"。
 *
 * 本测试用**真进程**验证三件事（进程内并发测试测不出跨进程锁）：
 *   1. 临界区互斥：多个进程在 `withFileLock` 下写 START/END，文件里不得出现交错；
 *   2. 接线：两个 RMW 入口（`setSessionMode` / `shouldRequestModeRestart`）确实在锁内
 *      ——结构断言，防"加了锁却漏接一处"；
 *   3. N 个进程各写一条不同会话记录 → 全部保留（丢更新会在这一步显现）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const RUN_TS = join(ROOT, 'scripts', 'run-ts.sh');
const ENV_KEYS = ['PI_CODING_AGENT_DIR'];

let dir: string;
let savedEnv: Record<string, string | undefined>;

const execP = (file: string, args: string[], env: Record<string, string | undefined>) =>
  new Promise<void>((res, rej) => {
    execFile(file, args, { env: env as NodeJS.ProcessEnv, timeout: 60_000 }, (err) => (err ? rej(err) : res()));
  });

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'my-pi-modelock-'));
  writeFileSync(join(dir, 'modes.json'), JSON.stringify({ default: 'full', modes: { roleplay: { features: [] } } }));
  process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

/** 把一段 worker 源码写进临时目录（worker 用绝对路径 import 生产代码） */
function writeWorker(name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, body);
  return file;
}

describe('mode 运行时状态的跨进程锁', () => {
  it('临界区互斥：多进程同时持锁写 START/END，文件里不得交错', async () => {
    const target = join(dir, 'trace.txt');
    const worker = writeWorker(
      'lock-worker.mts',
      `import { appendFileSync } from 'node:fs';
import { withFileLock } from ${JSON.stringify(join(ROOT, 'custom/core/file-lock.ts'))};
const [target, tag, holdMs] = process.argv.slice(2);
withFileLock(target + '.lock', () => {
  appendFileSync(target, 'START-' + tag + '\\n');
  const until = Date.now() + Number(holdMs);
  while (Date.now() < until) { /* 故意占住锁，放大交错窗口 */ }
  appendFileSync(target, 'END-' + tag + '\\n');
});
`,
    );
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    const tags = ['a', 'b', 'c', 'd'];
    await Promise.all(tags.map((t) => execP('bash', [RUN_TS, worker, target, t, '120'], env)));

    const lines = readFileSync(target, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(tags.length * 2);
    for (let i = 0; i < lines.length; i += 2) {
      expect(lines[i].startsWith('START-')).toBe(true);
      expect(lines[i + 1]).toBe(lines[i].replace('START-', 'END-')); // 成对出现 = 没有交错
    }
  });

  it('接线：两个 RMW 入口都在锁内（结构断言，防漏接一处）', () => {
    const src = readFileSync(join(ROOT, 'custom/features/mode/logic.ts'), 'utf-8');
    const body = (fn: string) => {
      const start = src.indexOf(`export function ${fn}`);
      expect(start, `${fn} 未找到`).toBeGreaterThan(-1);
      return src.slice(start, src.indexOf('\n}\n', start));
    };
    expect(body('setSessionMode')).toContain('withModeStoreLock(');
    expect(body('shouldRequestModeRestart')).toContain('withModeStoreLock(');
  });

  it('N 个进程各写一条不同会话记录 → 全部保留（丢更新会在这里显现）', async () => {
    const keys = ['/tmp/s0.jsonl', '/tmp/s1.jsonl', '/tmp/s2.jsonl', '/tmp/s3.jsonl', '/tmp/s4.jsonl'];
    const worker = writeWorker(
      'store-worker.mts',
      `import { setSessionMode } from ${JSON.stringify(join(ROOT, 'custom/features/mode/logic.ts'))};
setSessionMode(process.argv[2], 'roleplay');
`,
    );
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    await Promise.all(keys.map((k) => execP('bash', [RUN_TS, worker, k], env)));

    expect(existsSync(join(dir, 'modes-sessions.json'))).toBe(true);
    const all = JSON.parse(readFileSync(join(dir, 'modes-sessions.json'), 'utf-8')) as Record<string, { mode: string }>;
    for (const k of keys) expect(all[k]?.mode, k).toBe('roleplay');
  }, 90_000);
});
