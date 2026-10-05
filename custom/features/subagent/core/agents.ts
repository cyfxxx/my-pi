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

/**
 * 解析 `---` frontmatter（**刻意只支持简化 YAML 子集**，见下）。
 *
 * 支持：`key: value`、数组 `[a, b]` 或逗号串、值两端引号、行尾注释（` # …`，引号内不剥）。
 * 不支持（上游 pi 用真 yaml 包，本层为保持零依赖用简化解析）：块标量（`|` / `>` 多行）、
 * 嵌套映射/列表。遇到块标量标量不再静默当成字面量 `>`：值置空并记进 `unsupported`，
 * 由调用方告警跳过——否则角色会以 description='>' 被注册，问题被埋掉。
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  unsupported: string[];
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { frontmatter: {}, body: content, unsupported: [] };
  const fm: Record<string, unknown> = {};
  const unsupported: string[] = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = stripYamlComment(kv[2]).trim();
    if (/^[|>][-+]?$/.test(val)) {
      fm[key] = '';
      unsupported.push(key);
      continue;
    }
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
  return { frontmatter: fm, body: content.slice(m[0].length), unsupported };
}

/**
 * 去掉 YAML 行尾注释：`#` 前必须是空白（或行首），且不在引号内——
 * 与 YAML 语义一致（`description: 见 issue # 12` 里的 `#` 本就是注释起点）。
 */
function stripYamlComment(raw: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
  }
  return raw;
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
    const filePath = path.join(dir, entry.name);
    // 以 statSync 为准：dirent 的 d_type 在 overlayfs/沙箱下不可靠（实测把普通文件报成 DT_LNK），
    // 误判会静默丢失角色定义。
    try {
      if (!fs.statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    let frontmatter: Record<string, unknown> = {};
    let body = '';
    let unsupported: string[] = [];
    try {
      ({ frontmatter, body, unsupported } = parseFrontmatter(content));
    } catch {
      continue;
    }
    const name = frontmatter.name;
    const description = frontmatter.description;
    if (typeof name !== 'string' || typeof description !== 'string' || !name || !description) {
      // 静默跳过会让"角色文件写错"表现为"角色凭空消失"，排障要翻源码。这里告警一次。
      const why = unsupported.length > 0 ? `字段 ${unsupported.join('/')} 用了不支持的块标量（| 或 >）` : '缺少 name/description';
      console.error(`[subagent] 跳过角色文件 ${filePath}：${why}`);
      continue;
    }

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

