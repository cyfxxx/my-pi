/**
 * `before_agent_start` 的**前缀关键路径必须全定义（total）** —— 2026-10-07 事故回归锁
 *
 * 事故：pi 对 `before_agent_start` 处理器的异常**静默吞掉**（只 emitError 给内存 listener，
 * 不落盘）。处理器一抛错，`forceSystemPrompt` 就不被设置，请求退回"纯分段渲染"，
 * my-pi 追加的加固块整块消失 → system 位于请求最前 → 从第 0 个 token 起分叉 → 整段全价重放。
 * 实测一次翻转 = 147,555 token，占该会话全部未命中的 60.8%。
 *
 * 本测试锁两件事：
 *   1. **增强失败不得改变前缀字节**：让 `ctx.getContextUsage` / `pi.getActiveTools` 抛错，
 *      产出的 `systemPrompt` 必须与正常路径**逐字节相同**（即加固块恒在）。
 *   2. **次序**：读 `event.systemPrompt` 必须发生在"把 selectedTools 对齐到当前激活集"**之后**
 *      （该 getter 是惰性渲染，读它才定稿文本；反了会白丢那份对齐）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { EFFICIENCY_ADVICE, HARD_RULES } from '../budget/system-prompt';

type Handler = (event: unknown, ctx?: unknown) => unknown;
type Result = { systemPrompt?: string; message?: { customType: string; content: string } };

const BASE = 'You are an expert coding assistant operating inside pi.';
/** my-pi 追加块：`buildSystemPrompt` = base + "\n\n" + HARD_RULES + "\n\n" + EFFICIENCY_ADVICE */
const APPEND = `\n\n${HARD_RULES}\n\n${EFFICIENCY_ADVICE}`;

interface FakePiOpts {
  getActiveToolsThrows?: boolean;
  selectedTools?: string[];
}

function makeFakePi(opts: FakePiOpts = {}) {
  const hooks = new Map<string, Handler[]>();
  const active = opts.selectedTools ?? ['read', 'bash', 'edit', 'write'];
  const pi = {
    registerTool: () => {},
    registerCommand: () => {},
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
    getActiveTools: () => {
      if (opts.getActiveToolsThrows) throw new Error('boom: getActiveTools');
      return active;
    },
    getAllTools: () => active.map((name) => ({ name })),
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
  return { pi, hooks };
}

/**
 * 取回"会返回 systemPrompt 的那个" `before_agent_start` 处理器。
 * 不按下标取：context 功能注册了不止一个 `before_agent_start`（还有工作区指令那条），
 * 顺序会随功能演进而变。
 */
async function load(opts: FakePiOpts = {}) {
  vi.resetModules();
  const { register } = await import('../index');
  const { pi, hooks } = makeFakePi(opts);
  register(pi as unknown as ExtensionAPI);
  const hs = hooks.get('before_agent_start') ?? [];
  expect(hs.length).toBeGreaterThan(0);

  const ctx = (o: { getContextUsageThrows?: boolean } = {}) => ({
    ui: { notify: () => {} },
    hasUI: false,
    getContextUsage: () => {
      if (o.getContextUsageThrows) throw new Error('boom: getContextUsage');
      return { tokens: 1000, contextWindow: 1_000_000, percent: 0.1 };
    },
  });

  /** 造事件：`systemPrompt` 用**惰性 getter**，并在读取时记录 selectedTools 当时的值 */
  const makeEvent = (base: unknown = BASE) => {
    const sysOptions: { selectedTools?: string[] } = { selectedTools: ['read'] };
    const seen: string[][] = [];
    const event = {
      type: 'before_agent_start' as const,
      systemPromptOptions: sysOptions,
      get systemPrompt() {
        seen.push([...(sysOptions.selectedTools ?? [])]);
        return base;
      },
    };
    return { event, sysOptions, seen };
  };

  // 探针：找出返回 systemPrompt 的处理器（同时拿到一次"首调用"的结果，用于断言提示消息）
  let handler: Handler | undefined;
  let probe: Result | undefined;
  for (const h of hs) {
    const { event } = makeEvent();
    const r = (await h(event, ctx())) as Result | undefined;
    if (r && typeof r.systemPrompt === 'string') {
      handler = h;
      probe = r;
      break;
    }
  }
  if (!handler) throw new Error('未找到返回 systemPrompt 的 before_agent_start 处理器');
  return { handler, probe: probe as Result, ctx, makeEvent, pi };
}

describe('before_agent_start 前缀关键路径（total）', () => {
  it('正常路径：返回 base + 加固块（逐字节为 base 加固定追加块）', async () => {
    const { probe } = await load();
    expect(probe.systemPrompt).toBe(BASE + APPEND);
    // 追加块必须**完整**在场，而不只是"多了一段文本"
    expect(probe.systemPrompt).toContain(HARD_RULES);
    expect(probe.systemPrompt?.endsWith(EFFICIENCY_ADVICE)).toBe(true);
  });

  it('首调用产生易变提示消息（append-only 语义未被重构破坏）', async () => {
    const { probe } = await load();
    expect(probe.message).toBeDefined();
    expect(probe.message?.customType).toBeTruthy();
    expect(probe.message?.content.length).toBeGreaterThan(0);
  });

  it('ctx.getContextUsage 抛错 → systemPrompt 与正常路径逐字节相同', async () => {
    const { handler, probe, ctx, makeEvent } = await load();
    const { event } = makeEvent();
    const r = (await handler(event, ctx({ getContextUsageThrows: true }))) as Result;
    expect(r.systemPrompt).toBe(probe.systemPrompt);
    // 压力提示这一档没了是**可接受**的降级，但前缀必须原样
    expect(r.systemPrompt).toBe(BASE + APPEND);
  });

  it('pi.getActiveTools 抛错 → systemPrompt 不变；且不抛到 pi 的 runner', async () => {
    const { handler, probe, ctx, makeEvent } = await load({ getActiveToolsThrows: true });
    const { event } = makeEvent();
    await expect(handler(event, ctx())).resolves.toBeDefined();
    const r = (await handler(event, ctx())) as Result;
    expect(r.systemPrompt).toBe(probe.systemPrompt);
  });

  it('两处同时抛错 → 仍然返回完整加固块', async () => {
    const { handler, ctx, makeEvent } = await load({ getActiveToolsThrows: true });
    const { event } = makeEvent();
    const r = (await handler(event, ctx({ getContextUsageThrows: true }))) as Result;
    expect(r.systemPrompt).toBe(BASE + APPEND);
  });

  it('event.systemPrompt 不是字符串 → 不返回 systemPrompt，但也不抛错', async () => {
    const { handler, ctx, makeEvent } = await load();
    // 传 null（不能用 undefined：那会命中 makeEvent 的默认参数）
    const { event } = makeEvent(null);
    const r = (await handler(event, ctx())) as Result;
    expect(r.systemPrompt).toBeUndefined();
  });

  it('次序：读取 system 文本时 selectedTools 已被对齐到当前激活集', async () => {
    const { handler, ctx, makeEvent } = await load({ selectedTools: ['read', 'bash', 'grep'] });
    const { event, seen } = makeEvent();
    await handler(event, ctx());
    expect(seen.length).toBeGreaterThan(0);
    // getter 被读到的那一刻，options 必须已经是 active 集（否则这份对齐白丢）
    expect(seen[0]).toEqual(['read', 'bash', 'grep']);
  });
});
