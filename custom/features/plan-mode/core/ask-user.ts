/**
 * ask_user 的选项交互逻辑（纯逻辑，UI 经 {@link AskUserIO} 注入）
 *
 * 迁移自 pi-tools `plan-mode/tools.ts` 的 `registerAskUserTool`。单选：直接返回选择，
 * 选「其他」时弹输入框；多选：带 ✓ 标记的累积选择，直到「完成选择」。
 */

export interface AskUserIO {
  select: (title: string, options: string[]) => Promise<string | undefined>;
  editor: (title: string, prefill?: string) => Promise<string | undefined>;
}

export const OTHER_OPTION = '其他（请说明）';
export const DONE_OPTION = '完成选择';
export const CLEAR_OPTION = '取消全部';
export const CHECK_MARK = '✓ ';

export interface AskUserParams {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiple?: boolean;
}

/** 参数校验；返回错误文本或 null（表示合法） */
export function validateAskUserParams(params: Partial<AskUserParams>): string | null {
  if (!params.question || typeof params.question !== 'string') return 'Error: question is required';
  if (!Array.isArray(params.options) || params.options.length < 2) {
    return 'Error: options must be an array with at least 2 items';
  }
  return null;
}

/** 单选交互：选择「其他」时弹输入框，未输入则重新选择；返回面向模型的文本 */
export async function askUserSingle(io: AskUserIO, title: string, labels: string[]): Promise<string> {
  const options = [...labels, OTHER_OPTION];
  for (;;) {
    const choice = await io.select(title, options);
    if (choice === undefined) return '用户取消了选择';
    if (choice !== OTHER_OPTION) return choice;
    const reason = await io.editor('请说明你的选择：', '');
    if (reason && reason.trim()) return `其他: ${reason.trim()}`;
  }
}

/** 多选交互：累积 `✓` 标记的选项，「完成选择」返回逗号分隔结果 */
export async function askUserMultiple(io: AskUserIO, title: string, labels: string[]): Promise<string> {
  const selected: string[] = [];
  for (;;) {
    const selectOptions = [
      ...selected.map((l) => `${CHECK_MARK}${l}`),
      ...labels.filter((l) => !selected.includes(l)),
      OTHER_OPTION,
      DONE_OPTION,
      CLEAR_OPTION,
    ];
    const choice = await io.select(title, selectOptions);
    if (choice === undefined) return '用户取消了选择';
    if (choice === DONE_OPTION) {
      if (selected.length === 0) continue;
      return selected.join(', ');
    }
    if (choice === CLEAR_OPTION) {
      selected.length = 0;
      continue;
    }
    if (choice === OTHER_OPTION) {
      const reason = await io.editor('请说明你的补充信息：', '');
      if (reason && reason.trim()) selected.push(`其他: ${reason.trim()}`);
      continue;
    }
    const actual = choice.startsWith(CHECK_MARK) ? choice.slice(CHECK_MARK.length) : choice;
    const idx = selected.indexOf(actual);
    if (idx >= 0) selected.splice(idx, 1);
    else selected.push(actual);
  }
}

/** 工具入口：校验 → 单选/多选 → 文本结果 */
export async function runAskUser(io: AskUserIO, params: Partial<AskUserParams>): Promise<string> {
  const invalid = validateAskUserParams(params);
  if (invalid) return invalid;
  const question = params.question as string;
  const labels = (params.options ?? []).map((o) => o.label);
  const title = params.header ? `${params.header}: ${question}` : question;
  return params.multiple
    ? askUserMultiple(io, title, labels)
    : askUserSingle(io, title, labels);
}
