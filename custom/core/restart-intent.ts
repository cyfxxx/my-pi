/**
 * restart-intent.ts — "重启后要不要继续执行任务"的判据（纯逻辑，零 Pi 依赖）
 *
 * 背景（2026-10-06 用户反馈）：重启后注入"系统已重启，请从中断处继续当前任务"会**触发一次模型回合**。
 * 原意是自动接上被中断的工作，但很多重启根本没有在途任务——切模式、换模型、切会话、模型自己刚收尾
 * 就重启——于是白烧一次"重启后首轮全量重放"（仓库既有实测：重启后第二个回合一次 ≈80k 全量重放），
 * 还可能让模型凭空"编"一个任务出来（实测会话里能看到它对着重启通知自问"我该继续做什么"）。
 *
 * 判据分三层（优先级从高到低）：
 *   1. **写入端声明的意图**（`intent`）：谁请求的重启，谁最清楚有没有下一步——
 *      看门狗（回合卡死被中断）→ `continue`；`/mode`、`set_model`、`switch_session`（用户驱动的
 *      档位/会话变更）→ `none`；模型调 `admin_restart` 时用 `resume` 参数**自己声明**
 *      （它此刻上下文完整，判断是零成本的）。
 *   2. **盘面尾部**（transcript tail）：没人声明（`auto`：崩溃恢复、旧请求）时看会话最后一条是什么：
 *      未回答的 user 消息 / 带未完成工具调用的 assistant / 未消化的 toolResult / 轮次开始后才注入的
 *      custom 消息 → 工作在途 → 继续；assistant 纯文本收尾 → 已完成 → 不继续。
 *   3. **环境开关** `PI_RESTART_RESUME=off|auto|always`：强制关闭/强制继续（测试与用户偏好）。
 *
 * 为什么**不**让模型在重启后"自己判断"：那要求先跑一个回合才轮到它判断——成本已经付掉了，而它
 * 看到的只是历史，无从知道用户是否还想要这件事继续。让模型在**它能知情的时刻**（调 admin_restart
 * 时）声明意图，才是零成本且信息最全的位置；真被唤醒时，指令里也写明"若已完成或不确定就停下来说明"，
 * 避免它为了"继续"而编任务。
 *
 * 通道（消费者侧，见 features/autopilot/index.ts）：
 *   resume=true  → `sendMessage(..., { triggerTurn: true })`：真的跑一个回合接上工作；
 *   resume=false → `sendMessage(..., { deliverAs: 'nextTurn' })`：只在**下一次**真正要跑时
 *                  作为上下文出现（落 `_pendingNextTurnMessages`，不触发回合、不写会话文件、零成本）。
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';

/** 重启续跑意图：写入端声明；`auto` = 交给盘面尾部判 */
export type RestartResumeIntent = 'continue' | 'none' | 'auto';

/** 会话盘面尾部形态（只关心"是否还有在途工作"） */
export type TranscriptTailKind =
  | 'empty' // 没有会话文件 / 空会话 / 只有元数据条目
  | 'user' // 最后一条是用户消息：用户的请求还没被回答
  | 'assistant-tool-calls' // 最后一条是 assistant 且带工具调用：工具还没返回
  | 'assistant-text' // 最后一条是 assistant 纯文本：该回合已经收尾
  | 'tool-result' // 最后一条是工具结果：模型还没消化
  | 'custom' // 最后一条是扩展注入的 custom 消息：回合已开始但没跑完
  | 'system'; // 最后一条是 system（回合刚准备）：保守视为没有在途工作

export interface ResumeDecision {
  /** 是否真的唤醒模型继续干活 */
  resume: boolean;
  /** 判据（进日志/通知，便于事后解释"为什么这次没继续"） */
  reason: string;
}

/** 读取会话盘面尾部时最多回看多少字节（会话可能几 MB，只关心最后几条） */
export const TAIL_READ_BYTES = 256 * 1024;

/**
 * 读取会话文件的**最后一条实质条目**的形态。
 *
 * 跳过 `session` / `model_change` / `thinking_level_change` / `label` 这类元数据；
 * 只看 `message`（user/assistant/toolResult）与 `custom_message`。
 * 任何异常（文件不存在、坏 JSON、截断）都归到 `empty`——判据保守，不因为读不到盘面就自动开工。
 */
export function tailKindFromSessionFile(sessionFile: string | undefined | null): TranscriptTailKind {
  if (!sessionFile) return 'empty';
  let text = '';
  try {
    const size = statSync(sessionFile).size;
    if (size <= 0) return 'empty';
    const start = Math.max(0, size - TAIL_READ_BYTES);
    const fd = openSync(sessionFile, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf-8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return 'empty';
  }
  return tailKindFromLines(text.split('\n'));
}

/** 从（可能被截断的）JSONL 文本里倒着找最后一条实质条目 */
export function tailKindFromLines(lines: readonly string[]): TranscriptTailKind {
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]?.trim();
    if (!raw) continue;
    // 截断窗口的第一行多半是半个 JSON；解析失败就继续往前找
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = entry.type;
    if (type === 'custom_message') return 'custom';
    if (type !== 'message') continue; // session / model_change / thinking_level_change / label ...
    const message = (entry.message ?? {}) as Record<string, unknown>;
    const role = message.role;
    if (role === 'user') return 'user';
    if (role === 'toolResult') return 'tool-result';
    if (role === 'system') return 'system';
    if (role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : [];
      const hasToolCall = content.some((c) => {
        const t = (c as Record<string, unknown>)?.type;
        return typeof t === 'string' && t.toLowerCase().includes('toolcall');
      });
      return hasToolCall ? 'assistant-tool-calls' : 'assistant-text';
    }
    // 未知角色：保守当作"没有在途工作"
    return 'system';
  }
  return 'empty';
}

