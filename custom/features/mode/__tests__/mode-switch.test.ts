/**
 * mode 运行时状态分离 + /mode 切换接线测试
 *
 * 背景（用户实测报告）：`/mode roleplay` 后重启没生效。根因是"当前模式"被写进入库的
 * `modes.json`——任何 git 操作（checkout/stash/restore/pull，含另一台设备的版本）都会
 * 静默把它退回 `full`。现在 current 落在 gitignored 的 `modes-state.json`。
 *
 * 本测试锁三件事：
 *   1. 切模式**不碰** modes.json（回归防线：一旦回退，bug 就会重现）；
 *   2. 状态/配置的优先级与迁移兼容（旧的 modes.json.current 仍认）；
 *   3. `/mode <name>` 会提交重启请求并退出，而不是只提示用户手动重启。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  getCurrentMode,
  setCurrentMode,
  loadModes,
  loadModeState,
  modeStatePath,
  resolveEffectiveMode,
  isModeForcedByEnv,
} from '../logic';

type Handler = (event: unknown, ctx?: unknown) => unknown;

interface FakePi {
  commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
  hooks: Map<string, Handler[]>;
  [k: string]: unknown;
}

let dir: string;
const ENV_KEYS = ['PI_CODING_AGENT_DIR', 'PI_AGENT_MODE', 'PI_AGENT_MODE_SOURCE', 'PI_ADMIN_STATE_FILE'];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'my-pi-mode-'));
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'roleplay.md'), '人设占位\n');
  writeFileSync(
    join(dir, 'modes.json'),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_ADMIN_STATE_FILE = join(dir, 'state.json');
  delete process.env.PI_AGENT_MODE;
  delete process.env.PI_AGENT_MODE_SOURCE;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

const modesJson = (): string => readFileSync(join(dir, 'modes.json'), 'utf-8');

describe('运行时状态分离（current 不入库）', () => {
  it('无状态文件 → 回落到 default', () => {
    expect(getCurrentMode()).toBe('full');
    expect(loadModeState().current).toBeNull();
  });

  it('setCurrentMode 写 state 文件，且**完全不改动** modes.json', () => {
    const before = modesJson();
    setCurrentMode('roleplay');
    expect(loadModeState().current).toBe('roleplay');
    expect(getCurrentMode()).toBe('roleplay');
    expect(modesJson()).toBe(before); // 入库文件零改动 = 切模式不再让工作区变脏
    expect(existsSync(modeStatePath())).toBe(true);
  });

  it('旧格式（current 在 modes.json）仍被识别 —— 迁移兼容', () => {
    writeFileSync(
      join(dir, 'modes.json'),
      JSON.stringify({
        default: 'full',
        current: 'roleplay',
        modes: { roleplay: { description: 'rp', features: ['memory'], thinking: 'low' } },
      }),
    );
    expect(getCurrentMode()).toBe('roleplay');
  });

  it('旧格式的 current 指向未知模式 → 回落 default', () => {
    writeFileSync(join(dir, 'modes.json'), JSON.stringify({ default: 'full', current: '不存在的模式', modes: {} }));
    expect(getCurrentMode()).toBe('full');
  });

  it('状态文件里的模式名无效 → 回落 default（不崩、不锁定在坏值）', () => {
    setCurrentMode('roleplay');
    writeFileSync(modeStatePath(), JSON.stringify({ current: '不存在的模式' }));
    expect(getCurrentMode()).toBe('full');
  });

  it('status 文件损坏 → 回落 default', () => {
    writeFileSync(modeStatePath(), '{ not json');
    expect(getCurrentMode()).toBe('full');
  });

  it('loadModes 的内部模式名被锁定模式占位（文件里写 full 无效）', () => {
    writeFileSync(join(dir, 'modes.json'), JSON.stringify({ default: 'full', modes: { full: { features: [] } } }));
    expect(loadModes().modes.full.features).toEqual(['*']);
  });
});

describe('resolveEffectiveMode 的来源区分（热重载前提）', () => {
  it('外部注入 env（SOURCE 未设）→ env 优先', () => {
    setCurrentMode('full');
    process.env.PI_AGENT_MODE = 'roleplay';
    expect(resolveEffectiveMode()).toBe('roleplay');
  });

  it('SOURCE=env → env 优先', () => {
    setCurrentMode('full');
    process.env.PI_AGENT_MODE = 'roleplay';
    process.env.PI_AGENT_MODE_SOURCE = 'env';
    expect(resolveEffectiveMode()).toBe('roleplay');
    expect(isModeForcedByEnv()).toBe(true);
  });

  it('SOURCE=file（bootstrap 回写）→ 忽略 env，按磁盘状态（否则 /reload 永远切不动模式）', () => {
    setCurrentMode('roleplay');
    process.env.PI_AGENT_MODE = 'full'; // 上一次 bootstrap 的回写值
    process.env.PI_AGENT_MODE_SOURCE = 'file';
    expect(resolveEffectiveMode()).toBe('roleplay');
    expect(isModeForcedByEnv()).toBe(false);
  });
});

// ── 命令接线（假 pi）──

function makeFakePi(): FakePi {
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const hooks = new Map<string, Handler[]>();
  return {
    commands,
    hooks,
    registerTool: () => {},
    registerCommand: (name: string, opts: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
      commands.set(name, opts);
    },
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    on: (ev: string, h: Handler) => {
      const arr = hooks.get(ev) ?? [];
      arr.push(h);
      hooks.set(ev, arr);
    },
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    getActiveTools: () => [],
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
}

async function setup(): Promise<FakePi> {
  vi.resetModules();
  const { register } = await import('../index');
  const pi = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  return pi;
}

function cmdCtx(idle = true) {
  const notify = vi.fn();
  const shutdown = vi.fn();
  return {
    notify,
    shutdown,
    ctx: {
      hasUI: true,
      isIdle: () => idle,
      ui: { notify, setStatus: () => {} },
      sessionManager: { getSessionFile: () => '/tmp/sess.jsonl' },
      shutdown,
    },
  };
}

describe('/mode <name> 自动重启', () => {
  it('需要重启时提交 restart 请求（带会话续接）并退出，而不是只提示手动重启', async () => {
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.commands.get('mode')!.handler('roleplay', ctx);

    expect(shutdown).toHaveBeenCalledTimes(1);
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf-8'));
    expect(state.action).toBe('restart');
    expect(state.targetSession).toBe('/tmp/sess.jsonl');
    expect(state.reason).toContain('roleplay');
    expect(notify.mock.calls.some((c) => String(c[0]).includes('正在自动重启'))).toBe(true);
    // 状态已落盘，重启后 supervisor/bootstrap 据此生效
    expect(loadModeState().current).toBe('roleplay');
  });

  it('仅思考档位变化（full → 同功能集）不触发重启', async () => {
    const pi = await setup();
    const { ctx, shutdown } = cmdCtx();
    // full 是当前模式：切到 full 无任何变化
    await pi.commands.get('mode')!.handler('full', ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('响应进行中（非空闲）→ 不重启、不落盘、不产生半切换状态', async () => {
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx(false);
    await pi.commands.get('mode')!.handler('roleplay', ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(loadModeState().current).toBeNull(); // 状态未改：避免"配置已改但进程没重启"
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
    expect(notify.mock.calls.some((c) => String(c[0]).includes('响应正在进行中'))).toBe(true);
  });

  it('未知模式 → 报错且不写状态、不重启', async () => {
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.commands.get('mode')!.handler('nope', ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(loadModeState().current).toBeNull();
    expect(notify.mock.calls.some((c) => String(c[0]).includes('未知模式'))).toBe(true);
  });
});

describe('启动一致性校验（磁盘 vs 本进程）', () => {
  it('磁盘模式与本进程不一致 → 警告并给出修复命令', async () => {
    const pi = await setup(); // 此刻 activeMode = full
    setCurrentMode('roleplay'); // 模拟"注册后被改回退/被覆盖"
    const { ctx, notify } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);
    const warned = notify.mock.calls.find((c) => String(c[0]).includes('不一致'));
    expect(warned).toBeTruthy();
    expect(String(warned![0])).toContain('/mode roleplay');
  });

  it('一致时不产生告警', async () => {
    const pi = await setup();
    const { ctx, notify } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);
    expect(notify.mock.calls.some((c) => String(c[0]).includes('不一致'))).toBe(false);
  });

  it('env 强制模式下不告警（避免误报）', async () => {
    process.env.PI_AGENT_MODE = 'full';
    process.env.PI_AGENT_MODE_SOURCE = 'env';
    const pi = await setup();
    setCurrentMode('roleplay');
    const { ctx, notify } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);
    expect(notify.mock.calls.some((c) => String(c[0]).includes('不一致'))).toBe(false);
  });
});
