/**
 * mode 会话作用域 + /mode 切换接线测试
 *
 * 演进（每一步都是真实故障驱动的）：
 *   1. 背景一：`/mode roleplay` 后重启没生效——根因是"当前模式"被写进入库的 `modes.json`，
 *      任何 git 操作都会静默把它退回 `full`。→ 状态移到 gitignored 文件。
 *   2. 背景二（2026-10-06）：模式是**每台机器的全局选择**，于是新会话/别的会话都继承同一个值。
 *      现在改成**会话属性**：新会话用 `modes.json` 的 default，续接会话用它自己记录的模式
 *      （`modes-sessions.json`），`/mode` 只影响当前会话。
 *   3. 背景三（同批实测）：bootstrap 的来源判据只看 `PI_AGENT_MODE` 非空，第二次工厂执行
 *      （/reload、/new、会话切换都会重跑工厂）把 SOURCE 从 file 翻成 env，第三次起把**第一次**
 *      的值当外部注入钉死。实测：磁盘改 minimal 后第 2 轮正确、第 3 轮起又变回 full。
 *
 * 本测试锁四件事：
 *   1. 会话记录读写/裁剪/坏值回落，且切换**不碰** modes.json（回归防线）；
 *   2. resolveEffectiveMode / resolveStartupMode 的来源优先级与"多轮工厂执行不漂移"；
 *   3. `/mode <name>` 记录到当前会话并提交重启请求，而不是只提示用户手动重启；
 *   4. session_start 按**本会话**应有的模式自愈（不一致→重启一次；重启无效→改为告警，不循环）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  getDefaultMode,
  getSessionMode,
  setSessionMode,
  loadModes,
  resolveEffectiveMode,
  resolveStartupMode,
  shouldRequestModeRestart,
  isModeForcedByEnv,
  MODE_NOTICE_TTL_MS,
} from '../logic';

type Handler = (event: unknown, ctx?: unknown) => unknown;

interface FakePi {
  commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
  hooks: Map<string, Handler[]>;
  [k: string]: unknown;
}

let dir: string;
const SESS = '/tmp/my-pi-mode-test-sess.jsonl';
const ENV_KEYS = [
  'PI_CODING_AGENT_DIR',
  'PI_AGENT_MODE',
  'PI_AGENT_MODE_SOURCE',
  'PI_SESSION_MODE',
  'PI_ADMIN_STATE_FILE',
];
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

const modesJson = (): string => readFileSync(join(dir, 'modes.json'), 'utf-8');
const sessionsFile = (): string => join(dir, 'modes-sessions.json');
const statePath = (): string => join(dir, 'state.json');
const sentOf = (pi: FakePi): string[] => pi.sent as string[];

/** 复刻 pi-supervisor.sh 的 clear_admin_action：只清 action/timestamp，保留 restartLog */
function clearAction(): void {
  const s = JSON.parse(readFileSync(statePath(), 'utf-8'));
  s.action = 'none';
  s.timestamp = 0;
  writeFileSync(statePath(), JSON.stringify(s));
}

