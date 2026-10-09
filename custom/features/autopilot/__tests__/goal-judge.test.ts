/**
 * 目标验收「第二来源」的通道测试（P8 修正版的接线）
 *
 * 钉三类事：
 *   ① **fail-open**：没有通道 / 调用失败 / 抛错 / 超时 / 格式不符 ⇒ 一律 `done: null` + `skipped` 说明，
 *      **绝不**把它们说成"未达成"（那是把基础故障误读成评审判定）；
 *   ② 正常路径：DONE→true、NOT-DONE→false，原文照带；
 *   ③ **接线可见**：`goal` 工具必须真的把 `ctx.executeTool` 传进去、并且有 `verify` 分支——
 *      这类"可选通道没接上"的缺陷 `tsc` 看不见（本会话已踩过一次：池化路径漏传 allowExtensions）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGoalJudge, type ToolCaller } from '../run/goal-verdict';

const ok = (text: string) => async () => ({ text, isError: false });

describe('runGoalJudge：正常路径', () => {
  it('DONE → done=true 且带上理由', async () => {
    const r = await runGoalJudge(ok('判定：DONE\n理由：有可复现证据'), { objective: 'x' });
    expect(r.done).toBe(true);
    expect(r.reason).toContain('可复现证据');
    expect(r.skipped).toBeUndefined();
  });

  it('NOT-DONE → done=false（不是 skipped）', async () => {
    const r = await runGoalJudge(ok('判定：NOT-DONE\n理由：缺证据'), { objective: 'x' });
    expect(r.done).toBe(false);
    expect(r.skipped).toBeUndefined();
  });
});

describe('runGoalJudge：fail-open（绝不把故障当成"未达成"）', () => {
  it('没有嵌套通道 → done=null + skipped', async () => {
    const r = await runGoalJudge(undefined, { objective: 'x' });
    expect(r.done).toBeNull();
    expect(r.skipped).toContain('无嵌套调用通道');
  });

  it('子代理返回失败 → done=null + skipped', async () => {
    const r = await runGoalJudge(async () => ({ text: 'boom', isError: true }), { objective: 'x' });
    expect(r.done).toBeNull();
    expect(r.skipped).toContain('失败');
  });

  it('调用抛错 → done=null + skipped（不冒泡）', async () => {
    const r = await runGoalJudge(async () => {
      throw new Error('channel broke');
    }, { objective: 'x' });
    expect(r.done).toBeNull();
    expect(r.skipped).toContain('channel broke');
  });

  it('**超时 → done=null + skipped**（不无限等）', async () => {
    const never: ToolCaller = () => new Promise(() => {});
    const r = await runGoalJudge(never, { objective: 'x' }, 20);
    expect(r.done).toBeNull();
    expect(r.skipped).toContain('失败');
  });

  it('输出不合约定格式 → done=null + skipped（认不出不猜）', async () => {
    const r = await runGoalJudge(ok('我觉得应该完成了'), { objective: 'x' });
    expect(r.done).toBeNull();
    expect(r.skipped).toContain('格式');
  });
});

describe('接线可见（tsc 看不见的那一半）', () => {
  const SRC = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

  it('goal 工具把 ctx.executeTool 真的传给了评审', () => {
    expect(SRC, '评审通道没接上 ⇒ verify:true 会静默退化成 declared').toContain('runGoalJudge(ctx?.executeTool');
  });

  it('存在 opt-in 的 verify 分支（且是用 === true 严格判定）', () => {
    expect(SRC).toContain('args.verify === true');
  });

  it('判定为达成时用 judgeVerifiedCompletion（**标明来源是评审**，不冒充命令校验）', () => {
    expect(SRC).toContain('judgeVerifiedCompletion(goal, { reason: judged.reason');
  });
});
