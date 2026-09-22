/**
 * 任务完成即时记录（纯逻辑 + 本地文件）
 * 迁移自 pi-tools `agent/services/diagnostics/task-record.ts`，落点改为
 * `portable/memory/task-records.jsonl`（可用 PI_TASK_RECORD_FILE 覆盖）。
 *
 * 每次任务完成后（agent_settled）确定性写一条结构化记录，供批量总结层
 * `scripts/task-summarizer.mjs` 聚合。仅数据文件、不进注入面；失败静默。
 */

import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';

export interface TaskRecord {
  type: 'task';
  ts: number;
  /** 本轮最后一条用户请求摘要（前 200 字） */
  userRequest: string;
  /** 本轮请求总 token（input+cacheRead） */
  contextTokens: number;
  cacheHit: number;
  output: number;
  /** 本轮工具调用次数 */
  tools: number;
  /** 本轮是否触发自动压缩 */
  compacted: boolean;
  /** 会话内累计 user 消息数 */
  userSeq: number;
}

export function taskRecordFile(): string {
  return process.env.PI_TASK_RECORD_FILE || join(getMemoryDir(), 'task-records.jsonl');
}

export function recordTaskRecord(e: Omit<TaskRecord, 'type' | 'ts'>): void {
  // 后台总结/隔离任务不写记录，避免总结轮被再次总结形成递归积累。
  if (process.env.PI_DISABLE_TASK_RECORD === '1') return;
  try {
    const rec: TaskRecord = { type: 'task', ts: Date.now(), ...e };
    appendFileSync(taskRecordFile(), JSON.stringify(rec) + '\n');
  } catch {
    /* ignore */
  }
}

export function loadTaskRecords(): TaskRecord[] {
  try {
    if (!existsSync(taskRecordFile())) return [];
    const recs: TaskRecord[] = [];
    for (const l of readFileSync(taskRecordFile(), 'utf-8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l) as TaskRecord;
        if (r && r.type === 'task') recs.push(r);
      } catch {
        /* 跳过损坏行 */
      }
    }
    return recs;
  } catch {
    return [];
  }
}
