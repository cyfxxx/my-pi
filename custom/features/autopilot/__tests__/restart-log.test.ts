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
import { consumeRestartLog, readState, writeRestartRequest } from '../store/ops';

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

  it('消费一次即清空，避免重复注入', () => {
    writeRestartRequest('restart', { reason: '手动重启' });
    expect(consumeRestartLog()).not.toBeNull();
    expect(consumeRestartLog()).toBeNull();
    expect(readState().restartLog).toBeNull();
    expect(readState().action).toBe('none');
  });

  it('无重启记录时返回 null（普通启动不注入）', () => {
    expect(consumeRestartLog()).toBeNull();
  });
});
