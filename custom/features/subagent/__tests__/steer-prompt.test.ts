/**
 * 回归测试：**中途指令必须真的能入队**（2026-10-10）
 *
 * 两个根因各有一条断言盯着 ✓（都是本会话真实踩过的）：
 *  ① 不传 `streamingBehavior:'steer'` ⇒ 子进程拒绝 ⇒ **从未入队** ⇒ 注入永不生效 ✗；
 *  ② 不检查 `success:false` ⇒ **拒绝被当成投递成功** ✗ ⇒ 日志写"已投递"并标记已消费 = "假装成功" ✗。
 */
import { describe, expect, it } from 'vitest';
import { assertPromptAccepted, buildSteerPrompt } from '../core/runner';

describe('buildSteerPrompt（根因 ①：必须带 steer 才不会被拒）', () => {
  it('带 streamingBehavior=steer，且带序号前缀', () => {
    const p = buildSteerPrompt(3, '追加指令：完成后 echo INBOX-OK');
    expect(p.type).toBe('prompt');
    expect(p.streamingBehavior).toBe('steer');
    expect(p.message).toContain('#3');
    expect(p.message).toContain('INBOX-OK');
  });

  it('反向断言：一个"忘记带 steer"的假实现必须被这条断言抓住', () => {
    const fakeForgetSteer = (seq: number, text: string) => ({ type: 'prompt' as const, message: `#${seq} ${text}` });
    // 真实现带 steer、假实现不带 ⇒ 断言有分辨力（否则两者会同时通过而暴露矛盾）
    expect(buildSteerPrompt(1, 'x').streamingBehavior).toBe('steer');
    expect((fakeForgetSteer(1, 'x') as { streamingBehavior?: string }).streamingBehavior).toBeUndefined();
  });
});

describe('assertPromptAccepted（根因 ②：拒绝不得被当成成功）', () => {
  it('success:false ⇒ 必须抛（否则就是"假装成功"）', () => {
    expect(() => assertPromptAccepted({ success: false, error: 'Agent is already processing.' })).toThrow(
      /子进程拒绝该指令/,
    );
  });

  it('success:true ⇒ 不抛（接受并入队）', () => {
    expect(() => assertPromptAccepted({ success: true })).not.toThrow();
  });

  it('undefined（无响应体/老协议）⇒ 不抛（向后兼容）', () => {
    expect(() => assertPromptAccepted(undefined)).not.toThrow();
  });

  it('success:false 但无 error 文案 ⇒ 仍必须抛（不得因缺文案而放过）', () => {
    expect(() => assertPromptAccepted({ success: false })).toThrow();
  });

  it('反向断言：一个"永远放行"的假实现必然违反上面第一条', () => {
    const fakeAlwaysAccept = (_res?: { success?: boolean }): void => {};
    const rejected = { success: false, error: 'Agent is already processing.' };
    expect(() => assertPromptAccepted(rejected)).toThrow();
    expect(() => fakeAlwaysAccept(rejected)).not.toThrow(); // 假实现"通过了" ⇒ 正是被真实现拒绝的那种 ⇒ 断言有分辨力
  });
});
