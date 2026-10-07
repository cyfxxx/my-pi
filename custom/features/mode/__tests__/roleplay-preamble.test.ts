/**
 * roleplay preamble 定点替换测试
 *
 * 背景：roleplay 之前只靠 `--append-system-prompt` 追加人设，system prompt 前段仍是上游的
 * "You are an expert coding assistant…"——同一份提示词里前段自称编码助手、后段自称标枪。
 * 现在在 roleplay 模式下把 preamble 定点替换为角色身份句，保留 tools/rules/docs 段
 * （不能用 `--system-prompt`：那会连带删掉三段，而 roleplay 依赖其工具使用规则）。
 *
 * 本测试锁两件事：
 *   1. 行为：仅 roleplay 替换、锚点缺失不猜、幂等、tools 段保留；
 *   2. **锚点未漂移**：直接读 vendor 的 system-prompt.ts 断言上游文案还在——
 *      上游改句会让替换静默失效，必须在这里变红（vendor 缺失时跳过，fresh checkout 用）。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PI_CODING_PREAMBLE, ROLEPLAY_IDENTITY_PREAMBLE, applyRoleplayIdentity } from '../logic';

const VENDOR_SYSTEM_PROMPT = join(
  process.cwd(),
  'vendor/pi/packages/coding-agent/src/core/system-prompt.ts',
);

describe('roleplay preamble 定点替换', () => {
  it('锚点仍存在于上游 system-prompt.ts（上游改文案会让本测试红）', () => {
    if (!existsSync(VENDOR_SYSTEM_PROMPT)) {
      console.warn('vendor/pi 不存在，跳过锚点校验');
      return;
    }
    const src = readFileSync(VENDOR_SYSTEM_PROMPT, 'utf-8');
    expect(src).toContain(PI_CODING_PREAMBLE);
  });

  it('roleplay：替换为角色身份，不再自称 coding assistant，且 tools 段保留', () => {
    const base = `${PI_CODING_PREAMBLE}\n\n<tools>keep-me</tools>`;
    const out = applyRoleplayIdentity(base, 'roleplay');
    expect(out).not.toContain('expert coding assistant');
    expect(out).toContain('标枪');
    expect(out).toContain('<tools>keep-me</tools>');
    expect(out).toBe(`${ROLEPLAY_IDENTITY_PREAMBLE}\n\n<tools>keep-me</tools>`);
  });

  it('其它模式原样返回', () => {
    const base = `${PI_CODING_PREAMBLE}\n\n<tools>keep-me</tools>`;
    expect(applyRoleplayIdentity(base, 'full')).toBe(base);
    expect(applyRoleplayIdentity(base, 'lean')).toBe(base);
    expect(applyRoleplayIdentity(base, 'minimal')).toBe(base);
  });

  it('锚点缺失（上游文案漂移）时原样返回，不猜文本', () => {
    const base = 'You are a helpful assistant.\n\n<tools>keep-me</tools>';
    expect(applyRoleplayIdentity(base, 'roleplay')).toBe(base);
  });

  it('幂等：重复应用不改变结果', () => {
    const once = applyRoleplayIdentity(PI_CODING_PREAMBLE, 'roleplay');
    expect(applyRoleplayIdentity(once, 'roleplay')).toBe(once);
  });
});
