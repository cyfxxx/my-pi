/**
 * 工具面体积守门（P4 台账「启动期按模式收窄工具面」第一批交付）
 *
 * 背景：`tools` 是请求前缀里**最大的构件**——`daily-health` 实测 payload `toolsBytes` = 62.4 KB
 * （≈15.6K token，同模型下 DSH 只有其 1/2.3）。这 62.4 KB 里：
 *   · 本仓库 12 个功能注册的 **62 个工具 = 29.2 KB**（本守门度量的部分）
 *   · 其余约 33 KB 是 pi 内置工具（bash/read/write/edit/grep/find/ls 等，不在本仓库控制内）
 * 体积直接等于每一次 epoch 的前缀成本，且任何"悄悄加一个参数/写长一段描述"都会抬高它——
 * 故按 VISION §3.2（硬优先）落成守门，而不是靠 review 时肉眼估计。
 *
 * 相关的启动期收窄手段（缓存安全，只发生在进程启动时）：
 *   1. 模式白名单：`modes.json` 的 `features` 决定哪些功能被注册（未注册 = 0 字节）；
 *   2. pi 原生 `--tools/-t` 启动白名单（`vendor/pi/.../cli/args.ts:147`）。
 * 本守门只锁"不许无声膨胀"；是否默认收窄见 `DECISIONS.md` 与 `docs/design/UPGRADE-LEDGER.md`。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** 我们的扩展工具总量上限（2026-10-01 实测 29 212 B；留 ~10% 余量） */
const TOOLS_PAYLOAD_MAX_BYTES = 32_000;
/** 单个工具上限（当前最大 schedule_task 1 711 B） */
const SINGLE_TOOL_MAX_BYTES = 2_048;
/** 工具数量上限（当前 62） */
const TOOL_COUNT_MAX = 66;

interface Captured {
  name: string;
  description?: string;
  parameters?: unknown;
  feature: string;
}

function makeFakePi(sink: Captured[], feature: string): unknown {
  return {
    registerTool: (t: { name: string; description?: string; parameters?: unknown }) =>
      sink.push({ ...t, feature }),
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
  };
}

const FEATURES: Array<[string, () => Promise<{ register: (pi: ExtensionAPI) => void }>]> = [
  ['web-search', () => import('../../web-search/index')],
  ['context', () => import('../../context/index')],
  ['link', () => import('../../link/index')],
  ['memory', () => import('../../memory/index')],
  ['mode', () => import('../../mode/index')],
  ['plan-mode', () => import('../../plan-mode/index')],
  ['intervention', () => import('../../intervention/index')],
  ['subagent', () => import('../../subagent/index')],
  ['tmux', () => import('../../tmux/index')],
  ['browser', () => import('../../browser/index')],
  ['voice', () => import('../../voice/index')],
  ['autopilot', () => import('../../autopilot/index')],
];

async function captureAll(): Promise<Captured[]> {
  const out: Captured[] = [];
  for (const [name, load] of FEATURES) {
    const mod = await load();
    mod.register(makeFakePi(out, name) as unknown as ExtensionAPI);
  }
  return out;
}

function bytesOf(t: Captured): number {
  return Buffer.byteLength(
    JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }),
    'utf-8',
  );
}

// 本守门会注册**全部**功能：必须把运行时目录指向临时目录，否则未来某个功能在 register 期
// 写文件就会污染真实 `portable/memory`（只读当前实现不写，但守门要防的是将来）。
let tmpRoot = '';
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'my-pi-tools-'));
  process.env.PI_MEMORY_DIR = join(tmpRoot, 'memory');
  process.env.PI_CODING_AGENT_DIR = join(tmpRoot, 'agent');
});
afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('工具面体积守门', () => {
  it('总量/单项/数量都在预算内（超出时打印占比最高的工具）', async () => {
    const tools = await captureAll();
    const sized = tools
      .map((t) => ({ ...t, bytes: bytesOf(t) }))
      .sort((a, b) => b.bytes - a.bytes);
    const total = sized.reduce((n, t) => n + t.bytes, 0);
    const byFeature = new Map<string, number>();
    for (const t of sized) byFeature.set(t.feature, (byFeature.get(t.feature) ?? 0) + t.bytes);
    const featureLine = [...byFeature.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([f, b]) => `${f}=${(b / 1024).toFixed(1)}KB`)
      .join(' ');

    // 便于在 golden 日志里直接看到构成（不只在失败时才有信息）
    console.log(
      `工具面: ${sized.length} 个 / ${(total / 1024).toFixed(1)}KB（上限 ${(TOOLS_PAYLOAD_MAX_BYTES / 1024).toFixed(0)}KB）| ${featureLine}`,
    );

    const detail = sized
      .slice(0, 10)
      .map((t) => `${t.name}=${t.bytes}B(${t.feature})`)
      .join(' ');
    expect(total, `总量超预算 | top10: ${detail}`).toBeLessThanOrEqual(TOOLS_PAYLOAD_MAX_BYTES);
    expect(sized.length, `工具数量超预算 | top10: ${detail}`).toBeLessThanOrEqual(TOOL_COUNT_MAX);
    for (const t of sized) {
      expect(t.bytes, `${t.name} 单项超预算（desc=${t.description?.length ?? 0} 字符）`).toBeLessThanOrEqual(
        SINGLE_TOOL_MAX_BYTES,
      );
    }
    // 本用例要 import + register 全部 12 个功能（含 browser/voice/autopilot 等重模块）；
    // 在手机端跑**全量** vitest（66 worker 并发）时实测贴到默认 20s 上限而假性超时（断言本身通过）。
    // 显式放宽超时：守护的是体积预算，不是耗时。
  }, 60_000);

  it('模式白名单确有收窄效果（未注册的功能 = 0 字节）', async () => {
    // modes.json 的 features 是启动期过滤：非 full 模式只注册白名单内的功能。
    const modesPath = fileURLToPath(new URL('../../../../portable/agent/modes.json', import.meta.url));
    const modes = JSON.parse(readFileSync(modesPath, 'utf-8')) as {
      modes?: Record<string, { features?: string[] }>;
    };
    const all = await captureAll();
    const totalOf = (tools: Captured[]) => tools.reduce((n, t) => n + bytesOf(t), 0);
    const fullBytes = totalOf(all);
    for (const [name, cfg] of Object.entries(modes.modes ?? {})) {
      const allow = new Set(cfg.features ?? []);
      // 只统计白名单功能贡献的工具；mode/context 等基础设施功能由 bootstrap 额外放行，这里不做推断
      const subset = all.filter((t) => allow.has(t.feature));
      const subsetBytes = totalOf(subset);
      expect(subsetBytes, `${name} 白名单未起到收窄作用`).toBeLessThan(fullBytes);
    }
  });
});

