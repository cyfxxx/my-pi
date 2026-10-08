/**
 * bash 超时 → 转后台的纯逻辑（2026-10-07，编排优化第 2 项）
 *
 * 背景：my-pi 给没写 `timeout` 的 bash 注入 240s 上限（`features/context/index.ts`），
 * 而 pi 在超时时的处置是**杀掉整个进程树**（`core/tools/bash.ts`：`throw new Error("timeout:<秒>")`）
 * ——**工作直接丢失**，只剩一段不完整输出。对照 DSH：超时**提升为后台 job**，结果可以事后收。
 *
 * 本模块只放"转后台"这一步需要的**纯函数**（零 Pi 依赖，可在 vitest 里直接驱动）：
 *   · `parseTimeoutSeconds`   从超时错误文本里取出上限值（判定"这次失败是不是超时"）
 *   · `wrapWithCeiling`       给转入后台的命令加一层**硬上限**（见下）
 *   · `promoteSessionName`    生成后台会话名
 *
 * **为什么转后台还要再加一层上限**：前台被杀的**唯一好处**是"跑飞的命令不会赖着不走"。
 * 如果只是把原命令原样丢进 tmux，一个死循环就从"240s 后被杀"变成"**永远占着机器**"——
 * 那是比丢工作更糟的回归。所以转后台时用 `timeout -k` 包一层，上限放大但仍有限
 * （默认 `PI_BASH_PROMOTE_CEIL_S` = 3600s），保住"不会跑飞"这个性质。
 */

/** 默认的后台硬上限（秒）：比前台 240s 宽得多，但不无限 */
export const DEFAULT_PROMOTE_CEIL_S = 3600;

/** 从 pi 的超时错误文本里取上限秒数；不是超时则返回 null */
export function parseTimeoutSeconds(text: string): number | null {
  // 不锚定行首：pi 抛的是 `timeout:<秒>`，但工具结果文本可能带 `Error: ` 之类前缀。
  // 用"前一个字符不是字母/数字/下划线"来避免命中 `mytimeout:240` 这类别的字符串。
  const m = /(?:^|[^a-z0-9_])timeout:(\d+)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 未显式配置时用默认值；显式 <=0 视为关闭该硬上限（本地模型/特殊环境） */
export function resolvePromoteCeil(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PROMOTE_CEIL_S;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PROMOTE_CEIL_S;
  return n > 0 ? n : 0;
}

/** 单引号安全包裹（`sh -c` 用） */
function shQuote(command: string): string {
  return `'${command.replace(/'/g, `'\\''`)}'`;
}

/**
 * 给转入后台的命令加硬上限。
 *
 * `timeout -k <宽限> <上限> sh -c '<原命令>'`：用 `sh -c` 包住是为了让管道/`&&`/重定向等复合命令
 * 整体受同一个上限约束（直接 `timeout N cmd && other` 只管得到前半句）。
 * `ceiling <= 0` 时**不加包装**（显式关闭；调用方负责在文档里说明风险）。
 */
export function wrapWithCeiling(command: string, ceilingSeconds: number, killAfterSeconds = 10): string {
  if (!Number.isFinite(ceilingSeconds) || ceilingSeconds <= 0) return command;
  const grace = Number.isFinite(killAfterSeconds) && killAfterSeconds > 0 ? Math.floor(killAfterSeconds) : 10;
  return `timeout -k ${grace} ${Math.floor(ceilingSeconds)} sh -c ${shQuote(command)}`;
}

/** 后台会话名：`resume-<36 进制时间戳>`（不含前缀；`normalizeSessionName` 会加） */
export function promoteSessionName(nowMs: number): string {
  const base = Math.max(0, Math.floor(nowMs)).toString(36);
  return `resume-${base}`;
}

/** 转后台后注入给模型/用户的说明 */
export function promoteNotice(sessionName: string, logPath: string, ceilingSeconds: number, timedOutAt: number): string {
  const cap = ceilingSeconds > 0 ? `并加了 ${ceilingSeconds}s 硬上限` : '（未加上限）';
  return [
    `前台命令超过 ${timedOutAt}s 上限被中断，已**自动转入后台**（会话 ${sessionName}）原命令重跑${cap}。`,
    `日志: ${logPath}`,
    `用 tmux_read 查看输出；会话结束会自动唤醒你（不必轮询）。如不需要，用 tmux_stop 结束它。`,
  ].join('\n');
}
