# pi（vendored）+ my-pi 自定义层：运行时实现事实审计

> 目的：为与 DSH（DeepSeek Harness）的对比分析提供**可核查**的实现事实。
> 范围：`/root/my-pi/vendor/pi/`（上游 pi v0.99.1 + `patches/` 001–009）与 `/root/my-pi/custom/`（my-pi 自定义层）。
> 与 [`docs/development/CONTEXT-MANAGEMENT-COMPARISON.md`](CONTEXT-MANAGEMENT-COMPARISON.md) 不重复：压缩阈值/擦除/spill/压力分档/system prompt 变动/暖前缀只做**补充与更正**，矛盾处**以代码为准并在第五节列出**。
>
> 引用约定：`vendor/pi` 的路径省略前缀 `/root/my-pi/vendor/pi/packages/`；`custom/` 的路径省略 `/root/my-pi/custom/`。
> 每条断言附 `file:line` + 一句逐字原文。找不到证据写「未找到证据」。**代码默认值**与**运行时实际值**分列。
> 方法：`read` 完整读取关键文件；实测数据来自真机日志（第 4 节，脚本临时写在 `/tmp`，未提交）。

---

## 0. 口径、材料与一个数据陷阱

**实测数据源**

| 文件 | 规模 | 说明 |
|---|---|---|
| `portable/memory/context/.usage-diag.jsonl` | 942 行 | 逐请求用量；由 `context/index.ts` 的 `turn_end` 钩子写（`custom/features/context/index.ts:697`） |
| `portable/memory/logs/prefix-fingerprints.jsonl` | 763 行 | 逐请求前缀分段指纹；由 `before_provider_request` 钩子写（`custom/features/context/index.ts:124`） |
| `portable/agent/sessions/--root-my-pi--/*.jsonl` | 10 个会话 | 真实 transcript，含 system 分段原文与中途段差分 |
| `portable/memory/logs/level-changes.jsonl` | 3 行 | thinking 档位切换审计 |

**数据陷阱（必须先排除）**：`.usage-diag.jsonl` 的**前 18 行是合成测试夹具**——两组完全相同的 9 行块（`ts` 相差 124.4 s），数值全为整数（`input:100/cacheRead:50/cacheWrite:20/output:80/reasoning:30`），并含 6 类事件记录各 2 条：

```
{"ts":1790262066891,"input":100,"cacheRead":50,"cacheWrite":20,"output":80,"reasoning":30,"total":280,"contextTokens":280}
{"type":"usage-missing","ts":1790262066902}
{"type":"auto-compact","ts":1790262066902,"contextTokens":1200,"threshold":1000}
```

这 18 行中有 6 行是 usage、12 行是事件。**真实 usage 记录 = 924 条，真实事件记录 = 0 条**（所有 `auto-compact`/`prune`/`prune-think`/`thinking-meter`/`level-change`/`usage-missing` 记录都被限制在这 18 行夹具内）。第 4 节所有统计均基于 `raw[18:]` 这 924 条。**结论：真实运行期内，自动压缩事件 0 次、prune 事件 0 次、level-change 事件 0 次**（`level-changes.jsonl` 另有 3 条，见 §3.5）。

**（推定）夹具成因**：`recordUsage` 写盘路径在测试里未被隔离，测试用固定数值直接追加到了生产文件。此处不做进一步追因——不属于本次范围，但会污染任何"按行统计"的口径。

---

## 1. 系统提示词构造（pi 侧）

### 1.1 分段清单与顺序

构造函数的唯一入口：`coding-agent/src/core/system-prompt.ts:121` — `export function buildSystemPromptSections(input: BuildSystemPromptOptions): SystemPromptSections {`

段落的**插入顺序**（JS 对象 string key 保序）与来源：

| # | 段名 | 是否 XML 包裹 | 生成位置 | 来源 |
|---|---|---|---|---|
| 1 | `preamble` | **否**（唯一裸文本段） | `system-prompt.ts:143-147` | 常量，或 `--system-prompt` 覆盖 |
| 2 | `tools` | `<tools>` | `:151` | `selectedTools` × `toolSnippets` |
| 3 | `rules` | `<rules>` | `:152` | `buildRules()`（`:81-118`） |
| 4 | `docs` | `<docs>` | `:153-160` | 常量 + `getReadmePath()/getDocsPath()/getExamplesPath()` |
| 5 | `addendum` | `<addendum>` | `:163` | `resourceLoader.getAppendSystemPrompt()` |
| 6 | `project_context` | `<project_context>` | `:164` | AGENTS.md/CLAUDE.md（§1.3） |
| 7 | `skills` | `<skills>` | `:166-169` | `formatSkillsForPrompt()`（§1.4） |
| 8 | `cwd` | `<cwd>` | `:170` | `cwd.replace(/\\/g, "/")` |
| 9+ | 自定义段 | 同名标签 | `:171-173` | 扩展经 `sections` 传入 |

包裹规则（除 `preamble` 外一律包标签）：

- `system-prompt.ts:175-178` — `const sections: SystemPromptSections = { preamble: promptSections.preamble };` / `for (const [name, content] of Object.entries(promptSections)) {` / `if (name !== "preamble") sections[name] = \`<${name}>\n${content}\n</${name}>\`;`

段名的合法性校验：`system-prompt.ts:137` — `throw new Error(\`Invalid system prompt section name: ${name}\`);`（正则 `:52` — `const SYSTEM_PROMPT_SECTION_NAME = /^[a-z][a-z0-9_-]*$/;`）

**运行时实际值（10 个真实会话，全部一致）**：段序恒为 `['preamble','tools','rules','docs','addendum','project_context','skills','cwd']`，无自定义段。

### 1.2 哪些段静态、哪些动态

- **逐字节静态（同一进程内）**：`preamble`、`docs`（路径常量）、`cwd`。`docs` 内的 4 条路径指向 vendor 安装目录，进程重启后若安装路径变化会变（实测为 `/root/my-pi/vendor/pi/packages/coding-agent/...`，10 个会话全同）。
- **随工具集变化**：`tools` 段（`selectedTools` 过滤 + 每个工具的 `promptSnippet`）与 `rules` 段（`buildRules` 同时读 `selectedTools` 与 `toolGuidelines`：`system-prompt.ts:95-113`）。**因此注册/注销工具会同时改两段。**
- **随磁盘文件变化**：`project_context`（AGENTS.md 内容）、`addendum`（APPEND_SYSTEM.md 内容）、`skills`（SKILL.md 的 name/description/location）。
- **规则的确定性**：`buildRules` 先用 `seen` Set 去重（`:87-93`），再按 `selectedTools` 顺序遍历 `toolGuidelines`（`:111-113`），最后追加两条固定规则（`:115-116` — `addRule("Be concise in your responses");` / `addRule("Show file paths clearly when working with files");`）。**同一工具集下逐字节确定。**

### 1.3 AGENTS.md 的发现规则（`custom/` 与项目/agentDir）

发现函数：`resource-loader.ts:232` — `export function loadProjectContextFiles(options: { cwd: string; agentDir: string; }): Array<{ path: string; content: string }> {`

候选文件名与优先级（**每目录只取第一个命中**）：

- `resource-loader.ts:185` — `const candidates = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];`

发现顺序（两段拼接，`agentDir` 在前）：

1. **agentDir（全局）**：`resource-loader.ts:242-246` — `const globalContext = loadContextFileFromDir(resolvedAgentDir);` / `if (globalContext) { contextFiles.push(globalContext); ... }`
2. **cwd 及其全部祖先目录**：`resource-loader.ts:253-265` — 从 `cwd` 逐级 `dirname` 向上到根，**收集后 `unshift` 反转**（`:258` — `ancestorContextFiles.unshift(contextFile);`），因此最终顺序为 **根 → … → cwd**（离 cwd 越近越靠后）。
3. 去重：`seenPaths` Set（`:240`、`:257`、`:259`）。

两个特殊规则：

- **worktree 影子抑制**：`resource-loader.ts:214` — `function findShadowedContextFile(cwd: string): string | undefined {`；主仓库的 AGENTS.md 若被嵌套 worktree 的同名文件遮蔽，则**不加载**（`:255-256`）。
- **禁用开关**：`coding-agent/src/cli/args.ts:322` — `--no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading`

**注入格式**（不是原文平铺，而是 XML 包裹、带绝对路径）：

- `system-prompt.ts:72-79` — `return [ "Project-specific instructions and guidelines:", ...contextFiles.map(({ path, content }) => \`<project_instructions path="${path}">\n${content}\n</project_instructions>\`), ].join("\n\n");`

**运行时实际值**：my-pi 的 `PI_CODING_AGENT_DIR=portable/agent`（`my-pi.sh:12`），加载到的两个文件是 `portable/agent/AGENTS.md`（agentDir 全局层）与 `/root/my-pi/AGENTS.md`（若存在）。会话实测 `project_context` 段只包含 1 个 `<project_instructions>`（路径 `/root/my-pi/portable/agent/AGENTS.md`）——因为 `/root/my-pi/` 顶层当时无 AGENTS.md。

> **与 DSH 相关的关键点**：pi 把 AGENTS.md **全文**注入（无大小上限检查）；DSH 对大文件是「整份忽略」。此差异已在现有对比文档 P4 记录，本次补充的是「发现顺序 = agentDir → 根 → … → cwd」这一具体规则。

### 1.4 skills 如何注入

- 条件（必须同时满足）：所选工具含 `read` 或 `bash`，且 `skills.length > 0`。`system-prompt.ts:165-169` — `const skillFileReadTool = (["read", "bash"] as const).find((tool) => selectedTools.includes(tool));` / `if (skillFileReadTool && skills.length > 0) {`
- 渲染：`system-prompt.ts:167` — `const skillsPrompt = formatSkillsForPrompt(skills, skillFileReadTool).trim();`
- 格式（每个技能 4 行 XML，含 `name`/`description`/`location`**绝对路径**）：`skills.ts:372-378` — `for (const skill of visibleSkills) { lines.push("  <skill>"); lines.push(\`    <name>${escapeXml(skill.name)}</name>\`); ... lines.push(\`    <location>${escapeXml(skill.filePath)}</location>\`);`
- 只注入**元数据**，不注入 SKILL.md 正文；正文由模型按需 `read`。
- 可被技能自身屏蔽：`skills.ts:356` — `const visibleSkills = skills.filter((s) => !s.disableModelInvocation);`
- 工具不可用时**整段消失**：若 `selectedTools` 既无 `read` 也无 `bash`，`skills` 段根本不会生成（`:166`）。

