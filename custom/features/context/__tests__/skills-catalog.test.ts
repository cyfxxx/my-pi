/**
 * 技能目录移出 system prompt（2026-10-07）
 *
 * 两件事各自锁住：
 *   1. **纯逻辑**：`buildSkillsCatalog` / `skillsCatalogKey` 的格式与稳定性；
 *   2. **接线与次序**：`before_agent_start` 处理器必须把 `systemPromptOptions.skills` 清空，
 *      且必须发生在"读 `event.systemPrompt`"之前——否则 `forceSystemPrompt` 带 `<skills>`、
 *      fallback 渲染不带，两条路径不一致 = 前缀漂移（与"加固块丢失"同一类事故）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { buildSkillsCatalog, skillsCatalogKey, SKILLS_CATALOG_TAG } from '../budget/skills-catalog';
import type { SkillLike } from '../budget/skills-catalog';

const ROOT = '/repo/portable/agent/skills';
function skill(name: string, description: string, over: Partial<SkillLike> = {}): SkillLike {
  const baseDir = `${ROOT}/${name}`;
  return { name, description, baseDir, filePath: `${baseDir}/SKILL.md`, ...over };
}

describe('buildSkillsCatalog（纯逻辑）', () => {
  it('同源技能只给一条根路径规则，不再逐条重复绝对路径', () => {
    const out = buildSkillsCatalog([skill('a', '甲'), skill('b', '乙')]);
    expect(out).toContain(`技能文件统一位于：\`${ROOT}/<name>/SKILL.md\``);
    expect(out).toContain('- `a`: 甲');
    expect(out).toContain('- `b`: 乙');
    // 逐条路径应当被省掉（这正是它比 pi 的 XML 省体积的地方）
    expect(out).not.toContain(`${ROOT}/a/SKILL.md`);
  });

  it('异源技能逐条给出文件路径（否则模型找不到）', () => {
    const out = buildSkillsCatalog([skill('a', '甲', { baseDir: '/x/a', filePath: '/x/a/SKILL.md' }), skill('b', '乙')]);
    expect(out).not.toContain('技能文件统一位于');
    expect(out).toContain('`/x/a/SKILL.md`');
    expect(out).toContain(`\`${ROOT}/b/SKILL.md\``);
  });

  it('disableModelInvocation 的技能不进目录（与 pi 行为一致）', () => {
    const out = buildSkillsCatalog([skill('hidden', '隐藏', { disableModelInvocation: true }), skill('shown', '可见')]);
    expect(out).not.toContain('hidden');
    expect(out).toContain('- `shown`: 可见');
  });

  it('没有可见技能 → 空串（调用方据此跳过注入）', () => {
    expect(buildSkillsCatalog([])).toBe('');
    expect(buildSkillsCatalog([skill('h', 'x', { disableModelInvocation: true })])).toBe('');
  });

  it('多行描述被压成一行（目录每条只占一行）', () => {
    const out = buildSkillsCatalog([skill('a', '第一行\n第二行   缩进')]);
    expect(out).toContain('- `a`: 第一行 第二行 缩进');
    expect(out.split('\n').filter((l) => l.startsWith('- `a`')).length).toBe(1);
  });

  it('内容键稳定：同输入同键；描述/目录变则键变；顺序无关性不做要求（按调用方给的顺序）', () => {
    const a = [skill('a', '甲'), skill('b', '乙')];
    expect(skillsCatalogKey(a)).toBe(skillsCatalogKey([skill('a', '甲'), skill('b', '乙')]));
    expect(skillsCatalogKey(a)).not.toBe(skillsCatalogKey([skill('a', '甲改了'), skill('b', '乙')]));
    expect(skillsCatalogKey(a)).not.toBe(
      skillsCatalogKey([skill('a', '甲', { baseDir: '/other/a' }), skill('b', '乙')]),
    );
    // 不可见技能不进键（隐藏它不应触发重新注入）
    expect(skillsCatalogKey([skill('h', 'x', { disableModelInvocation: true })])).toBe('');
  });
});

// ── 接线与次序 ────────────────────────────────────────────────────────────────
type Handler = (event: unknown, ctx?: unknown) => unknown;
type Result = { systemPrompt?: string; message?: { customType: string; content: string } };

function makeFakePi() {
  const hooks = new Map<string, Handler[]>();
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
    getActiveTools: () => ['read', 'bash'],
    getAllTools: () => [],
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
  return { pi, hooks };
}

async function mount() {
  vi.resetModules();
  const { register } = await import('../index');
  const { pi, hooks } = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  return hooks.get('before_agent_start') ?? [];
}

/**
 * 造一个"像 pi 那样"的事件：`systemPrompt` 是**惰性 getter**，按当时的 `options.skills`
 * 渲染（有技能就带 `<skills>` 段），从而能真实暴露"清空发生在读之前还是之后"。
 */
