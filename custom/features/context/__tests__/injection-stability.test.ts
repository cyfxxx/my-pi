/**
 * system 前缀注入面守门（P4 升格通道第一批）
 *
 * 硬化目标（原为 AGENTS.md 软引导"system prompt 注入禁止时间戳/精确数值"）：
 *   1. 装配唯一入口 `buildSystemPrompt`：base 原样保留在最前，追加内容逐字节确定；
 *   2. 易变内容（日期/时钟/百分比/绝对路径/字节数/sha/版本号）一律拒绝；
 *   3. **注入预算**：软层条目不得无限增长（VISION §6 P4 判据）——超预算要走上层决策，
 *      而不是顺手把上限调大。
 *
 * 为什么值得守门：前缀一变，其后整段上下文按全价重算（存量实测单次 170K–316K token），
 * 而全价/命中价差 50 倍。这条纪律此前只写在提示词里。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EFFICIENCY_ADVICE,
  SYSTEM_APPEND_MAX_BYTES,
  SYSTEM_INJECTION_MAX_BYTES,
  VOLATILE_PATTERNS,
  appendedSystemParts,
  buildSystemPrompt,
  findVolatileInjection,
} from '../budget/system-prompt';
import { HARD_RULES } from '../budget/hard-rules';
import { WORKSPACE_INSTRUCTIONS_MAX_BYTES } from '../budget/workspace-instructions';

const APPEND_SYSTEM = fileURLToPath(new URL('../../../../portable/agent/APPEND_SYSTEM.md', import.meta.url));

describe('system 前缀注入装配', () => {
  it('base 原样保留在最前（pi 自己的提示词不被改写）', () => {
    const base = 'BASE_SYSTEM_PROMPT';
    const out = buildSystemPrompt(base);
    expect(out.startsWith(base)).toBe(true);
    expect(out.slice(0, base.length)).toBe(base);
  });

  it('追加内容 = HARD_RULES + EFFICIENCY_ADVICE，且不含其它段', () => {
    expect(appendedSystemParts()).toEqual([HARD_RULES, EFFICIENCY_ADVICE]);
    expect(buildSystemPrompt('B')).toBe(`B\n\n${HARD_RULES}\n\n${EFFICIENCY_ADVICE}`);
  });

  it('逐字节确定（同输入必同输出，防未来引入时间/随机）', () => {
    expect(buildSystemPrompt('B')).toBe(buildSystemPrompt('B'));
    expect(Buffer.from(buildSystemPrompt('B')).equals(Buffer.from(buildSystemPrompt('B')))).toBe(true);
  });
});

describe('易变内容守门', () => {
  it('注入的常量本身干净', () => {
    for (const part of appendedSystemParts()) {
      expect(findVolatileInjection(part), `注入段含易变内容: ${part.slice(0, 40)}`).toEqual([]);
    }
  });

  it('APPEND_SYSTEM.md（pi 原生注入 system）干净', () => {
    const text = readFileSync(APPEND_SYSTEM, 'utf-8');
    expect(findVolatileInjection(text)).toEqual([]);
  });

  it('每种模式都能抓到样本（守门自身有效性）', () => {
    const samples: Record<string, string> = {
      'ISO 日期': '更新于 2026-10-01',
      '斜杠日期': '更新于 2026/10/01',
      '时钟时间': '最后运行 09:30',
      '百分比数值': '命中率 99.78%',
      '绝对路径': '见 /root/my-pi/x',
      '字节/容量数值': '工具声明 62454 bytes',
      'commit sha': '提交 ccf4fc8f4',
      '语义化版本号': 'pi 0.99.1',
    };
    expect(Object.keys(samples).sort()).toEqual(VOLATILE_PATTERNS.map((p) => p.name).sort());
    for (const [name, sample] of Object.entries(samples)) {
      const hits = findVolatileInjection(sample);
      expect(hits.length, `未抓到: ${name} (${sample})`).toBeGreaterThan(0);
    }
  });

  it('纯英文十六进制单词不误报（defaced 不是 sha）', () => {
    expect(findVolatileInjection('the state was defaced')).toEqual([]);
  });
});

describe('注入预算（VISION §6 P4 判据）', () => {
  const bytes = (s: string) => Buffer.byteLength(s, 'utf-8');

  it('system 层追加段在预算内', () => {
    const used = bytes(appendedSystemParts().join('\n\n'));
    expect(used).toBeLessThanOrEqual(SYSTEM_INJECTION_MAX_BYTES);
  });

  it('APPEND_SYSTEM.md 在预算内', () => {
    const used = bytes(readFileSync(APPEND_SYSTEM, 'utf-8'));
    expect(used).toBeLessThanOrEqual(SYSTEM_APPEND_MAX_BYTES);
  });

  it('工作区指令（尾部 append-only 注入）有硬上限', () => {
    expect(WORKSPACE_INSTRUCTIONS_MAX_BYTES).toBeLessThanOrEqual(65_536);
    expect(WORKSPACE_INSTRUCTIONS_MAX_BYTES).toBeGreaterThan(0);
  });
});