**运行时实际值**：`portable/agent/settings.json` 显式启用 4 个技能（`"skills": ["+skills/pi-translate-zh/SKILL.md", ...]`），`skills` 段实测 **1,894 字符 / 548 token**（10 个会话完全一致）。

### 1.5 工具声明如何生成：顺序是否稳定、数量随什么变

**两套东西必须分开**：

1. **提示词里的 `<tools>` 段**（文本清单，`- name: snippet`）：`system-prompt.ts:148-151` —
   - `const visibleTools = selectedTools.filter((name) => !!toolSnippets[name]);`
   - `const tools = visibleTools.length > 0 ? visibleTools.map((name) => \`- ${name}: ${toolSnippets[name]}\`).join("\n") : "(none)";`
   - **只列出有 `promptSnippet` 的工具**；没有 snippet 的工具对模型完全不可见（尽管可执行）。
2. **真正发给 provider 的 `tools` 数组**（JSON Schema）：来自 `agent.state.tools`，每请求只做浅拷贝 `tools: this.agent.state.tools.slice()`（`coding-agent/src/core/agent-session.ts:757`、`:882`）。

**数组生成与顺序**：

- `agent-session.ts:1501-1505` — `private _applyToolLoadout(toolNames: string[]): AgentTool[] {` / `const tools = [...new Set(toolNames)].flatMap((name) => {` → **保序去重**，顺序 = 传入 `toolNames` 顺序。
- 注册表构造顺序 = **内置工具在前，扩展工具按注册顺序在后**：`agent-session.ts:3478-3481` — `const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));` / `for (const tool of wrappedExtensionTools as AgentTool[]) { toolRegistry.set(tool.name, tool); }`
- 追加式激活（新注册的扩展工具追加到活跃列表尾部）：`agent-session.ts:3500-3502` — `for (const toolName of this._toolRegistry.keys()) { if (!previousActivatedOnRegistration.has(toolName) && this._isActivatedOnRegistration(toolName)) { nextActiveToolNames.push(toolName);`
- 回读顺序：`agent-session.ts:1440-1441` — `getActiveToolNames(): string[] { return this.agent.state.tools.map((t) => t.name); }`

**结论**：同一 loadout 下**顺序稳定**（`[...new Set()]` 保序 + Map 插入序 + 追加式激活）；顺序只在 (a) `setActiveToolsByName`、(b) `prepareLoadout` 隐藏声明、(c) 扩展工具注册集合变化 时改变。**这三点都在 tool-loadout 变化时发生，不在每请求发生。**

**数量随什么变**：

- 默认启用集：`settings-manager.ts:212` — `export const DEFAULT_TOOL_NAMES: readonly string[] = ["read", "bash", "edit", "write"];`（**仅 4 个**）
- 覆盖来源优先级（`settings-manager.ts:231-245` — `resolveDefaultTools`）：`defaultTools` 设置项里的**纯名字列表整体替换默认集**，随后按顺序应用 `+name`/`-name` 修饰符。
- `--tools` CLI 限制：`agent-session.ts:3488-3493`（`allowedToolNames` 分支——凡被命名的工具即使默认不活跃也会被激活）。
- 扩展注册的工具：默认**在注册时自动激活**（`_isActivatedOnRegistration`，`:3497`、`:3501`）。

**运行时实际值**（会话 jsonl 实测，重要）：

| 会话 | `<tools>` 段工具数 | 工具清单 |
|---|---|---|
| 09-23 ~ 09-30（8 个会话） | **8** | read, bash, powershell, edit, write, grep, find, ls |
| 10-01 | **10** | 上述 8 + codemode, tool_search |

即 `tools` 段只有 133–179 token，而**实际 tools 数组远大于此**——09-30 会话的中途 system 段差分里一次性出现 **68 个**工具的 `toolsAdded`（含 browser_* 17 个、admin_* 8 个、voice_* 3 个、tmux_* 6 个等）。**`<tools>` 段是"精选清单"，不是工具全集**，两者不可互相估算。

### 1.6 my-pi 的补丁与自定义层往 system prompt 里加了什么

**上游补丁**：`patches/*.patch` 对 vendor 的全部改动文件清单（`grep '^+++ ' patches/*.patch`）：

```
package.json
packages/README.md
packages/ai/scripts/check-model-data.ts
packages/coding-agent/src/config.ts
packages/coding-agent/src/core/secrets.ts
packages/coding-agent/src/modes/interactive/components/footer.ts
packages/coding-agent/tsconfig.build.json
packages/tui/src/components/editor.ts
packages/tui/src/tui-main-screen.ts
```

→ **没有任何补丁触及 `system-prompt.ts`、`agent-session.ts`、`runner.ts` 或任何 LLM 请求路径**。补丁 001–009 全部是 branding / footer / TUI 滚动 / 模型数据校验。**结论：system prompt 文本本身是 100% 上游逻辑，my-pi 只通过扩展钩子改它。**

**自定义层注入 system prompt 的唯一一处**：`custom/features/context/index.ts:422` — ``systemPrompt: `${e.systemPrompt}\n\n${EFFICIENCY_ADVICE}`,``

- 常量：`custom/features/context/logic.ts:94` — `export const EFFICIENCY_ADVICE = '效率建议：使用更具体的工具调用可以提高响应速度。';`（**25 字 ≈ 13 token**）
- 生效机制：返回值被赋值给 `forceSystemPrompt`（`coding-agent/src/core/extensions/runner.ts:1446` — `currentOptions.forceSystemPrompt = result.systemPrompt;`），该文本在**每个请求**被投影成**唯一一条 head system 消息**，transcript 内其余 system 消息被丢弃：
  - `coding-agent/src/core/agent-session.ts:1712-1721` — `const forced = this._runSystemPromptOptions?.forceSystemPrompt;` … `return [head, ...transformed.filter((message) => message.role !== "system")];`
- `forceSystemPrompt` 为 undefined 时该投影直接返回原值：`:1713` — `if (forced === undefined) return transformed;`

**由此产生的两个非直觉后果**（本次审计新增，现有文档未覆盖）：

1. **forced prompt 在一次 run 内被冻结**。`_installAgentNextTurnRefresh` 用 `this._runSystemPromptOptions ?? this._baseSystemPromptOptions` 作为下一轮的 base（`agent-session.ts:867-868`），而 `_runSystemPromptOptions` 只在 run 结束时清空（`:1761` — `this._runSystemPromptOptions = undefined;`）。因此**同一次用户提示触发的整个工具循环里，发给 provider 的 system 文本逐字节不变**——这是**对前缀缓存有利**的性质。代价：run 中途因工具集变化生成的 system 段差分消息（`:2020-2022`、`:884-886`）会被投影丢弃，**模型在本次 run 内看不到 `<tools>`/`<rules>` 段更新**，只有 tools 数组（走的另一条路）实时更新。
2. **扩展触发的 run 与用户提示 run 的 system 头部不同**。`before_agent_start` 只在 `prompt()` 路径派发（唯一派发点 `agent-session.ts:1977`），而扩展 `sendMessage({triggerTurn:true})` 走 `_runAgentPrompt(appMessage)`（`:2231` — `this._deferredSettledActions.push(async () => await this._runAgentPrompt(appMessage));` / `:2236` 附近的 `await this._runAgentPrompt(appMessage);`）。这类 run **不设 `forceSystemPrompt`**，其请求头部是 transcript 段构建的 prompt（**不含 `EFFICIENCY_ADVICE`**）。触发者：tmux 完成通知、`/plan resume`、压缩后自动继续、voice 唤醒、autopilot 重启提示（见 §3）。

### 1.7 各段 token 规模（估算，标明口径）

**口径**：使用项目自身的估算函数（与 my-pi 全局一致）：

- `custom/features/context/budget/budget.ts:193-199` —
  ```ts
  export function estimateTokens(text: string): number {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const digits = (text.match(/[0-9]/g) || []).length;
    const astral = (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length;
    const other = text.length - cjk - digits - astral * 2;
    return Math.ceil(cjk / 2 + digits / 3.5 + astral + other / 4);
  }
  ```
  即 **CJK 2 字符/token、ASCII 4 字符/token、数字 3.5 字符/token**。这是估算，非 provider 真值。

**逐段实测（10 个真实会话，取 min/max）**：

| 段 | min token | max token | 说明 |
|---|---|---|---|
| `preamble` | 43 | 43 | 169 字符常量 |
| `tools` | 133 | 179 | 8→10 个工具 |
| `rules` | 198 | 257 | 与 tools 联动 |
| `docs` | 288 | 295 | 4 条路径 |
| `addendum` | 137 | 137 | `portable/agent/APPEND_SYSTEM.md`（326 字符，220 CJK） |
| `project_context` | **1,687** | **2,085** | `portable/agent/AGENTS.md`（5,623→6,752 字符） |
| `skills` | 548 | 548 | 4 个技能元数据（1,894 字符） |
| `cwd` | 6 | 6 | 24 字符 |
| **合计** | **3,040** | **3,550** | 最新会话（10-01）= 3,550 |

**关键比例**：system prompt 全文 **≈ 3.0–3.6 K token**，而实测 `contextTokens` p50 = **132.6 K**（第 4 节）→ **system prompt 只占稳态上下文的约 2.3–2.7%**。历史消息（thinking + toolResult 为主）才是主体。

**首个请求的上下文规模**（= system + tools 数组 + 首条用户消息，来自 `.usage-diag.jsonl` 每个会话首行）：

| 会话起始 | contextTokens |
|---|---|
| 09-25 11:59 | 10,584 |
| 09-26 11:35 | 11,525 |
| 09-27 10:06 | 16,711 |
| 09-30 11:05 | 15,823 |
| 10-01 04:35 | **23,239** |