/**
 * 状态类工具的路由守门（2026-10-07）
 *
 * 事故形态：`admin_status` 曾在描述里**枚举**"模型 / 会话文件 / 配置摘要"，而这三项各自都是另一个
 * 工具的**主管内容**。同一个关键词出现在多个 description 里，模型只能猜该叫哪个——30 天实测这几个
 * "看状态"的工具各只有 1–3 次调用，说明确实没被稳定用起来（`admin_switch_session` / `admin_set_model`
 * 更是 0 次）。
 *
 * 修法不是给每个描述加更多话（那只会让关键词继续互相污染），而是**让每个工具只声明自己独有的名词**，
 * 需要跨工具时用**工具名指针**（"…用 admin_list_models"）而不是复述对方的职责。
 *
 * 「指针加在哪」也有纪律：**只在名词会重叠时加**。`admin_status` 是"总览"，与四个单项工具的名词天然
 * 重叠 → 必须点名；成对工具（读/写 settings、列/切 models、列/切 sessions）靠**动词**区分即可，复述对方
 * 职责既污染关键词、又让声明变大——2026-10-07 实测：给每一对都加指针后 autopilot 声明从 6.8KB 涨到
 * 7.1KB，收掉这些冗余指针才回落到 6.7KB。
 *
 * 本守门锁三件事：
 *   ① 每个工具必须含自己的**独占名词**；
 *   ② 不得含别人的独占名词（谁把枚举加回去，这里立刻红）；
 *   ③ 该有点针的地方必须有（总览类工具不点名 = 模型只能猜）。
 */
const STATUS_ROUTING: Array<{ tool: string; owns: string[]; forbidden?: string[]; pointers?: string[] }> = [
  {
    tool: 'admin_status',
    owns: ['一屏摘要'],
    forbidden: ['settings.json', 'models.json', '会话文件'],
    pointers: ['admin_list_models', 'admin_list_sessions', 'admin_get_config', 'autopilot_status'],
  },
  { tool: 'admin_get_config', owns: ['**读** settings.json'], forbidden: ['models.json'] },
  { tool: 'admin_set_config', owns: ['**写** settings.json'], forbidden: ['models.json'] },
  { tool: 'admin_list_models', owns: ['models.json'], forbidden: ['settings.json'] },
  { tool: 'admin_set_model', owns: ['Provider'], forbidden: ['settings.json'] },
  { tool: 'admin_list_sessions', owns: ['历史会话文件'] },
  {
    tool: 'autopilot_status',
    owns: ['自主运行状态'],
    pointers: ['autopilot_policy', 'admin_status', 'schedule_task'],
  },
  { tool: 'autopilot_policy', owns: ['策略配置'], pointers: ['autopilot_status'] },
  { tool: 'verify_config', owns: ['配置'] },
];

describe('状态类工具路由守门', () => {
  it('每个工具只声明自己的名词，且点名相邻工具', async () => {
    const tools = await captureAll();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const spec of STATUS_ROUTING) {
      const t = byName.get(spec.tool);
      expect(t, `未注册工具: ${spec.tool}`).toBeDefined();
      const desc = t?.description ?? '';
      for (const noun of spec.owns) {
        expect(desc, `${spec.tool} 的描述缺少独占名词「${noun}」：${desc}`).toContain(noun);
      }
      for (const bad of spec.forbidden ?? []) {
        expect(desc, `${spec.tool} 的描述出现了别人的独占名词「${bad}」——枚举会与相邻工具互相污染：${desc}`).not.toContain(bad);
      }
      for (const p of spec.pointers ?? []) {
        expect(desc, `${spec.tool} 的描述应点名相邻工具 ${p}（否则模型只能猜）：${desc}`).toContain(p);
      }
    }
  });

  it('状态类工具的描述两两不同（防复制粘贴式重复）', async () => {
    const tools = await captureAll();
    const descs = STATUS_ROUTING.map((s) => tools.find((t) => t.name === s.tool)?.description ?? '');
    expect(descs.every((d) => d.length > 0)).toBe(true);
    expect(new Set(descs).size, `有工具描述重复：${JSON.stringify(descs)}`).toBe(descs.length);
  });
});
