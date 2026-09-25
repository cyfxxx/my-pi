/**
 * 请求前缀指纹（纯逻辑，零 Pi 依赖）
 *
 * 目的：定位"整段缓存失效"。自动前缀缓存按 token 序列匹配，理论上只有变化点**之后**
 * 才重算；但实测 my-pi 出现单次 170K–316K 的全量未命中（cacheRead 仅 2K），说明变化点
 * 落在前缀极前处。本模块对请求分段落指纹（system / tools / 消息头 / 总序列），
 * 与上一条对比即可回答"这次失效是谁变了"。
 *
 * 与 `scripts/check-injection-surface.sh`（静态 system prompt 指纹）互补：
 * 这里是运行时逐请求指纹，覆盖 tools 与消息序列。
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
 */
export function fingerprintRequest(
  payload: { messages?: unknown[]; tools?: unknown; system?: unknown },
  prev: PrefixFingerprint | null = null,
  now: number = Date.now(),
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
  }
  return {
    ts: now,
    ...(prev ? { sinceLastMs: Math.max(0, now - prev.ts) } : {}),
    total,
    system,
    tools,
    head,
    messageCount: messages.length,
    changed,
  };
}

/** 人类可读的一行摘要（用于日志/诊断输出） */
export function formatFingerprint(f: PrefixFingerprint): string {
  const flags = f.changed.length > 0 ? f.changed.join('+') : 'same';
  const idle = f.sinceLastMs != null ? `${Math.round(f.sinceLastMs / 1000)}s` : '-';
  return `${f.total} sys=${f.system} tools=${f.tools} head=${f.head} msgs=${f.messageCount} idle=${idle} [${flags}]`;
}
