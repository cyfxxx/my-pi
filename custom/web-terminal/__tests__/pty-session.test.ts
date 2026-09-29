/**
 * web-terminal/pty-session 回归测试。
 *
 * 纯函数部分（尺寸夹取、shell 片段拼装）始终运行；
 * 真实 pty 部分需要 util-linux 的 `script`/`stty`，缺失时自动跳过（不把门变红）。
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { buildPtyShellCommand, clampPtySize, PTY_MAX_COLS, PTY_MAX_ROWS, PTY_MIN_COLS, PTY_MIN_ROWS, PtySession } from '../pty-session';

const ttyToolsAvailable =
  spawnSync('sh', ['-c', 'command -v script >/dev/null 2>&1 && command -v stty >/dev/null 2>&1']).status === 0;
const describePty = ttyToolsAvailable ? describe : describe.skip;

describe('pty-session: clampPtySize', () => {
  it('把尺寸夹在安全区间内', () => {
    expect(clampPtySize(80, 24)).toEqual({ cols: 80, rows: 24 });
    expect(clampPtySize(1, 1)).toEqual({ cols: PTY_MIN_COLS, rows: PTY_MIN_ROWS });
    expect(clampPtySize(9999, 9999)).toEqual({ cols: PTY_MAX_COLS, rows: PTY_MAX_ROWS });
  });

  it('非整数/NaN 回退 80x24 后再夹取，且结果是整数', () => {
    expect(clampPtySize(Number.NaN, Number.NaN)).toEqual({ cols: 80, rows: 24 });
    expect(clampPtySize(80.7, 24.2)).toEqual({ cols: 80, rows: 24 });
    expect(clampPtySize(Number.POSITIVE_INFINITY, 0)).toEqual({ cols: PTY_MAX_COLS, rows: PTY_MIN_ROWS });
  });
});

describe('pty-session: buildPtyShellCommand', () => {
  it('先写 tty 路径、设置初始尺寸，再 exec 目标命令', () => {
    const command = buildPtyShellCommand({
      ttyFile: '/tmp/x.tty',
      cols: 100,
      rows: 30,
      command: "bash '/root/my-pi/my-pi.sh'",
    });
    expect(command).toContain("tty > '/tmp/x.tty' 2>/dev/null");
    expect(command).toContain('stty rows 30 cols 100');
    expect(command.endsWith("exec bash '/root/my-pi/my-pi.sh'")).toBe(true);
  });

  it('对被夹取的尺寸取值，并对含单引号的路径做转义', () => {
    const command = buildPtyShellCommand({
      ttyFile: "/tmp/it's.tty",
      cols: 1,
      rows: 1,
      command: 'true',
    });
    expect(command).toContain('stty rows 5 cols 20');
    expect(command).toContain(`tty > '/tmp/it'\\''s.tty'`);
  });
});

describePty('pty-session: 真实 pty', () => {
  it(
    '能发现 pty、收到输出，并且外部改尺寸会触发 SIGWINCH',
    async () => {
      const session = new PtySession({
        command: `bash -c 'stty size; trap "stty size" WINCH; while :; do sleep 0.2; done'`,
        cwd: process.cwd(),
        env: process.env,
        cols: 80,
        rows: 24,
      });
      await session.start();
      try {
        expect(session.terminalPath).toMatch(/^\/dev\//);
        expect(session.alive).toBe(true);
        await waitFor(() => session.replay().toString('utf8').includes('24 80'));

        // 改尺寸 → 内核向 pty 前台进程组发 SIGWINCH → 子进程打印新尺寸
        expect(await session.resize(100, 30)).toBe(true);
        await waitFor(() => session.replay().toString('utf8').includes('30 100'));

        // 同尺寸重复设置不算变化
        expect(await session.resize(100, 30)).toBe(false);
        expect(session.terminalSize).toEqual({ cols: 100, rows: 30 });

        // forceRedraw 通过"抖动"行数触发重绘，不改变最终尺寸
        expect(await session.forceRedraw()).toBe(true);
        expect(session.terminalSize).toEqual({ cols: 100, rows: 30 });
      } finally {
        await session.dispose();
      }
    },
    20_000,
  );

  it(
    'dispose 会连带结束进程组，退出信息可读',
    async () => {
      const session = new PtySession({
        command: `bash -c 'echo READY; sleep 30'`,
        cwd: process.cwd(),
        env: process.env,
        cols: 80,
        rows: 24,
      });
      const exited = new Promise<void>((resolve) => {
        session.onExit(() => resolve());
      });
      await session.start();
      await waitFor(() => session.replay().toString('utf8').includes('READY'));
      await session.dispose();
      await exited;
      expect(session.exit).not.toBeNull();
    },
    20_000,
  );

  it(
    'dispose 结束后整个进程树都消失（script 的负载 setsid 另立会话，必须连同后代一起结束）',
    async () => {
      // 为什么要断言整个树：`script` 会让负载 setsid 成为新会话首进程（pgid == 自身 pid），
      // 于是负载在另一个进程组里。实测只对 script 自己的进程组发 SIGTERM 时，负载靠
      // script 的转发与 pty 关闭后的 SIGHUP 最终也会退出，但要 ~2.1s；这期间 restart()
      // 已经把新会话拉起来了，旧负载的残余输出会混进新会话的回放缓冲。故终止走
      // SIGTERM → 400ms → SIGKILL（含全部后代进程组），把它压到 ~0.6s。
      // 用带唯一标记的探针脚本，使负载进程的 argv 里出现标记，便于事后用 ps 断言。
      const marker = `mypi-pty-probe-${randomBytes(4).toString('hex')}`;
      const probeScript = join(tmpdir(), `${marker}.sh`);
      writeFileSync(probeScript, '#!/bin/bash\nsleep 300\necho done\n', { mode: 0o700 });

      const session = new PtySession({
        command: `bash ${probeScript}`,
        cwd: process.cwd(),
        env: process.env,
        cols: 80,
        rows: 24,
      });
      try {
        await session.start();
        expect(await waitUntil(() => processList().includes(marker))).toBe(true);
        await session.dispose();
        expect(await waitUntil(() => !processList().includes(marker), 3000)).toBe(true);
      } finally {
        await session.dispose();
        rmSync(probeScript, { force: true });
      }
    },
    20_000,
  );
});

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

/** 当前进程列表（`ps -eo args=`），用于断言某个标记进程确实存在/消失。 */
function processList(): string {
  return spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8' }).stdout ?? '';
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待条件超时（${timeoutMs}ms）`);
}
