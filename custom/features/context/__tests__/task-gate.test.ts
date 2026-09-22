import { describe, it, expect } from 'vitest';
import { hasInProgressTask, extractUserRequest } from '../logic';

describe('context 压缩任务门', () => {
  it('存在 in_progress 任务时返回 true', () => {
    expect(hasInProgressTask([{ status: 'pending' }, { status: 'in_progress' }])).toBe(true);
  });

  it('无任务或全部完成/阻塞时返回 false', () => {
    expect(hasInProgressTask([])).toBe(false);
    expect(hasInProgressTask([{ status: 'completed' }, { status: 'blocked' }, { status: 'pending' }])).toBe(false);
  });
});

describe('context 任务记录：用户请求提取', () => {
  it('取最后一条 user 文本，支持字符串与块数组，压缩空白', () => {
    expect(extractUserRequest([{ role: 'user', content: '你好' }, { role: 'assistant', content: 'x' }, { role: 'user', content: ' 做  事 ' }])).toBe('做 事');
    expect(extractUserRequest([{ role: 'user', content: [{ type: 'text', text: 'A' }, { type: 'image' }] }])).toBe('A');
    expect(extractUserRequest([])).toBe('');
  });
});
