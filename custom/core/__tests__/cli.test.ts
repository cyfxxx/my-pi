import { describe, it, expect } from 'vitest';
import { parseSubcommand, filterCompletions } from '../cli';

describe('cli: parseSubcommand', () => {
  it('拆分首 token 为小写子命令与其余 token', () => {
    expect(parseSubcommand('Enable Foo Bar')).toEqual({ sub: 'enable', rest: ['Foo', 'Bar'] });
  });

  it('多余空白与空输入安全', () => {
    expect(parseSubcommand('   ')).toEqual({ sub: '', rest: [] });
    expect(parseSubcommand(undefined)).toEqual({ sub: '', rest: [] });
    expect(parseSubcommand('list')).toEqual({ sub: 'list', rest: [] });
  });
});

describe('cli: filterCompletions', () => {
  const items = [
    { value: 'list' },
    { value: 'enable ' },
    { value: 'help' },
  ];
  it('按前缀过滤，空前缀返回全部', () => {
    expect(filterCompletions(items, 'e')).toEqual([{ value: 'enable ' }]);
    expect(filterCompletions(items, '')).toHaveLength(3);
    expect(filterCompletions(items, undefined)).toHaveLength(3);
  });
});
