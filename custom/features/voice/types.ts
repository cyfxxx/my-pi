/**
 * Voice Feature — 基础类型与命令执行（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/types.ts`。
 */

import { execFile } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function nowStamp(): string {
  const d = new Date();
  const p = (n: number, l = 2): string => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function runCommand(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<CommandResult> {
  const { timeoutMs = 60000, maxBuffer = 16 * 1024 * 1024 } = opts;
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
      if (!err) {
        resolve({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        return;
      }
      const e = err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
      if (typeof e.code === 'number') {
        resolve({ code: e.code, stdout: stdout ?? '', stderr: stderr ?? '' });
        return;
      }
      if (e.message.includes('ENOENT')) {
        resolve({ code: 127, stdout: '', stderr: `${bin}: command not found` });
        return;
      }
      if (e.killed === true) {
        resolve({ code: 124, stdout: stdout ?? '', stderr: `timeout after ${timeoutMs}ms` });
        return;
      }
      resolve({ code: 1, stdout: stdout ?? '', stderr: stderr ?? e.message });
    });
  });
}

export interface TranscribeResult {
  text: string;
  language: string;
  error?: string;
}
