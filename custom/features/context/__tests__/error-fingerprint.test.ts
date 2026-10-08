/**
 * 错误指纹 + 修复预算测试（P7）
 *
 * 这一项最容易出错的地方是**归一化的两个方向**，所以两边都钉住：
 *   · 太窄 → 同一个错的路径/行号/耗时一变指纹就变，永远不触发（等于没做）；
 *   · 太宽 → 把不同错误并成一个指纹，会给出误导性的提醒（比不提醒更糟）。
 */
import { describe, it, expect } from 'vitest';
import {
  FINGERPRINT_EXCERPT_MAX,
  REPAIR_BUDGET_AT,
  createRepairBudget,
  errorFingerprint,
  normalizeErrorForFingerprint,
  observeRepairAttempt,
  repairBudgetHint,
} from '../budget/tool-health';

describe('归一化：易变部分不得影响指纹', () => {
  it('路径不同 → 同一个指纹', () => {
    const a = 'ENOENT: no such file or directory, open \'/root/my-pi/a/b.txt\'';
    const b = 'ENOENT: no such file or directory, open \'/tmp/other/c/d.txt\'';
    expect(errorFingerprint('read', a).key).toBe(errorFingerprint('read', b).key);
  });

  it('行号:列号不同 → 同一个指纹', () => {
    const a = 'SyntaxError: Unexpected token at /x/y.js:12:34';
    const b = 'SyntaxError: Unexpected token at /x/y.js:987:1';
    expect(errorFingerprint('bash', a).key).toBe(errorFingerprint('bash', b).key);
  });

  it('耗时/独立数字不同 → 同一个指纹', () => {
    const a = 'command timed out after 240s (pid 1234)';
    const b = 'command timed out after 30s (pid 99999)';
    expect(errorFingerprint('bash', a).key).toBe(errorFingerprint('bash', b).key);
  });

  it('哈希/UUID 不同 → 同一个指纹（否则每次都是"新错误"）', () => {
    const a = 'task 01a11b09-def9-70a3-8459-2e8b92c55fa5 failed: commit deadbeef1234 not found';
    const b = 'task 01a11b09-0000-0000-0000-000000000000 failed: commit 0123456789ab not found';
    expect(errorFingerprint('bash', a).key).toBe(errorFingerprint('bash', b).key);
  });

  it('ANSI 颜色码被剥掉（同一错误带色/不带色是同一个）', () => {
    const plain = 'Error: boom';
    const colored = '\u001b[31mError\u001b[0m: \u001b[1mboom\u001b[0m';
    expect(errorFingerprint('bash', plain).key).toBe(errorFingerprint('bash', colored).key);
  });
});

describe('归一化：不同错误不得合并（太宽比太窄更糟）', () => {
  it('不同 errno → 不同指纹', () => {
    expect(errorFingerprint('read', 'ENOENT: no such file').key).not.toBe(
      errorFingerprint('read', 'EACCES: permission denied').key,
    );
  });

  it('不同的目标模块/标识符 → 不同指纹（它们指向不同的根因）', () => {
    expect(errorFingerprint('bash', "Cannot find module 'left-pad'").key).not.toBe(
      errorFingerprint('bash', "Cannot find module 'right-pad'").key,
    );
  });

  it('同一文本但工具不同 → 不同指纹（不同工具的同名报错常常根因不同）', () => {
    const t = 'exit code 1';
    expect(errorFingerprint('bash', t).key).not.toBe(errorFingerprint('ctx_exec', t).key);
  });

  it('归一化不会把整条消息吃空（必须留下可辨认的骨架）', () => {
    const n = normalizeErrorForFingerprint('ENOENT: /a/b/c.txt:12:3 240ms');
    expect(n).toContain('ENOENT');
    expect(n).not.toContain('/a/b/c.txt');
    expect(n.length).toBeGreaterThan(3);
  });
});

