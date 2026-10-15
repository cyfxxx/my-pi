/**
 * pi 钩子事件 → DSH 事件的映射表（**数据化**）
 *
 * 来源：`docs/design/DSH-HOOK-MAPPING.md`（静态分析，逐条带 `文件:行号`）。
 * 本文件把那份分析**变成代码里的单一事实来源**，好处有三：
 *   1. 外观层的 `on(event, …)` 直接查表，不会"凭记忆写事件名"（本项目有过误用
 *      `before_tool_call` 的历史 ✗）；
 *   2. 每个映射带 `tier`，让**迁移进度可度量**（① 直接可映射 / ② 需改语义 / ③ 无对应）；
 *   3. 单元测试可以断言"18 个事件 100% 有档位"，新事件漏登记会**报错**而不是静默丢弃。
 *
 * 口径提醒（换基座时最容易踩的三点，均来自那份分析的实测结论）：
 *   - `tier: 'semantic'` 的事件**不是**"找不到"，而是**接入方式/粒度不同**：多半要从
 *     "一次会话级回调"改成"每步/每回合判条件"，或从事件改成**服务替换**；
 *   - `session-event` 类的落点是**提交后**的日志流（`session/event`），
 *     **只能观察、不能拦截** ⇒ 任何需要"改参数/改结果/否决"的钩子都不能走这条路；
 *   - `service` 类（目前只有 `session_before_compact`）没有事件，必须替换服务
 *     （`ctx.compaction`）或走失败瀑布 ⇒ 外观层对它**显式报告 unsupported**，
 *     由使用方决定接哪个服务（不得静默当作已完成）。
 */

import type { DshEventVia } from './types';

/** 迁移档位：① 直接可映射 / ② 需改语义 / ③ 无对应 */
export type MappingTier = 'direct' | 'semantic' | 'none';

export interface DshEventMapping {
  /** pi 侧事件名（`HookEvent` 的取值） */
  readonly pi: string;
  readonly tier: MappingTier;
  /** DSH 侧的落点（事件名 / 会话日志类型 / 服务名） */
  readonly dsh: readonly string[];
  readonly via: DshEventVia;
  /** 一行理由（含粒度差异与风险） */
  readonly note: string;
  /**
   * 落点存在但**语义不等价**时显式声明为 `degraded`（否则外观层会按 `via` 报成 supported，
   * 那是**过度声称**：例如 pi 的"选中档位时触发" vs DSH 的"每请求触发"）。
   */
  readonly status?: 'supported' | 'degraded';
  /** `status: 'degraded'` 时的具体理由（缺省用 note） */
  readonly degradedNote?: string;
}

/**
 * 18 个 my-pi 钩子事件的映射（顺序与 `DSH-HOOK-MAPPING.md` §1.1 的调用点降序一致）。
 * 调用点计数写进注释，方便按"改造量"排序（② 档占 29/53 个调用点）。
 */
