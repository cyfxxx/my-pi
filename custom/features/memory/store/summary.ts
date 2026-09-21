/**
 * Memory Feature — 会话摘要构建（纯逻辑，零 Pi 依赖）
 *
 * 把 compaction 生成的摘要文本整理为 `SummaryEntry`：启发式抽取决策/事实/偏好/教训，
 * 其余保留在 fullText。不做 LLM 调用，保证在压缩路径上零额外成本。
 */

import { randomUUID } from 'node:crypto';
import type { SummaryEntry } from './types';

const MAX_TITLE = 80;

const MARKERS: Array<{ key: 'decisions' | 'facts' | 'prefs' | 'lessons'; re: RegExp }> = [
  { key: 'decisions', re: /^(?:决策|决定|decisions?)[:：]\s*/i },
  { key: 'facts', re: /^(?:事实|facts?)[:：]\s*/i },
  { key: 'prefs', re: /^(?:偏好|preferences?|prefs?)[:：]\s*/i },
  { key: 'lessons', re: /^(?:教训|lessons?)[:：]\s*/i },
];

function cleanLine(raw: string): string {
  return raw
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .trim();
}

export function firstSummaryLine(text: string): string {
  for (const line of text.split('\n')) {
    const clean = cleanLine(line);
    if (clean) return clean;
  }
  return '';
}

export function buildSummaryEntry(params: {
  sessionId: string | null;
  text: string;
  ts?: string;
  title?: string;
}): SummaryEntry {
  const text = (params.text ?? '').trim();
  const decisions: string[] = [];
  const facts: string[] = [];
  const prefs: string[] = [];
  const lessons: string[] = [];

  for (const raw of text.split('\n')) {
    const line = cleanLine(raw);
    if (!line) continue;
    for (const { key, re } of MARKERS) {
      const m = line.match(re);
      if (m && line.length > m[0].length) {
        const value = line.slice(m[0].length).trim();
        if (value) {
          if (key === 'decisions') decisions.push(value);
          else if (key === 'facts') facts.push(value);
          else if (key === 'prefs') prefs.push(value);
          else lessons.push(value);
        }
        break;
      }
    }
  }

  const title = (params.title?.trim() || firstSummaryLine(text) || '会话摘要').slice(0, MAX_TITLE);
  return {
    id: randomUUID(),
    sessionId: params.sessionId,
    ts: params.ts ?? new Date().toISOString(),
    title,
    decisions,
    facts,
    prefs,
    lessons,
    fullText: text,
  };
}
