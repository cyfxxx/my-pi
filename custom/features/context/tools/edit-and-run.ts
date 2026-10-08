/**
 * `edit_and_run`：把"改文件 + 跑验证命令"合成一次调用（P6，Action Fusion 最小版）
 *
 * 借鉴 SoL-Pi 的 Action Fusion：编辑/写入 → 命令 的相邻转场占跨轮转场的 **12.3%**，后继动作里
 * bash 占 **85.1%**；融合后（他们的反事实推算）轮次 **1386→1237（−10.8%）**、token **−11.5%**。
 *
 * **但在我们自己的轨迹上实测，邻接率只有一半**（跨轮编辑→运行 **6.4%（19/299）**，轮内同时含两者
 * 仅 **0.7%（2/303）**）。所以这个工具的**收益上限是"约 6% 的回合数"**，不是 10.8%——
 * 我们按自己的数据调预期，不照抄他们的数字。见 `docs/design/SOL-PI-BORROW.md` 的 P6 节。
 *
 * 两条设计约束（都是为了不把"省一次往返"变成"多一次误操作"）：
 * 1. **编辑失败就不跑命令**。融合最大的风险是"编辑锚点没匹配上，命令却照样跑了一遍"——
 *    那会让模型把两件事混在一起归因。这里做成**条件执行**，失败直接把编辑错误原样返回。
 * 2. **结果显式分段** `[edit]` / `[run]`。合成一条观测是收益的来源，也是误归因的来源，
 *    分段是廉价的解药。
 *
 * ## 参数形状必须与 pi 的 `edit` **完全一致**（探针测出来的，不是读代码看出来的）
 *
 * pi 的 `edit` 是 `{path, edits:[{oldText,newText}]}`，不是 Claude-Code 风格的
 * `{file_path, old_string, new_string}`。更关键：**嵌套调用绕过 pi 的 `prepareArguments`**
 * （那层兼容旧参数名的适配只作用于"模型直呼"的路径），所以这里必须用规范 schema——
 * 否则 pi 会回 `Validation failed for tool "edit": - path: must have required properties path, edits`。
 *
 * 因此本工具**逐字转发** `{path, edits}`，**一个字段都不映射**：字段映射正是上一版出缺陷的地方。
 *
 * **不重写编辑逻辑**：两半都走 **pi 自己的工具**（`ctx.executeTool('edit' | 'bash')`），
 * 因此编辑语义、权限、bash 的超时/后台提升等行为与直接调用完全一致——我们只是把它们串起来。
 */

import { registerTool, type ToolExecuteContext } from '../../../adapters/tool-adapter';

/** 与其它工具一致的写法：PiApi 由 registerTool 的签名反推，避免跨层导入 Pi 类型 */
type PiApi = Parameters<typeof registerTool>[0];

/** 嵌套调用不可用时的说明（不是错误——是"退化路径"，告诉模型怎么继续） */
export const NESTED_UNAVAILABLE =
  'edit_and_run 不可用：当前上下文不提供嵌套工具调用。请分别调用 edit 与 bash（功能完全相同，只是多一次往返）。';

export interface EditAndRunArgs {
  path?: string;
  /** 与 pi 的 edit 同形：[{oldText, newText}] */
  edits?: unknown;
  command?: string;
}

/** 只做**前置**校验（形状不对就别浪费一次嵌套调用）；语义校验交给 pi 的 edit，它的报错更准 */
function validate(args: EditAndRunArgs): { path: string; edits: unknown[]; command: string } | string {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!path) return 'Error: path 必填（与 pi 的 edit 同名同义）';
  if (!Array.isArray(args.edits) || args.edits.length === 0) {
    return 'Error: edits 必填，且至少一项：[{oldText, newText}]（与 pi 的 edit 同形）';
  }
  if (command === '') return 'Error: command 必填（只想编辑请直接用 edit）';
  return { path, edits: args.edits, command };
}

/**
 * 融合执行体（导出以便用**假的 ctx** 直接测试——不需要跑真 pi）。
 * 返回给模型的文本，总是分 `[edit]` / `[run]` 两段。
 */
export async function runEditAndRun(args: EditAndRunArgs, ctx: ToolExecuteContext | undefined): Promise<string> {
  const v = validate(args);
  if (typeof v === 'string') return v;
  const call = ctx?.executeTool;
  if (!call) return NESTED_UNAVAILABLE;

  // ── 1) 编辑（复用 pi 的 edit，**逐字转发**规范参数）──
  const editRes = await call('edit', { path: v.path, edits: v.edits });
  const editText = editRes.text || (editRes.isError ? '(编辑失败，无输出)' : '(已编辑)');
  if (editRes.isError) {
    // 条件执行：编辑失败**不跑命令**（否则一次锚点不匹配会连带浪费一次命令与一次归因）
    return `[edit] 失败 — ${v.path}\n${editText}\n\n[run] 已跳过：编辑未成功，命令没有执行。修正 edits 后重试，或分别调用 edit 与 bash。`;
  }

  // ── 2) 命令（复用 pi 的 bash：超时/后台提升/权限语义与直接调用一致）──
  const runRes = await call('bash', { command: v.command });
  const runText = runRes.text || '(命令无输出)';
  const head = runRes.isError ? `[run] ${v.command}（失败）` : `[run] ${v.command}`;
  return `[edit] 成功 — ${v.path}\n${editText}\n\n${head}\n${runText}`;
}

export function registerEditAndRunTool(pi: PiApi): void {
  registerTool(pi, {
    name: 'edit_and_run',
    description:
      '编辑后立刻跑验证命令（参数同 edit）；编辑失败则不跑命令，输出分 [edit]/[run]',
    parameters: {
      path: { type: 'string', description: '文件' },
      edits: { type: 'json', description: '同 edit：[{oldText,newText}]' },
      command: { type: 'string', description: '验证命令' },
    },
    // **声明**（而不是 deferred）：Action Fusion 的价值就在"模型自发融合"，需要它在工具面上可见。
    // 代价是本工具的声明会进前缀，所以描述刻意精简——工具面体积守门（32000B 总预算）是**硬约束**：
    // 实测本工具首版 821B 会把总量顶到 32397B（超 397B）。按纪律**不去动预算**（那是"事后下调地板"），
    // 而是把声明压到预算内。压掉的只是措辞，安全语义（编辑失败不执行命令）仍在。
    executionMode: 'sequential',
    execute: async (params, ctx) => runEditAndRun(params as EditAndRunArgs, ctx),
  });
}
