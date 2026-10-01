/**
 * 工作区指令收集与渲染的纯逻辑测试（P1-1）
 *
 * 背景：pi 原生把 AGENTS.md 注入 system prompt 的 project_context 段（缓存前缀最前处），
 * 而这份文件由 my-pi 自己频繁编辑 → 每改一次整段前缀作废。改由本模块复刻同一套发现规则、
 * 渲染成尾部 append-only 消息。因此这里要锁死三件事：**发现顺序与 pi 一致**、
 * **同组文件渲染逐字节稳定**（否则"内容变才追加"判定失效）、**体积预算可控**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectContextFiles,
  collectWorkspaceInstructions,
  renderWorkspaceInstructions,
  truncateUtf8Safe,
  CONTEXT_FILE_CANDIDATES,
  WORKSPACE_INSTRUCTIONS_MAX_BYTES,
} from '../budget/workspace-instructions';

let root: string;
let agentDir: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'my-pi-ws-'));
  agentDir = join(root, 'agent');
  cwd = join(root, 'repo', 'pkg');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const write = (p: string, text: string): void => writeFileSync(p, text, 'utf-8');

describe('工作区指令发现', () => {
  it('agentDir 优先，随后 cwd→根（宽泛→具体）', () => {
    write(join(agentDir, 'AGENTS.md'), 'AGENT');
    write(join(root, 'repo', 'AGENTS.md'), 'REPO');
    write(join(cwd, 'AGENTS.md'), 'PKG');
    const files = collectContextFiles({ cwd, agentDir });
    expect(files.map((f) => f.content)).toEqual(['AGENT', 'REPO', 'PKG']);
  });

  it('同目录内按候选顺序取第一个（override 优先于 AGENTS.md 优先于 CLAUDE.md）', () => {
    write(join(cwd, 'CLAUDE.md'), 'CLAUDE');
    write(join(cwd, 'AGENTS.md'), 'AGENTS');
    expect(collectContextFiles({ cwd, agentDir }).map((f) => f.content)).toEqual(['AGENTS']);
    write(join(cwd, 'AGENTS.override.md'), 'OVERRIDE');
    expect(collectContextFiles({ cwd, agentDir }).map((f) => f.content)).toEqual(['OVERRIDE']);
    expect(CONTEXT_FILE_CANDIDATES[0]).toBe('AGENTS.override.md');
  });

  it('按路径去重：agentDir 同时也是 cwd 祖先时不重复注入', () => {
    // agentDir 放在 cwd 的祖先链上
    const nested = join(agentDir, 'work');
    mkdirSync(nested, { recursive: true });
    write(join(agentDir, 'AGENTS.md'), 'ONCE');
    const files = collectContextFiles({ cwd: nested, agentDir });
    expect(files).toHaveLength(1);
  });

  it('没有指令文件时返回空数组', () => {
    expect(collectContextFiles({ cwd, agentDir })).toEqual([]);
  });
});

describe('渲染的确定性与预算', () => {
  it('同一组文件渲染逐字节一致（含 hash），内容变则 hash 变', () => {
    write(join(agentDir, 'AGENTS.md'), 'A');
    const a1 = collectWorkspaceInstructions({ cwd, agentDir });
    const a2 = collectWorkspaceInstructions({ cwd, agentDir });
    expect(a1.text).toBe(a2.text);
    expect(a1.hash).toBe(a2.hash);
    write(join(agentDir, 'AGENTS.md'), 'B');
    expect(collectWorkspaceInstructions({ cwd, agentDir }).hash).not.toBe(a1.hash);
  });

  it('无文件 → 空文本（调用方据此跳过注入）', () => {
    const wi = collectWorkspaceInstructions({ cwd, agentDir });
    expect(wi.text).toBe('');
    expect(wi.files).toEqual([]);
  });

  it('超预算时从最宽泛的开始丢，并在文本里说明', () => {
    write(join(root, 'repo', 'AGENTS.md'), 'R'.repeat(400));
    write(join(cwd, 'AGENTS.md'), 'P'.repeat(400));
    const wi = renderWorkspaceInstructions(collectContextFiles({ cwd, agentDir }), 500);
    expect(wi.files.map((f) => f.content[0])).toEqual(['P']);
    expect(wi.omitted).toHaveLength(1);
    expect(wi.text).toContain('omitted');
    expect(wi.text).toContain('预算');
  });

  it('单份就超预算 → 截断到预算内且不切断多字节字符', () => {
    write(join(cwd, 'AGENTS.md'), '中'.repeat(200)); // 每字 3 字节 = 600B
    const wi = renderWorkspaceInstructions(collectContextFiles({ cwd, agentDir }), 100);
    expect(wi.truncated).toHaveLength(1);
    expect(wi.truncated[0].from).toBe(600);
    expect(Buffer.byteLength(wi.files[0].content, 'utf-8')).toBeLessThanOrEqual(100);
    expect(wi.files[0].content.endsWith('\uFFFD')).toBe(false); // 无替换字符 = 未切坏
    expect(wi.text).toContain('truncated');
  });

  it('truncateUtf8Safe 不切坏多字节字符', () => {
    const s = 'a中b'; // 1 + 3 + 1 字节
    expect(truncateUtf8Safe(s, 10)).toBe(s);
    expect(truncateUtf8Safe(s, 4)).toBe('a中');
    expect(truncateUtf8Safe(s, 3)).toBe('a');
    expect(truncateUtf8Safe(s, 0)).toBe('');
  });

  it('预算常量与 DSH 对齐（64KB）', () => {
    expect(WORKSPACE_INSTRUCTIONS_MAX_BYTES).toBe(65_536);
  });

  it('渲染文本带来源标题，便于模型判断优先级', () => {
    write(join(agentDir, 'AGENTS.md'), 'AGENT-RULES');
    const wi = collectWorkspaceInstructions({ cwd, agentDir });
    expect(wi.text).toContain('Instructions from:');
    expect(wi.text).toContain(join(agentDir, 'AGENTS.md'));
    expect(wi.text).toContain('AGENT-RULES');
    expect(wi.text).toContain('更具体的指令优先');
  });
});
