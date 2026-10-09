/**
 * 参数转发守门（源码级）
 *
 * ## 为什么需要它
 *
 * 2026-10-08 加 `parentSession` 时 `tsc` 暴露出一个**上批（S4）留下的真实缺陷**：
 * `runSubprocessAgent` 里对 `runPooledAgent(...)` 的调用**根本没传 `allowExtensions`**
 * ⇒ **池化路径（默认开启）会静默忽略 `extensions` 选项**——spawn 路径正常、池化路径失效，
 * 而"测函数本身"的单元测试（`buildPooledSpawnArgs`/`pooledProfileKey`）**全都测不到这条接线**。
 * 这类"新增参数没透传"的缺陷有三个特点：编译器只在**部分**场景报错、测试全绿、运行时静默降级。
 *
 * 因此这里用**源码级断言**盯住"参数必须出现在调用处"——与 `evaluate-no-named-functions.test.ts`
 * 的 AST 守门同思路：把"不能忘"变成"忘了就红"。它比端到端测试便宜得多（毫秒级、默认门禁里跑），
 * 又比单元测试有效（单元测试看不见接线）。
 *
 * 注意：这是**结构性守门**，不检查语义。若将来有人把这些参数改成"从上下文对象里取"，
 * 本守门会红——那时应当**改守门**（改成盯新的接线形态），而不是删掉它。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUNNER = readFileSync(join(__dirname, '..', 'core', 'runner.ts'), 'utf8');

/** 取出某个函数调用的完整参数文本（括号配对，够用于本文件的规模） */
function callArgs(source: string, callee: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${callee}(`, from);
    if (at < 0) break;
    const start = at + callee.length + 1;
    // 跳过**定义处**（`function runPooledAgent(...)` / `async function ...`）——只认调用
    if (/function\s+$/.test(source.slice(Math.max(0, at - 20), at))) {
      from = start;
      continue;
    }
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
    }
    out.push(source.slice(start, i - 1));
    from = i;
  }
  return out;
}

describe('runner.ts 的参数必须真的被转发（防"新增参数没透传"）', () => {
  it('runPooledAgent 的调用处必须传 allowExtensions 与 parentSession', () => {
    const calls = callArgs(RUNNER, 'runPooledAgent').filter((a) => a.includes('makeDetails'));
    expect(calls.length, '应当恰好有一个真正的 runPooledAgent 调用').toBe(1);
    // 上批缺陷就是这里：allowExtensions 没传 ⇒ 池化路径静默忽略 extensions
    expect(calls[0], 'runPooledAgent 调用处漏传 allowExtensions').toContain('allowExtensions');
    expect(calls[0], 'runPooledAgent 调用处漏传 parentSession').toContain('parentSession');
  });

  it('runSubprocessAgent 的每个调用处都要传 allowExtensions 与 parentSession', () => {
    const calls = callArgs(RUNNER, 'runSubprocessAgent').filter((a) => a.includes('defaultCwd'));
    expect(calls.length, 'runSingleAgent 里有两条 runSubprocessAgent 调用').toBeGreaterThanOrEqual(2);
    for (const [i, a] of calls.entries()) {
      expect(a, `第 ${i + 1} 处 runSubprocessAgent 漏传 allowExtensions`).toContain('allowExtensions');
      expect(a, `第 ${i + 1} 处 runSubprocessAgent 漏传 parentSession`).toContain('parentSession');
    }
  });

  it('落用量记录前必须先把 parentSession 写到 currentResult 上（两处）', () => {
    const writes = RUNNER.match(/currentResult\.parentSession = parentSession;/g) ?? [];
    expect(writes.length, '池化与 spawn 两条路径都要写 parentSession（返工指标靠它归属父会话）').toBe(2);
  });
});