→ 扣除 system prompt（3.0–3.6 K）与首条用户消息，**工具 schema 数组约 6–19 K token**（10-01 会话因注册工具更多而接近 19 K）。**这是 system prompt 的 2–5 倍。**

---

## 2. agent 循环（pi 侧）

### 2.1 主循环定位

真正的主循环在 `agent` 包，不是 `harness/`：

- `agent/src/agent-loop.ts:163` — `async function runLoop(`
- `agent/src/agent-loop.ts:102` — `export async function runAgentLoop(`
- `coding-agent/src/core/sdk.ts:2` — `import { Agent, type AgentMessage, setDefaultStreamFn, type ThinkingLevel } from "@earendil-works/pi-agent-core";`
- `harness/agent-harness.ts` 只在 `coding-agent/src/experimental/mini/worker/run.ts:66` 被引用 → **与 coding-agent 主路径无关**。

coding-agent 通过 5 个注入点把语义塞进循环（`agent-session.ts:474-478` 的安装顺序即包装顺序）：

```
474  this._installAgentNextTurnRefresh();
475  this._installAgentRequestProjection();
476  this._installAgentBoundaryHooks();
477  this._installHiddenDeclarationsProjection();
478  this._installAgentForcedPromptProjection();
```

### 2.2 一个 step 的精确结构

外层（agent-session）：

- `agent-session.ts:1747` — `await this.agent.prompt(messages);`
- `agent-session.ts:1748-1757` — `while (!this._agentRunAbortRequested) { if (await this._handlePostAgentRun()) { ... await this.agent.continue(); continue; } if (this._agentRunAbortRequested || !(await this._runBeforeSettleBoundary())) break; ... await this.agent.continue(); }`

内层（agent-loop，逐 iteration 的行号）：

```
176  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];
179  while (true) {
180      let hasMoreToolCalls = true;
183      while (hasMoreToolCalls || pendingMessages.length > 0) {
186          const nextTurnSnapshot = await config.prepareNextTurn?.(lastCompletedTurn);
207          await emit({ type: "turn_start" });
211          for (const message of declareToolChanges(currentContext, [...preparedMessages, ...pendingMessages])) {
214              currentContext.messages.push(message);
219          const requestUpdate = await config.prepareRequest?.(...)
242          const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFunction);
259          const toolCalls = message.content.filter((c) => c.type === "toolCall");
267-270      const executedToolBatch = message.stopReason === "length" ? await failToolCallsFromTruncatedMessage(...) : await executeToolCalls(...);
274-277      for (const result of toolResults) { currentContext.messages.push(result); newMessages.push(result); }
286          const decision = await config.finishTurn?.(lastCompletedTurn, signal);
287          await emit({ type: "turn_end", message, toolResults });
295          pendingMessages = (await config.getSteeringMessages?.()) || [];
302      const followUpMessages = (await config.getFollowUpMessages?.()) || [];
317      break;
```

顺序总结：**drain steering →（第 2 个 turn 起先 `prepareNextTurn`，其中含阈值压缩检查）→ `turn_start` → `declareToolChanges` + 追加 prepared/pending 消息 → `prepareRequest`（用 canonical projection 覆盖请求上下文）→ `transformContext` → `convertToLlm` → provider 流 → 追加 assistant → 执行工具并追加 toolResult → `finishTurn` → `turn_end` → 重新 poll steering。**

### 2.3 一次请求能产出几个工具调用 / 是否并行 / 有无上限

- **一条 assistant 消息可含任意多个 tool call**：`agent-loop.ts:259` — `const toolCalls = message.content.filter((c) => c.type === "toolCall");`
- **默认并行**：`agent/src/agent.ts:253` — `this.toolExecution = runtimeOptions.toolExecution ?? "parallel";`
- **串行条件**（二选一）：`agent-loop.ts:516-522` —
  ```ts
  const hasSequentialToolCall = toolCalls.some(
      (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
  );
  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
      return executeToolCallsSequential(...);
  }
  return executeToolCallsParallel(...);
  ```
- **并行实现 = 全批 `Promise.all`，无分块、无信号量、无上限**：`agent-loop.ts:646-648` — `const orderedFinalizedCalls = await Promise.all(` / `finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),`
  - 注意：**preflight（参数解析 / 校验 / `beforeToolCall`）是顺序的**（`:596-644` 的 for 循环），只有**执行**并行。
  - 结果消息顺序 = assistant 声明的源顺序（`:649-654`），与完成顺序无关。
- **并发上限 / batch size cap：未找到证据。**（`agent/src` 与 `coding-agent/src` 全量 grep 无 chunk/semaphore/`maxConcurrent`。）
- **没有任何内置工具声明 `executionMode: "sequential"`**（`grep -rn executionMode coding-agent/src/core/tools/` 无命中；该字段只在 `extensions/types.ts:619` 定义、在 `tool-definition-wrapper.ts:20/55` 透传）。→ **实测路径上所有工具批次都并行执行。**
- 同文件写操作由工具层自行串行化：`coding-agent/src/core/tools/file-mutation-queue.ts:32` — `export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {`（`edit.ts:163`、`write.ts:67` 调用；**不同文件仍并行**）。
- 早停规则：`agent-loop.ts:689-691` — `function shouldTerminateToolBatch(...): boolean { return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true); }`
- `stopReason === "length"` 时**整批不执行**、全部返回错误：`agent-loop.ts:267-269`；错误文案 `:492-494` — `` `Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.` ``

### 2.4 工具结果如何回灌

- role 固定 `"toolResult"`：`agent-loop.ts:922-934` — `return {` / `role: "toolResult",` / `toolCallId: finalized.toolCall.id,` / `toolName: finalized.toolCall.name,` / `content: finalized.result.content ?? [],` / `usage: finalized.result.usage,` / `isError: finalized.isError,`
- 回灌点（整批完成后统一 push）：`agent-loop.ts:274-277` — `for (const result of toolResults) {` / `currentContext.messages.push(result);` / `newMessages.push(result);`
- **本层无任何截断**：只有 `content ?? []` 归一化。真正的输出截断在 (a) 各工具内部（bash 的 `truncated`/`fullOutputPath`：`coding-agent/src/core/messages.ts:94-95`），(b) my-pi 的 `tool_result` 钩子（§3.4）。
- 传给 provider 时原样透传：`coding-agent/src/core/messages.ts:184-188` — `case "toolResult":` / `return m;`

### 2.5 终止条件

四条路径，全在 `runLoop` 内：

1. `stopReason === "error" || "aborted"` → 立即 end：`agent-loop.ts:245-255` — `if (message.stopReason === "error" || message.stopReason === "aborted") {` … `return;`
2. `finishTurn` 返回 `{action:"end"}`：`agent-loop.ts:289-292`
3. 无 tool call + 无 steering + 无 followUp + 无 explicit continuation → `break`：`agent-loop.ts:183` / `:296-298` / `:302-308` / `:317`
4. **max steps / max turns / token 预算上限：未找到证据。** 全仓 grep 无 `maxSteps`/`maxTurns`。会话唯一的"预算"是 compaction 的 `reserveTokens` 与 retry 的 `maxRetries`，**都不终止循环**。

> **与任务收敛相关的推论**：pi 没有硬性步数上限，收敛完全依赖模型的 `stopReason`（不再发 tool call）。my-pi 的自动继续门（`autoContinueGate`）与 plan-mode 的 `hasInProgressTask` 门是自定义层额外加的，见 §3。

### 2.6 重试策略（两层，语义不同）

**层 1：provider/HTTP（同请求原样重发，前缀稳定）**

- `ai/src/utils/provider-retry.ts:105-124` — `export async function retryProviderRequest<T>(` … `if (retriesRemaining <= 0 || !isProviderError(error) || !isRetryableProviderError(error)) throw error;`
- 次数：`coding-agent/src/core/sdk.ts:328` — `maxRetries: options.maxRetries ?? providerRetrySettings.maxRetries,`；`settings-manager.ts:1035` — `maxRetries: this.settings.retry?.provider?.maxRetries,` → **未配置时 `?? 0` = 默认 0 次**。
- 重发的是同一个已构造好的请求闭包，**不触碰历史**，前缀逐字节相同。

**层 2：agent turn（run 结束后重试，会裁历史）**

- 触发：`agent-session.ts:1779-1783` — `if (this._isRetryableError(message) && (await this._prepareRetry(message))) {` … `this._failedResponse = message;`
- 默认参数：`settings-manager.ts:998-1004` —
  ```ts
  getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number; maxAgentDelayMs: number } {
      return {
          enabled: this.getRetryEnabled(),
          maxRetries: this.settings.retry?.maxRetries ?? 3,
          baseDelayMs: this.settings.retry?.baseDelayMs ?? 2000,
          maxAgentDelayMs: this.settings.retry?.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS,
  ```
  `settings-manager.ts:48-50` — `maxRetries?: number; // default: 3` / `baseDelayMs?: number; // default: 2000 (exponential backoff: 2s, 4s, 8s)` / `maxAgentDelayMs?: number; // default: 60000`
  `settings-manager.ts:986` — `return this.settings.retry?.enabled ?? true;` → **默认开启**
- 退避公式：`ai/src/utils/retry.ts:122-126` — `const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);` / `return Math.min(safeDelay, policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS);`
- **对历史的影响（关键）**：`agent-session.ts:3688-3689` — `// Keep the failed attempt in raw history while durably omitting it from model projection.` / `this._omitRecoveryAttempt(message);`，其实现写一条 `context_edit(targetId, null)`（`:1206` — `const editId = this.sessionManager.appendContextEdit(targetId, null);`）。
  → 失败的 assistant 消息**从模型投影里被永久省略**（原始历史仍保留）。**下一次请求的前缀 = system + 之前成功的消息**，与失败请求的前缀**逐字节相同**（因为失败的 assistant 消息本来就没发给模型）→ **前缀缓存友好**，但历史被裁剪（若此前有 tool call，被裁的是整条失败 assistant，不带孤立 toolResult）。
