/**
 * 跨功能接线：mode 的自愈重启请求必须活过 autopilot 的重启通知消费
 *
 * 背景（2026-10-06 实测故障）：`session_start` 阶段 mode 先写重启请求（`action='restart'`），
 * autopilot 随后消费重启通知时执行 `writeState({restartLog:null, action:'none'})`——`writeState`
 * 是"默认值 + 覆盖"，把同一轮刚写下的 `action` 一起抹掉；supervisor 读到 `action=none` 便不再
 * 重拉而是直接退出。用户看到的现象是"注入了一条系统已重启、进程却退出、模式也没换"。
 *
 * 这里的价值在于**同时注册两个真实 feature**（不是各自单测）：只有按真实的注册顺序把两个
 * `session_start` 钩子都跑一遍，才能锁住"谁在什么顺序下消费了什么"。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { setSessionMode } from '../logic';

type Handler = (event: unknown, ctx?: unknown) => unknown;

interface FakePi {
  hooks: Map<string, Handler[]>;
  sent: string[];
  [k: string]: unknown;
}

let dir: string;
const SESS = '/tmp/my-pi-mode-autopilot.jsonl';
const ENV_KEYS = ['PI_CODING_AGENT_DIR', 'PI_AGENT_MODE', 'PI_AGENT_MODE_SOURCE', 'PI_SESSION_MODE', 'PI_ADMIN_STATE_FILE'];
let savedEnv: Record<string, string | undefined>;

function makeFakePi(): FakePi {
  const hooks = new Map<string, Handler[]>();
  const sent: string[] = [];
  const api: Record<string, unknown> = {
    hooks,
    sent,
    on: (ev: string, h: Handler) => {
      const arr = hooks.get(ev) ?? [];
      arr.push(h);
      hooks.set(ev, arr);
    },
    registerTool: () => {},
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    registerToolRenderer: () => {},
    sendMessage: () => {},
    sendUserMessage: (content: unknown) => {
      sent.push(String(content));
    },
    appendEntry: () => {},
    setSessionName: () => {},
    getActiveTools: () => [],
    setActiveTools: () => {},
    getAllTools: () => [],
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
  // 兜底：autopilot 注册面很宽，未列出的 API 一律当空操作，避免为了一个接线测试去堆假实现。
  // 注意 then/catch/finally 必须返回 undefined：否则 `await setupBoth()` 会把假 pi 当 thenable，
  // 其 then 是空操作 → Promise 永不 resolve → 测试挂死（第一版就踩了这个坑）。
  return new Proxy(api, {
    get: (target, prop) => {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
      return prop in target ? target[prop as string] : () => {};
    },
  }) as unknown as FakePi;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'my-pi-mode-ap-'));
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'roleplay.md'), '人设占位\n');
  writeFileSync(
    join(dir, 'modes.json'),
    JSON.stringify({
      default: 'full',
      modes: {
        roleplay: {
          description: 'rp',
          features: ['web-search', 'memory'],
          thinking: 'low',
          appendPrompt: 'modes/roleplay.md',
          memoryNamespace: 'roleplay',
        },
      },
    }),
  );
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_ADMIN_STATE_FILE = join(dir, 'state.json');
  delete process.env.PI_AGENT_MODE;
  delete process.env.PI_AGENT_MODE_SOURCE;
  delete process.env.PI_SESSION_MODE;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(SESS, { force: true });
});

async function setupBoth(): Promise<FakePi> {
  vi.resetModules();
  const { register: registerMode } = await import('../index');
  const { register: registerAutopilot } = await import('../../autopilot/index');
  const pi = makeFakePi();
  // 顺序与 bootstrap 的 FEATURES 一致：mode 先注册（它的 session_start 先跑）
  registerMode(pi as unknown as ExtensionAPI);
  registerAutopilot(pi as unknown as ExtensionAPI);
  return pi;
}

function ctx() {
  const notify = vi.fn();
  return {
    hasUI: true,
    isIdle: () => true,
    ui: { notify, setStatus: () => {} },
    sessionManager: { getSessionFile: () => SESS },
    shutdown: vi.fn(),
  };
}

describe('mode 自愈 + autopilot 通知消费（同一 session_start 相位）', () => {
  it('autopilot 让位：请求仍是 restart、通知未被消费、通用通知不注入', async () => {
    setSessionMode(SESS, 'roleplay'); // 本会话应为 roleplay
    const pi = await setupBoth(); // 本进程 activeMode = full → 自愈分支
    const handlers = pi.hooks.get('session_start') ?? [];
    expect(handlers.length).toBeGreaterThanOrEqual(2); // mode + autopilot 都注册了

    const c = ctx();
    await handlers[0]({}, c); // mode：写自愈重启请求
    await handlers[1]({}, c); // autopilot：消费重启通知（旧实现在这里把 action 清成 none）

    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf-8'));
    expect(state.action).toBe('restart'); // supervisor 仍会重拉
    expect(state.targetSession).toBe(SESS);
    expect(state.restartLog).toMatchObject({ notice: 'mode', mode: 'roleplay', from: 'full' });
    // autopilot 不得注入自己的通用"系统已重启"（模式切换的通知由新模式进程按模式生成）
    expect(pi.sent.filter((s) => s.includes('系统已重启'))).toHaveLength(0);
  });

  it('非模式类重启仍走 autopilot 的通用通知（让位只针对 notice=mode）', async () => {
    const { writeRestartRequest } = await import('../../autopilot/logic');
    const pi = await setupBoth();
    const handlers = pi.hooks.get('session_start') ?? [];

    writeRestartRequest('restart', { targetSession: SESS, reason: '手动重启' });
    await handlers[1]({}, ctx()); // 只跑 autopilot 的消费端

    expect(pi.sent.some((s) => s.includes('系统已重启'))).toBe(true);
  });
});
