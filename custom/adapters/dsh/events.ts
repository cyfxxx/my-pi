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
}

/**
 * 18 个 my-pi 钩子事件的映射（顺序与 `DSH-HOOK-MAPPING.md` §1.1 的调用点降序一致）。
 * 调用点计数写进注释，方便按"改造量"排序（② 档占 29/53 个调用点）。
 */
export const PI_TO_DSH_EVENTS: readonly DshEventMapping[] = [
  {
    pi: 'session_start',
    tier: 'semantic',
    dsh: ['agent/created', 'session/created'],
    via: 'cordis',
    note: '9 处调用点；粒度从"会话"变"agent"，且 agent/created 是否决点（抛错即创建失败），resume 语义要重查',
  },
  {
    pi: 'session_shutdown',
    tier: 'semantic',
    dsh: ['agent/disposed', 'session/disposed', 'workspace/session-stop'],
    via: 'cordis',
    note: '6 处；pi 是"会话被替换时"一次清理，DSH 拆成 agent/存储/归档三种时机，顺序与能否 veto 都不同',
  },
  {
    pi: 'before_agent_start',
    tier: 'semantic',
    dsh: ['agent/pre-step', 'system-prompt/assemble'],
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
  },
  {
    pi: 'input',
    tier: 'semantic',
    dsh: ['agent/pre-step', 'agent/inbox/inserted'],
    via: 'cordis',
    note: '4 处；改写对象从"用户输入"变成"进入 step 的消息数组"（inbox/inserted 只能观察）',
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
    note: '3 处；accept/replace/enrich/block 都有对应（只观察用 tools/result）',
  },
  {
    pi: 'turn_end',
    tier: 'direct',
    dsh: ['turn/end', 'agent/turn-stopping'],
    via: 'session-event',
    note: '3 处；需要"让回合继续"时 DSH 的 turn-stopping 比 pi 更强（可 steer）',
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
    dsh: ['agent/turn-stopping', 'agent/status'],
    via: 'cordis',
    note: '2 处；pi 是"整段 agent 结束"，DSH 这一层是回合级 ⇒ 处理器要从"结束一次"改成"每回合判条件"',
  },
  {
    pi: 'thinking_level_select',
    tier: 'semantic',
    dsh: ['model/selection'],
    via: 'session-event',
    note: '1 处；DSH 没有 thinking-level 事件，只能拿到模型选择 ⇒ 需确认处理器是否真依赖级别语义',
  },
  {
    pi: 'context',
    tier: 'direct',
    dsh: ['system-prompt/assemble'],
    via: 'cordis',
    note: '1 处；两者都允许权威改写装配结果，是最干净的一处对应',
  },
  {
    pi: 'session_before_compact',
    tier: 'semantic',
    dsh: ['compaction'],
    via: 'service',
    note: '1 处；无等价事件：pi 是"每次压缩前可取消/可自定义的回调"，DSH 是替换 CompactionEngine 服务（或失败路径瀑布 compaction/summary-error）⇒ 外观层显式判为需服务替换',
  },
  {
    pi: 'before_provider_request',
    tier: 'direct',
    dsh: ['agent/request', 'llm/stream'],
    via: 'cordis',
    note: '1 处；都能在请求发出前替换调用配置，DSH 另有流级瀑布可短路',
  },
  {
    pi: 'message_update',
    tier: 'direct',
    dsh: ['agent/assistant-stream'],
    via: 'cordis',
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
    pi: 'message_end',
    tier: 'direct',
    dsh: ['assistant/message'],
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
