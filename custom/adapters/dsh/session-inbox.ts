/**
 * **会话收件箱桥**：让**外部进程**给正在跑的 my-pi（DSH 基座）投递一条消息
 *
 * ## 定位（要说清楚，别和"子代理中途通信"混了）
 *
 * my-pi 原来的 `scripts/subagent-inbox.mjs` 是**子代理**中途通信：父进程轮询收件箱，把新消息通过 RPC
 * `prompt` 通道转发给子进程。在 DSH 上这条路**卡在关联性**上（见下"✗ 做不到"），所以这里实现的是
 * **当前会话**的收件箱：外部进程往 `<dir>/<sessionId>.inbox.jsonl` 追加一行，插件把它投递给该会话的**活 agent**
 * （`agent.steer` / `agent.followup` —— 这两条语义我们在 spike A25 里运行时验过）。
 *
 * ## ✗ 为什么不做"子代理收件箱"（如实登记）
 *
 * 宿主没有"子会话 ↔ 发起它的工具调用/名字"的可靠关联：`subagent/start` 的负载只有
 * `{runId, provider, id, local}`（`dsh-subagent/lib/types/types.d.ts:74-88`），**不带工具名/描述**；
 * 子会话的 `description` 只在创建参数里（`ContinuableStartSpec.label`），事件里拿不到。
 * 靠时间窗猜"这个子会话是刚才那次 scout 调用"是不可靠的 ⇒ 宁可只做能可靠做的那一半。
 * （进程外投递到**子代理**需要宿主提供该关联，或我们另造一条自己调 `ctx.subagents.start()` 的委派工具。）
 *
 * ## 文件格式（沿用 my-pi 收件箱惯例）
 *
 * ```
 * <dir>/<sessionId>.inbox.jsonl        每行：{"ts":"…","seq":1,"text":"……","deliverAs":"steer"|"followup"}
 * <dir>/<sessionId>.inbox.state.json   {"consumed": 1}   ← 已消费到的最大 seq（原子写）
 * ```
 *
 * - `seq` 单调递增；桥只投递 `seq > consumed` 的行，投递成功后才推进 `consumed`（幂等、可重放）。
 * - `deliverAs` 缺省 `followup`（新回合）；`steer` 表示"插到下一个 step 边界"（A25 已验）。
 * - 坏行（非法 JSON / 缺 text）**跳过并计数上报**，绝不让一行坏数据卡死整条桥。
 *
 * ## 安全边界
 *
 * * **默认关闭**（要显式 `inbox.enabled`）：它会周期读文件、还会把文件内容变成用户消息。
 * * 只投递给**已存在且活着的** agent（sessionId 精确匹配；不猜、不广播）。
 * * 定时器 `unref()`（不拖住进程退出）；`stop()` 幂等。
 */

/** 收件箱里的一行 */
export interface InboxLine {
  readonly seq: number;
  readonly text: string;
  readonly deliverAs: 'steer' | 'followup';
}

/** `node:fs` 的最小面（便于单测注入） */
export interface InboxFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  readdirSync(path: string): string[];
  existsSync(path: string): boolean;
  renameSync?(from: string, to: string): void;
  mkdirSync?(path: string, options?: { recursive?: boolean }): void;
}

/** 投递目标（宿主活 agent 的最小子集） */
export interface InboxAgentTarget {
  steer(message: unknown): void;
  followup(message: unknown): void;
}

/**
 * 解析收件箱原文 → 行；坏行丢弃并计数（**不静默**：由调用方把 `skipped` 报出去）。
 *
 * @param raw 文件全文
 * @param startSeq 只关心 `seq >` 这个值的行（传已消费的 seq）
 */
export function parseInbox(raw: string, startSeq = 0): { lines: InboxLine[]; skipped: number } {
  const lines: InboxLine[] = [];
  let skipped = 0;
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const obj = parsed as { seq?: unknown; text?: unknown; deliverAs?: unknown };
    const seq = typeof obj.seq === 'number' && Number.isFinite(obj.seq) ? obj.seq : undefined;
    const text = typeof obj.text === 'string' ? obj.text : undefined;
    // ★ `seq` 必须 >= 1：state 的"未消费"就是 0 ⇒ seq=0 的行永远投不出去，按坏行计数（不静默丢）
    if (seq === undefined || seq < 1 || !text || !text.trim()) {
      skipped += 1;
      continue;
    }
    if (seq <= startSeq) continue;
    lines.push({ seq, text, deliverAs: obj.deliverAs === 'steer' ? 'steer' : 'followup' });
  }
  lines.sort((a, b) => a.seq - b.seq);
  return { lines, skipped };
}

/** 读 state（坏文件按 0 处理；不抛） */
export function readConsumed(fs: InboxFs, statePath: string): number {
  try {
    if (!fs.existsSync(statePath)) return 0;
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { consumed?: unknown };
    return typeof parsed.consumed === 'number' && Number.isFinite(parsed.consumed) ? parsed.consumed : 0;
  } catch {
    return 0;
  }
}

/** 写 state（有 rename 就原子写，避免半个文件） */
export function writeConsumed(fs: InboxFs, statePath: string, consumed: number): void {
  const body = `${JSON.stringify({ consumed })}\n`;
  const tmp = `${statePath}.tmp`;
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    if (typeof fs.renameSync === 'function') fs.renameSync(tmp, statePath);
    else fs.writeFileSync(statePath, body, 'utf8');
  } catch {
    try {
      fs.writeFileSync(statePath, body, 'utf8');
    } catch {
      /* 写不了 state 就算了：下一轮会重复投递，但不至于卡死 */
    }
  }
}

