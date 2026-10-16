/**
 * 子代理并发上限：在 **DSH 底座**上核对宿主允许的并发，别让移动端静默超载
 *
 * ## 为什么需要它
 *
 * my-pi 在**移动端**（Termux / android）刻意把子代理并发压到 **2**
 * （`custom/features/subagent/core/helpers.ts`：`TERMUX_MAX_PARALLEL = 2`，`getMaxParallelTasks()` 按
 * `isTermuxEnv()` 切换；手机内存小，8 个并发子代理会 OOM）。
 *
 * 换到 DSH 后这条**不由我们决定**：宿主的 `maxActiveSubagents` 默认 **8**
 * （`dsh-subagent/lib/types/index.d.ts:104`、实现里 `default(8)`），而且它是
 * `Volatile<number>` —— 契约明说"**a reference whose value is updated only by its owning runtime**"
 * （`cosmokit/lib/types/volatile.d.ts`：接口**只有 `get()`**，没有 writer）。
 * ⇒ 我们的插件**无权**把别人的配置改小（强行改也改不动，只会假装成功）。
 *
 * ## 那就别静默
 *
 * 本模块只做两件事：**读**宿主实际生效的并发上限，并在"移动端 + 超出 my-pi 上限"时**明确报警**
 * 并给出可操作的部署层改法（profile patch 片段）。读不到时也一样明确说明（fail-open，但绝不假装核对过）。
 *
 * ✗ 已核实**做不到**的部分（如实登记）：运行期改宿主的 Volatile 不可行；
 * `dsh-config-editor` 能改的是 **profile 文档**（持久化改写 YAML），不是运行时值 ——
 * 用它在启动时偷偷改用户的 profile 属于"意外副作用"，本项目不做，改为把片段写进
 * `dsh/profile/my-pi.patch.yml` 的注释里，由部署方显式启用。
 */

/** my-pi 在移动端的并发上限（与 `features/subagent/core/helpers.ts` 的 `TERMUX_MAX_PARALLEL` 同值） */
export const MY_PI_TERMUX_MAX_ACTIVE = 2;

/** 判定"移动端"（口径与 `features/subagent/core/helpers.ts:isTermuxEnv` 对齐） */
export function isTermuxLike(env: { platform?: string; TERMUX_VERSION?: string }): boolean {
  const platform = env.platform ?? (typeof process !== 'undefined' ? process.platform : undefined);
  const termuxVersion = env.TERMUX_VERSION ?? (typeof process !== 'undefined' ? process.env?.TERMUX_VERSION : undefined);
  return platform === 'android' || Boolean(termuxVersion);
}

/** 核对结果 */
export interface CapacityAudit {
  /** 宿主实际生效的上限（读不到则 undefined） */
  readonly effective?: number;
  /** 是否"移动端 + 超出 my-pi 上限"（需要部署方处理） */
  readonly tooHigh: boolean;
  /** 给人看的一句话（含怎么改） */
  readonly note: string;
}

/**
 * 只读核对：读 `ctx.subagents.config.maxActiveSubagents`（Volatile）并与移动端上限比较。
 *
 * @param service `ctx.subagents`（拿不到就传 undefined —— 会如实说明"没核对"）
 * @param termux 是否移动端（测试可注入；默认按 `isTermuxLike(process)`)
 */
export function auditSubagentCapacity(service: unknown, termux: boolean = isTermuxLike({})): CapacityAudit {
  const max = readVolatileNumber(service);
  const clampHint =
    '要压到移动端上限，请在 profile patch 里显式覆盖宿主条目（示例，按需启用）：\n'
    + '    - id: subagent\n'
    + '      config:\n'
    + '        maxActiveSubagents: 2\n'
    + '        maxDepth: 1';

  if (max === undefined) {
    return {
      tooHigh: false,
      note:
        '读不到宿主的 maxActiveSubagents（subagents 服务缺失或不是 Volatile）⇒ **未做移动端并发核对**'
        + '（不假装核对过）；如需限制请在 profile patch 里覆盖 subagent 条目',
    };
  }
  if (!termux) {
    return { effective: max, tooHigh: false, note: `宿主并发上限 = ${max}（非移动端，保持宿主默认）` };
  }
  if (max <= MY_PI_TERMUX_MAX_ACTIVE) {
    return { effective: max, tooHigh: false, note: `宿主并发上限 = ${max} ≤ 移动端上限 ${MY_PI_TERMUX_MAX_ACTIVE} ✓` };
  }
  return {
    effective: max,
    tooHigh: true,
    note:
      `移动端（Termux/android）上宿主允许 ${max} 个并发子代理，超出 my-pi 的移动端上限 `
      + `${MY_PI_TERMUX_MAX_ACTIVE}（手机内存小，可能 OOM）—— 插件**无权**改宿主的 Volatile 配置，`
      + `请在部署层处理：\n${clampHint}`,
  };
}

/** 读 Volatile<number> 的当前值（`.get()`）；任何异常/形状不符都返回 undefined（fail-open） */
function readVolatileNumber(service: unknown): number | undefined {
  try {
    const config = (service as { config?: { maxActiveSubagents?: { get?: () => unknown } } } | undefined)?.config;
    const ref = config?.maxActiveSubagents;
    const value = typeof ref?.get === 'function' ? ref.get() : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
