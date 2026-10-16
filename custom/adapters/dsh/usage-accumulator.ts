/**
 * 回合用量累积器：把 DSH 的 `assistant/message.usage` 攒起来，补进 pi 的 `turn_end` 负载
 *
 * ## 问题（实测，不是推断）
 *
 * pi 的 `turn_end` 事件带 `message: AgentMessage`（`vendor/pi/packages/agent/src/types.ts:522`），
 * 处理器从 `event.message.usage` 读用量（本仓唯一读它的是 `custom/features/context/index.ts:977-1010`：
 * 每轮落盘 token 记账 + 输出速度结算）。
 *
 * DSH 侧 `turn/end` 的 data **只有** `{turn, reason}`。真 Host 跑的会话日志（isolated home 的
 * `session.v4.jsonl.zstd`，解压后 seq 25）原样是：
 *
 *     {"type":"turn/end","data":{"turn":1,"reason":{"kind":"completed"}}}
 *
 * ⇒ 照搬 `event.message.usage` 的处理器在 DSH 上**静默拿不到任何用量**（不报错、只是永远不记账）。
 * 同一份日志里用量其实**存在**，只是挂在另一个事件上（seq 16/23，两个 step 各一条）：
 *
 *     {"type":"assistant/message","data":{"turn":1,"step":1,
 *       "usage":{"inputTokens":358,"outputTokens":22,"cacheReadTokens":10240,
 *                "cacheWriteTokens":0,"totalTokens":10620}, ...}}
 *
 * ## 做法
 *
 * 在**适配层**（不在 features 里）把两者接起来：
 *   - 每条 `assistant/message` 的用量累加进"本会话本回合"的桶；
 *   - `turn/end` 到达时，把累积结果**合成为 pi 形状的补丁**（`{turnIndex, message:{usage}}`）。
 *
 * 为什么是累加而不是取最后一条：DSH 一个回合可以有**多个 step**（每次模型调用一个 step，
 * 上面那次真跑就是 step1 工具调用 + step2 收敛回答两条用量）⇒ "回合总用量"应为其和。
 * 这也正是 pi 侧 `turn_end` 的语义（"该助手消息及其全部工具结果都发完"之后的回合结算）。
 *
 * ## 两个"看起来能用、实际会静默丢数据"的坑（都是真 Host 冒烟抓出来的）
 *
 *   ① **不能"取走即清桶"**：同一个 pi 事件可以被多个特性注册（本仓 3 个特性注册 `turn_end`），
 *      而外观层是"每个 pi 事件注册 ⇒ 一条独立订阅" ⇒ 一条 DSH `turn/end` 会触发**多条**桥接。
 *      销毁式取值时只有第一条拿得到用量，其余全是 `undefined`，而**恰好不是**那条需要它的处理器
 *      ⇒ 用量永久丢失（实测日志：`用量补丁=yes` 后面跟着两条 `用量补丁=no`，`recordUsage` 没落盘）。
 *      ⇒ 所以对外只有 `read`（只读不销毁），桶靠 LRU 与 `drop` 回收。
 *   ② **必须按会话分桶**：不同会话的回合号各自从 1 开始，只按回合号分桶会让 A 会话的回合 1
 *      被 B 会话的回合 1 读到（串账）。会话 id 从 `session/event` 第一参（Session）取。
 *
 * ## 纪律
 *
 *   - **不猜**：字段名按上面日志实测，DSH 契约 `TokenUsage`（`dsh-llm/lib/types/types.d.ts:160-174`）
 *     逐字核对：`inputTokens/outputTokens/totalTokens?/cacheReadTokens?/cacheWriteTokens?/reasoningTokens?`。
 *   - **不造假**：该回合一条用量都没收到时返回 `undefined`，**不合成全 0 的用量**
 *     （假的 0 会让记账把"没数据"记成"零消耗"，比缺数据更坏）。
 *   - `cost` 只能填 0：DSH 的 `TokenUsage` **不含价格**（定价在别处，不在这个负载里）
 *     ⇒ 合成时显式标注 `costUnavailable`，让调用方有机会上报，而不是假装算了钱。
 */

