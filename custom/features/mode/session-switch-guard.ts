/**
 * Mode Feature — 会话切换守卫（纯逻辑，零 Pi 依赖）
 *
 * **问题**（用户实测 2026-10-14）：在 TUI 里 `/new` 或 `/resume`（会话选择器）时，
 * **当前会话正在跑的那一轮会被中止**。
 *
 * **根因在 pi 内部，不是 my-pi 的缺陷**：`AgentSessionRuntime` 的会话替换三条入口
 * （`newSession` / `switchSession` / `importFromJsonl`）都先走
 * `teardownCurrent()` → `await this.session.abort()`
 * （`vendor/pi/packages/coding-agent/src/core/agent-session-runtime.ts:167-177`，
 * 调用点 `:212` / `:245` / `:299` / `:391`）。也就是说上游把"切换会话"与"打断在跑的一轮"
 * 实现成了同一个动作。2026-10-11 本仓库的活体实验就是这条链的实测签名：切换瞬间 pane 出现
 * `Operation aborted`、旧会话文件末条是 `content: []` 的 assistant 记录、**进程 PID 不变**
 * （进程内替换，不是重启）。
 *
 * **可拦截点是 pi 的扩展事件 `session_before_switch`**（同文件 `:133-148`）：它在
 * `teardownCurrent()` **之前**发出，任一 handler 返回 `{ cancel: true }` 即不做替换。
 * 由此有两种做法：
 *   ① 取消这次切换，等回合结束后**自己再发起**切换。代价：事件 handler 拿到的
 *      `ExtensionContext` 上**没有** `newSession` / `switchSession`（两者只在
 *      `ExtensionCommandContext`，见 `core/extensions/types.ts:401-431`），得自己另找通道
 *      （进程重启 ≈40s，或伪造一次命令注入），复杂且都要额外验证。
 *   ② **在 handler 里等到回合结束再放行**（本实现）：pi 继续走它原本的替换流程，只是晚一点；
 *      放行时 agent 已空闲 ⇒ `teardownCurrent()` 里的 `abort()` 不再中止任何东西。
 *
 * 选 ②：不新增任何通道、不改注册面、切换仍由 pi 自己完成（`withSession` / `rebindSession`
 * 等既有语义全部保留）。
 *
 * **为什么不直接改 pi "别 abort"**：那是在改上游核心语义（本项目口径里属于"改运行期默认值"），
 * 且补丁栈要长期跟着 `agent-session-runtime.ts` 漂移。事件层能做到的事不碰核心。
 *
 * **通知必须是纯文本**：`ctx.ui.notify` 最终走 pi 的 `showStatus` / `showWarning`，两者都是
 * 普通 `ThemedText`（`interactive-mode.ts:3836-3856` / `:4641-4645`，**不渲染 markdown**）⇒
 * 文案里不能出现 `**加粗**` 这类记号，否则用户会看到字面星号。
 *
 * **等待是非阻塞的**：TUI 的 editor 调 `onSubmit` 时**不 await**（`packages/tui/src/components/editor.ts:1377`
 * 的字段类型就是 `(text: string) => void`），所以等待期间 Esc（`app.interrupt` →
 * `session.abort()`，`interactive-mode.ts:3070-3072`）与正常输入都照常工作——
 * **Esc 就是"立刻中断并切换"的逃生口**。这一点由真实 pty 场景验证
 * （`scripts/test-scenario-session-switch.mjs`），不靠代码推断。
 *
 * 边界（全部有测试）：
 *   - 空闲时的切换**零延迟放行**（不引入任何副作用）；
 *   - 无 UI（RPC / `-p` 无头 / 子代理）**一律放行**，不改变非交互路径行为；
 *   - `PI_SESSION_SWITCH_GUARD=off` 恢复上游行为（立刻中止并切换）；
 *   - 守卫自身异常 ⇒ **放行**（fail-open：绝不因为守卫的 bug 让用户的 `/new` 失效）；
 *   - 等待预算 `PI_SESSION_SWITCH_WAIT_MS`（默认 0 = 不设上限）：超时只**取消本次切换**，
 *     **绝不**代替用户去中断回合。
 */

/** 等待回合结束的轮询间隔。250ms 足够及时，且对空闲进程几乎无成本。 */
export const SWITCH_GUARD_POLL_MS = 250;

/** `off`（大小写不敏感）时恢复上游行为：立刻中止在跑的一轮并切换。 */
export const SWITCH_GUARD_ENV = 'PI_SESSION_SWITCH_GUARD';

/** 等待预算（毫秒）。默认 0 = 一直等（Esc 是逃生口）；超时只取消切换，不中断回合。 */
export const SWITCH_GUARD_BUDGET_ENV = 'PI_SESSION_SWITCH_WAIT_MS';

