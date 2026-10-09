/**
 * 目标验收「独立评审」的纯逻辑测试（第二校验来源）
 *
 * 这一项的成败全在两点，所以测试也就钉这两点：
 *   ① **提示词必须强制格式**（否则解析只能去猜散文含义）；
 *   ② **解析认不出就不猜**（`done: null`）——「认不出」与「未达成」是两件事，
 *      混为一谈会让 fail-open 变成 fail-closed（把好目标判成没完成）或反过来（放行没完成的）。
 * 另有一条**最容易写错**的边界：`NOT-DONE` 含子串 `DONE`，解析必须优先匹配前者。
 */
import { describe, it, expect } from 'vitest';
import {
  JUDGE_RAW_MAX,
  VERDICT_MARKER,
  buildGoalJudgePrompt,
  parseGoalVerdict,
} from '../run/goal-verdict';

describe('buildGoalJudgePrompt：强制格式 + 默认怀疑', () => {
  it('带上目标与执行者说明', () => {
    const p = buildGoalJudgePrompt({ objective: '把 A 改成 B', note: '已跑通测试' });
    expect(p).toContain('把 A 改成 B');
    expect(p).toContain('已跑通测试');
  });

  it('没有说明时明确写「未提供」（不留空让评审自己脑补）', () => {
    expect(buildGoalJudgePrompt({ objective: 'x' })).toContain('（未提供）');
  });

  it('**强制**要求判定标记（解析的确定性来源）', () => {
    const p = buildGoalJudgePrompt({ objective: 'x' });
    expect(p).toContain(`${VERDICT_MARKER}DONE`);
    expect(p).toContain(`${VERDICT_MARKER}NOT-DONE`);
  });

  it('写明「信息不足即判 NOT-DONE」（倾向于放行的评审等于没有评审）', () => {
    expect(buildGoalJudgePrompt({ objective: 'x' })).toContain('信息不足以证明目标已达成时，判 NOT-DONE');
  });
});

describe('parseGoalVerdict：宽进严出、认不出不猜', () => {
  it('DONE → done=true 并取出理由', () => {
    const v = parseGoalVerdict('判定：DONE\n理由：测试全绿且有输出证据');
    expect(v.done).toBe(true);
    expect(v.reason).toContain('测试全绿');
  });

  it('**NOT-DONE 不能被误当成 DONE**（它含子串 DONE）', () => {
    const v = parseGoalVerdict('判定：NOT-DONE\n理由：没有任何证据');
    expect(v.done).toBe(false);
    expect(v.reason).toContain('没有任何证据');
  });

  it('容忍大小写、中英文冒号、空格写法与代码围栏', () => {
    expect(parseGoalVerdict('判定: done').done).toBe(true);
    expect(parseGoalVerdict('判定：NOT DONE').done).toBe(false);
    expect(parseGoalVerdict('```\n判定：NOT_DONE\n理由：x\n```').done).toBe(false);
    expect(parseGoalVerdict('  判定 ：DONE  ').done).toBe(true);
  });

  it('**没有标记 → done=null（不猜）**（"认不出"不等于"未达成"）', () => {
    const v = parseGoalVerdict('我觉得这个目标完成得挺好的，应该没问题。');
    expect(v.done).toBeNull();
    expect(v.reason).toContain('不猜');
  });

  it('空/垃圾输入同样安全', () => {
    expect(parseGoalVerdict('').done).toBeNull();
    expect(parseGoalVerdict(undefined as unknown as string).done).toBeNull();
  });

  it('有判定但没理由时给出占位（不假装有理由）', () => {
    expect(parseGoalVerdict('判定：DONE').reason).toBe('(评审未给理由)');
  });

  it('原文截断到上限（状态文案/账本里不长篇引用）', () => {
    const v = parseGoalVerdict(`判定：DONE\n理由：${'x'.repeat(JUDGE_RAW_MAX * 2)}`);
    expect(v.raw.length).toBeLessThanOrEqual(JUDGE_RAW_MAX);
  });
});