describe('errorFingerprint 的形状', () => {
  it('key = 工具名:短哈希；excerpt 截断到上限', () => {
    const long = `Error: ${'x'.repeat(500)}`;
    const r = errorFingerprint('bash', long);
    expect(r.key.startsWith('bash:')).toBe(true);
    expect(r.key.split(':')[1].length).toBeLessThan(10);
    expect(r.excerpt.length).toBeLessThanOrEqual(FINGERPRINT_EXCERPT_MAX + 1);
  });
});

describe('修复预算：换参数还是同一个错才是真打转', () => {
  const err = 'ENOENT: no such file or directory, open \'/x/y.txt\'';

  it('同一错误、**不同参数** → 次数与"不同参数组数"都涨；恰好 3/5/8 提醒', () => {
    const s = createRepairBudget();
    const reminds: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const o = observeRepairAttempt(s, { toolName: 'read', errorText: err, argKey: `args-${i}`, nowMs: 1000 + i });
      expect(o.attempts).toBe(i);
      expect(o.distinctArgs).toBe(i);
      if (o.remind) reminds.push(i);
    }
    expect(reminds).toEqual([3, 5, 8]);
    expect([...REPAIR_BUDGET_AT].sort((a, b) => a - b)).toEqual([3, 5, 8]);
  });

  it('同参数重复 → distinctArgs 保持 1（说明是原样重试，不是换参数）', () => {
    const s = createRepairBudget();
    observeRepairAttempt(s, { toolName: 'read', errorText: err, argKey: 'same', nowMs: 10 });
    const o = observeRepairAttempt(s, { toolName: 'read', errorText: err, argKey: 'same', nowMs: 20 });
    expect(o.attempts).toBe(2);
    expect(o.distinctArgs).toBe(1);
  });

  it('不同错误各记各的预算（互不污染）', () => {
    const s = createRepairBudget();
    observeRepairAttempt(s, { toolName: 'bash', errorText: 'ENOENT: no such file', argKey: 'a', nowMs: 10 });
    observeRepairAttempt(s, { toolName: 'bash', errorText: 'ENOENT: no such file', argKey: 'b', nowMs: 11 });
    const other = observeRepairAttempt(s, {
      toolName: 'bash',
      errorText: 'EACCES: permission denied',
      argKey: 'c',
      nowMs: 12,
    });
    expect(other.attempts).toBe(1);
  });

  it('滑窗外不再累计（"打转"是短时间内的事）', () => {
    const s = createRepairBudget();
    observeRepairAttempt(s, { toolName: 'bash', errorText: err, argKey: 'a', nowMs: 0, windowMs: 1000 });
    observeRepairAttempt(s, { toolName: 'bash', errorText: err, argKey: 'b', nowMs: 500, windowMs: 1000 });
    // 第三次远在窗口之外：旧条目被丢弃，计数从头开始
    const o = observeRepairAttempt(s, { toolName: 'bash', errorText: err, argKey: 'c', nowMs: 10_000, windowMs: 1000 });
    expect(o.attempts).toBe(1);
    expect(o.distinctArgs).toBe(1);
  });
});

describe('提示文案', () => {
  it('给出次数、换过的参数组数、错误特征，并明确"不要原样重试"', () => {
    const s = createRepairBudget();
    let o = observeRepairAttempt(s, { toolName: 'bash', errorText: 'ENOENT: x', argKey: 'a', nowMs: 1 });
    o = observeRepairAttempt(s, { toolName: 'bash', errorText: 'ENOENT: x', argKey: 'b', nowMs: 2 });
    o = observeRepairAttempt(s, { toolName: 'bash', errorText: 'ENOENT: x', argKey: 'c', nowMs: 3 });
    expect(o.remind).toBe(true);
    const hint = repairBudgetHint(o);
    expect(hint).toContain('3 次');
    expect(hint).toContain('3 组参数');
    expect(hint).toContain('ENOENT');
    expect(hint).toContain('不要原样重试');
  });
});