export const PI_TO_DSH_EVENTS: readonly DshEventMapping[] = [
  {
    pi: 'session_start',
    tier: 'semantic',
    dsh: ['session/created', 'agent/created'],
    via: 'cordis',
    note: '9 处调用点；★ 2026-10-17 调整：**首选会话级** `session/created`（DSH 的会话创建公告，负载是 **Session 对象本身**——实测 `ctx.sessions.create()` 即触发；语义与 pi 的"会话开始"同层），agent 级 `agent/created` 作为备选（粒度是 agent，且抛错即创建失败，语义更重）',
  },
  {
    pi: 'session_shutdown',
    tier: 'semantic',
    dsh: ['session/disposed', 'agent/disposed', 'workspace/session-stop'],
    via: 'cordis',
    note: '6 处；★ 2026-10-17 调整：**首选会话级** `session/disposed`（会话离开存储，含回滚），`agent/disposed`（agent 级）与 `workspace/session-stop`（因归档停止运行中工作）作为各自时机的补充；pi 的"会话被替换时一次清理"在 DSH 上要按这三种时机分别想清楚',
  },
  {
    pi: 'before_agent_start',
    tier: 'semantic',
    dsh: ['agent/pre-step', 'system-prompt/assemble'],
    status: 'degraded',
    degradedNote: 'pi 是**每回合一次**、DSH 的 agent/pre-step 是**每步一次**（一回合可多次请求）⇒ 桥接层按 `turn` 去重（只跳过处理器，next() 每次照调）以保持"回合开始跑一次"的语义；提示词装配类处理器若要每步都跑应改挂 system-prompt/assemble',
    via: 'cordis',
    note: '6 处；pi 是"启动前一次"，DSH 对应点是每步（pre-step）或提示词装配 ⇒ 处理器必须改成幂等/每步语义',
  },
  {
    pi: 'turn_start',
    tier: 'direct',
    dsh: ['turn/start'],
    via: 'session-event',
    note: '4 处；纯观察，改走 session/event 按 event.type 派发',
  },
  {
    pi: 'agent_settled',
    tier: 'direct',
    dsh: ['agent/status'],
    via: 'cordis',
    note: '4 处；DSH 把 settled 表达为状态翻到 idle（无驱动在排队/在跑）',
    status: 'degraded',
    degradedNote: 'agent/status 在 running/idle **两个方向**都发 ⇒ 桥接层按 status==="idle" 过滤（读不到 status 时**失败开放**，宁可多跑不静默少跑）',
  },
  {
    pi: 'input',
    tier: 'semantic',
    dsh: ['agent/pre-step', 'agent/inbox/inserted'],
    via: 'cordis',
    status: 'degraded',
    degradedNote: '已实现：pi 的 {action:"handled"} ⇒ DSH {kind:"reject"}（并上报"reject 后消息是否回收件箱未核实"）；{action:"continue"}/undefined ⇒ next()。未实现：{action:"transform"} 需要替换 UserMessage 的不可变 content（且有稳定 id）⇒ 按不干预处理并上报（不静默改行为）。另外 DSH 的 pre-step 负载没有 streamingBehavior（steer/followUp）⇒ 该字段为空并上报',
    note: '4 处；改写对象从"用户输入"变成"进入 step 的消息数组"（`PreStepDecision`：`{kind:reject}` 或 `{kind:enter,messages}` ⇒ **整组替换**；`agent/inbox/inserted` 只能观察）。契约出处 `dsh-agent/lib/types/runtime-types.d.ts:92-99`；✗ 运行时未验（需 agent+LLM）',
  },
  {
    pi: 'tool_call',
    tier: 'direct',
    dsh: ['tools/pre-execute'],
    via: 'cordis',
    note: '3 处；分发前闸门，能力等价乃至更强（多了 cancel/ask），改动是 decision 形状',
  },
  {
    pi: 'tool_result',
    tier: 'direct',
    dsh: ['tools/post-execute', 'tools/result'],
    via: 'cordis',
    degradedNote: '实测（spike A14）：pi 返回 `{content}` 会**真的替换**注册表返回的内容块（`accept,content`），但 **`value`（结构化 canonical 值）不随之改变** ⇒ 若下游依赖 value，需另行处理',
    note: '3 处；accept/replace/enrich/block 都有对应（只观察用 tools/result）',
  },
  {
    pi: 'turn_end',
    tier: 'direct',
    dsh: ['turn/end', 'agent/turn-stopping'],
    via: 'session-event',
    note: '3 处；需要"让回合继续"时 DSH 的 turn-stopping 比 pi 更强（可 steer）',
    degradedNote: '负载字段名不同：DSH 日志事件是 `{type,seq,time,data}`（桥接层已把 `data` 摊平到顶层），但 `turn/end` 的 data 只有 `{turn,reason}`，**没有** pi 的 `message` ⇒ 读 `event.message` 的处理器会拿到 undefined，需要字段翻译或改处理器',
  },
  {
    pi: 'session_compact',
    tier: 'direct',
    dsh: ['compaction/end'],
    via: 'session-event',
    note: '2 处；"压缩完成"有直接对应类型，接入走 session/event',
  },
  {
    pi: 'agent_end',
    tier: 'semantic',
    dsh: ['agent/status', 'agent/turn-stopping'],
    via: 'cordis',
    note: '2 处；pi 是"整段 agent 结束"，DSH 这一层是回合级 ⇒ 处理器要从"结束一次"改成"每回合判条件"',
    status: 'degraded',
    degradedNote: '主落点取 agent/status 的 **idle** 转变（桥接层按 status==="idle" 过滤、读不到就失败开放）；若要"每回合判条件"应改挂 agent/turn-stopping（serial，可 steer）',
  },
  {
    pi: 'thinking_level_select',
    tier: 'semantic',
    dsh: ['agent/request'],
    via: 'cordis',
    status: 'degraded',
    degradedNote: '触发点无等价物：DSH 的 agent/request 是**每请求**，pi 的 thinking_level_select 是**选中档位时** ⇒ 处理器语义要搬到请求点（级别→档位的纯映射见 thinking-level.ts，运行时未验）',
    note: '1 处；★ 2026-10-16 更正：**触发点**在 DSH 没有等价物（无"档位选中"事件），但**应用点**有：请求的冻结配置含 `reasoningEffort?: ReasoningEffortId`（dsh-llm/lib/types/call-config.d.ts:19，模块注释明说 "request waterfalls replace them"）⇒ `agent/request`（waterfall，替换冻结调用配置）就是落点。正确移植形态是把 context 的"缓存安全夹档"逻辑**搬到请求点**（每请求幂等），级别→档位的纯映射见 thinking-level.ts。✗ 真正改配置需要模型路由（efforts 来自 LlmModelReasoningInfo）⇒ 运行时未验',
  },
  {
    pi: 'context',
    tier: 'semantic',
    dsh: ['system-prompt/assemble'],
    via: 'cordis',
    note: '1 处；原先判为"最干净的一处对应"，2026-10-17 更正为②（语义面不同，见 degradedNote）',
    status: 'degraded',
    degradedNote: '★ 2026-10-17 更正（原判 ① 是**语义面搞错**）：pi 的 context 事件拿到的是**消息转录**并且可以**替换它**（`ContextEventResult {messages?}`，vendor/pi/.../types.ts:1443-1445），而 DSH 的 system-prompt/assemble 拿到的是**提示词分段/工具/变量**、不是转录 ⇒ 改造点根本不是换事件名。我们那 1 处做的是"旧摘要去重 + 工具输出分层擦除"：前者属压缩引擎（替换 CompactionEngine / 子类化 summarize），后者属 **ctx.toolResultPruner**（服务级、压缩前必跑）；若只是想"补一段上下文"，DSH 的正解是 **ctx.systemPrompt.context()**（实测见 spike A12）⇒ 需重设计',
  },
  {
    pi: 'session_before_compact',
    tier: 'semantic',
    dsh: ['compaction/start'],
    via: 'session-event',
    note: '1 处；★ 2026-10-16 更正：DSH 的压缩生命周期是**会话日志事件** compaction/start|summary|end|prune（声明于 dsh-compaction 的 SessionEventMap，types.d.ts:21/35/73/88），经 `session/event` 追加派发 ⇒ 只能"开始后"观察、**不能否决**。我们这处只需要"压缩前落快照 + 记账"：`compaction/start` 到达时 summary 与替换用的 user/message 都还没落，够用 ✓；若将来要"取消压缩"，DSH 侧得替换 CompactionEngine 服务（不是订阅事件）✗',
  },
  {
    pi: 'before_provider_request',
    tier: 'semantic',
    dsh: ['agent/request', 'llm/stream'],
    via: 'cordis',
    note: '1 处；原先判为"请求前替换调用配置"等价，2026-10-17 更正为②（能力面不同，见 degradedNote）',
    status: 'degraded',
    degradedNote: '★ 2026-10-17 更正（原判 ① 高估了能力面）：pi 这条能**替换整个请求负载**（我们的暖前缀处理器返回 `{messages, tools}` 的新 payload）；DSH 的 `agent/request` 只能替换**调用配置**（provider/model/reasoningEffort/temperature/maxTokens/stop），而 `llm/stream` 虽是"每次流式调用外的瀑布（可短路）"，但**loop 构造的请求是深度冻结的**，契约原话 "listeners **read it, never rewrite it**"（可重建性不变量，dsh-llm/lib/types/index.d.ts:33-44）⇒ 暖前缀"重放已记录 payload"这条路在 DSH 上**没有对应**，需重设计或放弃',
  },
  {
    pi: 'message_update',
    tier: 'direct',
    dsh: ['agent/assistant-stream'],
    via: 'cordis',
    status: 'degraded',
    degradedNote: '负载字段名不同：pi 是 `{assistantMessageEvent:{type,delta}}`，DSH 的 agent/assistant-stream 是**有序帧**（`{type:start|chunk|...}`）⇒ 读 pi 字段的处理器会拿到 undefined，需要字段翻译或改处理器',
    note: '1 处；助手流式增量（DSH 是有序帧 + 结束帧）',
  },
  {
    pi: 'tool_execution_start',
    tier: 'direct',
    dsh: ['tools/execute'],
    via: 'cordis',
    note: '1 处；阶段相同（分发前），DSH 版本是环绕瀑布、能力是超集（超时/重试/指标）',
  },
  {
    pi: 'session_before_switch',
    tier: 'semantic',
    dsh: ['session/disposed', 'agent/disposed', 'workspace/session-stop'],
    via: 'cordis',
    note: '1 处（mode 的会话切换守卫，2026-10-14 新增）；★ pi 这条是**可否决的"切换前"闸门**（{cancel:true} 即可拦下），DSH 的会话生命周期事件都在**之后**（disposed 系）⇒ DSH 上要保留"切换中延后"的语义，得改到发起方（Host/客户端）那一层，agent 侧无处可拦',
  },
  {
    pi: 'message_end',
    tier: 'direct',
    dsh: ['assistant/message'],
    status: 'degraded',
    degradedNote: '负载字段名不同：pi 读 `event.message`，DSH 的日志事件把内容放在 `data`（桥接层已摊平 `data`，但名字不一定叫 message）⇒ 需要按 DSH 字段名核对后再定',
    via: 'session-event',
    note: '1 处；"一条助手消息定稿"是日志类型，走 session/event；也可用 agent/assistant-stream 的结束帧',
  },
];