/** DSH `TokenUsage` 的最小快照（字段名实测自真 Host 会话日志，见文件头） */
export interface DshTokenUsageLike {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
}

/** pi `Usage` 的快照（`vendor/pi/packages/ai/src/types.ts:446-467`） */
export interface PiUsageLike {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  /** 本仓扩展：标记 `cost` 是占位 0（DSH 负载无定价）——pi 侧没有这个字段，读它的只有我们自己的诊断 */
  costUnavailable?: true;
}

/** 一个回合累积出的合成补丁（字段名对齐 pi 的 `turn_end` 负载） */
export interface TurnUsagePatch {
  /** pi 的回合序号（DSH `turn/end` 的 `turn`） */
  readonly turnIndex?: number;
  /** 合成消息：只带用量，处理器读的是 `event.message.usage` */
  readonly message: { usage: PiUsageLike };
  /** 参与累加的模型调用次数（诊断用：多 step 回合 > 1） */
  readonly usageCalls: number;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * DSH 用量 → pi 用量（字段名逐个对齐；缺的可选字段**不编 0**，只在不影响语义时补 0）。
 *
 * 补 0 的边界：pi 的 `input/output/cacheRead/cacheWrite` 是**必填数字**，所以缺省补 0 是形状要求；
 * 但 `inputTokens`/`outputTokens` 本身缺失时（DSH 契约里它们必填，真出现缺失就是负载异常）
 * 返回 `undefined` —— 宁可不上报，也不把"缺数据"记成"零消耗"。
 */
export function toPiUsage(usage: DshTokenUsageLike | undefined): PiUsageLike | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const input = num(usage.inputTokens);
  const output = num(usage.outputTokens);
  if (input === undefined && output === undefined) return undefined;
  const cacheRead = num(usage.cacheReadTokens) ?? 0;
  const cacheWrite = num(usage.cacheWriteTokens) ?? 0;
  const reasoning = num(usage.reasoningTokens);
  const derived = (input ?? 0) + output! + cacheRead + cacheWrite;
  const total = num(usage.totalTokens) ?? derived;
  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead,
    cacheWrite,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: total,
    // 占位 0：DSH 的 TokenUsage 没有价格字段（见文件头"纪律"）
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUnavailable: true,
  };
}

/** 累加两条 pi 用量（回合内多 step 求和；`reasoning` 只在任一侧有时才出现） */
function addUsage(a: PiUsageLike, b: PiUsageLike): PiUsageLike {
  const reasoning = a.reasoning === undefined && b.reasoning === undefined ? undefined : (a.reasoning ?? 0) + (b.reasoning ?? 0);
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: a.totalTokens + b.totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUnavailable: true,
  };
}

/** 桶上限：会话日志事件流是长跑进程里的长期订阅，防止"回合没有 end"时无限增长 */
const MAX_TURNS = 32;

export interface TurnUsageAccumulator {
  /**
   * 记录一条事件（只认 `assistant/message` 形状；其余原样忽略）。
   * 传入的是**桥接后**的 pi 形状负载：data 已摊平 ⇒ 直接读 `turn` / `usage`。
   * `sessionId` 用于分桶隔离（两个会话的回合号会各自从 1 开始，不隔离就会串账）。
   */
  record(sessionId: string | undefined, payload: unknown): void;
  /**
   * 读某回合的累积结果（**不销毁**）。没有该回合的用量时返回 `undefined`，不合成假数据。
   *
   * ★ 为什么是"读"而不是"取走"（2026-10-18 Host 冒烟实测的致命细节）：
   *   同一个 pi 事件可以被**多个特性**注册（本仓有 3 个特性注册 `turn_end`），
   *   而外观层是"每个 pi 事件注册 ⇒ 一条独立订阅" ⇒ 一条 DSH `turn/end` 会触发**多条**桥接。
   *   原先用 `take()`（取走即清桶）时，**只有第一条桥接**能拿到用量，其它特性全部拿到 `undefined` ——
   *   实测就是"用量补丁=yes"后面跟两条"用量补丁=no"，`recordUsage` 恰好没落在第一条上 ⇒ 用量永久丢失。
   */
  read(sessionId: string | undefined, turn: number | undefined): TurnUsagePatch | undefined;
  /** 当前桶里的键数（测试/诊断用） */
  size(): number;
  /** 丢弃某回合的桶（例：会话切换/回合被取消，避免串账） */
  drop(sessionId: string | undefined, turn: number | undefined): void;
}

