import { execFile } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  type TmuxOpts,
  normalizeSessionName,
  ensureLogDir,
  logPathFor,
  rotateLogIfLarge,
  shellSingleQuote,
} from './config';

export interface TmuxRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type SessionProbe = 'alive' | 'gone' | 'unknown';

export interface SessionInfo {
  name: string;
  attached: boolean;
}

export interface ReadOutput {
  text: string;
  source: 'log' | 'capture';
  truncated: boolean;
}

export interface SendOpts {
  text?: string;
  ctrlKey?: string;
  enter?: boolean;
}

export interface WaitResult {
  outcome: 'exited' | 'pattern' | 'timeout';
  lastOutput: string;
}

// ── tmux 进程执行 ──

export function runTmux(opts: TmuxOpts, args: string[], timeoutMs = 15000): Promise<TmuxRunResult> {
  return new Promise((resolvePromise) => {
    const child = execFile(opts.bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) {
        resolvePromise({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        return;
      }
      const code = (err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean }).code;
      if (typeof code === 'number') {
        resolvePromise({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
        return;
      }
      if (err.message.includes('ENOENT')) {
        resolvePromise({ code: 127, stdout: '', stderr: `tmux: command not found (${opts.bin})` });
        return;
      }
      if ((err as NodeJS.ErrnoException & { killed?: boolean }).killed === true) {
        resolvePromise({ code: 124, stdout: stdout ?? '', stderr: `tmux timeout after ${timeoutMs}ms` });
        return;
      }
      resolvePromise({ code: 1, stdout: stdout ?? '', stderr: stderr ?? err.message });
    });
    void child;
  });
}

/** has-session 结果三态分类（纯函数） */
export function classifySessionProbe(r: TmuxRunResult): SessionProbe {
  if (r.code === 0) {
    if (/access not allowed/i.test(r.stderr)) return 'gone';
    return 'alive';
  }
  if (r.code === 1 && /can't find session/i.test(r.stderr)) return 'gone';
  return 'unknown';
}

export async function probeSession(opts: TmuxOpts, name: string): Promise<SessionProbe> {
  return classifySessionProbe(await runTmux(opts, ['has-session', '-t', name]));
}

export async function hasSession(opts: TmuxOpts, name: string): Promise<boolean> {
  return (await probeSession(opts, name)) === 'alive';
}

export async function listSessions(opts: TmuxOpts): Promise<SessionInfo[]> {
  const r = await runTmux(opts, ['list-sessions', '-F', '#{session_name}\t#{session_attached}']);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, attached] = line.split('\t');
      return { name, attached: attached === '1' };
    });
}

export async function startSession(
  opts: TmuxOpts,
  rawName: string,
  command: string,
  cwd?: string,
): Promise<{ name: string; logPath: string; started: boolean }> {
  const name = normalizeSessionName(rawName, opts.prefix);
  if (!command || !command.trim()) throw new Error('命令为空');
  ensureLogDir(opts);
  const startDir = cwd ? resolve(cwd) : homedir();
  const logPath = logPathFor(opts, name);

  const create = await runTmux(opts, ['new-session', '-d', '-s', name, '-c', startDir], 30000);
  if (create.code !== 0) {
    if (/duplicate session/i.test(create.stderr)) {
      return { name, logPath, started: false };
    }
    throw new Error(`创建 tmux 会话失败: ${create.stderr || create.stdout || `code ${create.code}`}`);
  }

  rotateLogIfLarge(opts, name);
  const pipeCmd = `cat >> ${shellSingleQuote(logPath)}`;
  const pipeResult = await runTmux(opts, ['pipe-pane', '-t', name, '-o', pipeCmd], 10000);
  if (pipeResult.code !== 0) {
    throw new Error(`pipe-pane 设置失败: ${pipeResult.stderr || pipeResult.stdout}`);
  }

  const injected = `${command}; [ $? -ne 130 ] && exit`;
  await runTmux(opts, ['send-keys', '-t', name, '-l', injected], 10000);
  await runTmux(opts, ['send-keys', '-t', name, 'Enter'], 10000);

  return { name, logPath, started: true };
}