/** 事件名 → 映射（查不到返回 undefined；调用方必须显式处理"未登记"而不是静默忽略） */
export function resolveDshEvent(piEvent: string): DshEventMapping | undefined {
  return PI_TO_DSH_EVENTS.find((m) => m.pi === piEvent);
}

/** 按档位分组的汇总（供文档/进度统计用；与映射表同源，不会漂移） */
export function mappingSummary(): Record<MappingTier, readonly string[]> {
  return {
    direct: PI_TO_DSH_EVENTS.filter((m) => m.tier === 'direct').map((m) => m.pi),
    semantic: PI_TO_DSH_EVENTS.filter((m) => m.tier === 'semantic').map((m) => m.pi),
    none: PI_TO_DSH_EVENTS.filter((m) => m.tier === 'none').map((m) => m.pi),
  };
}

/**
 * 断言"给定事件集合全部有映射"。
 * 用途：外观层在注册钩子时调用 ⇒ 迁移过程中**任何漏登记的事件都会立刻报错**，
 * 而不是变成一个"注册了但永远不触发"的钩子（本项目最怕的静默失效）。
 */
export function assertEventsMapped(events: readonly string[]): void {
  const missing = events.filter((e) => resolveDshEvent(e) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `DSH 适配层缺少事件映射：${missing.join(', ')}（请补 custom/adapters/dsh/events.ts，` +
        `并在 docs/design/DSH-HOOK-MAPPING.md 记录档位）`,
    );
  }
}