function makeEvent(skills: SkillLike[]) {
  const options: { skills?: SkillLike[]; selectedTools?: string[] } = { skills, selectedTools: ['read'] };
  const seenSkillsAtRender: number[] = [];
  const event = {
    type: 'before_agent_start' as const,
    systemPromptOptions: options,
    get systemPrompt() {
      seenSkillsAtRender.push((options.skills ?? []).length);
      const seg = (options.skills ?? []).length > 0 ? `\n\n<skills>${options.skills!.map((s) => s.name).join(',')}</skills>` : '';
      return `BASE_PROMPT${seg}`;
    },
  };
  return { event, options, seenSkillsAtRender };
}

function ctx(o: { getContextUsageThrows?: boolean } = {}) {
  return {
    ui: { notify: () => {} },
    hasUI: false,
    getContextUsage: () => {
      if (o.getContextUsageThrows) throw new Error('boom');
      return { tokens: 1000, contextWindow: 1_000_000, percent: 0.1 };
    },
  };
}

describe('技能目录接线（before_agent_start）', () => {
  it('跑完所有处理器后 options.skills 被清空，且返回的 systemPrompt 不含 <skills>', async () => {
    const hs = await mount();
    const { event, options, seenSkillsAtRender } = makeEvent([skill('a', '甲'), skill('b', '乙')]);
    const results: Result[] = [];
    for (const h of hs) results.push(((await h(event, ctx())) as Result) ?? {});

    expect(options.skills).toEqual([]);
    // 惰性 getter 被读到的那一刻，skills 必须已经是空的（否则 forceSystemPrompt 会带 <skills>）
    expect(seenSkillsAtRender.length).toBeGreaterThan(0);
    expect(Math.max(...seenSkillsAtRender)).toBe(0);

    const withPrompt = results.find((r) => typeof r.systemPrompt === 'string');
    // 主处理器会在 base 之后追加 my-pi 的加固块，所以这里只断言"base 原样在最前 + 不含 skills 段"
    expect(withPrompt?.systemPrompt?.startsWith('BASE_PROMPT')).toBe(true);
    expect(withPrompt?.systemPrompt).not.toContain('<skills>');
  });

  it('技能目录以尾部消息注入，且只在内容变化时注入一次', async () => {
    const hs = await mount();
    const dump = async () => {
      const { event } = makeEvent([skill('a', '甲')]);
      const out: Result[] = [];
      for (const h of hs) out.push(((await h(event, ctx())) as Result) ?? {});
      return out.find((r) => r.message?.customType === SKILLS_CATALOG_TAG)?.message?.content;
    };
    expect(await dump()).toContain('- `a`: 甲');
    // 同一内容第二次不再注入（append-only：旧的那份留在历史里）
    expect(await dump()).toBeUndefined();
  });

  it('增强失败（getContextUsage 抛错）也不影响清空——清空在关键路径上', async () => {
    const hs = await mount();
    const { event, options, seenSkillsAtRender } = makeEvent([skill('a', '甲')]);
    for (const h of hs) await h(event, ctx({ getContextUsageThrows: true }));
    expect(options.skills).toEqual([]);
    expect(Math.max(...seenSkillsAtRender)).toBe(0);
  });

  it('没有技能时不做任何事（清空动作不产生多余变更）', async () => {
    const hs = await mount();
    const { event, options } = makeEvent([]);
    for (const h of hs) await h(event, ctx());
    expect(options.skills).toEqual([]);
  });
});
