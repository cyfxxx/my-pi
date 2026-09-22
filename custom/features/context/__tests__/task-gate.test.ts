import { describe, it, expect } from 'vitest';
import { hasInProgressTask } from '../logic';

describe('context 压缩任务门', () => {
  it('存在 in_progress 任务时返回 true', () => {
    expect(hasInProgressTask([{ status: 'pending' }, { status: 'in_progress' }])).toBe(true);
  });

  it('无任务或全部完成/阻塞时返回 false', () => {
    expect(hasInProgressTask([])).toBe(false);
    expect(hasInProgressTask([{ status: 'completed' }, { status: 'blocked' }, { status: 'pending' }])).toBe(false);
  });
});
