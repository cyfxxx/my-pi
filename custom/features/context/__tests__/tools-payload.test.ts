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
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
  });

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