describe('会话模式记录（current 不入库、按会话隔离）', () => {
  it('没有记录 → 回落 default；default 来自 modes.json', () => {
    expect(getDefaultMode()).toBe('full');
    expect(getSessionMode(SESS)).toBeNull();
  });

  it('setSessionMode 只写会话记录文件，且**完全不改动** modes.json', () => {
    const before = modesJson();
    setSessionMode(SESS, 'roleplay');
    expect(getSessionMode(SESS)).toBe('roleplay');
    expect(modesJson()).toBe(before); // 入库文件零改动 = 切模式不再让工作区变脏
    expect(existsSync(sessionsFile())).toBe(true);
  });

  it('两个会话互不影响（A 的切换不会改到 B）', () => {
    setSessionMode('/tmp/a.jsonl', 'roleplay');
    expect(getSessionMode('/tmp/a.jsonl')).toBe('roleplay');
    expect(getSessionMode('/tmp/b.jsonl')).toBeNull();
  });

  it('记录里的模式名无效（配置里已删）→ 视为没有记录', () => {
    writeFileSync(sessionsFile(), JSON.stringify({ [SESS]: { mode: 'nope', updatedAt: '' } }));
    expect(getSessionMode(SESS)).toBeNull();
  });

  it('记录文件损坏 / 值类型不对 → 不崩，视为没有记录', () => {
    writeFileSync(sessionsFile(), '{ not json');
    expect(getSessionMode(SESS)).toBeNull();
    writeFileSync(sessionsFile(), JSON.stringify({ [SESS]: 'roleplay' }));
    expect(getSessionMode(SESS)).toBeNull();
  });

  it('没有会话文件（--no-session / 内存会话）→ 永远视为没有记录', () => {
    expect(getSessionMode(undefined)).toBeNull();
    expect(getSessionMode(null)).toBeNull();
  });

  it('保留期外的孤儿记录会被裁掉，刚写入的记录不受影响', () => {
    // 一个早已不存在的会话（时间戳远超保留期）+ 一个刚写的当前会话
    const stale = { mode: 'roleplay', updatedAt: '2020-01-01T00:00:00.000Z' };
    writeFileSync(sessionsFile(), JSON.stringify({ '/tmp/gone.jsonl': stale }));
    setSessionMode(SESS, 'roleplay');
    const all = JSON.parse(readFileSync(sessionsFile(), 'utf-8'));
    expect(all['/tmp/gone.jsonl']).toBeUndefined();
    expect(all[SESS].mode).toBe('roleplay');
  });

  it('loadModes 的内部模式名被锁定模式占位（文件里写 full 无效）', () => {
    writeFileSync(join(dir, 'modes.json'), JSON.stringify({ default: 'full', modes: { full: { features: [] } } }));
    expect(loadModes().modes.full.features).toEqual(['*']);
  });
});

describe('resolveEffectiveMode 的来源优先级', () => {
  it('外部注入 env（SOURCE 未设）→ env 优先', () => {
    process.env.PI_AGENT_MODE = 'roleplay';
    expect(resolveEffectiveMode()).toBe('roleplay');
  });

  it('SOURCE=env → env 优先，且标记为外部强制', () => {
    process.env.PI_AGENT_MODE = 'roleplay';
    process.env.PI_AGENT_MODE_SOURCE = 'env';
    expect(resolveEffectiveMode()).toBe('roleplay');
    expect(isModeForcedByEnv()).toBe(true);
  });

  it('SOURCE=file（bootstrap 回写）→ 忽略 env，按软来源/default 解析', () => {
    process.env.PI_AGENT_MODE = 'full'; // 上一次 bootstrap 的回写值
    process.env.PI_AGENT_MODE_SOURCE = 'file';
    expect(resolveEffectiveMode()).toBe('full'); // default，而不是被 env 钉死
    expect(isModeForcedByEnv()).toBe(false);
    process.env.PI_SESSION_MODE = 'roleplay'; // 启动器按会话解析出的软来源
    expect(resolveEffectiveMode()).toBe('roleplay');
  });

  it('软来源（PI_SESSION_MODE）必须是已知模式，否则回落 default', () => {
    process.env.PI_SESSION_MODE = 'does-not-exist';
    expect(resolveEffectiveMode()).toBe('full');
  });
});

describe('resolveStartupMode：多轮工厂执行不漂移（2026-10-06 实测回归）', () => {
  it('第 2/3 轮跟随会话模式，SOURCE 不被翻成 env（旧代码第 3 轮起钉死在首轮值）', () => {
    // 第 1 轮：全新进程，无 env / 无会话软来源 → default，并回写 PI_AGENT_MODE + SOURCE=file
    expect(resolveStartupMode()).toBe('full');
    expect(process.env.PI_AGENT_MODE_SOURCE).toBe('file');
    expect(process.env.PI_AGENT_MODE).toBe('full');

    // 用户切到 roleplay（会话记录 + 启动器注入软来源）
    setSessionMode(SESS, 'roleplay');
    process.env.PI_SESSION_MODE = 'roleplay';

    // 第 2 轮（/reload 或 /new 会重跑工厂）
    expect(resolveStartupMode()).toBe('roleplay');
    expect(process.env.PI_AGENT_MODE_SOURCE).toBe('file'); // 关键：不再翻成 env
    expect(process.env.PI_AGENT_MODE).toBe('roleplay');

    // 第 3 轮：旧代码在这里把第 1 轮的 full 当外部注入返回 → 现在仍是 roleplay
    expect(resolveStartupMode()).toBe('roleplay');
    expect(process.env.PI_AGENT_MODE).toBe('roleplay');
  });

  it('外部注入的硬覆盖在每轮都保持 env 来源（不被降级成回写值）', () => {
    process.env.PI_AGENT_MODE = 'roleplay';
    process.env.PI_AGENT_MODE_SOURCE = 'env';
    expect(resolveStartupMode()).toBe('roleplay');
    expect(process.env.PI_AGENT_MODE_SOURCE).toBe('env');
    expect(resolveStartupMode()).toBe('roleplay');
    expect(isModeForcedByEnv()).toBe(true);
  });
});

