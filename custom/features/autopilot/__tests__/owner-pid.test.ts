import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeRestartRequest } from '../store/ops';

/**
 * ownerPid 的取值顺序（回归：BUG-REPLAYS 第 37 条）。
 *
 * 为什么需要这条测试：ownerPid 是「多实例共享 state.json 时只认自己的请求」的判据，
 * 它必须等于**本实例的身份**。原实现只取 `process.ppid`（"我的父进程就是拉起我的 supervisor"），
 * 这在 Linux 成立，但 **Windows/MSYS 下不成立** —— MSYS 每次启动 `.exe` 都新建一个短命
 * 中间进程，故 node 看到的父 PID 不是 supervisor 的 PID（实测同一 bash 内三次调用分别得到
 * 33600 / 22048 / 39220）。后果：supervisor 把**自家 pi** 的重启请求判为"别人的"而拒绝，
 * 主循环只跑一轮就退出且不报错。
 *
 * 修法：supervisor export `MY_PI_SUPERVISOR_PID`，pi **优先继承**它（父进程知道自己的身份，
 * 子进程继承 —— 与 PID 语义无关），取不到才回退 ppid。本文件把该顺序钉住。
 */
const origAgent = process.env.PI_CODING_AGENT_DIR;
const origState = process.env.PI_ADMIN_STATE_FILE;
const origPid = process.env.MY_PI_SUPERVISOR_PID;

afterEach(() => {
  for (const [k, v] of [
    ['PI_CODING_AGENT_DIR', origAgent],
    ['PI_ADMIN_STATE_FILE', origState],
    ['MY_PI_SUPERVISOR_PID', origPid],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** 在隔离目录里跑一次 writeRestartRequest，返回写出的 state。 */
function writeAndRead(envPid: string | undefined): {
  ownerPid?: number;
  restartLog?: { ownerPid?: number };
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownerpid-'));
  const state = path.join(dir, 'state.json');
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_ADMIN_STATE_FILE = state;
  if (envPid === undefined) delete process.env.MY_PI_SUPERVISOR_PID;
  else process.env.MY_PI_SUPERVISOR_PID = envPid;

  writeRestartRequest('restart', { targetSession: '/s.jsonl' });
  const parsed = JSON.parse(fs.readFileSync(state, 'utf-8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return parsed;
}

describe('writeRestartRequest 的 ownerPid 取值顺序', () => {
  it('有 MY_PI_SUPERVISOR_PID → 优先继承它（正解，跨平台可靠）', () => {
    const s = writeAndRead('777001');
    expect(s.ownerPid).toBe(777001);
    // restartLog 必须带同一个值：detect_lost_restart 靠它判"这一轮写下的请求是不是被吞了"
    expect(s.restartLog?.ownerPid).toBe(777001);
  });

  it('无该环境变量 → 回退 process.ppid（兼容旧启动方式）', () => {
    const s = writeAndRead(undefined);
    expect(s.ownerPid).toBe(process.ppid);
  });

  it('环境变量非法 → 回退 ppid，不得写入 NaN/0', () => {
    for (const bad of ['not-a-number', '', '0', '-5']) {
      const s = writeAndRead(bad);
      expect(s.ownerPid).toBe(process.ppid);
    }
  });
});
