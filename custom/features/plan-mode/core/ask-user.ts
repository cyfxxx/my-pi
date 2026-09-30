/**
 * ask_user 的选项交互逻辑（纯逻辑，UI 经 {@link AskUserIO} 注入）
 *
 * 迁移自 pi-tools `plan-mode/tools.ts` 的 `registerAskUserTool`。单选：直接返回选择，
 * 选「其他」时弹输入框；多选：列出编号选项，用户一次输入编号（如 `1,3`）即完成多选。
 *
 * 多选不走「循环弹选择器 + ✓ 累积」：pi 扩展 UI 的 `select` 没有初始高亮索引参数
 * （见 core/extensions/types.ts 的 ExtensionUIDialogOptions，只有 signal/timeout），
 * 循环调用必然把光标弹回第一项。改用 editor 一次输入，交互更短、无光标问题。
 */

export interface AskUserIO {
  select: (title: string, options: string[]) => Promise<string | undefined>;
  editor: (title: string, prefill?: string) => Promise<string | undefined>;
}

export const OTHER_OPTION = '其他（请说明）';
export const CANCEL_OPTION = '取消选择';

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
  // 调用方传入的标签可能与内置项同名，去重后追加，避免列表出现两个相同条目
  const options = [...labels];
  if (!options.includes(OTHER_OPTION)) options.push(OTHER_OPTION);
  if (!options.includes(CANCEL_OPTION)) options.push(CANCEL_OPTION);
  for (;;) {
    const choice = await io.select(title, options);
    if (choice === undefined) return '用户取消了选择';
    if (choice === CANCEL_OPTION) return '用户取消了选择';
    if (choice !== OTHER_OPTION) return choice;
    const reason = await io.editor('请说明你的选择：', '');
    if (reason && reason.trim()) return `其他: ${reason.trim()}`;
  }
}

/** 解析多选编号输入：支持 `1,3` / `1 3` / `1-3` / `0`（表示补充其它）；返回索引或错误 */
export function parseSelectionInput(
  raw: string,
  count: number,
): { indexes: number[]; other: boolean; error?: string } {
  const tokens = raw.split(/[,，、;；\s]+/).filter(Boolean);
  const indexes: number[] = [];
  let other = false;
  for (const token of tokens) {
    if (token === '0') {
      other = true;
      continue;
    }
    const range = /^(\d+)[-~](\d+)$/.exec(token);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > count || from > to) {
        return { indexes: [], other: false, error: `范围超出：${token}（可选 1-${count}）` };
      }
      for (let i = from; i <= to; i += 1) indexes.push(i - 1);
      continue;
    }
    if (!/^\d+$/.test(token)) {
      return { indexes: [], other: false, error: `无法识别的输入：${token}` };
    }
    const n = Number(token);
    if (n < 1 || n > count) {
      return { indexes: [], other: false, error: `编号超出范围：${token}（可选 1-${count}）` };
    }
    indexes.push(n - 1);
  }
  if (!indexes.length && !other) return { indexes: [], other: false, error: '未输入有效编号' };
  return { indexes: [...new Set(indexes)], other };
}

/** 多选交互：列出编号选项，用户一次输入编号（如 `1,3`）后返回逗号分隔结果 */
export async function askUserMultiple(io: AskUserIO, title: string, labels: string[]): Promise<string> {
  const numbered = labels.map((l, i) => `  ${i + 1}. ${l}`).join('\n');
  let notice = '';
  for (;;) {
    const prompt = `${title}\n${numbered}\n\n${notice}输入所选编号（逗号分隔如 1,3；范围如 1-3；0 表示补充其它内容；留空取消）：`;
    const raw = await io.editor(prompt, '');
    if (raw === undefined) return '用户取消了选择';
    const text = raw.trim();
    if (!text) return '用户取消了选择';
    const parsed = parseSelectionInput(text, labels.length);
    if (parsed.error) {
      notice = `⚠ ${parsed.error}\n`;
      continue;
    }
    const picked = parsed.indexes.map((i) => labels[i]);
    if (parsed.other) {
      const extra = await io.editor('补充说明（留空则忽略）：', '');
      if (extra && extra.trim()) picked.push(`其他: ${extra.trim()}`);
    }
    if (!picked.length) {
      notice = '⚠ 至少选择一项\n';
      continue;
    }
    return picked.join(', ');
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
