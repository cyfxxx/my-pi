/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Local stubs (decoupled from pi-coding-agent)
const CONFIG_DIR_NAME = '.pi';
function getAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  return path.join(process.env.HOME || '~', CONFIG_DIR_NAME, 'agent');
}
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      result[key] = val;
    }
  }
  return result;
}

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	/** frontmatter readonly: true 时 spawn 强制白名单工具集（仅 read/grep/find/ls）+ 注入只读提示 */
	readonly?: boolean;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = (() => {
			try {
				// @ts-ignore — parseFrontmatter does not accept type arguments
		return parseFrontmatter<Record<string, string>>(content);
			} catch {
				// 2026-08-28 审计：畸形 YAML 在 UI 确认门前棸掉整个 subagent 调用——跳过该文件而非中断
				return { frontmatter: {} as Record<string, string>, body: "" };
			}
		})();

		if (!(frontmatter as any).name || !(frontmatter as any).description) {
			continue;
		}

		// 2026-08-28 审计：兼容 YAML 数组语法 tools: [read, ls]（split 对数组抛 TypeError）
		const tools = (
			Array.isArray((frontmatter as any).tools)
				? (frontmatter as any).tools
				: typeof (frontmatter as any).tools === "string"
					? (frontmatter as any).tools.split(",")
					: []
		)
			.map((t: unknown) => String(t).trim())
			.filter(Boolean);

		const rawReadonly = (frontmatter as Record<string, unknown>).readonly;

		agents.push({
			name: (frontmatter as any).name,
			description: (frontmatter as any).description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: (frontmatter as any).model,
			readonly: rawReadonly === true || rawReadonly === "true" ? true : undefined,
			systemPrompt: body as string,
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
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
