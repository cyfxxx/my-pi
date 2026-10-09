/**
 * `writeTools` 提取测试（用户批复第 4 项 / P8-A）
 *
 * 这个字段的全部价值在于**口径可信**，所以测试要把口径的边界也钉住：
 *   ① 只认文件编辑类工具（write/edit/edit_and_run）——去重、保序；
 *   ② **故意不含 catch-all**（bash/ctx_exec/tmux_*）：含进来会恒为非空、信息量归零。
 *      这条要**显式断言**，否则将来有人"顺手补全"就把字段废掉了；
 *   ③ 畸形/未知消息一律跳过（旁路统计绝不能因形状变化抛错）；
 *   ④ 只读子代理 = 空数组（"没动过文件"必须能被表达出来）。
 */
import { describe, it, expect } from 'vitest';
import { WRITE_TOOLS, buildUsageRecord, extractWriteTools } from '../core/usage-log';
import type { SingleResult } from '../core/types';

const asst = (...names: string[]) => ({
  role: 'assistant',
  content: names.map((name, i) => ({ type: 'toolCall', id: `c${i}`, name, arguments: {} })),
});

describe('extractWriteTools：只认文件编辑类工具', () => {
  it('提取 write/edit/edit_and_run', () => {
    expect(extractWriteTools([asst('write', 'edit', 'edit_and_run')])).toEqual(['write', 'edit', 'edit_and_run']);
  });

  it('去重并保留首次出现顺序（同一工具多次调用只记一次）', () => {
    expect(extractWriteTools([asst('edit', 'write'), asst('edit', 'edit')])).toEqual(['edit', 'write']);
  });

  it('**故意排除 catch-all**：bash/ctx_exec/tmux_* 不计入（否则字段恒为非空、信息量归零）', () => {
    const msgs = [asst('bash', 'ctx_exec', 'tmux_run', 'tmux_send', 'grep', 'read')];
    expect(extractWriteTools(msgs)).toEqual([]);
    // 口径本身也钉住：WRITE_TOOLS 里出现 bash 之类就说明有人在"补全"这个集合
    for (const forbidden of ['bash', 'ctx_exec', 'tmux_run', 'tmux_send', 'read', 'grep']) {
      expect(WRITE_TOOLS.has(forbidden), `${forbidden} 不该被算作文件编辑类工具`).toBe(false);
    }
  });

  it('bash 与 edit 混用时只报 edit（说明"跑过命令"不等于"改过文件"）', () => {
    expect(extractWriteTools([asst('bash', 'edit', 'bash')])).toEqual(['edit']);
  });

  it('只读子代理 → 空数组（"没动过文件"能被表达）', () => {
    expect(extractWriteTools([asst('read', 'grep', 'find')])).toEqual([]);
    expect(extractWriteTools([])).toEqual([]);
  });

  it('畸形/未知结构一律跳过，不抛错', () => {
    const junk: unknown[] = [
      null,
      undefined,
      42,
      'string',
      {},
      { content: 'plain text' },
      { content: [null, 7, 'x', {}] },
      { content: [{ type: 'text', text: 'hi' }] },
      { content: [{ type: 'toolCall' }] }, // 缺 name
      { content: [{ type: 'toolCall', name: 123 }] }, // name 不是字符串
      { content: [{ type: 'toolCall', name: 'unknown_tool' }] },
      asst('edit'),
    ];
    expect(extractWriteTools(junk)).toEqual(['edit']);
  });
});

describe('buildUsageRecord：把字段写进账本', () => {
  const base: SingleResult = {
    agent: 'worker',
    agentSource: 'user',
    task: '改点东西',
    exitCode: 0,
    messages: [asst('read'), asst('edit', 'bash')],
    stderr: '',
    usage: { turns: 2, input: 10, cacheRead: 20, cacheWrite: 0, output: 5, cost: 0.001, contextTokens: 30 },
    model: 'm',
  };

  it('记录里带上 writeTools（只读子代理为 []）', () => {
    const r = buildUsageRecord(base, 123);
    expect(r.writeTools).toEqual(['edit']);
    expect(r.ts).toBe(123);
    const readOnly = buildUsageRecord({ ...base, messages: [asst('read', 'grep')] });
    expect(readOnly.writeTools).toEqual([]);
  });

  it('messages 缺失也不抛错（字段退化为 []）', () => {
    const r = buildUsageRecord({ ...base, messages: [] });
    expect(r.writeTools).toEqual([]);
  });
});
