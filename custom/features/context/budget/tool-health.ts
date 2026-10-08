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

// ─────────────────────────────────────────────────────────────────────────────
// 错误指纹 + 修复预算（P7，见 docs/design/SOL-PI-BORROW.md）
//
// 借鉴 SoL-Pi："Budget repair per error fingerprint"、"Give counterexamples precedence and break
// repeated failure loops"、"Break repeated diagnostic loops without stopping real progress"。
//
// 与上面的"连续失败熔断"互补、**不替换它**（那是按**工具名**计数，语义不同、已被依赖）：
//   · 熔断按工具名 → "同一个工具连续失败 3 次"（可能每次错因不同）
//   · 修复预算按**错误指纹** → "同一个错误出现 3 次，期间换过 M 组参数仍失败"
// 后者才是真打转的信号：**换了参数还是同一个错**，说明问题不在参数上。
//
// 指纹必须**去掉易变部分**（路径、行号、耗时、哈希、端口…），否则同一个错每次指纹都不同、
// 永远不触发；但也不能归一化过头，把不同错误并成一个。两个方向都有测试钉住。
// ─────────────────────────────────────────────────────────────────────────────

/** 在第几次"同一错误"上提醒（只在这些**恰好**的计数上提醒） */
export const REPAIR_BUDGET_AT: ReadonlySet<number> = new Set([3, 5, 8]);
/** 滑窗：超过这个时长没有再次出现的指纹会被丢弃（"打转"是短时间内的事） */
export const REPAIR_WINDOW_MS = 15 * 60 * 1000;
/** 指纹摘要保留的字符数（给模型看的片段，不是全量报错） */
export const FINGERPRINT_EXCERPT_MAX = 160;

/**
 * 错误文本的确定性归一化（只用于**指纹**，不改动给模型看的原文）。
 * 去：ANSI 控制序列、绝对路径/家目录、UUID 与长十六进制、耗时、行号列号、其余独立数字。
 */
export function normalizeErrorForFingerprint(text: string): string {
  let s = text;
  s = s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''); // ANSI
  s = s.replace(/~\/[\w.@+-/]+/g, '<path>'); // ~/...
  s = s.replace(/(?:[A-Za-z]:\\|\/)(?:[\w.@+-]+\/)+[\w.@+-]*/g, '<path>'); // 绝对路径
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>'); // UUID
  s = s.replace(/\b[0-9a-f]{7,}\b/gi, '<id>'); // 哈希/obj id
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds|min|mins|minutes)\b/gi, '<t>');
  s = s.replace(/\bline\s+\d+/gi, 'line <n>');
  s = s.replace(/[:,]\d+(?::\d+)?\b/g, ':<n>'); // :12 / :12:34
  s = s.replace(/\b\d+(?:\.\d+)?\b/g, '<n>'); // 其余独立数字
  return s.replace(/\s+/g, ' ').trim();
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 指纹：`<工具名>:<归一化后的短哈希>`；`excerpt` 是归一化文本的前若干字符，供提示文案用 */
export function errorFingerprint(toolName: string, errorText: string): { key: string; excerpt: string } {
  const norm = normalizeErrorForFingerprint(errorText);
  const excerpt = norm.length > FINGERPRINT_EXCERPT_MAX ? `${norm.slice(0, FINGERPRINT_EXCERPT_MAX)}…` : norm;
  return { key: `${toolName || 'tool'}:${djb2(norm)}`, excerpt };
}

interface RepairEntry {
  attempts: number;
  argKeys: Set<string>;
  firstAt: number;
  lastAt: number;
}

export interface RepairBudgetState {
  entries: Map<string, RepairEntry>;
}

export function createRepairBudget(): RepairBudgetState {
  return { entries: new Map() };
}

export interface RepairObservation {
  key: string;
  excerpt: string;
  /** 该指纹在窗口内出现的次数（含本次） */
  attempts: number;
  /** 期间用过的**不同参数**组数——这是"换参数还是同一个错"的直接证据 */
  distinctArgs: number;
  /** 本次是否应当提醒 */
  remind: boolean;
}

/**
 * 记一次失败并返回修复预算视图。`argKey` 用 `repeat-reminder.ts` 的 `stableKey(input)` 得到
 * （统一一份稳定键实现，避免两套）。窗口外的旧指纹会被丢弃。
 */
export function observeRepairAttempt(
  state: RepairBudgetState,
  opts: { toolName: string; errorText: string; argKey: string; nowMs?: number; windowMs?: number },
): RepairObservation {
  const now = opts.nowMs ?? Date.now();
  const windowMs = opts.windowMs ?? REPAIR_WINDOW_MS;
  for (const [k, e] of state.entries) {
    if (now - e.lastAt > windowMs) state.entries.delete(k);
  }
  const { key, excerpt } = errorFingerprint(opts.toolName, opts.errorText);
  const prev = state.entries.get(key);
  const entry: RepairEntry = prev ?? { attempts: 0, argKeys: new Set<string>(), firstAt: now, lastAt: now };
  entry.attempts += 1;
  entry.argKeys.add(opts.argKey);
  entry.lastAt = now;
  state.entries.set(key, entry);
  return {
    key,
    excerpt,
    attempts: entry.attempts,
    distinctArgs: entry.argKeys.size,
    remind: REPAIR_BUDGET_AT.has(entry.attempts),
  };
}

/** 提醒文案：给出"同一错误 + 换过几组参数"这两个可操作事实 */
export function repairBudgetHint(o: RepairObservation): string {
  return (
    `\n\n→ 修复预算提示：同一错误已出现 ${o.attempts} 次，期间换过 ${o.distinctArgs} 组参数仍失败。` +
    `\n   错误特征：${o.excerpt}` +
    `\n   换参数无效说明问题不在参数上——先定位根因（读报错原文/核对前置条件），或改用替代方案；不要原样重试。`
  );
}
