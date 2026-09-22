export interface TaskRec {
  type: 'task';
  ts: number;
  userRequest: string;
  contextTokens: number;
  cacheHit: number;
  output: number;
  tools: number;
  compacted: boolean;
  userSeq: number;
}

export function parseTaskRecords(raw: string): TaskRec[];
export function groupSessions(records: TaskRec[], gapMs?: number): { records: TaskRec[]; lastTs: number }[];
export function isSubstantial(r: TaskRec): boolean;
export function buildDigest(records: TaskRec[]): string;
