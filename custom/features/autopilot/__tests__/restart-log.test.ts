/**
 * 重启恢复通知的跨进程契约测试
 *
 * 背景（2026-09-26 修复）：`admin_restart` / watchdog 写 `restartLog` 后由
 * `scripts/pi-supervisor.sh` 以 `--session` 重拉会话；supervisor 只清 `action`
 * 而**保留** `restartLog`，供新进程的 `session_start` 用 `consumeRestartLog()`
 * 生成"系统已重启"注入。此前 my-pi 只实现了写入端，没有消费端，表现为
 * "重启后没有任何自动注入的信息"。
 *
 * 本测试锁定三段契约：
 *   1. writeRestartRequest 写入 action + restartLog；
 *   2. supervisor 式清除（action=none、timestamp=0、restartLog 保留）后仍可消费；
 *   3. 消费一次即清空，避免重复注入。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { consumeRestartLog, isModeOwnedNotice, readState, writeRestartRequest } from '../store/ops';

let agentDir: string;
let statePath: string;
const origAgent = process.env.PI_CODING_AGENT_DIR;
const origState = process.env.PI_ADMIN_STATE_FILE;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'my-pi-restart-log-'));
  statePath = join(agentDir, 'state.json');
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_ADMIN_STATE_FILE = statePath;
});

afterEach(() => {
  if (origAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = origAgent;
  if (origState === undefined) delete process.env.PI_ADMIN_STATE_FILE;
  else process.env.PI_ADMIN_STATE_FILE = origState;
  rmSync(agentDir, { recursive: true, force: true });
});

function readStateFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
}

describe('restartLog 消费端契约', () => {
  it('写入重启请求后 action 与 restartLog 同时落盘', () => {
    writeRestartRequest('restart', { targetSession: '/s/cur.jsonl', reason: '手动重启' });
    const state = readStateFile();
    expect(state.action).toBe('restart');
    expect(state.targetSession).toBe('/s/cur.jsonl');
    expect(state.restartLog).toMatchObject({
      action: 'restart',
      targetSession: '/s/cur.jsonl',
      reason: '手动重启',
    });
  });

  it('supervisor 清 action（保留 restartLog）后仍能消费到重启信息', () => {
    writeRestartRequest('restart_hang', { targetSession: '/s/cur.jsonl', reason: '看门狗恢复' });
    // 复刻 pi-supervisor.sh 的 clear_admin_action：只置 action/timestamp，保留 restartLog
    const s = JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    s.action = 'none';
    s.timestamp = 0;
    writeFileSync(statePath, JSON.stringify(s));

    const log = consumeRestartLog();
    expect(log).not.toBeNull();
    expect(log?.action).toBe('restart_hang');
    expect(log?.reason).toBe('看门狗恢复');
    expect(log?.targetSession).toBe('/s/cur.jsonl');
  });

  it('消费一次即清空 restartLog，但**不动 action**（action 的消费者只有 supervisor）', () => {
    writeRestartRequest('restart', { reason: '手动重启' });
    expect(consumeRestartLog()).not.toBeNull();
    expect(consumeRestartLog()).toBeNull();
    expect(readState().restartLog).toBeNull();
    // 回归（2026-10-06 实测）：旧实现写 `writeState({restartLog:null, action:'none'})`，
    // 而 session_start 里 mode 的自愈重启是"先写请求、autopilot 随后消费通知"，
    // 于是这次重启被通知消费顺手取消：supervisor 读到 action=none 直接退出，
    // 用户看到"注入了一条系统已重启，进程却退出了，模式也没换"。
    expect(readState().action).toBe('restart');
    expect(readState().reason).toBe('手动重启');
  });

  it('mode 自愈写下的重启请求不会被通知消费吞掉（回归：action/字段全保留）', () => {
    writeRestartRequest('restart', {
      targetSession: '/s/rp.jsonl',
      reason: '按会话模式自愈：本会话应为 roleplay，进程原为 full',
      notice: 'mode',
      mode: 'roleplay',
      from: 'full',
    });
    const log = consumeRestartLog();
    expect(log?.notice).toBe('mode');
    const state = readState();
    expect(state.action).toBe('restart');
    expect(state.targetSession).toBe('/s/rp.jsonl');
    expect(state.notice).toBe('mode');
    expect(state.mode).toBe('roleplay');
    expect(state.from).toBe('full');
    expect(state.restartLog).toBeNull();
  });

  it('无重启记录时返回 null（普通启动不注入）', () => {
    expect(consumeRestartLog()).toBeNull();
  });
});

describe('mode 归属的通知让位给 mode 功能', () => {
  it('notice=mode → autopilot 不注入（模式切换的通知只有 mode 写得对）', () => {
    expect(isModeOwnedNotice({ action: 'restart', notice: 'mode' })).toBe(true);
    expect(isModeOwnedNotice({ action: 'restart' })).toBe(false);
    expect(isModeOwnedNotice({ action: 'restart', notice: 'other' })).toBe(false);
    expect(isModeOwnedNotice(null)).toBe(false);
    expect(isModeOwnedNotice(undefined)).toBe(false);
  });
});

// ── 跨 TS/bash 边界：真 supervisor 必须仍读得到这次重启 ──

/** 用真实 scripts/pi-supervisor.sh 的 read_admin_action 读一次状态（跨进程、跨语言） */
function supervisorDecision(): { act: string; target: string } {
  const script = [
    `MY_PI_SUPERVISOR_LIB=1 source ${JSON.stringify(join(process.cwd(), 'scripts/pi-supervisor.sh'))} >/dev/null 2>&1`,
    'read_admin_action',
    `printf '%s|%s' "$ACT" "$TARGET"`,
  ].join('; ');
  const out = execFileSync('bash', ['-c', script], {
    env: { ...process.env, PI_ADMIN_STATE_FILE: statePath },
    encoding: 'utf-8',
  });
  const [act = '', target = ''] = out.split('|');
  return { act, target };
}

describe('通知消费后的 supervisor 契约（回归：action 不能被代清）', () => {
  it('mode 写请求 + autopilot 消费通知之后，supervisor 仍读到 restart + 目标会话', () => {
    writeRestartRequest('restart', {
      targetSession: '/s/rp.jsonl',
      reason: '按会话模式自愈：本会话应为 roleplay，进程原为 full',
      notice: 'mode',
      mode: 'roleplay',
      from: 'full',
    });
    consumeRestartLog(); // 这一步在旧实现里把 action 清成了 none → supervisor 直接退出
    const { act, target } = supervisorDecision();
    expect(act).toBe('restart');
    expect(target).toBe('/s/rp.jsonl');
  });
});
