/**
 * 工作区指令（AGENTS.md / CLAUDE.md）收集与渲染（纯逻辑，零 Pi 依赖）
 *
 * 为什么由 my-pi 自己收集，而不用 pi 的原生注入：
 * pi 把工作区指令放进 **system prompt 的 project_context 段**——即缓存前缀的最前处。
 * 而 my-pi 的工作区指令（`portable/agent/AGENTS.md`）恰恰是**它自己频繁编辑**的文件：
 * 每改一次，整段前缀作废（实测 763 条指纹里 9 次 `system` 断裂，冷启动平均 23,973 token）。
 * DSH 的做法相反：工作区指令以 `<system-reminder>` 包成 **user 消息追加到历史**，append-only，
 * 内容变更时再追加一份完整替换——改文档只影响尾部。
 *
 * 因此：pi 侧用 `--no-context-files` 关掉原生注入，本模块复刻同一套发现规则，产出可注入的消息。
 *
 * 发现规则（与 `vendor/pi/packages/coding-agent/src/core/resource-loader.ts:185-269` 对齐）：
 *   1. `agentDir` 优先（= `portable/agent/AGENTS.md`，my-pi 的那份）；
 *   2. 再从 **cwd 向上逐级**找；同目录内按候选顺序取第一个命中的文件；
 *   3. 顺序为"宽泛 → 具体"（根目录在前、cwd 在后），更具体的排后面便于覆盖；
 *   4. 按路径去重。
 *   与 pi 的差异（有意）：不实现 git worktree 的 shadow 判定（边缘情形），改为按路径去重；
 *   另加**体积预算**（pi 没有），避免文档无限膨胀把前缀撑大。
 *
 * 稳定性要求：同一组文件必须渲染出**逐字节相同**的文本（不得含时间戳/路径以外的易变值），
 * 否则调用方的"内容变才追加"判定会失效，变成每轮都注入。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** 与 pi 的候选顺序一致：同目录内取第一个存在者 */
export const CONTEXT_FILE_CANDIDATES = [
  'AGENTS.override.md',
  'AGENTS.md',
  'AGENTS.MD',
  'CLAUDE.md',
  'CLAUDE.MD',
] as const;

/** 工作区指令总体积预算（UTF-8 字节）。对齐 DSH 的 64KB `maxBytes`。 */
export const WORKSPACE_INSTRUCTIONS_MAX_BYTES = 65_536;

export interface ContextFile {
  path: string;
  content: string;
}

export interface TruncationNote {
  path: string;
  from: number;
  to: number;
}

