/**
 * Autopilot Feature — 任务执行器（纯逻辑，零 Pi 依赖）
 *
 * 补齐 pi-tools autopilot 的离线执行核心：以子进程 `pi --mode json -p` 运行任务
 * （隔离上下文），解析 JSONL 取最终文本/退出码/用量。策略与遥测由调用方（index tick）处理。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { renderPrompt } from '../store/storage';
import type { Task } from '../types';

export interface TaskRunResult {
  result: 'success' | 'failed';
  output: string;
  exitCode: number;
  durationMs: number;
  stderr: string;
}

/** 构造 `pi` 调用参数（mode json 单轮，无会话/无扩展） */
export function buildRunArgs(task: Task): string[] {
  return ['--mode', 'json', '-p', '--no-session', '--no-extensions', renderPrompt(task.prompt)];
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtual = currentScript?.startsWith('/$bunfs/root/');
  if (currentScript && !isBunVirtual && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) {
    // 非 node/bun 时：确保 args 包含脚本路径（即使 currentScript 为空）
    return { command: process.execPath, args: [...(currentScript ? [currentScript] : []), ...args] };
  }
  return { command: 'pi', args };
}

/** 从 JSONL 流中提取最后一条 assistant 文本（导出便于单测） */
export function extractRunOutput(lines: string[]): string {
  let text = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: { type?: string; message?: { role?: string; content?: unknown } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== 'message_end' || ev.message?.role !== 'assistant') continue;
    const content = ev.message.content;
    if (typeof content === 'string') {
      if (content) text = content;
    } else if (Array.isArray(content)) {
      const parts = content
        .filter((b): b is { type?: string; text?: string } => !!b && typeof b === 'object')
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string);
      if (parts.length) text = parts.join('\n');
    }
  }
  return text;
}

export function runTaskOnce(task: Task, cwd: string, timeoutMs = task.maxRunTime * 1000): Promise<TaskRunResult> {
  const started = Date.now();
  const invocation = getPiInvocation(buildRunArgs(task));
  const SENSITIVE_ENV = /^(ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|AWS_SECRET|PI_SESSION_ID|PI_AUTH|PI_API_KEY)/i;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !SENSITIVE_ENV.test(k)) env[k] = v;
  }
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (exitCode: number, errMsg?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = extractRunOutput(stdout.split('\n'));
      resolve({
        result: exitCode === 0 && !errMsg && output ? 'success' : 'failed',
        output: (errMsg ? `${errMsg}\n${output}` : output).slice(0, 4000) || (exitCode === 0 ? '(无输出)' : `exit ${exitCode}`),
        // 保留真实退出码：124=超时（ops.errClassOf 依赖它判定 timeout），不要被 errMsg 覆盖为 1
        exitCode,
        durationMs: Date.now() - started,
        stderr: stderr.slice(-2000),
      });
    };
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(invocation.command, invocation.args, {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
    } catch (e) {
      resolve({ result: 'failed', output: `子进程启动失败: ${(e as Error).message}`, exitCode: 1, durationMs: Date.now() - started, stderr: '' });
      return;
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* 已退出 */
      }
      finish(124, `任务超时（${task.maxRunTime}s）`);
    }, timeoutMs);
    timer.unref?.();
    proc.stdout!.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > 512 * 1024) stdout = stdout.slice(-512 * 1024);
    });
    proc.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 50 * 1024) stderr = stderr.slice(-50 * 1024);
    });
    proc.on('error', (err: Error) => finish(1, `子进程启动失败: ${err.message}`));
    proc.on('close', (code) => finish(code ?? 0));
  });
}

/** 任务运行临时目录（隔离，含 pid） */
export function taskTmpDir(): string {
  return path.join(os.tmpdir(), `my-pi-autopilot-${process.pid}`);
}