- 成功清零：`agent-session.ts:1134-1140` — `if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {`
- **context overflow 不走 retry，走 compaction**：`agent-session.ts:3611-3615` — `private _isRetryableError(message: AssistantMessage): boolean {` / `if (isContextOverflow(...)) return false;`
- 摘要类调用另有 `retryAssistantCall`：`ai/src/utils/retry.ts:185-235`；压缩路径传入默认重试策略（`agent-session.ts:2653`）。
- **运行时实际值**：`portable/agent/settings.json` **未配置 `retry` 节** → 使用默认（enabled=true / 3 次 / 2 s 指数 / 上限 60 s）。provider 层 maxRetries 未配置 → **0 次**。

### 2.7 错误如何呈现

- **工具错误统一形状** `isError: true` + 单个 text 块：`agent-loop.ts:905-910` — `function createErrorToolResult(message: string): AgentToolResult<any> {` / `return {` / `content: [{ type: "text", text: message }],`
  - 覆盖场景：工具不存在（`:719` — `` `Tool ${toolCall.name} not found` ``）、参数校验/准备失败（`:769-772`）、被 hook 阻止（`:744-753` — `createErrorToolResult(beforeResult.reason || "Tool execution was blocked")`）、工具抛异常（`:845-846`）、abort（`:740` — `createErrorToolResult("Operation aborted")`）。
  - hook 可改写 `isError`：`agent-loop.ts:890` — `isError = afterResult.isError ?? isError;`；my-pi 的 `tool_result` 钩子读取它但**不改写**（只用于熔断计数，§3.4）。
- **provider 错误**：assistant 消息带 `stopReason: "error"` + `errorMessage`（`ai/src/api/anthropic-messages.ts:831-833`）或 `"aborted"`。run 级异常合成一条 assistant 失败消息并走完整事件链（`agent/src/agent.ts:532-547`）。
- **都作为普通消息持久化**（`agent-session.ts:1120` — `entryId = this.sessionManager.appendMessage(event.message);`），**没有独立错误通道**。
- `stopReason === "error"` 的 assistant 消息也**是**前缀的一部分（它被追加进 `currentContext.messages` 与 transcript），直到 retry 把投影裁掉。

### 2.8 压缩在循环中的介入点（4 处，loop 内 2 处）

(a) `prepareNextTurn`（**每次内层迭代开头、上一 turn 完成后、下一次请求前**）：

- `agent-session.ts:863-864` — `this.agent.prepareNextTurnWithContext = async (turn, signal) => {` / `const context = await this._compactBeforeNextAssistantResponse(turn.context);`
- loop 调用点：`agent-loop.ts:186` — `const nextTurnSnapshot = await config.prepareNextTurn?.(lastCompletedTurn);`
- 实现：`agent-session.ts:735-743` — `private async _compactBeforeNextAssistantResponse(context: AgentContext): Promise<AgentContext> {` / `const projection = this.sessionManager.buildSessionProjection();` / `if (!model || isVirtualModel(model) || !this._exceedsCompactionThreshold(model, projection)) {` / `await this._runAutoCompaction("threshold", false);`

(b) `prepareRequest`（**紧贴请求前**，按虚拟模型路由后的模型再验一次）：

- `agent-session.ts:797-800` — `if (this._exceedsCompactionThreshold(route.model, projection)) {` / `await this._runAutoCompaction("threshold", false);`
- loop 调用点：`agent-loop.ts:219-226`

(c) run 结束后（`agent_end` 之后）：`agent-session.ts:1799` — `if (await this._checkCompaction(message, true, toolResults)) {`（含 overflow 恢复 `:2925-2932` 与阈值分支 `:2996-2998`）

(d) 新 prompt 提交前（`prompt()` 内、`before_agent_start` 之前）：`agent-session.ts:1969-1972` — `const lastAssistant = this._findLastAssistantMessage();` / `if (lastAssistant) { await this._checkCompaction(lastAssistant, false); }`

**阈值公式**（pi 内置，不读任何 gate）：

- `coding-agent/src/core/compaction/compaction.ts:267-270` — `export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {` / `if (!settings.enabled) return false;` / `return contextTokens > contextWindow - settings.reserveTokens;`
- 默认：`compaction.ts:126-130` — `enabled: true,` / `reserveTokens: 16384,` / `keepRecentTokens: 20000`
- **运行时实际值**：`portable/agent/settings.json` 的 `compaction` 节覆盖为 `reserveTokens: 32768`、`keepRecentTokens: 20000`、`enabled: true`。窗口 1 M → 阈值 ≈ 967 K。**实测 924 个请求中最大 `contextTokens` = 341,416，从未触及** → 与现有文档一致：**pi 内置压缩在 my-pi 上从未触发**。

**压缩调用链**：`_runAutoCompaction` → `prepareCompaction` → `session_before_compact` 钩子（`:3039-3048`）→ `compact()` → `appendCompaction`（`:3092`）→ `_refreshFinalizedContext()`（`:3094`）→ `session_compact`（`:3103-3109`）→ `compaction_end`（`:3120`）。

**摘要请求不走主循环的 `onPayload`（本次核实，支撑 warm-prefix 死代码结论）**：

- `compaction.ts:605` — `const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers, env, sessionId };`（**不含 `onPayload`**）
- `compaction.ts:629-633` — `const requestOptions: SimpleStreamOptions = {` / `...options,` / `cacheRetention: "none",` / `sessionId: options.sessionId ?? uuidv7(),`
- `compaction.ts:634-637` — `const produce = async (): Promise<AssistantMessage> =>` / `streamFn` / `? (await streamFn(model, context, requestOptions)).result()` / `: completeSimple(model, context, requestOptions);`
- 而主循环的 config **含** `onPayload`：`agent/src/agent.ts:473` — `onPayload: this.onPayload,`，它接到 `sdk.ts:408` — `onPayload: transformProviderPayload,` → `runner.emitBeforeProviderRequest`。
- → **`before_provider_request` 钩子在压缩/摘要请求上永不触发**；my-pi 的 `warm-prefix` 重放分支是死代码（与现有文档 P1 一致，本次给出 `compaction.ts:606` 这一条直接证据）。

### 2.9 用户中断 / 追加指令（steering / followUp）如何进入

- 入队 API：`agent-session.ts:2160-2164`（`this.agent.steer({role:"user", content, timestamp: Date.now()})`）、`:2177`（`this.agent.followUp({...})`）。
- 流式中提交 prompt 必须指定行为：`agent-session.ts:1929-1938` — `throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.");`
- 队列语义：`agent/src/agent.ts:159-169` — `if (this.mode === "all") return this.messages.slice();` … `drain()`；模式来自 `settings.json`（**运行时 `steeringMode: "all"` / `followUpMode: "all"`**）。
- **排空点（3 处）**：
  - run 开始前：`agent-loop.ts:176`
  - 每 turn 结束后：`agent-loop.ts:295`
  - `prepareNextTurn` 之后补一次（仅前一次为空时）：`agent-loop.ts:204-206`
  - follow-up 仅在"本来要停"时取：`agent-loop.ts:302-307`
- **进入消息数组的精确位置**：下一次请求之前，与 prepared 消息一起经 `declareToolChanges` **追加到尾部**：`agent-loop.ts:211-216` — `for (const message of declareToolChanges(currentContext, [...preparedMessages, ...pendingMessages])) {` … `currentContext.messages.push(message);`
- **是否重写已发送历史**：**不重写已存在的消息，只在末尾追加**。但有一个副作用：`declareToolChanges` 可能在追加的消息**之前**插入一条 tool-delta system 消息（`agent-loop.ts:359-362` — `return [...pendingMessages.slice(0, index), update, ...pendingMessages.slice(index)];`）。该 system 消息是**追加点**，不是前缀重写。
- 中断：`agent-session.ts:2349-2358` — `this._agentRunAbortRequested = true;` / `this.agent.abort();`

### 2.10 Hook 时序（一次循环迭代内的精确顺序）

**每个 run 的全局顺序**：

1. `input`（仅用户提交文本；最早）：`agent-session.ts:1908-1913`
2. → `_checkCompaction(lastAssistant, false)`（`:1969-1972`）
3. → `before_agent_start`（**每 run 一次，不是每请求**）：`agent-session.ts:1977-1981` — `const result = await this._extensionRunner.emitBeforeAgentStart(` / `expandedText,` / `currentImages,` / `this._baseSystemPromptOptions,`
4. → 构造消息数组：user（`:1997-2001`）→ `_pendingNextTurnMessages`（`:2004-2007`）→ **hook 返回的 custom 消息（追加在 user 之后，`:2009-2019`）**；随后 `_preparePromptAndLoadout` 的段差分作为**首条**消息 `unshift`（`:2020-2022` — `if (updateMessage) messages.unshift(updateMessage);`）
5. → `agent.prompt()` → `runLoop`

**每个内层迭代**（这是回答"钩子在循环里的确切时序"的核心）：

