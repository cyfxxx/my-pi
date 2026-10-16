/**
 * 安全取 DSH 服务：**先 `ctx.get(name)`，再退回直接属性读**，两路都包 try/catch。
 *
 * ## 为什么不能直接写 `ctx.tools`
 *
 * cordis 的服务访问受 `inject` 约束：**插件没声明 inject 就访问服务会抛**
 * `Error: cannot get property "tools" without inject`。这在真实 Host 里是**加载期失败**
 * ——2026-10-18 的 Host 级冒烟正是这样暴露的：插件被 DSH loader 加载后立刻抛错，
 * `dsh: warning: 1 entry did not activate`，而我们的 `inject` 只声明了 `tools`，
 * 适配层却还摸了 `systemPrompt`/`sessions`/`sessionTitle`/`agents`/`commands` ✗。
 *
 * ## 口径
 *
 *   - 我们**真正需要**的服务（`tools`）已在插件 `inject` 里声明 ✓；
 *   - 其余是**可选增强**（有就用、没有就如实上报），所以用 `ctx.get()` 取 ——
 *     服务注册表的 `get` 不受 inject 约束（DSH 自己的代码也这么用：`this.ctx.get("toolResultPruner")`）；
 *   - 单测里的假 ctx 没有 `get`（直接挂属性）⇒ 退回属性读；cordis 的 ctx 属性读会抛 ⇒ 被 catch 吞掉。
 */
export function getDshService<T>(ctx: unknown, name: string): T | undefined {
  const c = ctx as { get?: (n: string) => unknown; [key: string]: unknown } | undefined;
  if (c && typeof c.get === 'function') {
    try {
      const value = c.get(name);
      if (value !== undefined && value !== null) return value as T;
    } catch {
      /* 该 fiber 无权或服务未就绪：继续尝试属性读（测试替身走这条） */
    }
  }
  try {
    return (c?.[name] ?? undefined) as T | undefined;
  } catch {
    return undefined;
  }
}
