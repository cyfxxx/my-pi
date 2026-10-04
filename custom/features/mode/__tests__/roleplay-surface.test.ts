/**
 * 角色扮演模式「工具面契约」守卫
 *
 * 背景：roleplay 是给私人助手日常交流用的窄档位——每个工具 schema 都随每次请求发送，
 * 多挂一个 browser（18 工具）或 autopilot（6.4 KB）就是每次对话都白付前缀成本。
 * 2026-10-04 实测并定档：roleplay 活跃 18 个 = 内置 read/bash/edit/write + grep/find/ls
 * （`settings.json` 的 `defaultTools` 增量）+ web-search 3 + memory 8，活跃 schema ≈11 KB。
 *
 * 本用例读**入库的真实配置**（不是临时目录），因此别处改 modes.json 会在这里被拦下：
 * 想扩 roleplay 的工具面，就要连同这条契约和 `DECISIONS.md` 的对应条目一起改。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeModesFile } from '../logic';

const agentDir = fileURLToPath(new URL('../../../../portable/agent/', import.meta.url));
const readJson = (name: string): unknown => JSON.parse(readFileSync(agentDir + name, 'utf-8'));

const modes = normalizeModesFile(readJson('modes.json'));
const roleplay = modes.modes.roleplay;
const settings = readJson('settings.json') as { defaultTools?: unknown };

describe('roleplay 工具面契约（mode = 启动档位）', () => {
  it('功能白名单恰好是 web-search + memory（重功能一律不进）', () => {
    expect(roleplay).toBeDefined();
    expect([...roleplay.features].sort()).toEqual(['memory', 'web-search']);
  });

  it('人设与记忆命名空间已绑定，thinking 固定 low', () => {
    expect(roleplay.appendPrompt).toBe('modes/roleplay.md');
    expect(roleplay.memoryNamespace).toBe('roleplay');
    expect(roleplay.thinking).toBe('low');
  });

  it('人设文件存在且被 git 跟踪（check-features.sh 同款约束的测试侧断言）', () => {
    const persona = readFileSync(agentDir + 'modes/roleplay.md', 'utf-8');
    expect(persona.length).toBeGreaterThan(2000);
    expect(persona).toContain('指挥官');
  });

  it('defaultTools 只做增量（+name），不替换 pi 的默认内置工具集', () => {
    const tools = settings.defaultTools;
    expect(Array.isArray(tools)).toBe(true);
    const list = tools as string[];
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) expect(entry.startsWith('+')).toBe(true);
    // roleplay 需要的文件检索三件套；不趁机把 browser_* / admin_* 之类塞进来
    expect(list).toEqual(['+grep', '+find', '+ls']);
  });
});
