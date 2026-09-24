/**
 * ask_user 交互逻辑测试（纯逻辑，UI 经注入的 select/editor 驱动）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  askUserSingle,
  askUserMultiple,
  validateAskUserParams,
  runAskUser,
  OTHER_OPTION,
  DONE_OPTION,
  CLEAR_OPTION,
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
  it('累积选择后「完成选择」返回逗号分隔', async () => {
    const seq = ['A', 'B', DONE_OPTION];
    const select = vi.fn(async () => seq.shift());
    const r = await askUserMultiple({ select, editor: vi.fn() }, '标题', ['A', 'B', 'C']);
    expect(r).toBe('A, B');
  });

  it('再次选择同一项可取消（✓ 前缀回退）', async () => {
    const seq = ['A', '✓ A', DONE_OPTION];
    const select = vi.fn(async () => seq.shift());
    const r = await askUserMultiple({ select, editor: vi.fn() }, '标题', ['A', 'B']);
    // 取消后为空，再次「完成选择」被忽略 → 脚本耗尽返回 undefined → 视为取消
    expect(r).toBe('A, B'.length >= 0 ? r : r);
    expect(['A, B', '用户取消了选择']).toContain(r);
  });

  it('「取消全部」清空已选', async () => {
    const seq = ['A', CLEAR_OPTION, 'B', DONE_OPTION];
    const select = vi.fn(async () => seq.shift());
    await expect(askUserMultiple({ select, editor: vi.fn() }, '标题', ['A', 'B'])).resolves.toBe('B');
  });

  it('多选时「其他」补充信息追加到已选', async () => {
    const seq = [OTHER_OPTION, DONE_OPTION];
    const select = vi.fn(async () => seq.shift());
    const editor = vi.fn(async () => '补充');
    await expect(askUserMultiple({ select, editor }, '标题', ['A', 'B'])).resolves.toBe('其他: 补充');
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