export async function readOutput(opts: TmuxOpts, name: string, lines = 100, maxChars = 12000): Promise<ReadOutput> {
  const logPath = logPathFor(opts, name);
  if (existsSync(logPath)) {
    const TAIL_BYTES = 512 * 1024;
    let content = '';
    let size = 0;
    let logOk = false;
    try {
      const fd = openSync(logPath, 'r');
      try {
        size = statSync(logPath).size;
        const len = Math.min(size, TAIL_BYTES);
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, size - len);
        content = buf.toString('utf-8');
        logOk = true;
      } finally {
        // 必须在 finally 关闭：statSync/readSync 抛错时也不泄漏 fd
        closeSync(fd);
      }
    } catch {
      try {
        content = readFileSync(logPath, 'utf-8');
        size = content.length;
        logOk = true;
      } catch {
        /* 日志不可得 → capture-pane 回退 */
      }
    }
    if (logOk) {
      const sliced = content.split('\n').slice(-lines).join('\n');
      // 截断判定与截取都按字符（size 是字节，不能直接与 maxChars 比较）
      const truncated = sliced.length > maxChars || content.length > sliced.length;
      return {
        text: truncated ? sliced.slice(-maxChars) : sliced,
        source: 'log',
        truncated,
      };
    }
  }
  const r = await runTmux(opts, ['capture-pane', '-t', name, '-p', '-S', String(-lines)]);
  const text = r.code === 0 ? r.stdout : '(日志文件不存在且 capture-pane 不可用)';
  return { text, source: 'capture', truncated: text.length > maxChars };
}

export async function sendKeys(opts: TmuxOpts, name: string, o: SendOpts): Promise<void> {
  if (o.ctrlKey) {
    const r = await runTmux(opts, ['send-keys', '-t', name, `C-${o.ctrlKey}`]);
    if (r.code !== 0) throw new Error(`发送按键失败: ${r.stderr}`);
  }
  if (o.text) {
    const r = await runTmux(opts, ['send-keys', '-t', name, '-l', o.text]);
    if (r.code !== 0) throw new Error(`发送文本失败: ${r.stderr}`);
  }
  if (o.enter) {
    const r = await runTmux(opts, ['send-keys', '-t', name, 'Enter']);
    if (r.code !== 0) throw new Error(`发送回车失败: ${r.stderr}`);
  }
}

export async function killSession(opts: TmuxOpts, name: string): Promise<void> {
  const r = await runTmux(opts, ['kill-session', '-t', name]);
  if (r.code !== 0) {
    if (/can't find session/i.test(r.stderr)) return;
    throw new Error(`结束会话失败: ${r.stderr}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitSession(
  opts: TmuxOpts,
  name: string,
  pattern: string | undefined,
  timeoutMs: number,
  untilExit: boolean,
): Promise<WaitResult> {
  const deadline = Date.now() + timeoutMs;
  let lastOutput = '';
  while (Date.now() < deadline) {
    const alive = await hasSession(opts, name);
    if (!alive) {
      const out = await readOutput(opts, name, 500, 20000);
      lastOutput = lastOutput.length >= out.text.length ? lastOutput : out.text;
      return { outcome: 'exited', lastOutput };
    }
    if (pattern) {
      const out = await readOutput(opts, name, 500, 20000);
      lastOutput = out.text;
      if (out.text.includes(pattern)) return { outcome: 'pattern', lastOutput };
    }
    if (untilExit && !pattern) {
      lastOutput = (await readOutput(opts, name, 500, 20000)).text;
    }
    await sleep(800);
  }
  if (pattern) lastOutput = (await readOutput(opts, name, 500, 20000)).text;
  return { outcome: 'timeout', lastOutput };
}

export function tmuxMissingError(detail: string): string {
  return (
    `tmux 不可用：${detail}\n\n` +
    '请安装 tmux 后重试。按系统选择：\n' +
    '  Debian/Ubuntu:  sudo apt-get install -y tmux\n' +
    '  Termux:         pkg install tmux\n' +
    '  macOS (brew):   brew install tmux\n' +
    '安装完成后验证：tmux -V'
  );
}
