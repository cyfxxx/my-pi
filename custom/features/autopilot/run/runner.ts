/**
 * Autopilot Feature — 任务执行器（纯逻辑，零 Pi 依赖）
 *
 * 补齐 pi-tools autopilot 的离线执行核心：以子进程 `pi --mode json -p` 运行任务
 * （隔离上下文），解析 JSONL 取最终文本/退出码/用量。策略与遥测由调用方（index tick）处理。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { renderPrompt } from '../store/storage';
import { logDir } from '../store/paths';
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

/**
 * `argv[1]` 是否指向**测试运行器**的入口（vitest/jest/mocha）。
 * 抽成导出函数 ⇒ 供 `getPiInvocation` 与"调度器测试环境早退"**共用一套判据**（不造第二套 ✓）。
 */
export function isTestRunnerEntryPath(currentScript: string | undefined): boolean {
  return (
    !!currentScript &&
    (currentScript.includes(`${path.sep}node_modules${path.sep}vitest${path.sep}`) ||
      currentScript.includes(`${path.sep}node_modules${path.sep}jest${path.sep}`) ||
      currentScript.includes(`${path.sep}node_modules${path.sep}mocha${path.sep}`))
  );
}

/**
 * 当前进程是否运行在**测试运行器**里（`VITEST` 由 vitest 注入 ✓；或入口位于测试运行器目录）。
 * 用途：**调度器入口据此早退** ⇒ 任何测试都不可能驱动真实调度器 ✓。
 */
export function isTestEnvironment(): boolean {
  return !!process.env.VITEST || isTestRunnerEntryPath(process.argv[1]);
}

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtual = currentScript?.startsWith('/$bunfs/root/');
  // 2026-10-11 修（定时任务 `tool-stats-daily` 反复失败的真根因 ✗）：
  // **不能无条件信任 `process.argv[1]`** —— 本进程若是 **vitest worker**，`argv[1]` 就是测试运行器的
  // worker 入口（实测 `/…/node_modules/vitest/dist/workers/forks.js`）⇒ 旧逻辑会去
  // `node <forks.js> --mode json …` ⇒ 抛 `Expected worker to be run in node:child_process` ⇒ 任务必然失败。
  // 判据（**纯附加、最小** ✓）：入口位于测试运行器目录（vitest/jest/mocha）⇒ **回退到 `'pi'`** ✓；
  // 其余路径行为**完全不变** ✓。
  const isTestRunnerEntry = isTestRunnerEntryPath(currentScript);
  if (currentScript && !isBunVirtual && !isTestRunnerEntry && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
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
  // 剥离敏感凭据：通用 *_API_KEY/*_API_TOKEN/*_AUTH_TOKEN/*_OAUTH_TOKEN 结尾
  // + AWS 凭据 + PI 自身凭据（供任何 provider、不限于原 5 个固定名）
  const SENSITIVE_ENV =
    /(_API_KEY|_API_TOKEN|_AUTH_TOKEN|_OAUTH_TOKEN)$|^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)|^PI_(SESSION_ID|AUTH|API_KEY)/i;
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
      const failed = exitCode !== 0 || !!errMsg;
      // Patch (runner-failure-log): 失败/超时先把完整 stdout/stderr 落盘。
      // 超时路径 SIGKILL 子进程后内存输出即消失，tasks.json 只剩一句「任务超时」，
      // 无法区分卡在脚本、pre-push hook 还是模型回合。
      const logFile = failed
        ? writeRunLog(task, { exitCode, errMsg, durationMs: Date.now() - started, stdout, stderr })
        : null;
      const base =
        (errMsg ? `${errMsg}\n${output}` : output).slice(0, 4000) ||
        (exitCode === 0 ? '(无输出)' : `exit ${exitCode}`);
      resolve({
        result: exitCode === 0 && !errMsg && output ? 'success' : 'failed',
        output: logFile ? `${base}\n[诊断日志] ${logFile}` : base,
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

interface RunLogInfo {
  exitCode: number;
  errMsg?: string;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/**
 * 失败/超时诊断落盘到 scheduler/logs/<taskId>-<ISO>.log（按任务保留最近 10 份）。
 * 失败返回 null，不阻断任务结果。
 */
export function writeRunLog(task: Task, info: RunLogInfo): string | null {
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${task.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    fs.writeFileSync(
      file,
      [
        '# autopilot run log',
        `task: ${task.name} (${task.id})`,
        `time: ${new Date().toISOString()}`,
        `exitCode: ${info.exitCode}`,
        `durationMs: ${info.durationMs}`,
        `reason: ${info.errMsg ?? ''}`,
        '',
        '## stderr',
        info.stderr || '(empty)',
        '',
        '## stdout (pi JSONL)',
        info.stdout || '(empty)',
        '',
      ].join('\n'),
    );
    pruneRunLogs(task.id, 10);
    return file;
  } catch {
    return null;
  }
}

function pruneRunLogs(taskId: string, keep: number): void {
  const dir = logDir();
  const own = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${taskId}-`) && f.endsWith('.log'))
    .sort();
  for (const f of own.slice(0, Math.max(0, own.length - keep))) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ignore */
    }
  }
}

/** 任务运行临时目录（隔离，含 pid） */
