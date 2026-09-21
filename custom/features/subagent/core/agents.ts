/**
 * Subagent Feature — Agent 发现（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/subagent/agents.ts`。
 * 自实现 frontmatter 解析（不依赖 pi 的 parseFrontmatter）；项目级目录为 `<cwd>/.pi/agents`。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAgentDir } from '../../../core/config';

export type AgentScope = 'user' | 'project' | 'both';

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  readonly?: boolean;
  systemPrompt: string;
  source: 'user' | 'project';
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

const CONFIG_DIR_NAME = '.pi';

/** 解析 `---` frontmatter（简化 YAML：key: value，数组支持 [a, b] / 逗号串） */
export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { frontmatter: {}, body: content };
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return { frontmatter: fm, body: content.slice(m[0].length) };
}

function loadAgentsFromDir(dir: string, source: 'user' | 'project'): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith('.md')) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    let frontmatter: Record<string, unknown> = {};
    let body = '';
    try {
      ({ frontmatter, body } = parseFrontmatter(content));
    } catch {
      continue;
    }
    const name = frontmatter.name;
    const description = frontmatter.description;
    if (typeof name !== 'string' || typeof description !== 'string' || !name || !description) continue;

    const tools = (
      Array.isArray(frontmatter.tools)
        ? frontmatter.tools
        : typeof frontmatter.tools === 'string'
          ? frontmatter.tools.split(',')
          : []
    )
      .map((t) => String(t).trim())
      .filter(Boolean);

    const rawReadonly = frontmatter.readonly;
    agents.push({
      name,
      description,
      tools: tools.length > 0 ? tools : undefined,
      model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
      readonly: rawReadonly === true || rawReadonly === 'true' ? true : undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  for (;;) {
    const candidate = path.join(currentDir, CONFIG_DIR_NAME, 'agents');
    if (isDirectory(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userDir = path.join(getAgentDir(), 'agents');
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents = scope === 'project' ? [] : loadAgentsFromDir(userDir, 'user');
  const projectAgents = scope === 'user' || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, 'project');

  const agentMap = new Map<string, AgentConfig>();
  if (scope === 'both') {
    for (const a of userAgents) agentMap.set(a.name, a);
    for (const a of projectAgents) agentMap.set(a.name, a);
  } else if (scope === 'user') {
    for (const a of userAgents) agentMap.set(a.name, a);
  } else {
    for (const a of projectAgents) agentMap.set(a.name, a);
  }
  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
  if (agents.length === 0) return { text: 'none', remaining: 0 };
  const listed = agents.slice(0, maxItems);
  return {
    text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join('; '),
    remaining: agents.length - listed.length,
  };
}