| 序 | 动作 | file:line |
|---|---|---|
| 1 | `prepareNextTurn`（= agent-session 包装：**阈值压缩检查** → 段差分 → 返回 `messages:[段差分]` + `context.tools` 新数组） | `agent-loop.ts:186`；`agent-session.ts:863-890` |
| 2 | 补 poll steering（仅上次为空） | `agent-loop.ts:204-206` |
| 3 | `turn_start` 事件/hook | `agent-loop.ts:207` |
| 4 | `declareToolChanges` 生成 tool-delta system 消息；追加 prepared+pending 消息 | `agent-loop.ts:211-216` |
| 5 | `prepareRequest`（= **canonical projection 覆盖 `messages` 与 `tools`** + 路由后再验阈值压缩） | `agent-loop.ts:219-226`；`agent-session.ts:748-802` |
| 6a | `**context**` handlers（**看不到 system 消息**；返回后 Pi 把 system 头贴回） | `agent-loop.ts:390-392` → `runner.ts:1289-1318`（`runner.ts:1296` — `const visibleMessages = currentMessages.filter((message) => message.role !== "system");`；`runner.ts:1306` — `currentMessages = restoreSystemMessages(currentMessages, visibleSnapshot, returned);`） |
| 6b | `**context_with_system**` handlers（**看得到 system，返回值原样使用**） | `runner.ts:1320-1347` |
| 6c | hidden 声明过滤（`toolsAdded/toolsRemoved`） | `agent-session.ts:1690-1703` |
| 6d | **forced system prompt 折叠成单一 head**（丢弃全部 system 消息） | `agent-session.ts:1708-1721` |
| 7 | `convertToLlm` | `agent-loop.ts:395` |
| 8 | `streamFunction`（SDK 层；含 cacheWarmer） | `agent-loop.ts:403-407` → `sdk.ts:396-407` |
| 9 | `**before_provider_request**`（payload 已构造完，可**整体替换** payload） | `sdk.ts:358-362` → `runner.ts:1352-1366` |
| 10 | `before_provider_headers`（原地 mutate） | `runner.ts:1383-1394` |
| 11 | HTTP → `after_provider_response` → `provider_stream_event` | `sdk.ts:363-385` |
| 12 | assistant `message_start` → `message_update*` → `**message_end**`（可**原地替换整条消息**） | `agent-loop.ts:420/435-439/454`；`agent-session.ts:1225-1238`（`Object.assign(targetRecord, replacement);`） |
| 13 | 每个 tool call：`tool_execution_start` → `**tool_call**` hook（可改 `event.input`、可 `{block:true}`）→ execute → `tool_execution_update` → `**tool_result**` hook（+图片归一化）→ `tool_execution_end` → toolResult `message_start/end` | `agent-loop.ts:542-547/727-736/829-837/780-786/864-876`；`agent-session.ts:627-669` |
| 14 | toolResult push 进上下文 | `agent-loop.ts:274-277` |
| 15 | `finishTurn`（先派发 `turn_end` boundary hook） | `agent-loop.ts:286` → `agent-session.ts:846-854` |
| 16 | `turn_end` 事件/hook | `agent-loop.ts:287` |
| 17 | poll steering | `agent-loop.ts:295` |

**关键判定（回答"钩子能否在每次请求改前缀"）**：能，共 4 条路径：

1. `context_with_system` —— 返回值原样使用，可删改头部（只报错不阻止）：`runner.ts:1329-1334` — `error: "Handler removed the leading system message; ..."`
2. `before_provider_request` —— 可整体替换 payload（含 `system`/`messages`/`tools`）：`runner.ts:1363-1366` — `if (handlerResult !== undefined) { currentPayload = handlerResult;`
3. `context` —— 看不到 system，且 Pi 事后贴回（`runner.ts:284-292`），**不能丢 prompt 但能改对话体**
4. `message_end` —— 在消息入 transcript 那一刻替换内容，影响之后所有请求：`agent-session.ts:1278-1291`

**my-pi 实际使用了其中的 1 与 3（`before_provider_request` 只做诊断与死代码重放；`message_end`/`context_with_system` 未注册）。**

### 2.11 循环里会改写"已发送历史 / 请求前部"的所有位置

| # | 位置 | 频率 | file:line |
|---|---|---|---|
| 1 | **每请求用 canonical session projection 覆盖请求上下文**（最重要：请求内容不来自 `agent.state.messages` 的临时改动，而来自 session entries 重算） | **每请求** | `agent-session.ts:752-757` — `const projection = this.sessionManager.buildSessionProjection();` / `messages: projection.messages,` / `tools: this.agent.state.tools.slice(),` |
| 2 | 压缩后整体替换内存 transcript | 每次压缩 | `agent-session.ts:897-902` — `this.agent.state.messages = projection.messages;` |
| 3 | 重试/溢出恢复写 `context_edit` 删除失败 assistant | 每次重试 | `agent-session.ts:1206` |
| 4 | `context` 钩子后把 system 头贴回 | **每请求** | `runner.ts:290-291` |
| 5 | **forced system prompt 每请求折叠成单一 head** | **每请求** | `agent-session.ts:1708-1721` |
| 6 | hidden 声明过滤（仅当 `_hiddenDeclarations` 非空） | 每请求 | `agent-session.ts:1690-1703` |
| 7 | `declareToolChanges` 插入/改写 system 消息 | tool-loadout 变化时 | `agent-loop.ts:333-363` |
| 8 | prompt 段差分 system 消息（首轮 `unshift`，后续追加） | 段变化时 | `agent-session.ts:1665-1670`、`:2022`、`:884-886` |
| 9 | `message_end` 原地改写消息对象 | 每条消息 | `agent-session.ts:1225-1238` |
| 10 | boundary hook 可追加 `context_edit`/`compaction` 条目 | hook 决定 | `agent-session.ts:905-943` |

**其中 4、5、6 是"每请求都跑但通常输出不变"的变换**：它们逐字节确定性，因此**不破坏前缀缓存**（除非其输入变了）。**my-pi 的 `context` 钩子（第 6a 步）在默认配置下是唯一每请求跑的自定义变换，其默认路径是纯读取（§3.3）。**

---

## 3. my-pi 自定义层的每请求副作用

### 3.1 总表：每个 LLM 请求被自定义层改变了什么

**默认配置（`portable/agent/settings.json` 未设任何 `PI_CONTEXT_*`，`my-pi.sh` 只导出 `PI_CODING_AGENT_DIR`/`PI_MEMORY_DIR`）下的真实清单**：

| # | 机制 | 触发条件 | 落点 | append-only？ | 改请求前部？ | 改工具数组？ | 稳定性 | file:line + 逐字引文 |
|---|---|---|---|---|---|---|---|---|
| 1 | **`EFFICIENCY_ADVICE` 追加** | 每次**用户提示** run 的 `before_agent_start`（无条件） | **system prompt 头部（整段替换式）** | 内容上是追加 | **是**（相对原生 pi 的 system 字节） | 否 | **逐请求稳定**（常量；仅随 pi 基础 prompt 变化） | `custom/features/context/index.ts:422` ``systemPrompt: `${e.systemPrompt}\n\n${EFFICIENCY_ADVICE}`,`` |
| 2 | **记忆注入 `my-pi-memory-injection`** | `before_agent_start`；块非空且 ≠ 上次 | **appended message（custom→user，尾部）** | **是**（旧块永不删） | 否 | 否 | only-changes-on-content-change；压缩后重置必重发一次 | `custom/features/memory/index.ts:380` `return { message: { customType: INJECT_TAG, content: block, display: false } };` |
| 3 | **易变运行时提示 `my-pi-context-advice`** | `before_agent_start`；内容非空且 ≠ 上次（首轮必发） | **appended message（尾部）** | **是**（无删除逻辑） | 否 | 否 | only-changes-on-content-change（0.75/0.9 档、重启提示） | `custom/features/context/index.ts:416` `if (volatileText && volatileText !== lastVolatileContext) {` |
| 4 | **`tool_result` 写入期裁剪/脱水/熔断** | 每次工具结果写入 | **该条新 toolResult 的内容** | n/a（只改新消息） | 否 | 否 | once-per-tool-result，**确定性**（内容+累计预算决定） | `custom/features/context/index.ts:544` `const pruned = pruneToolOutput(out, name);` |
| 5 | **compactionSummary 去重（删除旧摘要）** | `context` 钩子；序列中 `compactionSummary` ≥ 2 条 | message array（**删除**） | **否** | **是**（删除点靠前则其后全失效） | 否 | 每次压缩后变一次 | `custom/features/context/index.ts:462` `working = messages.filter(` |
| 6 | **`applyToolLayering`** | `before_agent_start`，首次 或 休眠工具活跃时 | tool array（经 pi 重建 system 的 tools 清单） | 否 | 间接 | **可能（默认对齐到"全部已注册"；`--tools` 不会被覆盖，见 §3.2(B)）** | only-changes-on-X（每会话至多一次） | `custom/features/context/budget/tool-layering.ts:32-33` `if (sameToolSet(getActiveTools(pi), target)) return;` / `setActiveTools(pi, target);` |
| 7 | **`sysOptions.selectedTools` 对齐** | `before_agent_start`，且与当前活跃集不同 | system 段（可能生成 mid-conversation system 消息） | 否（原地改事件对象） | **可能（仅不一致时一次）** | 间接 | only-changes-on-X | `custom/features/context/index.ts:362` `if (active.length > 0) sysOptions.selectedTools = active;` |
| 8 | **thinking 档位夹取** | `thinking_level_select`（模型切换被解析为 `max` 时） | **provider 请求选项 `reasoning`** | n/a | 否（不在 prompt/消息里） | 否 | only-changes-on-X，且**切档本身使整段缓存失效** | `custom/features/context/index.ts:272` `setThinkingLevel(pi, clamped);` |
| 9 | **`ctx.compact()` 触发** | `turn_end` 且过全部门 | 无（触发宿主重建 transcript）→ **下一请求消息序列整体重建** | 否 | **是（下一请求）** | 否 | 低频事件 | `custom/features/context/index.ts:596` `ctx.compact?.();` |
| 10 | 指纹记录 | `before_provider_request` 每请求 | **nothing**（本地 JSONL） | n/a | 否 | 否 | once-per-request | `custom/features/context/index.ts:124` `appendJSONLRotating(fingerprintFile, fp, 1_000_000);` |
| 11 | plan-mode 只读拦截 | `tool_call` 且计划模式开启 | **nothing**（block 工具调用） | n/a | 否 | **否（明确不改工具集）** | only-changes-on-X | `custom/features/plan-mode/index.ts:353` `return { block: true, reason: '计划模式：编辑/写入被禁用。使用 /plan exit 退出。' };` |
| 12 | subagent | 模型调用 `subagent` 工具 | **子进程 argv/env** | n/a | n/a | 子进程独立 | once-per-tool-call | `custom/features/subagent/core/runner.ts:79` `const args: string[] = ['--mode', 'json', '-p', '--no-session', '--no-extensions'];` |
| 13 | autopilot 定时器 | `session_start` 起 60 s `setInterval` | **out-of-band**（不在请求路径） | n/a | 否 | 否 | once-per-session | `custom/features/autopilot/index.ts:666` `tickTimer = setInterval(() => {` |
| 14 | autopilot 重启提示 | `session_start` 且交互式且未消费 restartLog | `sendUserMessage`（**真实 user 消息**） | 是 | 否（尾部） | 否 | once-per-restart | `custom/features/autopilot/index.ts:704` ``sendUserMessage(pi, `[系统] ${line}。历史上下文已恢复，请从中断处继续当前任务。`);`` |
| 15 | intervention | `before_agent_start`（只读） | **nothing**（写本地 JSONL） | n/a | 否 | 否 | once-per-run | `custom/features/intervention/index.ts:53` ``currentRun = { prompt: e.prompt ?? '', startedAt: Date.now(), tools: [] };`` |
| 16 | tmux 完成通知 | 后台会话结束（watcher） | appended custom 消息 + `triggerTurn:true` | 是 | 否 | 否 | once-per-completion | `custom/features/tmux/index.ts:41` `sendMessage(pi, { customType: NOTIFY_CUSTOM_TYPE, content: text, display: true }, { triggerTurn: true });` |
| 17 | voice | 唤醒词/听写完成 | `sendUserMessage`（真实 user 消息） | 是 | 否 | 否 | once-per-event | `custom/features/voice/index.ts:78` `if (r.text) sendUserMessage(pi, r.text, { expandPromptTemplates: false });` |
| 18 | mode 切档 | `/mode <name>` | thinking 即时改；人设/功能**需重启**（重启后经 `--append-system-prompt`，system 前部变） | 否 | **是（重启后）** | **是（重启后按模式过滤注册）** | only-changes-on-X | `custom/features/mode/index.ts:130` `setThinkingLevel(pi, config.thinking);` |

