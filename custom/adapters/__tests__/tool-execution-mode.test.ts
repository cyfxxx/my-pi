/**
 * 工具"并发语义"守门（2026-10-07）
 *
 * 背景：pi 的默认是**并行执行同一轮的多个工具调用**（`packages/agent/src/agent.ts`：
 * `runtimeOptions.toolExecution ?? "parallel"`），并提供逐个工具的退出开关 `executionMode: 'sequential'`。
 * pi 自己的工具（bash/edit/write）**一个都没声明**——文件类并发 pi 另有保护
 * （`core/tools/file-mutation-queue.ts` 按 realpath 排队），但 my-pi 的工具持有的是
 * **非文件的共享可变状态**，没有任何互斥：
 *
 *   · browser 18 个工具共享同一个 `BrowserManager`/page（`impl.ts` 无 queue/mutex/lock）；
 *   · autopilot 的重启/配置族写同一份状态（`admin_restart` / `admin_set_model` /
 *     `admin_switch_session` / `admin_set_config`）；
 *   · `todo` 是同一份待办列表（读-改-写，并发会丢更新）。
 *
 * 而 my-pi 的适配器原先**连字段都没转发**（只拷贝 name/label/description/parameters/execute），
 * 等于**静默声明"这些工具都并行安全"**。本守门锁三件事：
 *   ① 适配器必须透传 `executionMode`；
 *   ② 上列共享状态工具必须标 `sequential`（漏标即红）；
 *   ③ **快速只读/独立工具不得标 `sequential`**——pi 的判定粒度是整批（一批里有一个 sequential
 *      整批转串行），滥用会把并行能力整体关掉。反向断言防"一刀切全都标上"。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerTool } from '../tool-adapter';

interface Captured {
  name: string;
  executionMode?: string;
}

function capturingPi(sink: Captured[]): ExtensionAPI {
  return {
    registerTool: (t: Captured) => sink.push(t),
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    on: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  } as unknown as ExtensionAPI;
}

let tmpRoot = '';
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'my-pi-execmode-'));
  process.env.PI_MEMORY_DIR = join(tmpRoot, 'memory');
  process.env.PI_CODING_AGENT_DIR = join(tmpRoot, 'agent');
});
afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function captureFeature(path: string, exportName = 'register'): Promise<Map<string, Captured>> {
  const sink: Captured[] = [];
  const mod = (await import(path)) as Record<string, (pi: ExtensionAPI) => void>;
  const fn = mod[exportName];
  expect(typeof fn, `${path} 未导出 ${exportName}`).toBe('function');
  fn(capturingPi(sink));
  return new Map(sink.map((t) => [t.name, t]));
}

/** 必须串行的工具（共享可变状态、且无锁） */
const MUST_BE_SEQUENTIAL = [
  // autopilot：重启/配置族写同一份状态
  'admin_restart',
  'admin_set_model',
  'admin_switch_session',
  'admin_set_config',
  // 计划模式：同一份待办列表（读-改-写）+ 模式状态
  'todo',
  'plan_enter',
  'plan_exit',
  // tmux：同名会话的按键/命令交错会让日志无法归因
  'tmux_send',
  'tmux_run',
  'tmux_stop',
  // voice：单一音频设备，并发录制/转写互相踩
  'voice_record',
  'voice_transcribe',
  'voice_speak',
  // link：出站消息顺序
  'link_send',
  // schedule_task：未加锁的共享 RMW（tasks.json）
  'schedule_task',
];

/** 明确**不得**串行的工具（独立/快速只读；标了会把整批拖成串行） */
const MUST_STAY_PARALLEL = [
  'memory_search',
  'memory_stats',
  'admin_get_config',
  'admin_list_models',
  'ask_user',
  // 审计结论：memory/ctx 的读-改-写**整体在 withFileLock 内**（memory/store/io.ts），
  // 数据完整性有保护，只剩批内顺序语义 → 保持并行（它们是热路径，串行化要付整批降级的代价）。
  // 注意 io.ts 的已知取舍：拿不到锁时告警后按无锁继续（防死锁）。这是既有决定，不是本次疏漏。
  'memory_store',
  'memory_forget',
  'ctx_note',
  'ctx_snap',
];

describe('① 适配器必须透传 executionMode', () => {
  it('declared 的 sequential 会传给 pi；未声明的保持不传（让 pi 用默认 parallel）', () => {
    const sink: Captured[] = [];
    registerTool(capturingPi(sink), {
      name: 'probe_seq',
      description: '探针',
      parameters: {},
      executionMode: 'sequential',
      execute: async () => 'ok',
    });
    registerTool(capturingPi(sink), {
      name: 'probe_plain',
      description: '探针',
      parameters: {},
      execute: async () => 'ok',
    });
    expect(sink[0].executionMode).toBe('sequential');
    expect('executionMode' in sink[1]).toBe(false);
  });
});

describe('② browser 全部 18 个工具都是 sequential', () => {
  it('共享同一个 page，且 impl.ts 里没有任何互斥', async () => {
    const tools = await captureFeature('../../features/browser/index');
    const browserTools = [...tools.values()].filter((t) => t.name.startsWith('browser_'));
    expect(browserTools.length, '没抓到 browser 工具（注册面变了？）').toBe(18);
    const notSeq = browserTools.filter((t) => t.executionMode !== 'sequential').map((t) => t.name);
    expect(notSeq, `这些 browser 工具没标 sequential，会在同一页面上并发互踩：${notSeq.join(', ')}`).toEqual([]);
  });
});

describe('③ 共享状态工具必须 sequential，独立只读工具不得 sequential', () => {
  it('autopilot 的重启/配置族 + todo 都标了 sequential', async () => {
    const auto = await captureFeature('../../features/autopilot/index');
    const admin = await captureFeature('../../features/autopilot/tools/admin-tools', 'registerAdminTools');
    const plan = await captureFeature('../../features/plan-mode/index');
    const tmux = await captureFeature('../../features/tmux/index');
    const voice = await captureFeature('../../features/voice/index');
    const link = await captureFeature('../../features/link/index');
    const sched = await captureFeature('../../features/autopilot/tools/schedule-tool', 'registerScheduleTool');
    const all = new Map([...auto, ...admin, ...plan, ...tmux, ...voice, ...link, ...sched]);
    const missing = MUST_BE_SEQUENTIAL.filter((n) => all.get(n)?.executionMode !== 'sequential');
    expect(missing, `这些共享状态工具漏标 sequential：${missing.join(', ')}`).toEqual([]);
  });

  it('独立/只读工具**不得**标 sequential（pi 按整批降级，滥用会关掉并行）', async () => {
    const mem = await captureFeature('../../features/memory/index');
    const web = await captureFeature('../../features/web-search/index');
    const admin = await captureFeature('../../features/autopilot/tools/admin-tools', 'registerAdminTools');
    const plan = await captureFeature('../../features/plan-mode/index');
    const all = new Map([...mem, ...web, ...admin, ...plan]);
    const overMarked = MUST_STAY_PARALLEL.filter((n) => all.get(n)?.executionMode === 'sequential');
    expect(overMarked, `这些工具不该串行，标了会把整批拖慢：${overMarked.join(', ')}`).toEqual([]);
  });
});