/** 由 sessionId 生成一个稳定的用户消息（形状对齐 spike A25 验过的 `UserMessage`） */
export function userMessageFor(sessionId: string, line: InboxLine): unknown {
  return {
    id: `inbox-${sessionId}-${line.seq}`,
    role: 'user',
    content: [{ type: 'text', text: line.text }],
    source: { kind: 'user' },
  };
}

export interface SessionInboxBridgeOptions {
  readonly dir: string;
  /** 轮询间隔（默认 1500ms） */
  readonly intervalMs?: number;
  /** 上报（成功投递 / 跳过 / 出错都用它；缺省 `console.log`） */
  readonly report?: (message: string) => void;
}

export interface SessionInboxBridge {
  /** 立刻扫一轮（返回本次投递条数；测试/CLI 手动触发用） */
  drain(): number;
  /** 停止（幂等） */
  stop(): void;
  /** 当前跟踪到的活会话（排障用） */
  sessions(): string[];
}

/**
 * 启动桥。
 *
 * @param ctx cordis ctx（只要有 `on`；`setInterval` 等用全局，便于单测）
 * @param fs  文件面（测试注入）
 * @param options 目录/间隔/上报
 */
export function startSessionInboxBridge(
  ctx: { on?: (event: string, listener: (...args: readonly unknown[]) => unknown) => (() => void) | void },
  fs: InboxFs,
  options: SessionInboxBridgeOptions,
): SessionInboxBridge {
  const report = options.report ?? ((m: string) => console.log(`[my-pi-dsh] ${m}`));
  const intervalMs = options.intervalMs ?? 1500;
  const agents = new Map<string, InboxAgentTarget>();
  const offs: Array<() => void> = [];
  let stopped = false;

  const sessionIdOf = (agent: unknown): string | undefined => {
    const a = agent as { session?: { id?: unknown; header?: { id?: unknown } }; id?: unknown } | undefined;
    const id = a?.session?.id ?? a?.session?.header?.id ?? a?.id;
    return typeof id === 'string' && id ? id : undefined;
  };

  // 跟踪活 agent（`agent/created` 的负载是 `{agent}`；两种形状都兜住，同 facade 的做法）
  const onCreated = (...args: readonly unknown[]): unknown => {
    const first = args[0] as { agent?: unknown } | undefined;
    const agent = first && typeof first === 'object' && 'agent' in first ? first.agent : first;
    const id = sessionIdOf(agent);
    const target = agent as InboxAgentTarget | undefined;
    if (id && typeof target?.steer === 'function' && typeof target?.followup === 'function') agents.set(id, target);
    return undefined;
  };
  const onDisposed = (...args: readonly unknown[]): unknown => {
    const first = args[0] as { agent?: unknown; session?: unknown } | undefined;
    const agent = first && typeof first === 'object' && 'agent' in first ? first.agent : first;
    const id = sessionIdOf(agent ?? first);
    if (id) agents.delete(id);
    return undefined;
  };
  for (const [event, listener] of [
    ['agent/created', onCreated],
    ['agent/disposed', onDisposed],
  ] as const) {
    try {
      const off = ctx.on?.(event, listener);
      if (typeof off === 'function') offs.push(off);
    } catch {
      /* 订阅不上就只靠 currentInitiator 兜底；不阻塞启动 */
    }
  }

  const drain = (): number => {
    let delivered = 0;
    let files: string[] = [];
    try {
      files = fs.readdirSync(options.dir).filter((f) => f.endsWith('.inbox.jsonl'));
    } catch {
      return 0; // 目录还没建 ⇒ 正常情况
    }
    for (const file of files) {
      const sessionId = file.slice(0, -'.inbox.jsonl'.length);
      const target = agents.get(sessionId);
      if (!target) continue; // 不是本进程的活会话（或已结束）⇒ 不动它的 state
      const path = `${options.dir}/${file}`;
      const statePath = `${options.dir}/${sessionId}.inbox.state.json`;
      let raw = '';
      try {
        raw = fs.readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      const consumed = readConsumed(fs, statePath);
      const { lines, skipped } = parseInbox(raw, consumed);
      if (skipped > 0) report(`收件箱 ${file}：跳过 ${skipped} 条坏行（不是合法 JSON 或缺 text）`);
      for (const line of lines) {
        try {
          const message = userMessageFor(sessionId, line);
          if (line.deliverAs === 'steer') target.steer(message);
          else target.followup(message);
          delivered += 1;
          writeConsumed(fs, statePath, line.seq);
          report(`收件箱投递：${sessionId} seq=${line.seq}（${line.deliverAs}）"${line.text.slice(0, 40)}"`);
        } catch (error) {
          // 投递失败**不推进 state**（下一轮重试），但要说清楚
          report(`收件箱投递失败：${sessionId} seq=${line.seq} ⇒ ${(error as Error).message}`);
          break;
        }
      }
    }
    return delivered;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  if (intervalMs > 0) {
    timer = setInterval(() => {
      if (stopped) return;
      try {
        drain();
      } catch (error) {
        report(`收件箱轮询出错（继续）：${String(error)}`);
      }
    }, intervalMs);
    // 不拖住进程退出
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  return {
    drain,
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      for (const off of offs) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      offs.length = 0;
      agents.clear();
    },
    sessions: () => [...agents.keys()],
  };
}