export type SwitchReason = 'new' | 'resume' | string;

export interface WaitSteps {
  isIdle: () => boolean;
  budgetMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function envValue(env: Record<string, string | undefined>, key: string): string {
  return String(env[key] ?? '').trim();
}

/** 守卫是否启用。只有显式 `off` 才关闭——避免拼错一个值就把行为悄悄换掉。 */
export function isSwitchGuardEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return envValue(env, SWITCH_GUARD_ENV).toLowerCase() !== 'off';
}

/** 等待预算：0 / 非法值 = 不设上限（默认）。 */
export function switchWaitBudgetMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(envValue(env, SWITCH_GUARD_BUDGET_ENV));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** 等待是否超预算（0 = 永不超时）。 */
export function isBudgetExceeded(waitedMs: number, budgetMs: number): boolean {
  return budgetMs > 0 && waitedMs >= budgetMs;
}

/** 人话时长：用于通知里说明"已等 / 最多等"多久。 */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (safe < 60_000) return `${Math.max(1, Math.round(safe / 1000))} 秒`;
  const minutes = Math.round(safe / 60_000);
  return `${minutes} 分钟`;
}

/** 会话标签：通知里只显示文件名（全路径太长，文件名里已含时间戳与 id）。 */
export function sessionLabel(sessionFile: string | undefined): string {
  const raw = typeof sessionFile === 'string' ? sessionFile.trim() : '';
  if (!raw) return '';
  const parts = raw.split(/[\\/]/);
  return parts[parts.length - 1] || raw;
}

/** 目标描述：new = 新会话；resume = 切到指定会话（没给路径时如实说"未提供目标"）。 */
export function switchTargetLabel(reason: SwitchReason, targetSessionFile?: string): string {
  if (reason === 'new') return '新建会话';
  const label = sessionLabel(targetSessionFile);
  return label ? `切换会话 ${label}` : '切换会话（目标路径未提供）';
}

/**
 * 已经在等时的重复请求：不重复开等待线程（否则两个 `/new` 会在回合结束后各切一次），
 * 直接取消这一条并告诉用户"上一条还在等"。
 */
export function formatSwitchBusyNotice(): string {
  return (
    '[会话切换] 已在等当前回合结束，切换会在回合结束后自动完成。\n' +
    '若要立刻中断并切换，按 Esc；或等这一轮跑完。'
  );
}

/** 首次延后：说明"发生了什么 + 什么时候会自动发生 + 怎么立刻反悔"。 */
export function formatSwitchWaitNotice(opts: {
  reason: SwitchReason;
  targetSessionFile?: string;
  budgetMs: number;
}): string {
  const lines = [
    `[会话切换] 当前回合仍在运行（正在等模型或跑工具）：已延后${switchTargetLabel(opts.reason, opts.targetSessionFile)}，`,
    '回合一结束就会自动完成切换——你这一轮不会被中断。',
  ];
  if (opts.budgetMs > 0) {
    lines.push(`最多等 ${formatDuration(opts.budgetMs)}；超时则取消本次切换（不会中断你的回合）。`);
  }
  lines.push('若要立刻中断当前回合并切换，按 Esc。');
  return lines.join('\n');
}

/** 超预算：取消切换，且明确说明"没有替你中断回合"——避免出现无法解释的"回合没了"。 */
export function formatSwitchTimeoutNotice(opts: {
  reason: SwitchReason;
  targetSessionFile?: string;
  waitedMs: number;
}): string {
  return (
    `[会话切换] 已等 ${formatDuration(opts.waitedMs)}，当前回合仍未结束：本次${
      switchTargetLabel(opts.reason, opts.targetSessionFile)
    }已取消（没有中断你的回合）。\n` +
    '需要的话按 Esc 中断当前回合，然后重新发起切换。'
  );
}

/**
 * 等回合结束。返回 `idle` 表示可以放行（pi 会继续它原本的切换），
 * `timeout` 表示超出预算——调用方应取消切换，**不要**代替用户中断回合。
 *
 * 先判一次空闲再判预算：刚跑完就按下 `/new` 时立即放行，不引入 250ms 抖动。
 */
export async function waitForIdleStep(opts: WaitSteps): Promise<'idle' | 'timeout'> {
  const pollMs = opts.pollMs ?? SWITCH_GUARD_POLL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const startedAt = now();
  for (;;) {
    // isIdle 由调用方用"防抛 + 抛了当空闲"的包装传入（见 index.ts 的 safeIsIdle）。
    if (opts.isIdle()) return 'idle';
    if (isBudgetExceeded(now() - startedAt, opts.budgetMs)) return 'timeout';
    await sleep(pollMs);
  }
}
