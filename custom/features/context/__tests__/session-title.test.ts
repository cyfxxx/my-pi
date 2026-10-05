/**
 * session-title 规范化守门
 *
 * 背景：模型经 `session_title` 工具设置会话标题。标题只落 pi 的会话元数据
 * （`session_info`，append-only，不进 LLM 上下文），但 pi 自身只折叠换行 + trim，
 * 无长度上限，故由本模块统一清理与截断。守门点：
 *   1. 多行/连续空白折叠为单空格并去首尾；
 *   2. ANSI 转义与控制字符不得进入标题（防污染会话列表/页脚）；
 *   3. 超出字节上限时 UTF-8 安全截断（不切断多字节字符、不留尾空格）。
 */
import { describe, expect, it } from 'vitest';
import { MAX_SESSION_TITLE_BYTES, normalizeSessionTitle } from '../budget/session-title';

describe('session-title: 文本规范化', () => {
  it('折叠多行与连续空白并 trim', () => {
    expect(normalizeSessionTitle('  优化\n\n任务   流畅度 ')).toBe('优化 任务 流畅度');
    expect(normalizeSessionTitle('a\t\tb\r\nc')).toBe('a b c');
  });

  it('剥离 ANSI 转义与控制字符', () => {
    expect(normalizeSessionTitle('\u001b[31m会话标题\u001b[0m')).toBe('会话标题');
    expect(normalizeSessionTitle('标题\u0007\u0000尾')).toBe('标题 尾');
  });

  it('空输入或纯空白得到空串（调用方据此跳过写入）', () => {
    expect(normalizeSessionTitle('')).toBe('');
    expect(normalizeSessionTitle('  \n\t ')).toBe('');
  });

  it('UTF-8 安全截断到字节上限且不切多字节字符', () => {
    const out = normalizeSessionTitle('汉'.repeat(200), MAX_SESSION_TITLE_BYTES);
    expect(Buffer.byteLength(out, 'utf-8')).toBeLessThanOrEqual(MAX_SESSION_TITLE_BYTES);
    // 「汉」为 3 字节，上限整除，故恰好是 40 个
    expect(out).toBe('汉'.repeat(MAX_SESSION_TITLE_BYTES / 3));
  });

  it('截断处落在多字节边界上（不会产生非法字符）', () => {
    const out = normalizeSessionTitle('a'.repeat(MAX_SESSION_TITLE_BYTES - 1) + '汉字', MAX_SESSION_TITLE_BYTES);
    expect(Buffer.byteLength(out, 'utf-8')).toBeLessThanOrEqual(MAX_SESSION_TITLE_BYTES);
    expect(out.endsWith('a')).toBe(true);
    expect(/\uFFFD/.test(out)).toBe(false);
  });

  it('同输入必同输出（纯函数，无时间/随机依赖）', () => {
    const input = '  固定  标题 ';
    expect(normalizeSessionTitle(input)).toBe(normalizeSessionTitle(input));
  });
});
