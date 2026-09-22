import { describe, it, expect } from 'vitest';
import { localDay, truncateChars, oneLine, formatTokens } from '../text';

describe('text: localDay', () => {
  it('接受 Date/字符串/时间戳', () => {
    const d = new Date(2026, 8, 22, 12, 0, 0);
    const day = localDay(d);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(localDay(d.toISOString())).toBe(day);
    expect(localDay(d.getTime())).toBe(day);
  });
});

describe('text: truncateChars', () => {
  it('超长截断并加省略号，默认省略号可覆盖', () => {
    expect(truncateChars('hello', 10)).toBe('hello');
    expect(truncateChars('x'.repeat(50), 10)).toBe('x'.repeat(10) + '…');
    expect(truncateChars('x'.repeat(50), 10, '...')).toBe('x'.repeat(10) + '...');
    expect(truncateChars('', 5)).toBe('');
  });
});

describe('text: oneLine', () => {
  it('压缩空白，对象走 JSON', () => {
    expect(oneLine('a\n  b\tc')).toBe('a b c');
    expect(oneLine({ a: 1 })).toBe('{"a":1}');
  });
});

describe('text: formatTokens', () => {
  it('阈值行为与既有实现一致', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(20000)).toBe('20k');
    expect(formatTokens(2_000_000)).toBe('2.0M');
  });
});