**默认关闭的潜在重写路径（已实现但运行时未启用）**：

| 机制 | 开关（默认值） | 若开启会怎样 | file:line |
|---|---|---|---|
| 每轮工具输出擦除 `pruneToolResults` | `PI_CONTEXT_ERASE === 'on'` → **false** | 每请求改写靠前 toolResult → 前缀断裂 | `custom/features/context/budget/task-gate.ts:92` `export const PER_TURN_ERASE = process.env.PI_CONTEXT_ERASE === 'on';` |
| 历史 thinking 擦除 `pruneThinkingBudget` | 同上 | 删除早期 thinking 块 → 前缀断裂 | `custom/features/context/index.ts:484` |
| 工具按需分层 | `PI_CONTEXT_TOOL_LAYERING === 'on'` → **false** | 裁剪工具数组 → 整段失效 | `custom/features/context/budget/task-gate.ts:75` `export const TOOL_LAYERING = process.env.PI_CONTEXT_TOOL_LAYERING === 'on';` |
| 自适应切档 `tickThinkingLevel` | `PI_CONTEXT_THINKING_AUTO === 'on'` → **false** | 切档 → 整段失效 | `custom/features/context/index.ts:737` `if (thinkingAutoEnabled) {` |
| 暖前缀重放 | 无开关，但**永不触发**（§2.8 证据） | 会替换 payload 的 messages 与 tools | `custom/features/context/budget/warm-prefix.ts:149` `messages: [` |

### 3.2 逐项补充（与上面表格不重复的细节 + 关键判定证据）

**(A) 每请求路径上实际执行的三个钩子**

`custom/features/context/index.ts` 注册的全部请求路径钩子：

```
event: 'before_agent_start'   (每次用户提示 run 一次)
event: 'context'              (每请求)
event: 'tool_call'            (每次工具调用)
event: 'tool_result'          (每个工具结果)
event: 'before_provider_request' (每请求)
event: 'input' / 'turn_start' / 'turn_end' / 'message_update' (事件流)
```

**`context` 钩子在默认配置下的净效果 = 只有 compactionSummary 去重**：`custom/features/context/index.ts:468-469` — `// 每轮擦除默认关闭（PI_CONTEXT_ERASE=on 打开）：它会每轮改写历史中靠前的消息，` / `// 使其后所有 token 失去前缀缓存（实测占单会话 67% 成本）。见 budget/task-gate.ts。` / `if (PER_TURN_ERASE) {`
→ 擦除阈值（`PRUNE_PROTECT=60K`/`PRUNE_MINIMUM=30K`/`KEEP_THINKING_TOKENS=64K`，`task-gate.ts:56-60`）**在运行时全部不生效**。这与现有对比文档 O1/O2 的"已接线/每次请求都跑"**直接矛盾**（见第五节）。

**(B) `applyToolLayering` 在默认配置下不是纯 no-op（重要，易误判）**

- 调用：`custom/features/context/index.ts:345-349` —
  ```
  if (!layeringApplied) {
      applyToolLayering(pi);
      layeringApplied = true;
  } else if (dormantToolsActive(pi)) {
  ```
- 默认分支返回**注册表里全部工具**：`custom/features/context/budget/tool-groups.ts:199` — `return layered ? computeActiveTools(allToolNames, enabledGroups) : [...allToolNames];`
- **更正（初稿曾误判为"会覆盖 `--tools` 限制"）**：`getAllToolNames` 读的是 `pi.getAllTools()`（`custom/adapters/ui-adapter.ts:136-138` — `return pi.getAllTools().map((t) => t.name);`），而该注册表**已经过 `allowedToolNames`/`excludedToolNames` 过滤**：`agent-session.ts:3429` — `.filter((tool) => isAllowedTool(tool.definition.name));`、`:3432` — `.filter(([name]) => isAllowedTool(name))`。→ **`--tools` 限制不会被 `applyToolLayering` 覆盖。**
- 但仍**不是 no-op**：默认分支会把活跃集对齐到"全部已注册工具"，因此会**激活注册表里存在但当前未活跃的工具**——典型是 `exposure: "deferred"` / `"codemode"` 的工具（`_applyToolLoadout` 只排除 `exposure === "hidden"`：`agent-session.ts:1504` — `return tool && this._getToolExposure(name) !== "hidden" ? [tool] : [];`），或此前被 `prepareLoadout` 隐藏 / 被上一轮 `setActiveTools` 收窄的工具。运行时证据：10-01 会话活跃集包含 `codemode` 与 `tool_search`（二者正是 codemode/deferred 暴露度）。
- 每次这样的对齐会触发 **一次 tools 数组变化 + 一次 system 的 `<tools>`/`<rules>` 段差分 → 一次前缀断裂**（且每个会话只发生一次，因为 `layeringApplied` 置位后走 `dormantToolsActive` 分支）。
- `sameToolSet` 是**顺序无关**比较：`tool-layering.ts:37-42` — `const sa = [...a].sort();` / `const sb = [...b].sort();` → **仅顺序变化不会触发** `setActiveTools`；顺序对齐改由 §3.1 第 7 项（`sysOptions.selectedTools = active`）承担。
- 运行时证据：`portable/agent/settings.json` 无 `defaultTools` → 默认集 4 个；但会话实测 `<tools>` 段有 8–10 个工具。**这是扩展注册自动激活（`_isActivatedOnRegistration`）+ `applyToolLayering` 对齐的合并结果。**

**(C) 记忆注入的位置与 append-only 语义**

- 位置：`before_agent_start` 返回的 `message` → 宿主作为 `role:'custom'` 消息**追加在 user 消息之后**（`coding-agent/src/core/agent-session.ts:2009-2019`），`convertToLlm` 把 custom 映射为 **user 角色**（`coding-agent/src/core/messages.ts:162-166`），并**持久化进 transcript**（`agent-session.ts:1108`）。
- append-only 的明确声明（2026-09-29 修复）：`custom/features/memory/index.ts:384-388` —
  ```
  // ── 历史注入消息：**不再**做"只保留最新一条"的过滤（2026-09-29）──
  // 旧实现在此调用 filterInjectedMessages(e.messages)，移除除最新一条外的全部注入，
  // 造成消息序列在旧注入位置发生位移 → 该点之后的前缀缓存整段失效（实测单次 150K–320K
  // token 全价重算，占全部未命中的 39%）。现改为 append-only：所有注入留在历史中，
  // 模型以最新一块为准。旧注入随压缩折叠，不会无限增长。
  ```
- 去抖是**字符串全等**（非 hash）：`custom/features/memory/recall/inject.ts:151-152` — `export function shouldInjectMemory(block: string, lastInjectedBlock: string | null): boolean {` / `return block.length > 0 && block !== lastInjectedBlock;`
- 预算默认 500 token、条目上限 8：`inject.ts:15` — `export const DEFAULT_BUDGET_TOKENS = 500;`；`inject.ts:93` — `if (injectedEntries >= 8) break;`
- 压缩后重置：`custom/features/memory/index.ts:395` — `lastInjectedBlock = null;`
- **两条注入消息的固定顺序**：user → `my-pi-context-advice` → `my-pi-memory-injection`。依据是注册顺序决定 handler 顺序，而 `FEATURES` 里 `context` 在 `memory` 之前：`custom/bootstrap.ts:34-35` — `defineFeature('context', registerContext),` / `defineFeature('memory', registerMemory),`；宿主的 handler 按扩展注册顺序遍历并 `messages.push`（`coding-agent/src/core/agent-session.ts:2009-2019`）。**这个顺序在进程内固定，因此不产生额外的前缀抖动。**

**(D) 易变提示与记忆注入的不对称**

`lastVolatileContext` **没有任何重置点**（只在 `context/index.ts:118` 初始化、`:416-417` 更新），而 `lastInjectedBlock` 在 `session_compact` 被重置。→ **压缩后记忆会重发，但压力提示不会**（除非内容恰好变化）。

**(E) 工具的解析/层级**

`custom/features/context/budget/tool-layering.ts:29` — `export function applyToolLayering(pi: PiApi): void {`；`setActiveTools` 最终落到 `agent-session.ts:1475-1478` — `setActiveToolsByName(toolNames: string[]): void {` / `const tools = this._applyToolLoadout(toolNames);` / `this._rebuildSystemPrompt(tools.map((tool) => tool.name));` → **会重建 system prompt 的 `tools`/`rules` 段**（一次段差分 + 一次 tools 数组变化 = 一次前缀断裂）。

**(F) subagent 的上下文继承面**

`custom/features/subagent/core/runner.ts:79` — `const args: string[] = ['--mode', 'json', '-p', '--no-session', '--no-extensions'];` → **不共享会话、不加载自定义扩展（等于 spawn，空上下文）**；仅当 agent 定义了 `systemPrompt` 时才通过临时文件 + `--append-system-prompt` 传入（`:108-117`）。子代理**不继承父历史，因此不复用父 KV 缓存**——与 DSH 的 fork 模式形成对比（现有文档 P2 已记，本次确认代码事实）。

