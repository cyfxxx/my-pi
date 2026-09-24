/**
 * 代码执行工具（ctx_exec）
 *
 * 迁移自 pi-tools `pi-memory/tools/exec-sandbox.ts`。在子进程中执行 JS/TS/Python/Shell，
 * 仅 stdout 进入上下文——适合聚合处理多个文件后打印结果，代替逐个读文件。
 * 原实现的 pruneToolOutput/用量记账由 my-pi 的 tool_result 钩子统一承担（见 context/index.ts），
 * 此处只保留执行与截断。
 */

import { spawn } from 'node:child_process';
import { registerTool } from '../../../adapters/tool-adapter';

/** Pi API 类型经 adapters 推导：features 逻辑层不直接 import Pi 包 */
type PiApi = Parameters<typeof registerTool>[0];

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT = 2000;

export const LANGUAGES: Record<string, { cmd: string; args: string[] }> = {
  js: { cmd: process.argv[0], args: ['-e'] },
  ts: { cmd: process.argv[0], args: ['-e'] },
  python: { cmd: 'python3', args: ['-c'] },
  shell: { cmd: 'bash', args: ['-c'] },
};

/** 由 shebang 推断语言，缺省 js */
export function detectLanguage(code: string): string {
  const firstLine = code.trim().split('\n')[0] || '';
  if (/^#!/.test(firstLine)) {
    if (/\bpython/.test(firstLine)) return 'python';
    if (/\bbash\b/.test(firstLine) || /\bsh\b/.test(firstLine)) return 'shell';
    if (/\bnode\b/.test(firstLine)) return 'js';
  }
  return 'js';
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: string;
}

/** 按 max_output 截断并标注比例（cap 为 Infinity 表示不限） */
export function truncateOutput(output: string, cap: number): string {
  if (!Number.isFinite(cap) || output.length <= cap) return output;
  const ratio = Math.round((cap / output.length) * 100);
  return `${output.slice(0, cap)}\n\n[truncated: ${output.length} chars → ${cap} chars (${ratio}%)]`;
}

export async function execLanguageAsync(
  language: string,
  code: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const lang = LANGUAGES[language];
  if (!lang) {
    return {
      stdout: '',
      stderr: '',
      status: null,
      error: `Unsupported language: "${language}". Supported: ${Object.keys(LANGUAGES).join(', ')}`,
    };
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error(`Timeout after ${timeout}ms`)), timeout);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

  try {
    return await new Promise<ExecResult>((resolve, reject) => {
      const proc = spawn(lang.cmd, [...lang.args, code], {
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: combinedSignal,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      proc.on('close', (status) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), status }));
      proc.on('error', (err) => reject(err));
    });
  } catch (err) {
    return { stdout: '', stderr: '', status: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function registerExecTool(pi: PiApi): void {
  registerTool(pi, {
    name: 'ctx_exec',
    description:
      '在子进程中执行代码（JS/TS/Python/Shell），仅 stdout 进入上下文。适合聚合处理多个文件后打印结果，代替逐个读文件。',
    parameters: {
      code: { type: 'string', description: 'Code to execute' },
      language: {
        type: 'string',
        enum: ['js', 'ts', 'python', 'shell'],
        description: "Language: 'js' (default), 'python', 'shell'。省略时按 shebang 推断。",
        optional: true,
      },
      description: { type: 'string', description: 'Brief description of what this does', optional: true },
      timeout: { type: 'number', description: `超时毫秒（默认 ${DEFAULT_TIMEOUT_MS}）`, optional: true },
      max_output: {
        type: 'number',
        description: `最大输出字符数（默认 ${DEFAULT_MAX_OUTPUT}；0 表示不限）`,
        optional: true,
      },
    },
    execute: async (params, ctx) => {
      const code = params.code as string | undefined;
      if (!code) return 'Error: code is required';
      const maxOutput = params.max_output as number | undefined;
      const cap = maxOutput === undefined ? DEFAULT_MAX_OUTPUT : maxOutput === 0 ? Number.POSITIVE_INFINITY : maxOutput;
      const timeout = (params.timeout as number | undefined) ?? DEFAULT_TIMEOUT_MS;
      const language = (params.language as string | undefined) || detectLanguage(code);
      const { stdout, stderr, status, error } = await execLanguageAsync(language, code, timeout, ctx?.signal);
      if (error) return `Error: ${error}`;
      if (status !== 0) return `Exit code ${status}\n${stderr || stdout}`;
      return truncateOutput(stdout || '(no output)', cap);
    },
  });
}
