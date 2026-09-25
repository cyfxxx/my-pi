/**
 * prune 纯逻辑回归测试（迁移自 pi-tools pi-context/tests/prune.test.ts）
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pruneToolResults,
  pruneThinkingBudget,
  sweepPruneRefs,
  isPrunedMessage,
  messageText,
  PRUNE_PROTECT_TOKENS,
  PRUNE_MINIMUM_TOKENS,
  KEEP_RECENT_TURNS,
} from '../budget/prune';
import type { PruneMessage } from '../budget/prune';

function toolResult(text: string): PruneMessage {
  return { role: 'toolResult', content: [{ type: 'text', text }] };
}
function user(): PruneMessage {
  return { role: 'user', content: [{ type: 'text', text: '用户消息' }] };
}
function assistant(): PruneMessage {
  return { role: 'assistant', content: [{ type: 'text', text: '助手回复' }] };
}
function session(rounds: number, outputSize = 200_000): PruneMessage[] {
  const msgs: PruneMessage[] = [];
  for (let i = 0; i < rounds; i++) {
    msgs.push(user());
    msgs.push(assistant());
    msgs.push(toolResult('y'.repeat(outputSize)));
  }
  return msgs;
}

describe('pruneToolResults: 工具输出分层擦除', () => {
  it('空/无工具结果 → 无修改', () => {
    const r = pruneToolResults([]);
    expect(r.modified).toBe(false);
    expect(r.prunedCount).toBe(0);
  });

  it('保护带内（最近轮次 + 预算内）不擦除', () => {
    const r = pruneToolResults(session(1), { minimumTokens: 0 });
    expect(r.modified).toBe(false);
  });

  it('超保护带的更早 toolResult 输出被替换为占位（保留结构）', () => {
    const msgs = session(5, 200_000);
    const r = pruneToolResults(msgs, { protectTokens: 40_000, minimumTokens: 0 });
    expect(r.modified).toBe(true);
    expect(r.prunedCount).toBe(2);
    expect(messageText(r.messages[2])).toMatch(/^\[pruned: \d+ chars\]$/);
    expect(messageText(r.messages[5])).toMatch(/^\[pruned: \d+ chars\]$/);
    expect(messageText(r.messages[8])).toContain('y');
    expect(messageText(r.messages[14])).toContain('y');
  });

  it('新默认（60K/30K）：5 轮×5万 token 即擦除最旧输出（原 120K/80K 从不触发）', () => {
    const r = pruneToolResults(session(5, 200_000));
    expect(r.modified).toBe(true);
    // 保护带 60K 先吸收 1 条 50K，其后（最旧）1 条被擦除
    expect(r.prunedCount).toBe(1);
  });

  it('显式保护带 120K：8 轮×5万 token 时仅擦除 3 条更早输出', () => {
    const msgs = session(8, 200_000);
    const r = pruneToolResults(msgs, { protectTokens: 120_000 });
    expect(r.modified).toBe(true);
    expect(r.prunedCount).toBe(3);
    for (const i of [2, 5, 8]) expect(messageText(r.messages[i])).toMatch(/^\[pruned: \d+ chars\]$/);
    for (const i of [11, 14, 17, 20, 23]) expect(messageText(r.messages[i])).toContain('y');
  });

  it('擦除单调性：追加新回合后旧擦除点保持擦除（占位不恢复）', () => {
    const before = pruneToolResults(session(8, 200_000));
    const extended = [...before.messages, user(), assistant(), toolResult('z'.repeat(200_000))];
    const after = pruneToolResults(extended);
    for (const i of [2, 5, 8]) expect(messageText(after.messages[i])).toMatch(/^\[pruned: \d+ chars\]$/);
  });

  it('已擦除判定：正文含 "[pruned:" 字面量（非开头）不误判', () => {
    const msgs = session(8, 200_000);
    msgs[2] = toolResult(`文件内容如下：\n[pruned: 12345 chars]\n${'y'.repeat(200_000)}`);
    const r = pruneToolResults(msgs, { protectTokens: 120_000 });
    expect(r.prunedCount).toBe(3);
    expect(isPrunedMessage(msgs[2])).toBe(false);
    expect(messageText(r.messages[2])).toMatch(/^\[pruned: \d+ chars\]$/);
  });

  it('已擦除判定：真实 marker 开头被识别，重扫不重复擦除', () => {
    const first = pruneToolResults(session(8, 200_000));
    const pruned = first.messages[2];
    expect(isPrunedMessage(pruned)).toBe(true);
    const second = pruneToolResults(first.messages, { protectTokens: 0, minimumTokens: 0 });
    expect(second.messages[2]).toBe(pruned);
  });

  it('角色门卫与 marker 前导空白容忍', () => {
    expect(isPrunedMessage({ role: 'user', content: [{ type: 'text', text: '[pruned: 1 chars]' }] })).toBe(false);
    expect(isPrunedMessage(toolResult('[pruned: 1 chars]'))).toBe(true);
    expect(isPrunedMessage(toolResult('  \n[pruned: 1 chars]'))).toBe(true);
    expect(isPrunedMessage(toolResult('output... [pruned: 1 chars] more'))).toBe(false);
  });

  it('messageText 只提取 text block', () => {
    const m: PruneMessage = {
      role: 'toolResult',
      content: [
        { type: 'text', text: '第一段' },
        { type: 'other', text: '忽略' },
        { type: 'text', text: '第二段' },
      ],
    };
    expect(messageText(m)).toBe('第一段\n第二段');
  });

  it('非 text 块（图片等）被替换为占位文本块', () => {
    const tool = (imgData: string): PruneMessage => ({
      role: 'toolResult',
      content: [
        { type: 'image', data: imgData, mimeType: 'image/png' },
        { type: 'text', text: 'y'.repeat(200_000) },
      ],
    });
    const msgs: PruneMessage[] = [
      user(), assistant(), tool('aaaa'),
      user(), assistant(), tool('bbbb'),
      user(), assistant(), tool('cccc'),
      user(), assistant(), tool('dddd'),
      user(), assistant(), tool('eeee'),
    ];
    const r = pruneToolResults(msgs, { protectTokens: 40_000, minimumTokens: 0 });
    const blockTypes = (m: PruneMessage): string[] =>
      Array.isArray(m.content) ? (m.content as { type?: string }[]).map((b) => b.type ?? '') : [];
    expect(r.modified).toBe(true);
    expect(blockTypes(r.messages[2])).not.toContain('image');
    expect(blockTypes(r.messages[2])).toEqual(['text', 'text']);
    expect(blockTypes(r.messages[8])).toContain('image');
  });

  it('常数：擦除调优（60K/30K/2）——原 120K/80K 在长会话中从未触发', () => {
    expect(PRUNE_PROTECT_TOKENS).toBe(60_000);
    expect(PRUNE_MINIMUM_TOKENS).toBe(30_000);
    expect(KEEP_RECENT_TURNS).toBe(2);
  });
});

describe('pruneThinkingBudget: thinking 按 token 预算保留', () => {
  function assistantWithThinking(thinking: string, text = '回复'): PruneMessage {
    return { role: 'assistant', content: [{ type: 'thinking', thinking }, { type: 'text', text }] };
  }
  function userMsg(): PruneMessage {
    return { role: 'user', content: [{ type: 'text', text: '用户消息' }] };
  }

  it('预算内 → 不修改', () => {
    const msgs = [userMsg(), assistantWithThinking('x'.repeat(1000)), assistantWithThinking('y'.repeat(2000))];
    expect(pruneThinkingBudget(msgs, 16_000).modified).toBe(false);
  });

  it('超预算 → 预算耗尽处及更早的 thinking 删除，保留 text 块', () => {
    const msgs = [
      userMsg(),
      assistantWithThinking('a'.repeat(20_000), '回复1'),
      assistantWithThinking('b'.repeat(20_000), '回复2'),
      assistantWithThinking('c'.repeat(20_000), '回复3'),
    ];
    const r = pruneThinkingBudget(msgs, 8_000);
    expect(r.modified).toBe(true);
    const contents = r.messages.map((m) => (Array.isArray(m.content) ? m.content : []));
    expect(contents[3].filter((b) => b.type === 'thinking')).toHaveLength(1);
    expect(contents[1].filter((b) => b.type === 'thinking')).toHaveLength(0);
    expect(contents[1].some((b) => b.type === 'text' && b.text === '回复1')).toBe(true);
  });

  it('无 thinking → 不修改', () => {
    const msgs = [userMsg(), { role: 'assistant', content: [{ type: 'text', text: '回复' }] }];
    expect(pruneThinkingBudget(msgs, 1_000).modified).toBe(false);
  });
});

describe('pruneToolResults: dumpRef 擦除溯源', () => {
  it('dumpRef 返回路径 → marker 内嵌路径，回调收到完整原文', () => {
    const msgs = session(3);
    const r = pruneToolResults(msgs, {
      minimumTokens: 0,
      protectTokens: 0,
      keepRecentTurns: 0,
      dumpRef: (text, meta) => {
        expect(meta.chars).toBe(text.length);
        return `/tmp/refs/${meta.index}.md`;
      },
    });
    expect(r.modified).toBe(true);
    const prunedMsg = r.messages.find((m, i) => m !== msgs[i])!;
    expect(messageText(prunedMsg)).toContain('→ /tmp/refs/');
  });

  it('dumpRef 抛错/返回 null → 降级纯 chars marker', () => {
    const refs: Array<() => string | null> = [
      () => {
        throw new Error('disk full');
      },
      () => null,
    ];
    for (const ref of refs) {
      const msgs = session(3);
      const r = pruneToolResults(msgs, { minimumTokens: 0, protectTokens: 0, keepRecentTurns: 0, dumpRef: ref });
      expect(messageText(r.messages.find((m, i) => m !== msgs[i])!)).toMatch(/^\[pruned: \d+ chars\]$/);
    }
  });

  it('已擦除消息跳过：不重选、不再回调 dumpRef', () => {
    let calls = 0;
    const msgs = session(3);
    const r1 = pruneToolResults(msgs, {
      minimumTokens: 0,
      protectTokens: 0,
      keepRecentTurns: 0,
      dumpRef: () => { calls++; return '/tmp/refs/x.md'; },
    });
    const before = calls;
    const r2 = pruneToolResults(r1.messages, {
      minimumTokens: 0,
      protectTokens: 0,
      keepRecentTurns: 0,
      dumpRef: () => { calls++; return '/tmp/refs/x.md'; },
    });
    expect(r2.modified).toBe(false);
    expect(calls).toBe(before);
  });
});

describe('sweepPruneRefs: 擦除溯源目录清理', () => {
  it('过期文件按 mtime 删除；总量超限从最旧删起', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-prune-refs-'));
    const oldFile = join(dir, 'old.md');
    const newFile = join(dir, 'new.md');
    writeFileSync(oldFile, 'x'.repeat(100));
    writeFileSync(newFile, 'y'.repeat(100));
    const past = new Date(Date.now() - 30 * 86_400_000);
    utimesSync(oldFile, past, past);

    const stats = await sweepPruneRefs(dir, { retentionDays: 14 });
    expect(stats.scanned).toBe(2);
    expect(stats.deletedByAge).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);

    const stats2 = await sweepPruneRefs(dir, { retentionDays: -1, maxTotalBytes: 50 });
    expect(stats2.deletedBySize).toBe(1);
    expect(existsSync(newFile)).toBe(false);
  });

  it('目录不存在 → 空统计不抛错', async () => {
    const stats = await sweepPruneRefs('/nonexistent/my-pi-prune-refs-xyz');
    expect(stats.scanned).toBe(0);
  });
});

describe('buildPruneDumpRef: 擦除落盘回调', () => {
  it('写入 refs 目录并返回路径；已含 marker 的文本返回 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prune-dump-'));
    process.env.PI_PRUNE_REFS_DIR = dir;
    const { buildPruneDumpRef } = await import('../budget/prune-dump');
    const dump = buildPruneDumpRef({ sessionManager: { getSessionId: () => 'sess/1' } })!;
    expect(dump).toBeTypeOf('function');
    const ref = dump('原始输出', { index: 3, chars: 4 });
    expect(ref).toBe(join(dir, 'sess_1.md'));
    expect(existsSync(ref!)).toBe(true);
    expect(dump('[pruned: 4 chars]', { index: 3, chars: 4 })).toBeNull();
    delete process.env.PI_PRUNE_REFS_DIR;
  });

  it('PI_DISABLE_PRUNE_DUMP=1 → 不落盘', async () => {
    process.env.PI_DISABLE_PRUNE_DUMP = '1';
    const { buildPruneDumpRef } = await import('../budget/prune-dump');
    expect(buildPruneDumpRef(undefined)).toBeUndefined();
    delete process.env.PI_DISABLE_PRUNE_DUMP;
  });
});