**(G) autopilot watchdog 不在请求路径**

`custom/features/autopilot/index.ts:666` — `tickTimer = setInterval(() => {`（60 s，`unref`）；watchdog 的双信号判定（`run/watchdog.ts` 的 `lastActivity` + 会话文件 mtime）只**写重启请求**，不修改任何请求（`custom/features/autopilot/run/watchdog.ts:88-127`）。唯一进上下文的是重启后的一条 `sendUserMessage`（`index.ts:704`）。

**(H) plan-mode 的拦截点**

`custom/features/plan-mode/index.ts:118-119` — `// 只读保护在 tool_call 阶段拦截（见下方「只读强制」hook），不再改工具集：` / `// 变更 selectedTools 会让整段前缀缓存失效（实测 ~140k 全量重放/次）。` → 这是**代码里显式的前缀缓存权衡记录**，与 DSH 的"工具数组稳定"取向一致。

### 3.3 一句话回答

**默认配置下，每个 LLM 请求被自定义层改变的部分只有三处**：

1. **请求头部 system 文本始终等于 `<pi 渲染的完整分段 prompt>` + 常量 `EFFICIENCY_ADVICE`**（`context/index.ts:422`，**仅用户提示 run**；扩展触发的 run 不含该常量）；
2. **尾部按"内容变化"追加两条 custom（映射为 user 角色）消息**：`my-pi-context-advice`（`context/index.ts:418`）与 `my-pi-memory-injection`（`memory/index.ts:380`），**append-only**；
3. **对刚写入的工具结果做确定性截断/脱水/熔断改写**（`context/index.ts:544`，只改新消息）。

另外两个非每请求但会改请求的：`context` 钩子在 ≥2 条 `compactionSummary` 时**删除**旧摘要（`context/index.ts:462`，唯一默认开启的"删历史"）；thinking 档位变化改 provider 的推理选项（`context/index.ts:272`）。

**有没有"每请求改写已发送历史"的动作？** 没有。第 2、3 项只动新写入的内容；第 1 项是逐字节稳定的头部重放；`context` 的删除只在压缩后发生一次。**这是 my-pi 相对 DSH 最大的差异面（DSH 有 `in-history` 路由 + 摘要前缀重放），也是本次审计最重要的结论：my-pi 的默认配置已经不在请求路径上做"逐请求历史重写"了。**

---

## 4. 实测形状（真实运行数据）

### 4.1 逐请求用量分布（`.usage-diag.jsonl`，924 条真实记录）

**口径**：排除前 18 行合成夹具（§0）；`ts` 为 `turn_end` 时刻；`input` = 未命中 input token，`cacheRead` = 命中读取 token，`contextTokens` = 该请求的上下文总规模。**只报数字与口径，不做成本换算。**

| 指标 | p50 | p90 | p99 | mean | max | sum |
|---|---|---|---|---|---|---|
| `input`（未命中） | 374 | 2,770 | 203,636 | 6,951 | **316,053** | **6,422,415** |
| `cacheRead`（命中） | 120,768 | 258,150 | 336,325 | 132,567 | 340,352 | **122,491,808** |
| `output` | 610 | 2,081 | 5,587 | 918 | 9,860 | 848,163 |
| `reasoning`（含在 output 口径外，单列） | 358 | 1,507 | 4,095 | 625 | 9,540 | 577,791 |
| `contextTokens` | **132,622** | 260,515 | 336,667 | 144,428 | **341,416** | — |

**时间跨度**：2026-09-24T22:52:46Z → 2026-10-01T04:39:35Z（约 6.2 天）。

**命中率** `cacheRead/(cacheRead+input)`（n=886，另有 38 条 `input+cacheRead == 0`）：

| p05 | p10 | p50 | mean |
|---|---|---|---|
| 0.1481 | 0.9398 | **0.9968** | 0.9310 |

**按 cacheRead 占比分桶**（n=886）：

| cacheRead 占比 | 请求数 | 占比 |
|---|---|---|
| < 10%（几乎整段未命中） | 37 | **4.2%** |
| 10–80% | 26 | 2.9% |
| 80–95% | 36 | 4.1% |
| 95–99% | 126 | 14.2% |
| **> 99%** | **661** | **74.6%** |
| `input+cacheRead==0` | 38 | （单列，不计入） |

**未命中的集中度**（这是最关键的分布事实）：

| 阈值 | 请求数 | 占比 | `input` 合计 | 占全部未命中 |
|---|---|---|---|---|
| `input > 1,000` | 216 | 23.4% | 6,176,391 | **96.2%** |
| `input > 5,000` | 76 | 8.2% | 5,912,826 | 92.1% |
| `input > 10,000` | **60** | **6.5%** | 5,798,937 | **90.3%** |
| `input > 50,000` | 30 | 3.2% | 5,159,483 | 80.3% |
| `input > 100,000` | 24 | 2.6% | 4,725,969 | **73.6%** |

→ **6.5% 的请求吃掉了 90% 的未命中 token；2.6% 的请求吃掉 74%。** 优化目标高度集中。

**Top 8 单请求未命中**：

| 时刻 | input | cacheRead | contextTokens |
|---|---|---|---|
| 09-24 23:39:35 | 316,053 | 2,048 | 319,184 |
| 09-24 23:30:49 | 296,616 | 2,048 | 300,306 |
| 09-26 12:52:10 | 253,095 | 896 | 254,433 |
| 09-26 12:52:20 | 245,898 | 8,960 | 254,995 |
| 09-26 12:41:41 | 236,853 | 9,984 | 247,876 |
| 09-26 12:41:51 | 221,742 | 25,088 | 248,251 |
| 09-26 12:42:11 | 220,236 | 27,392 | 248,482 |
| 09-26 12:42:21 | 216,704 | 30,592 | 248,173 |

### 4.2 前端（前缀）变更次数与原因分类（`prefix-fingerprints.jsonl`，763 条）

**指纹口径**（`custom/features/context/budget/prefix-fingerprint.ts:80-100`）：

- `system` = `sha(systemTextOf(payload))`（`:87`）
- `tools` = `sha(JSON.stringify(payload.tools))`（`:88`）
- `head` = 前 **6** 条消息的 `role:customType:JSON(content)` 拼接哈希（`:23` — `export const FINGERPRINT_HEAD_MESSAGES = 6;`；`:89`）
- `total` = `sha([system, tools, sha(全部消息 key)].join('|'))`（`:90`）
- `level` = thinking 档位（`:109`）——`level` 入指纹是为固化"DeepSeek 缓存键含 `reasoning_effort`"（`:37` — `/** thinking 档位（DeepSeek 的缓存键包含 reasoning_effort，切档使整段前缀失效） */`）
- 变更类别：`system` / `tools` / `head` / `messages`（条数变）/ `level` / 兜底 `total`（`:93-100`）

**基本统计**：

| 项 | 值 |
|---|---|
| 指纹条数 | 763 |
| 不同 `system` 指纹 | **12** |
| 不同 `tools` 指纹 | **18** |
| 不同 `head` 指纹 | **32** |
| 不同 `total` 指纹 | **732**（= 几乎每请求都不同，因为消息在增长） |
| `sinceLastMs` p50 / p90 / p99 / max | 8,263 ms / 86,292 ms / 267,545 ms / 896,064 ms |

**`changed[]` 分布**（763 条）：

| changed | 条数 | 占比 | 含义 |
|---|---|---|---|
| `['messages']` | **688** | 90.2% | 只有消息条数变（正常追加，**前缀未断**） |
| `[]` | 51 | 6.7% | 完全相同 |
| `['head','messages']` | 10 | 1.3% | 前 6 条消息内容变 |
| `['system','head','messages']` | 9 | 1.2% | system + 消息头变 |
| `['tools','messages']` | 5 | 0.7% | 工具数组变 |

**前缀断裂事件（`system`/`tools`/`head` 任一变化）= 42 次**，分类：

| 分类 | 次数 |
|---|---|
| 会话启动（`messageCount ≤ 4`） | 13 |
| 重启 / 新会话（`messageCount` 下降） | 9 |
| **会话中途（真正的稳态断裂）** | **20** |

**20 次会话中途断裂的原因分类**：

| 类别 | 次数 | 说明 |
|---|---|---|
| `['tools']` | 8 | 工具数组变化（enable_tool / 扩展注册 / 工具分层） |
| `['system','head']` | 9 | system 段变化（AGENTS.md 内容变、`<tools>`/`<rules>`/`<docs>` 段差分） |
| `['system','tools','head']` | 2 | 两者同时变 |
| `['head']` | 1 | 仅前 6 条消息内容变 |

**这 20 次断裂后首个请求的 `input` 合计 = 1,882,133 token，占全部未命中（6,422,415）的 29.3%。**

另有口径：**被指纹标注"有前缀变化"的请求共 24 条（占 924 的 2.6%），其 `input` 合计 1,527,402（占全部未命中的 23.8%）。**

### 4.3 指纹无法解释的那部分未命中（重要局限）

**指纹的两个盲区**：

1. `head` 只覆盖**前 6 条消息**（`prefix-fingerprint.ts:23`）。会话前 6 条之后的中段改写**不被 `head` 捕获**。
2. `total` 兜底**实际上很少生效**：`prefix-fingerprint.ts:100` — `if (changed.length === 0 && prev.total !== total) changed.push('total');` —— 只有当**其它分段全部未变且消息条数也没变**（即 `changed` 为空）时才补记 `total`。而正常运行中消息条数几乎总在变（`messages` 必然入列），所以**中段内容被改写 + 条数变化**这种组合会只记为 `['messages']`，看起来"前缀没变"。运行时证据：**`total` 从未出现在任何一条记录的 `changed` 里**（763 条中 0 条）。

**实证后果**：`input > 10,000` 的 **60** 条请求中，**只有 15 条**被指纹标注了前缀变化；剩余 **37 条（`input` 合计 3,203,383，占全部未命中的 50%）指纹无法归因**。这 37 条里：

- `sinceLastMs` p50 = 12,478 ms、p90 = 116,989 ms、max = 328,054 ms；**> 60 s 的只占 15%，> 180 s 的占 10%**。

