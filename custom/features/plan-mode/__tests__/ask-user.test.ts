/**
 * ask_user 交互逻辑测试（纯逻辑，UI 经注入的 select/editor 驱动）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  askUserSingle,
  askUserMultiple,
  parseSelectionInput,
  validateAskUserParams,
  runAskUser,
  OTHER_OPTION,
} from '../core/ask-user';

describe('validateAskUserParams', () => {
  it('缺 question 或选项不足 2 个时返回错误', () => {
    expect(validateAskUserParams({ options: [{ label: 'a' }, { label: 'b' }] })).toContain('question is required');
    expect(validateAskUserParams({ question: 'q', options: [{ label: 'a' }] })).toContain('at least 2 items');
    expect(validateAskUserParams({ question: 'q', options: [{ label: 'a' }, { label: 'b' }] })).toBeNull();
  });
});

describe('askUserSingle', () => {
  it('直接返回所选标签', async () => {
    const select = vi.fn(async () => 'A');
    const editor = vi.fn(async () => '');
    await expect(askUserSingle({ select, editor }, '标题', ['A', 'B'])).resolves.toBe('A');
    expect(select).toHaveBeenCalledWith('标题', ['A', 'B', OTHER_OPTION]);
    expect(editor).not.toHaveBeenCalled();
  });

  it('选「其他」后返回用户输入', async () => {
    const select = vi.fn(async () => OTHER_OPTION);
    const editor = vi.fn(async () => '自定义内容');
    await expect(askUserSingle({ select, editor }, '标题', ['A', 'B'])).resolves.toBe('其他: 自定义内容');
  });

  it('选「其他」但未输入时重新选择', async () => {
    let n = 0;
    const select = vi.fn(async () => (++n === 1 ? OTHER_OPTION : 'B'));
    const editor = vi.fn(async () => '   ');
    await expect(askUserSingle({ select, editor }, '标题', ['A', 'B'])).resolves.toBe('B');
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('取消返回取消文本', async () => {
    const select = vi.fn(async () => undefined);
    await expect(askUserSingle({ select, editor: vi.fn() }, '标题', ['A', 'B'])).resolves.toBe('用户取消了选择');
  });
});

describe('askUserMultiple', () => {
  it('编号输入返回对应标签（逗号分隔）', async () => {
    const editor = vi.fn(async () => '1,3');
    await expect(askUserMultiple({ select: vi.fn(), editor }, '标题', ['A', 'B', 'C'])).resolves.toBe('A, C');
  });

  it('支持范围与顿号/空格分隔', async () => {
    const editor = vi.fn(async () => '1-2、3');
    await expect(askUserMultiple({ select: vi.fn(), editor }, '标题', ['A', 'B', 'C'])).resolves.toBe('A, B, C');
  });

  it('编号越界时提示并重试', async () => {
    const editor = vi.fn();
    editor.mockResolvedValueOnce('9').mockResolvedValueOnce('2');
    await expect(askUserMultiple({ select: vi.fn(), editor }, '标题', ['A', 'B'])).resolves.toBe('B');
    expect(editor).toHaveBeenCalledTimes(2);
    expect(String(editor.mock.calls[1][0])).toContain('超出范围');
  });

  it('输入 0 追加「其他」补充说明', async () => {
    const editor = vi.fn();
    editor.mockResolvedValueOnce('1,0').mockResolvedValueOnce('补充');
    await expect(askUserMultiple({ select: vi.fn(), editor }, '标题', ['A', 'B'])).resolves.toBe('A, 其他: 补充');
  });

  it('空输入视为取消', async () => {
    const editor = vi.fn(async () => '   ');
    await expect(askUserMultiple({ select: vi.fn(), editor }, '标题', ['A', 'B'])).resolves.toBe('用户取消了选择');
  });
});

describe('parseSelectionInput', () => {
  it('去重并展开范围', () => {
    expect(parseSelectionInput('1,1,2-3', 3)).toEqual({ indexes: [0, 1, 2], other: false });
  });

  it('越界/非法/空输入返回错误', () => {
    expect(parseSelectionInput('5', 3).error).toContain('超出范围');
    expect(parseSelectionInput('abc', 3).error).toContain('无法识别');
    expect(parseSelectionInput('   ', 3).error).toContain('未输入有效编号');
  });

  it('0 表示补充其它', () => {
    expect(parseSelectionInput('0', 3)).toEqual({ indexes: [], other: true });
  });
});

describe('runAskUser', () => {
  it('非法参数直接返回错误文本，不触发 UI', async () => {
    const select = vi.fn();
    const r = await runAskUser({ select, editor: vi.fn() }, { question: '', options: [] });
    expect(r).toContain('Error');
    expect(select).not.toHaveBeenCalled();
  });

  it('header 拼接到标题', async () => {
    const select = vi.fn(async () => 'A');
    await runAskUser(
      { select, editor: vi.fn() },
      { question: '选哪个?', header: '构建', options: [{ label: 'A' }, { label: 'B' }] },
    );
    expect(select).toHaveBeenCalledWith('构建: 选哪个?', ['A', 'B', OTHER_OPTION]);
  });
});
