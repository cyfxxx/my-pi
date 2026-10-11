import { describe, expect, it } from 'vitest';
import {
  computeRunOutcome,
  detectUnparsedToolCallMarkers,
} from '../run/runner';

/** 造一段"标记泄漏"的假输出（**不真烧 143 秒的会话**） */
const leaked = (marker = '<dots_function_call>') =>
  `我先调用工具。\n${marker}\n再试一次。\n${marker}\n最终回复：完成。`;

describe('detectUnparsedToolCallMarkers（窄判据：>=2 次才命中）', () => {
  it('dots 家族重复出现 ⇒ 命中', () => {
    const r = detectUnparsedToolCallMarkers(leaked());
    expect(r).not.toBeNull();
    expect(r!.count).toBeGreaterThanOrEqual(2);
  });

  it('同类家族（<|tool_call|> / <tool_call>）重复出现 ⇒ 命中', () => {
    expect(detectUnparsedToolCallMarkers(leaked('<|tool_call|>'))).not.toBeNull();
    expect(detectUnparsedToolCallMarkers(leaked('<tool_call>'))).not.toBeNull();
  });

  it('**只出现一次** ⇒ 不命中（防"狼来了"）', () => {
    expect(detectUnparsedToolCallMarkers('文档里提了一次 <dots_function_call>。')).toBeNull();
  });

  it('普通文本 / 空文本 ⇒ 不命中', () => {
    expect(detectUnparsedToolCallMarkers('任务完成，已写入 3 个文件。')).toBeNull();
    expect(detectUnparsedToolCallMarkers('')).toBeNull();
  });
});

describe('computeRunOutcome（判定语义）', () => {
  it('对照组：exit 0 + 正常输出 ⇒ 仍是 success（不误伤 ✓）', () => {
    expect(computeRunOutcome({ exitCode: 0, output: '任务完成。' }).result).toBe('success');
  });

  it('exit 0 + 标记泄漏 ⇒ **failed**，且 reason 写明原因（不再静默报成功 ✓）', () => {
    const r = computeRunOutcome({ exitCode: 0, output: leaked() });
    expect(r.result).toBe('failed');
    expect(r.suspect?.count).toBeGreaterThanOrEqual(2);
    expect(r.reason).toContain('suspect: unparsed tool call');
    expect(r.reason).toContain('没有真正执行任何工具调用');
  });

  it('既有语义不变：exit!=0 / 有 errMsg / 空输出 ⇒ failed', () => {
    expect(computeRunOutcome({ exitCode: 1, output: 'x' }).result).toBe('failed');
    expect(computeRunOutcome({ exitCode: 0, errMsg: '超时', output: 'x' }).result).toBe('failed');
    expect(computeRunOutcome({ exitCode: 0, output: '' }).result).toBe('failed');
  });

  it('反向断言：一个"永远报 success"的假实现在泄漏用例上必然失败 ✓', () => {
    const fakeAlwaysSuccess = (_i: { exitCode: number; errMsg?: string; output: string }) => 'success' as const;
    const inputs = [
      { exitCode: 0, output: leaked() },
      { exitCode: 0, output: leaked('<|tool_call|>') },
    ];
    for (const i of inputs) {
      expect(fakeAlwaysSuccess(i)).not.toBe(computeRunOutcome(i).result);
    }
  });
});