export function createTurnUsageAccumulator(): TurnUsageAccumulator {
  // 用 Map 保序：插入序即"先来的回合"，超上限时淘汰最早的
  const buckets = new Map<string, { usage: PiUsageLike; calls: number }>();

  const keyOf = (sessionId: string | undefined, turn: unknown): string | undefined => {
    const t = num(turn);
    if (t === undefined) return undefined;
    return `${sessionId ?? '(无会话)'}#${t}`;
  };
  /** 从 key 里取回回合号（`read` 要把它放进补丁里） */
  const turnOfKey = (key: string): number => Number(key.slice(key.lastIndexOf('#') + 1));

  return {
    record(sessionId: string | undefined, payload: unknown): void {
      if (typeof payload !== 'object' || payload === null) return;
      const event = payload as { type?: unknown; turn?: unknown; usage?: unknown };
      if (event.type !== 'assistant/message') return;
      const usage = toPiUsage(event.usage as DshTokenUsageLike | undefined);
      if (!usage) return;
      const key = keyOf(sessionId, event.turn);
      if (key === undefined) return;
      const prev = buckets.get(key);
      if (prev) {
        prev.usage = addUsage(prev.usage, usage);
        prev.calls += 1;
      } else {
        buckets.set(key, { usage, calls: 1 });
        if (buckets.size > MAX_TURNS) {
          const oldest = buckets.keys().next();
          if (!oldest.done) buckets.delete(oldest.value);
        }
      }
    },

    read(sessionId: string | undefined, turn: number | undefined): TurnUsagePatch | undefined {
      const key = keyOf(sessionId, turn);
      if (key === undefined) return undefined;
      const bucket = buckets.get(key);
      if (!bucket) return undefined;
      return { turnIndex: turnOfKey(key), message: { usage: bucket.usage }, usageCalls: bucket.calls };
    },

    size(): number {
      return buckets.size;
    },

    drop(sessionId: string | undefined, turn: number | undefined): void {
      const key = keyOf(sessionId, turn);
      if (key !== undefined) buckets.delete(key);
    },
  };
}

/**
 * 把累积结果合成到 `turn/end` 的 pi 负载上。
 *
 * 合并方向：**只补缺失**——DSH 将来若自己在 `turn/end` 里带上 `message`/`turnIndex`，
 * 以 DSH 的为准（它是一手数据），我们只填空的。返回新对象，不改原负载。
 */
export function mergeTurnUsage(
  payload: Record<string, unknown>,
  patch: TurnUsagePatch | undefined,
): Record<string, unknown> {
  if (!patch) return payload;
  const merged: Record<string, unknown> = { ...payload };
  if (merged.turnIndex === undefined && patch.turnIndex !== undefined) merged.turnIndex = patch.turnIndex;
  // message 只在 DSH 没给时补；给了但里面没有 usage 时，把用量挂进去（不覆盖 DSH 的 message 本体）
  const existing = merged.message;
  if (existing === undefined) {
    merged.message = patch.message;
  } else if (typeof existing === 'object' && existing !== null && (existing as { usage?: unknown }).usage === undefined) {
    merged.message = { ...(existing as Record<string, unknown>), usage: patch.message.usage };
  }
  if (merged.usage === undefined) merged.usage = patch.message.usage;
  return merged;
}
