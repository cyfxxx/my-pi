/**
 * 请求前缀指纹（纯逻辑，零 Pi 依赖）
 *
 * 目的：定位"整段缓存失效"。自动前缀缓存按 token 序列匹配，理论上只有变化点**之后**
 * 才重算；但实测 my-pi 出现单次 170K–316K 的全量未命中（cacheRead 仅 2K），说明变化点
 * 落在前缀极前处。本模块对请求分段落指纹（system / tools / 消息头 / 总序列），
 * 与上一条对比即可回答"这次失效是谁变了"。
 *
 * 与 `scripts/check-injection-surface.sh`（静态 system prompt 指纹）互补：
 * 这里是运行时逐请求指纹，覆盖 tools、消息序列与 thinking 档位。
 *
 * 2026-09-29 补齐的两处盲区（曾是"整段失效查不出原因"的主因）：
 *   1. `total` 算了却从不比较 → 只比较 `messageCount`，中段消息内容被改写时条数不变，
 *      于是记成 `changed: []`（看起来"前缀没变"）。现在 `total` 变化会在没有其它分段
 *      命中时补记为 `changed: ['total']`。
 *   2. 未记录 thinking 档位 → 切档导致的整段失效（cacheRead 归零）看起来"无原因"。
 *      现在档位进入指纹并单独标记 `level`。
 *
 * 2026-10-01 补齐第三处盲区（度量闭合）：`head` 只覆盖前 6 条，而 `total` 兜底会被
 * "条数变化"抢先命中，于是大未命中只剩 `['messages']` 这种**无法定位**的标签——实测
 * 60 条 `input>10K` 的大未命中里 37 条（=全部未命中的约 50%）归因不出来。
 * 现在改为对**整条消息序列**做分段指纹（每 `FINGERPRINT_SEGMENT_MESSAGES` 条一段），
 * 变化时直接给出**首个分叉段**：`messages@0-7` 表示从第 0 条起就分叉（最贵，整段重放），
 * `messages@120-127` 表示中后段改写（只影响其后的少量 token）。判据由此从一个布尔
 * 变成"失效起点"，才能区分"该修"与"可接受"。
 */

import { createHash } from 'node:crypto';

/** 参与"消息头"指纹的前 N 条消息（足够覆盖 system 之后的早期上下文） */
export const FINGERPRINT_HEAD_MESSAGES = 6;

/**
 * 消息序列分段粒度（条）。8 条一段是"定位精度 vs 记录体积"的折中：
 * 300 条上下文 → 约 38 段 ≈ 0.4KB，既能把失效起点定位到 8 条以内，
 * 又不会像逐条哈希那样把日志放大十倍。
 */
export const FINGERPRINT_SEGMENT_MESSAGES = 8;