/** 盘面尾部的默认判据（`intent='auto'` 时用） */
function resumeFromTail(tail: TranscriptTailKind): ResumeDecision {
  switch (tail) {
    case 'user':
      return { resume: true, reason: 'tail-pending-user-message' };
    case 'assistant-tool-calls':
      return { resume: true, reason: 'tail-interrupted-tool-calls' };
    case 'tool-result':
      return { resume: true, reason: 'tail-pending-tool-result' };
    case 'custom':
      return { resume: true, reason: 'tail-turn-started-not-finished' };
    default:
      return { resume: false, reason: `tail-${tail}` };
  }
}

/**
 * 合并三层判据，给出"要不要唤醒模型继续"的结论。
 *
 * `intent` 来自磁盘上的 restartLog（外部数据），非法值一律当 `auto`。
 */
export function decideRestartResume(opts: {
  intent?: unknown;
  tail: TranscriptTailKind;
  /** `PI_RESTART_RESUME`；`off` 强制不继续、`always` 强制继续 */
  env?: string | undefined;
}): ResumeDecision {
  const force = (opts.env ?? '').trim().toLowerCase();
  if (force === 'off') return { resume: false, reason: 'env-off' };
  if (force === 'always') return { resume: true, reason: 'env-always' };

  const intent = opts.intent;
  if (intent === 'none') return { resume: false, reason: 'intent-none' };
  if (intent === 'continue') return { resume: true, reason: 'intent-continue' };
  return resumeFromTail(opts.tail);
}

/** 归一化写入端的意图值（工具参数/环境都可能给脏值） */
export function normalizeResumeIntent(value: unknown, fallback: RestartResumeIntent = 'auto'): RestartResumeIntent {
  if (value === 'continue' || value === 'none' || value === 'auto') return value;
  return fallback;
}

/** 续跑指令（唤醒模型时注入；明确允许"没有下一步就停下"，防止它为了继续而编任务） */
export function formatResumePrompt(noticeLine: string): string {
  return (
    `${noticeLine}。历史上下文已恢复。` +
    `如果你还有下一步行动，请继续执行；如果任务已完成或不确定，请停下来向用户说明，不要凭空开工。`
  );
}

/** 这条重启日志是否归 mode 功能自己通知（`notice: 'mode'`）——消费者据此让位 */
export function isModeOwnedNoticeLog(log: Record<string, unknown> | null | undefined): boolean {
  return Boolean(log) && log?.notice === 'mode';
}

/** 重启通知的文案行（消费者共用；含操作/原因/目标模型/会话路径） */
export function formatRestartLine(log: Record<string, unknown>): string {
  const reason = typeof log.reason === 'string' && log.reason ? log.reason : '(未指定原因)';
  let line = `系统已重启。操作: ${String(log.action ?? '?')} | 原因: ${reason}`;
  if (log.targetProvider || log.targetModel) {
    line += ` | 目标模型: ${String(log.targetProvider ?? '-')}/${String(log.targetModel ?? '-')}`;
  }
  if (typeof log.targetSession === 'string' && log.targetSession) {
    line += ` | 会话: ${log.targetSession}`;
  }
  return line;
}

/** 注入计划：`turn` = 真跑一个回合；`next-turn` = 零成本上下文备注；`none` = 什么都不注入 */
export interface NoticePlan {
  channel: 'turn' | 'next-turn';
  customType: string;
  content: string;
  reason: string;
}

/**
 * 把"这条重启日志该怎么告知模型"算成一个计划（纯函数；谁注入、用哪个通道由调用方决定）。
 *
 * 两个消费者共用它：\`features/autopilot\`（注册了 autopilot 的模式）与 \`features/mode\` 的兜底
 * （roleplay/lean/minimal 里没注册 autopilot，通用日志否则**没人消费** → 崩溃恢复后既没有通知
 * 也不会续跑，且完全静默）。
 */
export function planRestartNotice(opts: {
  log: Record<string, unknown>;
  tail: TranscriptTailKind;
  env?: string | undefined;
}): NoticePlan {
  const line = formatRestartLine(opts.log);
  const decision = decideRestartResume({ intent: opts.log.intent, tail: opts.tail, env: opts.env });
  if (decision.resume) {
    return { channel: 'turn', customType: 'my-pi-restart-resume', content: `[系统] ${formatResumePrompt(line)}`, reason: decision.reason };
  }
  return { channel: 'next-turn', customType: 'my-pi-restart-note', content: `[系统] ${formatResumeSkippedNote(line, decision.reason)}`, reason: decision.reason };
}

/** 不续跑时的上下文备注（`deliverAs: 'nextTurn'`：零成本，等下一次真正要跑时出现） */
export function formatResumeSkippedNote(noticeLine: string, reason: string): string {
  return `${noticeLine}。本次重启不需要继续执行任务（判据: ${reason}）；历史上下文已恢复，等用户指示。`;
}