export interface WorkspaceInstructions {
  files: ContextFile[];
  /** 因预算被整体丢弃的文件（从最宽泛的开始丢） */
  omitted: string[];
  /** 因预算被截断的文件 */
  truncated: TruncationNote[];
  /** 待注入的消息正文（含来源标题与预算说明） */
  text: string;
  /** text 的 sha256 前 16 位：调用方据此判断"内容变才追加" */
  hash: string;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 同目录内按候选顺序读第一个存在的文件 */
export function loadContextFileFromDir(dir: string): ContextFile | null {
  for (const name of CONTEXT_FILE_CANDIDATES) {
    const p = join(dir, name);
    try {
      if (!existsSync(p) || !statSync(p).isFile()) continue;
      return { path: p, content: stripBom(readFileSync(p, 'utf-8')) };
    } catch {
      /* 读不了就当这个候选不存在，继续下一个 */
    }
  }
  return null;
}

/**
 * 按 pi 的规则收集：agentDir 优先，随后 cwd → 根，顺序为宽泛→具体；按路径去重。
 * 截断的深度上限（64 层）只为防御异常路径，正常不会触及。
 */
export function collectContextFiles(options: { cwd: string; agentDir: string }): ContextFile[] {
  const out: ContextFile[] = [];
  const seen = new Set<string>();
  const push = (f: ContextFile | null): void => {
    if (!f) return;
    const key = resolve(f.path);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };

  push(loadContextFileFromDir(resolve(options.agentDir)));

  const ancestors: ContextFile[] = [];
  let dir = resolve(options.cwd);
  for (let depth = 0; depth < 64; depth++) {
    const f = loadContextFileFromDir(dir);
    if (f && !seen.has(resolve(f.path))) ancestors.unshift(f);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 祖先里可能与 agentDir 那份同路径（agentDir 在 cwd 之上时），逐个去重后再并入
  for (const f of ancestors) push(f);
  return out;
}

/** UTF-8 安全截断：不切断多字节字符（返回按字符数截断后的字符串与字节数） */
export function truncateUtf8Safe(content: string, maxBytes: number): string {
  const buf = Buffer.from(content, 'utf-8');
  if (buf.byteLength <= maxBytes) return content;
  let end = maxBytes;
  // UTF-8 续字节形如 10xxxxxx；回退到字符边界
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf-8');
}

const INTRO =
  '以下工作区指令可能与你的工作相关，适用时作为指引；更具体的指令优先于更宽泛的。' +
  '它们不覆盖 system / developer / 用户的直接指令。';

function renderParts(
  files: ContextFile[],
  omitted: string[],
  truncated: TruncationNote[],
): string {
  const parts: string[] = [INTRO];
  if (omitted.length > 0 || truncated.length > 0) {
    const notes: string[] = [];
    if (omitted.length > 0) notes.push(`omitted ${omitted.join(', ')}`);
    if (truncated.length > 0) {
      notes.push(
        ...truncated.map((t) => `truncated ${t.path} from ${t.from} to ${t.to} bytes`),
      );
    }
    parts.push(`[工作区指令预算 ${WORKSPACE_INSTRUCTIONS_MAX_BYTES} bytes：${notes.join('; ')}]`);
  }
  for (const f of files) {
    parts.push(`Instructions from: ${f.path}\n\n${f.content}`);
  }
  return parts.join('\n\n');
}

/**
 * 按预算渲染：能放下就全放；放不下从**最宽泛的**（数组前部）开始丢；
 * 若最具体的那份本身就超预算，则截断它（UTF-8 安全）并给出说明。
 */
export function renderWorkspaceInstructions(
  files: ContextFile[],
  maxBytes: number = WORKSPACE_INSTRUCTIONS_MAX_BYTES,
): WorkspaceInstructions {
  const sizeOf = (f: ContextFile): number => Buffer.byteLength(f.content, 'utf-8');
  const omitted: string[] = [];
  const truncated: TruncationNote[] = [];
  let kept = [...files];

  const totalBytes = (): number => kept.reduce((a, f) => a + sizeOf(f), 0) + 0;
  while (kept.length > 1 && totalBytes() > maxBytes) {
    const dropped = kept.shift();
    if (dropped) omitted.push(dropped.path);
  }
  if (kept.length === 1 && sizeOf(kept[0]) > maxBytes) {
    const f = kept[0];
    const from = sizeOf(f);
    const cut = truncateUtf8Safe(f.content, maxBytes);
    kept = [{ path: f.path, content: cut }];
    truncated.push({ path: f.path, from, to: Buffer.byteLength(cut, 'utf-8') });
  }

  const text = kept.length > 0 || omitted.length > 0 || truncated.length > 0
    ? renderParts(kept, omitted, truncated)
    : '';
  return {
    files: kept,
    omitted,
    truncated,
    text,
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
  };
}

/** 一站式：收集 + 渲染 */
export function collectWorkspaceInstructions(options: {
  cwd: string;
  agentDir: string;
  maxBytes?: number;
}): WorkspaceInstructions {
  return renderWorkspaceInstructions(
    collectContextFiles({ cwd: options.cwd, agentDir: options.agentDir }),
    options.maxBytes,
  );
}