describe('自愈重启防环', () => {
  it('同一（会话, 模式）首次放行、窗口内第二次拦截', () => {
    expect(shouldRequestModeRestart(SESS, 'roleplay')).toBe(true);
    expect(shouldRequestModeRestart(SESS, 'roleplay')).toBe(false);
  });

  it('换会话或换模式是新的键 → 重新放行', () => {
    expect(shouldRequestModeRestart(SESS, 'roleplay')).toBe(true);
    expect(shouldRequestModeRestart(SESS, 'lean')).toBe(true);
    expect(shouldRequestModeRestart('/tmp/other.jsonl', 'roleplay')).toBe(true);
  });
});

// ── 命令接线（假 pi）──

function makeFakePi(): FakePi {
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const hooks = new Map<string, Handler[]>();
  const sent: string[] = [];
  return {
    commands,
    hooks,
    sent,
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
    sendUserMessage: (content: unknown) => {
      sent.push(String(content));
    },
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

function cmdCtx(idle = true, sessionFile: string | null = SESS) {
  const notify = vi.fn();
  const shutdown = vi.fn();
  return {
    notify,
    shutdown,
    ctx: {
      hasUI: true,
      isIdle: () => idle,
      ui: { notify, setStatus: () => {} },
      sessionManager: { getSessionFile: () => sessionFile ?? undefined },
      shutdown,
    },
  };
}

describe('/mode <name> 记录到当前会话 + 自动重启', () => {
  it('需要重启时写会话记录 + 提交 restart 请求（带会话续接）并退出', async () => {
    const pi = await setup();
    const before = modesJson();
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.commands.get('mode')!.handler('roleplay', ctx);

    expect(shutdown).toHaveBeenCalledTimes(1);
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf-8'));
    expect(state.action).toBe('restart');
    expect(state.targetSession).toBe(SESS);
    expect(state.reason).toContain('roleplay');
    expect(notify.mock.calls.some((c) => String(c[0]).includes('正在自动重启'))).toBe(true);
    // 记录已落盘（且只在会话表里），重启后 bash/pi 两侧据此生效
    expect(getSessionMode(SESS)).toBe('roleplay');
    expect(modesJson()).toBe(before); // 入库的 modes.json 零改动
  });

  it('切换只影响当前会话：另一个会话仍回落 default', async () => {
    const pi = await setup();
    await pi.commands.get('mode')!.handler('roleplay', cmdCtx().ctx);
    expect(getSessionMode(SESS)).toBe('roleplay');
    expect(getSessionMode('/tmp/another.jsonl')).toBeNull();
    expect(getDefaultMode()).toBe('full');
  });

  it('仅思考档位变化（full → 同功能集）不触发重启，但记录仍写入', async () => {
    const pi = await setup();
    const { ctx, shutdown } = cmdCtx();
    await pi.commands.get('mode')!.handler('full', ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
    expect(getSessionMode(SESS)).toBe('full');
  });

  it('响应进行中（非空闲）→ 不重启、不落盘、不产生半切换状态', async () => {
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx(false);
    await pi.commands.get('mode')!.handler('roleplay', ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(getSessionMode(SESS)).toBeNull(); // 未记录：避免"配置已改但进程没重启"
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
    expect(notify.mock.calls.some((c) => String(c[0]).includes('响应正在进行中'))).toBe(true);
  });

  it('未知模式 → 报错且不写记录、不重启', async () => {
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.commands.get('mode')!.handler('nope', ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(getSessionMode(SESS)).toBeNull();
    expect(notify.mock.calls.some((c) => String(c[0]).includes('未知模式'))).toBe(true);
  });

  it('重启请求写盘失败 → 不退出进程，明确告警（防止"静默退出、模式也没换"）', async () => {
    const pi = await setup();
    mkdirSync(statePath(), { recursive: true }); // 目标路径是目录 → 原子写的 rename 会失败
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.commands.get('mode')!.handler('roleplay', ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(notify.mock.calls.some((c) => String(c[0]).includes('写盘失败'))).toBe(true);
  });

  it('会话不落盘（--no-session）→ 不重启、不写记录，并说明限制', async () => {
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx(true, null);
    await pi.commands.get('mode')!.handler('roleplay', ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(existsSync(sessionsFile())).toBe(false);
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
    expect(notify.mock.calls.some((c) => String(c[0]).includes('不落盘'))).toBe(true);
  });
});

describe('session_start 按会话自愈（模式是会话属性）', () => {
  it('本会话记录 roleplay、进程却是 full → 自动重启并续接该会话', async () => {
    setSessionMode(SESS, 'roleplay');
    const pi = await setup(); // 此刻 activeMode = full（没有软来源）
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);
    expect(shutdown).toHaveBeenCalledTimes(1);
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf-8'));
    expect(state.action).toBe('restart');
    expect(state.targetSession).toBe(SESS);
    expect(state.reason).toContain('自愈');
    expect(notify.mock.calls.some((c) => String(c[0]).includes('自动重启'))).toBe(true);
  });

  it('刚重启过仍不一致 → 不再重启，改为告警（防死循环）', async () => {
    setSessionMode(SESS, 'roleplay');
    expect(shouldRequestModeRestart(SESS, 'roleplay')).toBe(true); // 模拟上一次自愈已发生
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(notify.mock.calls.some((c) => String(c[0]).includes('仍未生效'))).toBe(true);
  });

  it('新会话（无记录）用 default：进程已是 full 时不重启', async () => {
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(notify.mock.calls.some((c) => String(c[0]).includes('自动重启'))).toBe(false);
  });

  it('进程模式来自软来源且与会话记录一致 → 不重启', async () => {
    setSessionMode(SESS, 'roleplay');
    process.env.PI_SESSION_MODE = 'roleplay';
    const pi = await setup(); // activeMode = roleplay
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(notify.mock.calls.some((c) => String(c[0]).includes('roleplay'))).toBe(true);
  });

  it('外部硬覆盖（source=env）不触发自愈（避免误报）', async () => {
    process.env.PI_AGENT_MODE = 'full';
    process.env.PI_AGENT_MODE_SOURCE = 'env';
    setSessionMode(SESS, 'roleplay');
    const pi = await setup();
    const { ctx, notify, shutdown } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);
    expect(shutdown).not.toHaveBeenCalled();
    expect(notify.mock.calls.some((c) => String(c[0]).includes('自动重启'))).toBe(false);
  });

  it('无 UI（headless）→ 不重启，只留下告警', async () => {
    setSessionMode(SESS, 'roleplay');
    const pi = await setup();
    const { ctx, shutdown } = cmdCtx();
    const noUi = { ...ctx, hasUI: false };
    await pi.hooks.get('session_start')![0]({}, noUi);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('会话不落盘（--no-session）且模式不一致 → 不重启（没有可精确续接的目标）', async () => {
    // 构造不一致：进程按 roleplay 启动（软来源），会话却无文件 → intended=default≠activeMode
    process.env.PI_SESSION_MODE = 'roleplay';
    const pi = await setup();
    const { ctx, shutdown } = cmdCtx(true, null);
    await pi.hooks.get('session_start')![0]({}, ctx);
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe('模式切换后的注入通知（由新模式进程生成）', () => {
  it('重启请求带 mode 归属，且写入端**不消费**它（留给新模式进程）', async () => {
    setSessionMode(SESS, 'roleplay');
    const pi = await setup(); // 旧进程：full
    const { ctx } = cmdCtx();
    await pi.hooks.get('session_start')![0]({}, ctx);

    const state = JSON.parse(readFileSync(statePath(), 'utf-8'));
    expect(state.action).toBe('restart'); // 请求仍在：不会被"通知消费"顺手取消
    expect(state.restartLog).toMatchObject({
      action: 'restart',
      notice: 'mode',
      mode: 'roleplay',
      from: 'full',
      targetSession: SESS,
    });
    expect(sentOf(pi)).toHaveLength(0); // 旧进程（旧档位）不注入任何通知
  });

  it('新模式进程注入一次，内容是模式信息而不是内部状态', async () => {
    setSessionMode(SESS, 'roleplay');
    const fullPi = await setup();
    await fullPi.hooks.get('session_start')![0]({}, cmdCtx().ctx); // 旧进程写下请求
    clearAction(); // supervisor 消费

    process.env.PI_SESSION_MODE = 'roleplay';
    const rpPi = await setup(); // 新进程：roleplay
    const { ctx } = cmdCtx();
    await rpPi.hooks.get('session_start')![0]({}, ctx);

    const sent = sentOf(rpPi);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('已切换：full → roleplay');
    expect(sent[0]).toContain('启用功能: web-search、memory');
    expect(sent[0]).toContain('思考档位 low');
    expect(sent[0]).toContain('人设已注入');
    expect(sent[0]).toContain('记忆命名空间 roleplay');
    expect(sent[0]).toContain('不要向用户复述');
    // 内部措辞与会话路径不能进模型上下文
    expect(sent[0]).not.toContain('进程原为');
    expect(sent[0]).not.toContain(SESS);
    expect(sent[0]).not.toContain('自愈');

    // 同进程再来一次 session_start（/reload 等）不重复注入
    await rpPi.hooks.get('session_start')![0]({}, ctx);
    expect(sentOf(rpPi)).toHaveLength(1);
  });

  it('通知属别的会话 → 不注入也不消费（留给那个会话的进程）', async () => {
    const other = '/tmp/my-pi-mode-other.jsonl';
    setSessionMode(other, 'roleplay');
    setSessionMode(SESS, 'roleplay'); // 本会话也在 roleplay：新进程不会触发自愈，才能看清"不消费"
    const fullPi = await setup();
    const otherCtx = cmdCtx(true, other).ctx;
    await fullPi.hooks.get('session_start')![0]({}, otherCtx); // 为**别的**会话写下请求
    clearAction();

    process.env.PI_SESSION_MODE = 'roleplay';
    const rpPi = await setup();
    await rpPi.hooks.get('session_start')![0]({}, cmdCtx().ctx); // 本会话是 SESS
    expect(sentOf(rpPi)).toHaveLength(0);
    const state = JSON.parse(readFileSync(statePath(), 'utf-8'));
    expect(state.restartLog?.targetSession).toBe(other); // 原样留着
  });

  it('过期通知（重启没落成）→ 丢弃且不再注入', async () => {
    setSessionMode(SESS, 'roleplay');
    const fullPi = await setup();
    await fullPi.hooks.get('session_start')![0]({}, cmdCtx().ctx);
    clearAction();
    const s = JSON.parse(readFileSync(statePath(), 'utf-8'));
    s.restartLog.timestamp = Date.now() - MODE_NOTICE_TTL_MS - 1000;
    writeFileSync(statePath(), JSON.stringify(s));

    process.env.PI_SESSION_MODE = 'roleplay';
    const rpPi = await setup();
    await rpPi.hooks.get('session_start')![0]({}, cmdCtx().ctx);
    expect(sentOf(rpPi)).toHaveLength(0);
    expect(JSON.parse(readFileSync(statePath(), 'utf-8')).restartLog).toBeNull();
  });

  it('本进程与会话记录不一致时不消费通知（留给真正切成功的那一轮）', async () => {
    setSessionMode(SESS, 'roleplay');
    const fullPi = await setup(); // 旧进程：full
    const c = cmdCtx().ctx;
    await fullPi.hooks.get('session_start')![0]({}, c); // 写下自愈请求（并占住防环标记）
    clearAction();
    // 同一进程再走一次 session_start：仍在旧档位 + 防环窗口内 → 只告警
    await fullPi.hooks.get('session_start')![0]({}, cmdCtx().ctx);
    expect(JSON.parse(readFileSync(statePath(), 'utf-8')).restartLog.notice).toBe('mode'); // 日志没被消费掉
    expect(sentOf(fullPi)).toHaveLength(0);
  });

  it('没有重启记录时普通启动不注入（新会话不该收到切换通知）', async () => {
    const pi = await setup();
    await pi.hooks.get('session_start')![0]({}, cmdCtx().ctx);
    expect(sentOf(pi)).toHaveLength(0);
  });
});
