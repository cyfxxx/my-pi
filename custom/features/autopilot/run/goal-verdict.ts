/**
 * 目标验收的**独立评审**（`goal complete` 的第二校验来源）
 *
 * ## 为什么是"第二来源"而不是唯一来源
 *
 * P1 给 `goal complete` 落了第一来源：一条**只读检查命令**由 my-pi 实际跑通（exit 0）⇒ `verified`。
 * 那是最硬的判据（确定性、可复现）。但有些目标**没有可跑的检查**（"调研并给出结论""读完这份文档"），
 * 这时能用的只有语言判断。本模块提供**第二来源**：让一个**独立上下文的评审者**判断目标是否真的达成。
 *
 * **优先级**：确定性命令 > 独立评审。两者都有时用命令；只有评审时也可记为 verified，但要**标明来源**。
 *
 * ## 为什么不用 `verify_*` 现成的 5 个导出（2026-10-08 更正）
 *
 * 我曾以为 `DEFAULT_JUDGE_PROMPT` / `parseJudgeScores` / `CandidateScore` / `VerificationRecord` /
 * `ProgressTracker` 那套"正好是这里缺的一半"。**核实后不成立**：那套的形状是
 * **Best-of-N 候选打分**（`bestIndex`、`scores[]`、`nCandidates`、`selectedIndex`），回答的是
 * "**N 个候选里哪个最好**"；而这里要回答"**这个目标真的达成了吗**"——**二元判定 + 理由**。
 * 拿候选打分的提示词去问完成与否是把工具用错地方，所以这里**专门写**提示词与解析器。
 *
 * ## 通道
 *
 * pi **不**给扩展暴露"调用模型"的 API（ExtensionContext 只有 `sendMessage`（投递，不同步返回）、
 * `setModel`/`getModel`/`getThinkingLevel`、`executeTool`）。因此评审走
 * **`ctx.executeTool('subagent', ...)`** 起一个独立子代理——顺带拿到一个更强的好处：
 * **评审在独立上下文里做，看不到当前会话的自我叙述**，这比在同会话里问模型自己更硬。
 *
 * ## 解析原则：宽进严出，认不出就不猜
 *
 * **评审者的代价（论文明写）**：reviewer 的假阳性会变成额外回合——所以这是 opt-in，且失败一律 fail-open。
 *
 * 输出格式由提示词**强制**（第一行 `判定：DONE` / `判定：NOT-DONE`，第二行 `理由：…`），
 * 所以解析是**确定性**的；认不出标记时返回 `done: null`（**不猜**），由调用方 fail-open 保持 `declared`。
 */

/** 提示词要求的判定标记前缀（解析与提示词共享同一个常量，避免两边漂移） */
export const VERDICT_MARKER = '判定：';

/** 评审原文保留的最大字符数（账本/状态文案里不长篇引用） */
export const JUDGE_RAW_MAX = 800;

export interface GoalVerdict {
  /** true=达成；false=未达成；**null=认不出判定**（不是"未达成"，调用方据此 fail-open） */
  done: boolean | null;
  reason: string;
  /** 评审原文（截断） */
  raw: string;
}

export interface GoalJudgeInput {
  objective: string;
  /** 执行者自己的说明（`goal complete` 的 note/evidence） */
  note?: string;
  /**
   * 评审用的模型（可选，opt-in）。**为什么值得换模型**（Humanize arXiv:2610.08900 §2.1 的联合采样）：
   * 同一个模型的"提议"与"接受"共用同一个盲区，缺陷存活概率 `b` 只在换了一个**独立**的评判者后才降到
   * `b·m_R`。不传时继承主会话模型 ⇒ 行为与以前逐字节一致。
   */
  model?: string;
}

/**
 * 派哪个 agent 做评审：`reviewer`。
 *
 * 选它的**决定性理由是它 `tools` 里有 `bash`**（见 `portable/agent/agents/reviewer.md`）——
 * Humanize §7 的反面证据说得很明确：**评审者不能跑测试时，跨模型评审是有害的**。
 * 所以"换模型"必须与"评审者能执行"同时成立，否则只是换了个复读机。
 */
export const JUDGE_AGENT = 'reviewer';