**"空闲导致 provider 端缓存过期"假说并不被数据支持**（这正是现有文档"空闲 >约 3 分钟必失效"需要更正的地方）：按空闲时长对**无前缀变化**的请求分桶（`input > 10K` 视为大段未命中）：

| 空闲 `sinceLastMs` | 请求数 | 大未命中数 | 大未命中率 | `input` 合计 | p50 `input` |
|---|---|---|---|---|---|
| < 10 s | 416 | 7 | 1.7% | 1,145,371 | 416 |
| 10–30 s | 169 | 9 | 5.3% | 1,586,800 | 390 |
| 30–60 s | 40 | 1 | 2.5% | 217,782 | 280 |
| 60–180 s | 69 | 1 | 1.4% | 67,649 | 224 |
| > 180 s | 25 | 2 | 8.0% | 64,421 | 250 |

→ **大未命中率不随空闲单调上升**；最大的未命中量落在 **10–30 s** 桶（1.59 M）。单会话反例（10-01 会话，4 个请求）：

```
10-01 04:35:33 input= 23093 cacheRead=     0 ctx= 23239   ← 会话首请求（必未命中）
10-01 04:36:15 input=    68 cacheRead= 23040 ctx= 23633
10-01 04:38:01 input= 23960 cacheRead=    64 ctx= 24187   ← 空闲 106s，前缀指纹无变化，仍全量未命中
10-01 04:39:35 input=    57 cacheRead= 24160 ctx= 24822
```

**结论（口径声明）**：现有文档第六节"未命中（整段缓存失效）是最大单项（64%）"这一**方向成立**（本次实测 90.3% 的未命中集中在 60 条请求上），但"与空闲 >3 分钟必失效的实测模式一致"这一**归因不成立**——本次口径下 90% 的大未命中发生在空闲 ≤ 60 s 的请求上，且 50% 的未命中根本无法用可观测的前缀变化或空闲解释。**归因缺口需要一个覆盖全消息序列的分段指纹（而不是只覆盖前 6 条）才能闭合。**

### 4.4 前端变更的会话级证据（transcript 侧，交叉验证 §4.2）

从 10 个会话 jsonl 抽取的 **mid-conversation system 段差分消息**（`role:'system'`、`content:''`、`sections` 为该次变更的段）：

| 会话 | system 消息数 | 中途被改的段（次数） |
|---|---|---|
| 09-23 | 1 | — |
| 09-24 | 4 | `project_context` ×2 |
| 09-26 | 5 | `project_context` ×1 |
| 09-27 10:06 | 1 | — |
| 09-27 10:14 | 2 | （仅工具声明变化，无段变化） |
| 09-27 10:42 | 4 | `tools` ×2、`rules` ×2 |
| 09-28 | 1 | — |
| 09-29 | 1 | — |
| 09-30 | 3 | `tools` ×1、`rules` ×1、`docs` ×1 |
| 10-01 | 1 | — |

并伴随 `toolsAdded`/`toolsRemoved` 的工具增量声明，例如 09-30 会话一次 `toolsAdded` 列出 **68 个工具**（`toolsRemoved` 同样 68 个——这是 `declareToolChanges` 在 loadout 重排时把整个集合先删后加的表现，`agent-loop.ts:333-363`）。

→ **transcript 侧确认：中途 system 段变化的主因是 (a) `project_context`（agentDir 的 AGENTS.md 被编辑）、(b) `tools`/`rules`/`docs`（工具集变化）。这与 §4.2 的 `['system','head']` 9 次 + `['system','tools','head']` 2 次吻合。**

---

## 5. 与现有文档矛盾之处（以代码为准）

| # | `CONTEXT-MANAGEMENT-COMPARISON.md` 的说法 | 代码事实 | 判定 |
|---|---|---|---|
| 1 | 第 13–14 行：`pruneThinkingBudget` **已接线（保留 64K）**；`pruneToolResults` 阈值降至 60K/30K、**每次请求都跑** | `task-gate.ts:92` — `export const PER_TURN_ERASE = process.env.PI_CONTEXT_ERASE === 'on';`（默认 false）；`context/index.ts:468-469` 的注释明说是**为了成本而默认关闭**（实测占单会话 67% 成本）。`PRUNE_PROTECT`/`PRUNE_MINIMUM`/`KEEP_THINKING_TOKENS` 三个常量在运行时**全部不生效** | **文档已过期（代码为准）**。第 41–52 行的 O1/O2 以及第 91–99 行的"优化后"表格据此作废——**擦除层当前是关闭的** |
| 2 | 第 17 行：`system prompt 变动` 一栏的「my-pi（本轮优化前）」写"每轮重写 system prompt" | pi 的机制是 **in-history 段差分**：`agent-session.ts:1665-1670` 生成 `{role:'system', content:'', sections: patch}`，首轮 `unshift`（`:2022`）、后续轮追加（`:884-886`）。**不是每轮重写头部**；且 my-pi 的 `before_agent_start` 使头部在**一次 run 内逐字节冻结**（§1.6 后果 1） | **描述错误（代码为准）** |
| 3 | 第 64–67 行 O4：压力分档「0.7/0.85/0.95 改为相对压缩阈值」 | **注入用的档位是 0.75 / 0.9**（`context/index.ts:384`/`:387`）；0.7/0.85/0.95 只用于 `pressure` **报告值**与 thinking 升档审批（`budget/budget.ts:33-35`、`:142-144`） | **文档把两套阈值混为一谈** |
| 4 | 第 108–118 行 P1：压缩摘要的暖前缀重放**是死代码**（"挂在 `before_provider_request` 上，压缩路径不经过 `Agent` 的 `onPayload`"） | **确认**，并补一条直接证据：`compaction.ts:605` — `const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers, env, sessionId };`（**无 `onPayload`**）；主循环则显式带 `onPayload`（`agent/src/agent.ts:473` — `onPayload: this.onPayload,`） | **文档正确，本次补强证据** |
| 5 | 第 141–142 行 P4：`my-pi 基线实测仅 ~10.4K token`（指 AGENTS.md） | 本次实测 `project_context` 段（= agentDir 的 AGENTS.md 全文 + XML 包装）**1,687–2,085 token**；首个请求总上下文 10.5–23.2 K | **口径不同（文档可能把"首个请求总上下文"当成了 AGENTS.md）**，需澄清 |
| 6 | 第 179–180 行：`空闲 >约 3 分钟必失效` | §4.3 实测：无前缀变化的大未命中中，`>180 s` 只占 10%，而 `10–30 s` 桶贡献的未命中量最大（1.59 M） | **归因不成立（数据为准）** |
| 7 | 第 12 行：自动压缩阈值 256K「门3 默认关闭 → **会触发**」 | **代码确认** `IDLE_MS` 默认 0 = 门关闭（`task-gate.ts:45-50`）；但**实测 924 条记录中自动压缩事件 0 次**（§0：所有 `auto-compact` 记录都在 18 行夹具内），且最大 `contextTokens` = 341,416 > 256K | **代码正确，但运行时从未触发**——需解释（候选原因：`turn_end` 的 `resolveContext` 取的是 `ctx.getContextUsage()`，与 `.usage-diag` 的 `contextTokens` 口径可能不同；本次未找到直接证据，标为**未找到证据**） |

**另外发现的文档/注释不一致（非对比文档，属 my-pi 自身）**：

- `budget/budget.ts:101` 把 `setCompactThreshold` 标为 `@deprecated ... 仅保留 API 兼容`，但它是**压力分母的唯一来源**（`budget.ts:138` — `const pressureBase = s.compactThreshold && s.compactThreshold > 0 ? s.compactThreshold : base;`；`:160` — `budgetBase: pressureBase,`）。注释与实现矛盾。
- `budget/README.md:32` 写「重启提示阈值 100K」，代码是 **180K**（`task-gate.ts:30`）。
- `budget/budget.ts:87-88` 的 `HIGH_PRESSURE_HINT`/`CRITICAL_PRESSURE_HINT`、`:167` 的 `getTokenPressureTag()`、`:180` 的 `getUrgencyHint()` **全仓无调用点**（死代码，不进请求）。
- `memory/recall/inject.ts:122` 的 `filterInjectedMessages` **无调用点**（保留供测试与离线分析，文件头注释已说明）。

---

## 6. 未找到证据清单

1. **主循环的 max steps / max turns / step 预算上限**：`未找到证据`（`agent/src`、`coding-agent/src` 内均无 `maxSteps`/`maxTurns` 类阈值）。
2. **多 tool call 批次的并发上限 / batch size cap / 分块 / 信号量**：`未找到证据`（`agent-loop.ts:646-648` 是一次性 `Promise.all`）。
3. **agent loop 层的 tool result 截断逻辑**：`未找到证据`（只有 `content ?? []` 归一化；截断在各工具内部与 `messages.ts` 的渲染里）。
4. **自动压缩在运行时从未触发的原因**：`未找到证据`（阈值 256K、实测最大 341K，但事件记录为 0，且事件记录文件同时被夹具污染，无法从该文件判定）。
5. **10-01 会话 04:38:01 那次 106 s 空闲后 23,960 token 全量未命中的根因**：`未找到证据`（指纹无变化、无压缩事件、无 retry 事件记录）。
6. **`provider` 端缓存 TTL / 过期策略**：`未找到证据`（两边代码都不含缓存 TTL 逻辑）。
7. **`context_with_system` / `message_end` 钩子在 my-pi 中的注册**：`未找到证据`（全仓 grep `custom/` 无这两个事件名）→ **确认未使用**。
8. **`<tools>` 段与实际 tools 数组的 token 精确拆分**：只能由"首请求 `contextTokens` − system 段 − 用户消息"差分估算（**未被直接测量**，因 transcript 不记录请求体）。

---

## 附：本次审计的两个副产物（可复用）

1. **`/tmp/loop-findings.md`**（398 行）：pi 主循环逐条证据（10 问 + hook 时序全表 + 附加判定），路径相对 `vendor/pi/packages/`。
2. **`/tmp/custom-findings.md`**（608 行）：my-pi 自定义层逐请求副作用逐项证据（机制详述 + 未进入请求路径清单 + 文档不一致点）。
