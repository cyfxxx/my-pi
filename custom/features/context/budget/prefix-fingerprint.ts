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
 */

import { createHash } from 'node:crypto';

/** 参与"消息头"指纹的前 N 条消息（足够覆盖 system 之后的早期上下文） */
export const FINGERPRINT_HEAD_MESSAGES = 6;

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
  /** thinking 档位（DeepSeek 的缓存键包含 reasoning_effort，切档使整段前缀失效） */
  level: string;
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
  const system = sha(systemTextOf(payload));
  const tools = sha(stable(payload.tools));
  const head = sha(messages.slice(0, FINGERPRINT_HEAD_MESSAGES).map(messageKey).join('\n'));
  const total = sha([system, tools, sha(messages.map(messageKey).join('\n'))].join('|'));
  const changed: string[] = [];
  if (prev) {
    if (prev.system !== system) changed.push('system');
    if (prev.tools !== tools) changed.push('tools');
    if (prev.head !== head) changed.push('head');
    if (prev.messageCount !== messages.length) changed.push('messages');
    if ((prev.level ?? '') !== level) changed.push('level');
    // total 兜底：以上分段全部未变、但整体指纹不同 → 变化点在 head 之外的消息内容里。
    // 旧实现不比较 total，这类改写会被记成 changed: []，是"整段失效查无原因"的盲区。
    if (changed.length === 0 && prev.total !== total) changed.push('total');
  }
  return {
    ts: now,
    ...(prev ? { sinceLastMs: Math.max(0, now - prev.ts) } : {}),
    total,
    system,
    tools,
    head,
    level,
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
