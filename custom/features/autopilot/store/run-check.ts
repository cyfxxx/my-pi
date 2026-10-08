/**
 * 只读检查命令的执行器（P1，见 `docs/design/SOL-PI-BORROW.md`）
 *
 * 用途：让 `goal` 的"完成"能有一个**独立于模型叙述**的判据。借鉴 SoL-Pi 的两条发现：
 * "Require validation evidence before claiming completion" 与
 * "Demand a check that can distinguish the broken state"。
 *
 * 设计取舍：
 * - **不接受模型自封**：只有当这条命令**真的跑通（exit 0）**，目标才会被记为 `verified`；
 *   没给命令一律只能记 `declared`。见 `store/goal.ts` 的三个完成态构造器。
 * - **有界**：默认 120s 超时，超时按失败处理（杀掉进程树不必要，`sh -c` 的子进程随父退出）；
 *   输出只留尾部若干字符——这是给模型看的证据，不是日志归档。
 * - **无 Pi 依赖**：纯 IO，可在 vitest 里用无害命令直接驱动。
 */

import { spawn } from 'node:child_process';

/** 默认超时（毫秒）。比 bash 的 240s 前台上限更短：检查命令本就该是快的。 */
export const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
/** 只保留输出尾部这么多字符（给模型当证据足够） */
export const CHECK_OUTPUT_TAIL_CHARS = 4_000;

export interface CheckResult {
  /** exit 0 且未超时 */
  ok: boolean;
  /** 退出码；被杀/超时/启动失败时为 null */
  status: number | null;
  /** stdout + stderr 的尾部（合并保留顺序） */
  outputTail: string;
  timedOut: boolean;
  /** 命令没能在给定超时内跑完，或被信号终止 */
  reason: string;
}

function tail(s: string, n = CHECK_OUTPUT_TAIL_CHARS): string {
  return s.length > n ? s.slice(-n) : s;
}

/**
 * 跑一条检查命令（`sh -c <command>`）。
 *
 * 注意：调用方必须把它当**只读**检查用（工具描述里已写明）。这里不做沙箱——模型本来就能用 bash，
 * 这个执行器的价值不在"限制能力"，而在**把判据从模型叙述里拿出来**，交给 harness 实测。
 */
export async function runCheckCommand(
  command: string,
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<CheckResult> {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs as number) > 0
    ? Math.floor(opts.timeoutMs as number)
    : DEFAULT_CHECK_TIMEOUT_MS;

  return new Promise<CheckResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let timedOut = false;

    const finish = (status: number | null, reason: string): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ok: status === 0 && !timedOut,
        status,
        outputTail: tail(`${stdout}${stderr ? `\n${stderr}` : ''}`),
        timedOut,
        reason,
      });
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('sh', ['-c', command], {
        cwd: opts.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({
        ok: false,
        status: null,
        outputTail: '',
        timedOut: false,
        reason: `无法启动检查命令：${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      // 给它一点时间收尾；仍不退就按超时收口（不阻塞目标判定）
      setTimeout(() => finish(null, `超过 ${timeoutMs}ms 未结束`), 1_000).unref?.();
    }, timeoutMs);
    timer.unref?.();

    proc.stdout?.on('data', (d: Buffer) => {
      stdout = tail(stdout + d.toString('utf8'));
    });
    proc.stderr?.on('data', (d: Buffer) => {
      stderr = tail(stderr + d.toString('utf8'));
    });
    proc.on('error', (e: Error) => finish(null, `执行出错：${e.message}`));
    proc.on('close', (status) => finish(status, status === 0 ? '通过' : `退出码 ${status}`));
  });
}

/** 把检查结果压成一句给模型/状态文案看的话 */
export function describeCheck(command: string, r: CheckResult): string {
  const head = r.ok ? '检查通过' : r.timedOut ? '检查超时' : `检查失败（${r.reason}）`;
  return `${head}：\`${command}\``;
}