/**
 * 为"目标是否真的达成"专门写的二元判定提示词。
 *
 * 两条刻意的措辞：
 * - **默认怀疑**：信息不足以证明达成时判 NOT-DONE。一个倾向于说"完成"的评审等于没有评审。
 * - **强制格式**：第一行标记、第二行理由，使解析确定化（而不是去猜散文的意思）。
 */
export function buildGoalJudgePrompt(input: GoalJudgeInput): string {
  const objective = input.objective.trim();
  const note = (input.note ?? '').trim() || '（未提供）';
  return [
    '你是一名**独立验收员**。另一个执行者声称完成了下面这个目标，请你判断它**是否真的达成**。',
    '',
    `目标：${objective}`,
    '',
    `执行者的说明：${note}`,
    '',
    '要求：',
    '1. 只依据上面给出的信息判断。**信息不足以证明目标已达成时，判 NOT-DONE**——不要因为措辞自信就放行。',
    '2. 指出你依据什么、缺什么；不要臆测未给出的结果。',
    '3. 严格按下面两行开头作答（标记必须原样出现在行首，便于程序解析）：',
    `   第一行：${VERDICT_MARKER}DONE 或 ${VERDICT_MARKER}NOT-DONE`,
    '   第二行：理由：<一句话>',
  ].join('\n');
}

/** 从评审文本里抽出判定与理由（认不出标记 ⇒ done=null，**不猜**） */
export function parseGoalVerdict(text: string): GoalVerdict {
  const raw = String(text ?? '').slice(0, JUDGE_RAW_MAX);
  // NOT-DONE 必须排在 DONE 前面，否则会被 DONE 抢先匹配
  const m = /判定\s*[:：]\s*(NOT[\s_-]?DONE|DONE)/i.exec(raw);
  if (!m) {
    return { done: null, reason: '评审输出里没有「判定：DONE / 判定：NOT-DONE」标记（不猜）', raw };
  }
  const done = !m[1].toUpperCase().startsWith('NOT');
  const reasonMatch = /理由\s*[:：]\s*(.+)/.exec(raw);
  const reason = reasonMatch ? reasonMatch[1].trim().slice(0, 300) : '(评审未给理由)';
  return { done, reason, raw };
}

/** 嵌套工具调用通道（由适配器的 `ctx.executeTool` 提供；不可用时 undefined） */
export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;

export interface GoalJudgeOutcome extends GoalVerdict {
  /** 非空表示**没能拿到判定**（通道缺失/调用失败/超时）——调用方据此 fail-open，不要把原因说成"未达成" */
  skipped?: string;
}

/** 评审默认超时（毫秒）。超时只是**我们不再等**；子代理自身的上限仍在（120s ≪ 子代理 30min 总上限） */
export const JUDGE_TIMEOUT_MS = 120_000;

/**
 * 跑一次独立评审。**任何异常路径都返回 `done: null` + `skipped` 说明**（fail-open）：
 * 评审是"加分项"，绝不能因为它坏掉而让目标状态变坏或阻塞完成。
 */
export async function runGoalJudge(
  call: ToolCaller | undefined,
  input: GoalJudgeInput,
  timeoutMs: number = JUDGE_TIMEOUT_MS,
): Promise<GoalJudgeOutcome> {
  if (!call) {
    return { done: null, reason: '当前上下文不提供嵌套工具调用', raw: '', skipped: '无嵌套调用通道' };
  }
  const prompt = buildGoalJudgePrompt(input);
  let res: { text: string; isError: boolean };
  try {
    res = await Promise.race([
      call('subagent', {
        task: prompt,
        agent: JUDGE_AGENT,
        ...(input.model ? { model: input.model } : {}),
      }),
      new Promise<{ text: string; isError: boolean }>((resolve) =>
        setTimeout(() => resolve({ text: '', isError: true }), timeoutMs).unref?.(),
      ),
    ]);
  } catch (e) {
    return { done: null, reason: '', raw: '', skipped: `评审调用抛错：${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.isError) {
    return { done: null, reason: '', raw: res.text.slice(0, JUDGE_RAW_MAX), skipped: '评审子代理返回失败' };
  }
  const v = parseGoalVerdict(res.text);
  if (v.done === null) return { ...v, skipped: '评审输出不符合约定格式' };
  return v;
}