export interface PrefixFingerprint {
  ts: number;
  /** 距上一条请求的间隔（ms）；用于判定"整段失效"是否发生在长时间空闲之后 */
  sinceLastMs?: number;
  /** 整个请求序列指纹 */
  total: string;
  /** system prompt 指纹 */
  system: string;
  /** tools 定义指纹 */
  tools: string;
  /** 前 N 条消息指纹 */
  head: string;
  /**
   * 全消息序列的分段指纹（每 FINGERPRINT_SEGMENT_MESSAGES 条一段）。
   * 与上一条对比可定位"首个分叉段"，即前缀缓存真正失效的起点。
   */
  segments: string[];
  /** thinking 档位（DeepSeek 的缓存键包含 reasoning_effort，切档使整段前缀失效） */
  level: string;
  /** 工具声明 JSON 的字节数（前缀里最大的构件；增长即成本增长） */
  toolsBytes: number;
  /** system 文本的字节数 */
  systemBytes: number;
  /** 消息条数（压缩/裁剪会改变它） */
  messageCount: number;
  /** 与上一条指纹相比发生变化的段（首次为空） */
  changed: string[];
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function messageKey(m: unknown): string {
  const msg = m as { role?: string; customType?: string; content?: unknown };
  return `${msg?.role ?? ''}:${msg?.customType ?? ''}:${stable(msg?.content)}`;
}

/** 从请求 payload 中取 system prompt（provider payload 形态不固定，尽量兼容） */
export function systemTextOf(payload: {
  messages?: unknown[];
  system?: unknown;
  systemPrompt?: unknown;
}): string {
  const explicit = payload.system ?? payload.systemPrompt;
  if (typeof explicit === 'string') return explicit;
  if (explicit !== undefined && explicit !== null) return stable(explicit);
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  for (const m of messages) {
    const msg = m as { role?: string; content?: unknown };
    if (msg?.role === 'system' || msg?.role === 'developer') return stable(msg.content);
  }
  return '';
}

/** 消息序列分段指纹：每 SEG 条一段，段的哈希差异即"从前缀的哪个位置开始分叉" */
export function messageSegments(messages: unknown[], size: number = FINGERPRINT_SEGMENT_MESSAGES): string[] {
  const out: string[] = [];
  for (let i = 0; i < messages.length; i += size) {
    out.push(sha(messages.slice(i, i + size).map(messageKey).join('\n')).slice(0, 8));
  }
  return out;
}

/**
 * 首个分叉段对应的**消息下标**；无分叉返回 null。
 *
 * 关键语义：**尾部追加不算分叉**。最后一个未满段的内容会随追加而变化（如 6 条 → 7 条时
 * 段 0 从 m0..m5 变成 m0..m6），但缓存前缀并未失效——新的 token 只是在尾部接上。
 * 因此判定规则是：
 *   1. 只比较**两侧都完整**的段（下标 < min(满段数)），首个不同即分叉点；
 *   2. 完整段全同、且**条数不变**时，才比较尾段（原地改写最后一小段的情形）；
 *   3. 条数变了（追加/删除）→ 返回 null，交给 `messages` 计数标记。
 * 不做这一步会把"正常追加"误报成"整段失效"，让度量失去意义。
 */
export function firstDivergentSegment(
  prev: string[] | undefined,
  next: string[],
  prevCount: number,
  nextCount: number,
  size: number = FINGERPRINT_SEGMENT_MESSAGES,
): number | null {
  if (!Array.isArray(prev)) return null;
  const prevFull = Math.floor(Math.max(0, prevCount) / size);
  const nextFull = Math.floor(Math.max(0, nextCount) / size);
  const common = Math.min(prevFull, nextFull, prev.length, next.length);
  for (let i = 0; i < common; i++) {
    if (prev[i] !== next[i]) return i * size;
  }
  if (prevCount === nextCount) {
    const tail = common;
    if (prev[tail] !== undefined && next[tail] !== undefined && prev[tail] !== next[tail]) {
      return tail * size;
    }
  }
  return null;
}

/**
 * 计算请求分段落指纹；`prev` 存在时给出变化段。
 * 注意 total 基于完整消息序列，用于判断"请求是否逐字节相同"。
 * `level` 为当前 thinking 档位（参与缓存键，切档即整段失效）。
 */
export function fingerprintRequest(
  payload: { messages?: unknown[]; tools?: unknown; system?: unknown },
  prev: PrefixFingerprint | null = null,
  now: number = Date.now(),
  level: string = '',
): PrefixFingerprint {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const systemText = systemTextOf(payload);
  const system = sha(systemText);
  const toolsJson = stable(payload.tools);
  const tools = sha(toolsJson);
  const head = sha(messages.slice(0, FINGERPRINT_HEAD_MESSAGES).map(messageKey).join('\n'));
  const segments = messageSegments(messages);
  const total = sha([system, tools, sha(messages.map(messageKey).join('\n'))].join('|'));
  const changed: string[] = [];
  if (prev) {
    if (prev.system !== system) changed.push('system');
    if (prev.tools !== tools) changed.push('tools');
    if (prev.head !== head) changed.push('head');
    if (prev.messageCount !== messages.length) changed.push('messages');
    if ((prev.level ?? '') !== level) changed.push('level');
    // 分段定位：给出**首个分叉段**的消息下标，这是前缀缓存真正失效的起点。
    // 段 0 分叉 = 整段重放（最贵）；越靠后越便宜。旧实现只记 'messages'，无法区分两者。
    const segStart = firstDivergentSegment(prev.segments, segments, prev.messageCount, messages.length);
    if (segStart !== null) {
      changed.push(
        `messages@${segStart}-${segStart + FINGERPRINT_SEGMENT_MESSAGES - 1}`,
      );
    }
    // 兜底：以上分段全部未变、但整体指纹不同（理论上不可达，保留为安全网）
    if (changed.length === 0 && prev.total !== total) changed.push('total');
  }
  return {
    ts: now,
    ...(prev ? { sinceLastMs: Math.max(0, now - prev.ts) } : {}),
    total,
    system,
    tools,
    head,
    segments,
    level,
    toolsBytes: Buffer.byteLength(toolsJson, 'utf-8'),
    systemBytes: Buffer.byteLength(systemText, 'utf-8'),
    messageCount: messages.length,
    changed,
  };
}

/** 人类可读的一行摘要（用于日志/诊断输出） */
export function formatFingerprint(f: PrefixFingerprint): string {
  const flags = f.changed.length > 0 ? f.changed.join('+') : 'same';
  const idle = f.sinceLastMs != null ? `${Math.round(f.sinceLastMs / 1000)}s` : '-';
  return `${f.total} sys=${f.system} tools=${f.tools} head=${f.head} lvl=${f.level || '-'} msgs=${f.messageCount} idle=${idle} [${flags}]`;
}
