/**
 * `edit_and_run` 测试（P6）
 *
 * 用**假的 ctx** 直接驱动 `runEditAndRun`（不需要跑真 pi），因为这里要锁的是**融合逻辑**：
 *   ① 顺序：先 edit 后 bash；
 *   ② **条件执行的硬保证：edit 失败 ⇒ bash 一次都不许被调用**（这是本工具最大的风险点：
 *      锚点没匹配上却照样跑了一遍命令，会让模型把两件事混在一起归因）；
 *   ③ 分段：结果里 `[edit]` 与 `[run]` 必须都在（合成观测是收益来源，也是误归因来源）；
 *   ④ 退化路径：没有嵌套调用能力时给出可继续操作的说明，而不是抛错；
 *   ⑤ `replace_all` 只在显式 true 时透传（不要给 pi 的 edit 塞无意义字段）。
 */
import { describe, it, expect } from 'vitest';
import { NESTED_UNAVAILABLE, runEditAndRun } from '../tools/edit-and-run';
import type { ToolExecuteContext } from '../../../adapters/tool-adapter';

type Call = { name: string; args: Record<string, unknown> };

/** 造一个记录调用顺序的假 ctx */
function fakeCtx(reply: (name: string, args: Record<string, unknown>) => { text: string; isError: boolean }) {
  const calls: Call[] = [];
  const ctx = {
    executeTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return reply(name, args);
    },
  } as unknown as ToolExecuteContext;
  return { ctx, calls };
}

const okEdit = { text: '已替换 1 处', isError: false };
const okRun = { text: 'tests passed', isError: false };

describe('融合顺序与分段', () => {
  it('先 edit 后 bash，且两段都在结果里', async () => {
    const { ctx, calls } = fakeCtx((n) => (n === 'edit' ? okEdit : okRun));
    const out = await runEditAndRun(
      { path: '/a/b.ts', edits: [{ oldText: 'x', newText: 'y' }], command: 'npx vitest run x' },
      ctx,
    );
    expect(calls.map((c) => c.name)).toEqual(['edit', 'bash']);
    expect(calls[1].args).toEqual({ command: 'npx vitest run x' });
    expect(out).toContain('[edit] 成功');
    expect(out).toContain('[run] npx vitest run x');
    expect(out).toContain('tests passed');
    expect(out).toContain('已替换 1 处');
  });

  it('编辑参数**逐字**透传给 pi 的 edit（不做字段映射——映射正是上一版出缺陷的地方）', async () => {
    const { ctx, calls } = fakeCtx(() => okEdit);
    const edits = [{ oldText: 'x', newText: 'y' }];
    await runEditAndRun({ path: '/a/b.ts', edits, command: 'true' }, ctx);
    // 形状必须与 pi 的 edit 规范 schema 一致：{path, edits}——不能出现 file_path/old_string 这类别名
    expect(calls[0].args).toEqual({ path: '/a/b.ts', edits });
    expect(Object.keys(calls[0].args).sort()).toEqual(['edits', 'path']);
  });

  it('多段 edits 原样透传（pi 的 edit 支持一次多处修改）', async () => {
    const { ctx, calls } = fakeCtx(() => okEdit);
    const edits = [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }];
    await runEditAndRun({ path: '/a', edits, command: 'true' }, ctx);
    expect(calls[0].args.edits).toEqual(edits);
  });
});

describe('条件执行：编辑失败就绝不跑命令', () => {
  it('edit isError ⇒ bash 一次都不被调用，且明确说明已跳过', async () => {
    const { ctx, calls } = fakeCtx((n) => (n === 'edit' ? { text: 'oldText 未找到', isError: true } : okRun));
    const out = await runEditAndRun({ path: '/a/b.ts', edits: [{ oldText: 'x', newText: 'y' }], command: 'rm -rf /' }, ctx);
    expect(calls.map((c) => c.name)).toEqual(['edit']); // ← 核心断言
    expect(out).toContain('[edit] 失败');
    expect(out).toContain('已跳过');
    expect(out).toContain('oldText 未找到');
    expect(out).not.toContain('tests passed');
  });

  it('命令本身失败时仍如实返回 [run]（融合不等于掩盖失败）', async () => {
    const { ctx } = fakeCtx((n) => (n === 'edit' ? okEdit : { text: 'exit 1: boom', isError: true }));
    const out = await runEditAndRun({ path: '/a', edits: [{ oldText: 'x', newText: 'y' }], command: 'make' }, ctx);
    expect(out).toContain('[run] make（失败）');
    expect(out).toContain('boom');
  });
});

describe('退化路径与参数校验', () => {
  it('没有嵌套调用能力 ⇒ 给出可继续操作的说明（不抛错）', async () => {
    const out = await runEditAndRun({ path: '/a', edits: [{ oldText: 'x', newText: 'y' }], command: 'true' }, undefined);
    expect(out).toBe(NESTED_UNAVAILABLE);
    expect(out).toContain('edit 与 bash');
  });

  it('缺参数时明确报错，且不触发任何嵌套调用', async () => {
    const { ctx, calls } = fakeCtx(() => okEdit);
    expect(await runEditAndRun({ edits: [{ oldText: 'x', newText: 'y' }], command: 'true' }, ctx)).toContain('path');
    expect(await runEditAndRun({ path: '/a', edits: [], command: 'true' }, ctx)).toContain('edits');
    expect(await runEditAndRun({ path: '/a', edits: [{ oldText: 'x', newText: 'y' }] }, ctx)).toContain('command');
    expect(calls).toHaveLength(0);
  });

  it('只做编辑（不给 command）应被引导回 edit，而不是静默只编辑', async () => {
    const { ctx } = fakeCtx(() => okEdit);
    const out = await runEditAndRun({ path: '/a', edits: [{ oldText: 'x', newText: 'y' }], command: '   ' }, ctx);
    expect(out).toContain('command 必填');
    expect(out).toContain('edit');
  });
});
