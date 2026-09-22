/**
 * 工具健康度纯逻辑（迁移自 pi-tools `pi-context/tool-truncation.ts` 的熔断/脱水部分）
 *
 * 与 NEW 已有的 token 预算截断（budget.pruneToolOutput）互补，不重复截断：
 *   - 连续失败熔断：同一工具连续失败 ≥3 次，在输出尾部追加熔断提示，打断无效重试。
 *   - 错误脱水：错误输出里的连续重复行折叠为 2 行 + 标记，超长行截断，降低 token
 *     而不丢失头尾关键信息。
 *
 * 零 Pi 依赖，便于测试；状态（failStreak Map）由调用方持有。
 */

export const ERROR_MARK_RE = /(^|\n)\s*(Error|ERROR|Traceback \(most recent call last\)|error:)/;
export const ERROR_LINE_MAX = 800;
export const ERROR_LINE_KEEP = 240;
export const FAIL_STREAK_LIMIT = 3;

export const FAIL_BREAKER_HINT =
  '\n\n→ 熔断提示：同一工具已连续失败 3 次以上。停止重复尝试：先检查前置条件（路径/权限/网络/参数）或改用替代方案；再次失败应暂停并向用户说明。';
export const DEHYDRATE_HINT = '\n→ 错误已精简；连续失败时优先参考记忆库 [solutions] 条目。';

/** 更新失败连击：返回触发熔断的提示（仅第 3 次触发，之后不重复） */
export function updateFailStreak(
  streak: Map<string, number>,
  toolName: string,
  isError: boolean,
): { n: number; hint?: string } {
  if (!isError) {
    streak.delete(toolName);
    return { n: 0 };
  }
  const n = (streak.get(toolName) ?? 0) + 1;
  streak.set(toolName, n);
  return n === FAIL_STREAK_LIMIT ? { n, hint: FAIL_BREAKER_HINT } : { n };
}

/** 错误输出确定性脱水：重复行折叠、超长行截断；无错误标记或无变化返回 undefined */
export function dehydrateErrorOutput(text: string): string | undefined {
  if (!ERROR_MARK_RE.test(text)) return undefined;
  const lines = text.split('\n');
  const out: string[] = [];
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run++;
    if (run > 2) {
      out.push(line, line, `[...${run - 2} 行重复已折叠]`);
      changed = true;
    } else if (Buffer.byteLength(line, 'utf8') > ERROR_LINE_MAX) {
      out.push(`${line.slice(0, ERROR_LINE_KEEP)}...[行截断]`);
      changed = true;
    } else {
      out.push(line);
    }
    i += run;
  }
  return changed ? out.join('\n') : undefined;
}

export interface TextBlockLike {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

/** 原位重建：把 text 写回第一个 text 块位置，保留其余（图片等）块 */
export function rebuildTextContent<T extends TextBlockLike>(content: T[], text: string): T[] {
  const rebuilt: T[] = [];
  let placed = false;
  for (const c of content) {
    if (c.type === 'text') {
      if (!placed) {
        rebuilt.push({ ...c, text });
        placed = true;
      }
    } else {
      rebuilt.push(c);
    }
  }
  if (!placed) rebuilt.push({ type: 'text', text } as T);
  return rebuilt;
}
