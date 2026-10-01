# DSH 运行时实现审计（补充与更新）

审计对象：`/root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/`（打包后的 JS，241 个包）。
既有文档：`/root/my-pi/docs/development/DSH-CONTEXT-AUDIT.md`（下称「旧文档」）。本文只做**补充与更新**；凡与旧文档冲突，以代码/运行时实测为准并显式标注。

**证据分级（每条断言都带其一）：**

- `[CODE]` 打包 JS 源码（`文件:行号` + 原文引用）。
- `[YAML]` 部署组合文件（base/web/profile/preset）。
- `[RUNTIME]` **实测运行时值**：解压本机真实会话日志
  `/root/.dsh/sessions/--root-my-pi--/<session>/session.v3.jsonl.zstd`（`zstdcat` + JSON 逐行解析）。
  主力样本 = 父会话 `session-45e03659-9fe1-4338-a3be-e7f3f9749721`：**42 turns / 2166 steps / 2162 assistant messages / 2506 tool results / 12 113 事件 / 37.2 MB 明文日志**。
- `[EST]` 估算（标注口径）。DSH 自身的固定密度估算常量为 4 chars/token：`[CODE]` `dsh-token-meter/lib/index.js:16` — `const CHARS_PER_TOKEN = 4;`。

**代码默认值 vs 运行时实际值**：本文分开标注。本机生效组合 = `dsh-base/cordis.patch.yml`（host 面）+ `dsh-web-app/cordis.patch.yml`（web 面）+ `dsh-agent-presets/presets/standard/agent.cordis.yml`（agent 面，`agentPreset: "standard"`，`[RUNTIME]` 会话首行 `{"type":"session",...,"agentPreset":"standard"}`）。

---

## 0. 包版本

**全部 231 个 `@deepseek-ai/dsh-*` 包版本一致 = `0.1.5-rc.2`**（逐包读 `package.json` 统计：231 × `0.1.5-rc.2`）。
非 DSH 自有的同作用域依赖：`cordis@4.0.2`、`cordis-plugin-group@1.0.2`、`cordis-plugin-hmr@1.0.17`、`cordis-plugin-include@1.0.7`、`cordis-plugin-loader@1.0.3`、`cordis-plugin-timer@1.1.4`、`cosmokit@1.8.3`、`schemastery@3.18.2`、`node-addon-system@0.1.2`、`node-addon-system-linux-arm64@0.1.2`。
本次重点包的版本：`dsh-system-prompt` / `dsh-persona` / `dsh-agent` / `dsh-agent-loop` / `dsh-agent-instructions` / `dsh-agent-presets` / `dsh-agent-tool-presentation` / `dsh-tools` / `dsh-skill` / `dsh-skill-filesystem` / `dsh-tool-skill` / `dsh-session` / `dsh-llm-retry` / `dsh-sandbox-policy` / `dsh-user-approval` = **全部 `0.1.5-rc.2`**。

---

# 第一部分：系统提示词构造

## 1.1 装配机制（谁拼、怎么拼）

系统提示词**不是**写死的大模板，而是**注册表 + 每条目一个 section**，由 `dsh-system-prompt` 服务在**每个 step** 重新装配。

- `[CODE]` `dsh-system-prompt/lib/index.js:111-113` —
  `return assembly.sections.map((section) => interpolate(section, assembly.variables, "section")).filter((text) => text.length > 0).join("\n\n");`
  ⇒ 空 section 被丢弃，段间固定以**两个换行**连接。
- `[CODE]` `dsh-system-prompt/lib/index.js:308` — `async assemble(context = {}) {`；`:331` —
  `const sectionDefinitions = [...sectionByName.values()].sort(comparePromptSections);`
- `[CODE]` `dsh-system-prompt/lib/index.js:96-98` — `return a.order - b.order || compareNames(a.name, b.name);`
  ⇒ 排序键 = `order` 升序，同 order 再按**名称码点序**（与 locale 无关）。
- `[CODE]` `dsh-system-prompt/lib/index.js:151-175` 是 `{{variable}}` 插值器：未知/未定义变量**抛错**，`:165-170` — `if (!Object.hasOwn(variables, name)) { ... throw new Error(`unknown prompt variable "{{${name}}}" ...`); }`。本部署实际用到 `{{model}}`、`{{cwd}}`。
- `[CODE]` `dsh-system-prompt/lib/index.js:351` — 装配后仍会跑一次 waterfall：
  `const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));` ⇒ 存在**插件改写最终提示词**的扩展点（本部署未发现使用；`grep -rn "system-prompt/assemble"` 除注册表自身外无订阅者）。

## 1.2 分段清单、顺序与规模（`[RUNTIME]` 实测 + `[CODE]` 来源）

实测：整个会话只有 **1 条 `system/message`**，正文 **6 829 字符**，按 `\n\n` 切分得 **21 段**，与 `SECTION_ORDERS` 表逐项对齐。`[RUNTIME]` 会话 seq 7；字符数为该段实测长度；token 列为 `[EST]` `ceil(chars/4)`。

| # | section name | order | 来源（注册点） | 实测 chars | ≈token | 静态/动态 |
|---|---|---|---|---|---|---|
| 1 | `harness:identity` | -1000 | `dsh-system-prompt/lib/index.js:213-217` | 48 | 12 | 静态常量 |
| 2 | `deployment:persona-prefix` | 0 | `dsh-persona/lib/index.js:36-41` + preset `:28` | 59 | 15 | 静态（插值 model） |
| 3 | `context:file-reference` | 900 | `dsh-file-reference-local/lib/index.js:342-346` | 343 | 86 | 动态（按 `read` 是否存在） |
| 4 | `tool:bash` | 1000 | `dsh-tool-bash/lib/index.js:254-258` | 92 | 23 | 静态常量 |
| 5 | `tool:read` | 1100 | `dsh-tool-fs/lib/index.js:326-330` | 156 | 39 | 动态（工具可见性） |
| 6 | `tool:write` | 1200 | `dsh-tool-fs/lib/index.js:591-595` | 220 | 55 | 动态（可见性 + edit 是否存在） |
| 7 | `tool:edit` | 1300 | `dsh-tool-fs/lib/index.js:736-740` | 388 | 97 | 动态（可见性） |
| 8 | `tool:glob` | 1400 | `dsh-tool-fs-search/lib/index.js:775-779` | 390 | 98 | 动态（可见性 + `sampleOverCapGlobResults`） |
| 9 | `tool:grep` | 1500 | `dsh-tool-fs-search/lib/index.js:1084-1088` | 129 | 33 | 动态（可见性） |
| 10 | `tool:jobs` | 1600 | `dsh-tool-jobs/lib/index.js:201-205` | 382 | 96 | 静态常量 |
| 11 | `tool:web_search` | 2000 | `dsh-tool-web/lib/index.js:256-260` | 427 | 107 | 动态（可见性 + `maxQueries` + fetch 是否存在） |
| 12 | `tool:web_fetch` | 2100 | `dsh-tool-web/lib/index.js:731-735` | 282 | 71 | 动态（可见性） |
| 13 | `tool:goal` | 2400 | `dsh-tool-goal/lib/index.js:259-263` | 734 | 184 | 动态（`blockedAfterConsecutiveRounds`） |
| 14 | `tool:workflow` | 2600 | `dsh-tool-workflow/lib/index.js:138-142` | 325 | 82 | 动态（toolName） |
| 15 | `tool:ralph` | 2700 | `dsh-tool-ralph/lib/index.js:295-299` | 434 | 109 | 静态常量 |
| 16 | `tool:subagent` | 2800 | `dsh-tool-subagent/lib/index.js:576-580` | 358 | 90 | 动态（provider 已注册 + 工具可见） |
| 17 | `tool:subagent_fork` | 2800 | 同上（同 order，按名字排序在后） | 363 | 91 | 同上 |
| 18 | `ui:deliverable-file-references` | 9000 | `dsh-client-ui-deliverables/lib/index.js:132-137` | 299 | 75 | 静态常量 |
| 19 | `harness:source` | 10000 | `dsh-app-boot/lib/index.js:1567-1573` | 331 | 83 | 每次装配求值，值恒定（checkout 路径） |
| 20 | `app:web-surface` | 10100 | `dsh-web-app/lib/index.js:180-184`，正文 `:91-93` | 991 | 248 | 每次装配求值（本机 web URL） |
| 21 | `deployment:persona-suffix` | 10200 | `dsh-persona/lib/index.js:42-46` + `dsh-web-app/cordis.patch.yml:18` | 38 | 10 | 静态（插值 cwd） |
| | **合计** | | | **6 829** | **≈1 707** | |

**关键结论 1：系统提示词本体只有约 1.7K token，而工具声明 JSON 有 27 285 字节 ≈ 6 8xx token（见 1.6）。指令重心在工具声明，不在系统提示词。**

`SECTION_ORDERS` 中**从未被任何插件注册**的槽位（仅存在于表内）：`PLAN_POLICY`(500，本会话未进 plan mode)、`TEAM_POLICY`(600)、`PTC_ONLY`(800)、`TOOL_PWSH`(1010，Windows 专属)、`TOOL_PTY`(1700)、`TOOL_LSP`(2200)、`TOOL_SESSION_QUERY`(2300)、`TOOL_REPORT`(2900)、`TOOLS_SDK`(5000)、`STRUCTURED_OUTPUT`(9900，仅子代理用到)。证据：`[CODE]` `dsh-system-prompt/lib/index.js:10-42` 是完整表；全仓 `grep -rn "TEAM_POLICY"` 仅命中该表自身 ⇒ **未找到**任何注册点。

## 1.3 每段的稳定性（对前缀缓存的意义）

- **进程内完全静态（绝大多数）**：1、4、10、15、18 为字面常量；2、21 只插值 `model`/`cwd`。
- **每次装配求值但值恒定**：19（checkout 路径）、20（web URL）。`[CODE]` `dsh-web-app/lib/index.js:183` — `text: () => webSurfacePrompt(localWebUrl(promptCtx))`；`localWebUrl` 由 `webServer.port` 决定（`:95-99`）⇒ **换端口/重启到不同端口会改变系统提示词**。
- **随工具可见性变化**：3、5–9、11–12、14、16–17。工具集不变则文案不变；`dsh-tools` 的 `restrict()` 或 preset 变化会同时改变提示词与工具目录。
- `[RUNTIME]` **跨 4 个会话逐字节相同**：父会话 + 3 个子代理会话，`sha1(system prompt) = 7c92c8ecbcb3`（长度同为 6 829），`sha1(tools JSON) = ddb537ebe49a`（27 个工具）。⇒ **spawn 型子代理与父代理共享完全相同的请求前缀（除历史外）**。
- `[RUNTIME]` 工具目录在整个会话（6 次 `request/header`，跨 2166 steps）**哈希恒定**；6 条 header 的 `reason` 分别为 `initial` 与 5 次 `resume`：`[CODE]` `dsh-agent-loop/lib/index.js:1176-1180` — `reason: baseline === void 0 ? "initial" : "resume"`。

## 1.4 指令文件（AGENTS.md / CLAUDE.md）的角色与位置

旧文档 §11 已覆盖发现/预算/去重，此处只**补充运行时证据与更新**：

- **角色与位置（复述一句，便于对照）**：`[CODE]` `dsh-agent-instructions/lib/index.js:111-112` 以 `<system-reminder>` 包裹，且是 **`user/message`**，不是 system section；位置在「新认领用户消息之后」（旧文档 `:1270-1288`）。
- `[RUNTIME]` **本会话实际注入 23 次，合计 159 312 字符 ≈ 39 828 token**（`source.kind === "agent-instructions"`）。绝大多数是**同一文件的重复重投**，文案形如：
  - seq 539 — `"<system-reminder>\nAdditional instructions from: portable/agent/AGENTS.md\n\nThese instructions apply to work under `portable/agent`. Use them as guidanc"`
  - seq 549 — `"<system-reminder>\nUpdated instructions from: portable/agent/AGENTS.md\n\nThis file changed after it was loaded. Use the following content instead of the previous content."`
  - 同一路径 `portable/agent/AGENTS.md` 被重投 **14 次**（含连续 4 次：seq 10508/10516/10524/10532，间隔 2–4 秒）。
- **影响**：均为 **append-only**，不破坏已发送前缀，但会让上下文线性膨胀；且「Updated … instead of the previous content」使**同一文件的多个版本同时留在窗口里**（旧版本仍在历史中）。旧文档只说「append-only 且 cache-friendly」，**未量化其体积成本**，这是本次的更新点。

## 1.5 skills 如何进入提示词

- `[CODE]` **技能目录不进系统提示词**。`dsh-skill` 全包无 `systemPrompt` 引用（grep 零匹配 ⇒ 对「是否渲染进系统提示词」**未找到证据**，实为否定）。
- `[CODE]` 目录作为**带 `skill-catalog` source 的 `user/message`** 在 `agent/pre-step` 推送：`dsh-tool-skill/lib/index.js:239` — `return createUserMessage({`；`:256` — `kind: "skill-catalog",`；正文含 `<available_skills>`，并明确「This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.」（`:250`）。
- `[CODE]` 正文**按需**加载：调用 `skill` 工具才返回完整 SKILL.md（去 frontmatter），`dsh-tool-skill/lib/index.js:155` — `content: skill.content`；来源 `dsh-skill-filesystem/lib/index.js:702` — `content: parsed.body.trim()`；渲染成 `<skill_content>`（`dsh-skill/lib/index.js:60`）。
- `[CODE]` 摘要截断上限：`dsh-tool-skill/lib/index.js:40` — `const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500;`（代码默认，部署未覆盖）。
- `[RUNTIME]` 本部署**没有**出现 `skill-catalog` 消息（父会话 user/message 的 `source.kind` 分布：`user` 42、`plugin` 19、`agent-message` 12、`subagent-settled` 11、`agent-instructions` 23）——因为 `/root/my-pi/.dsh/skills`、`/root/my-pi/.agents/skills`、`~/.dsh/skills`、`~/.agents/skills` **均不存在**，且 `DSH_BUNDLED_SKILL_DIR` 未设置。⇒ 技能路径在本部署**实际为休眠状态**。

## 1.6 工具声明（tool declarations）的规模与排序

- `[RUNTIME]` **27 个工具**，整个 `tools` 数组 JSON = **27 285 字节**（含数组括号 27 313）；`description` 合计 **13 531 字符**，`parameters` JSON 合计 **12 371 字符**。
- `[EST]` 按 4 chars/token：工具声明 ≈ 6 8xx token，是系统提示词（≈1 707 token）的 **4 倍**。
- `[RUNTIME]` 第一个请求实测 `inputTokens=7354, cacheReadTokens=896`（合计 8 250 token），与「系统提示词 + 工具声明」的估算量吻合 ⇒ 交叉验证成立。
- **排序**：`[CODE]` `dsh-system-prompt/lib/index.js:348` — `tools: orderTools(collected, this.toolOrder, knownNames),`；未配置 `toolOrder` 时 `:84` — `if (toolOrder === void 0) return tools.sort(compareToolNames);`，比较器 `:100-102` 为**名称码点升序**。`[YAML]` 全仓与 profile 均未设置 `toolOrder`（grep 零匹配）⇒ 实测 27 个工具名恰为字典序：`ask_user_question, bash, create_goal, edit, exit_plan_mode, get_goal, glob, grep, interrupt_agent, job_kill, job_list, job_output, list_agents, present, ralph, read, read_image, send_message, skill, subagent, subagent_fork, todo_write, update_goal, web_fetch, web_search, workflow, write`。
- **单工具描述体积（`[RUNTIME]`，字符/UTF-8 字节）**：`workflow` 2500/2526（声明 `dsh-tool-workflow/lib/index.js:145` — `description: DESCRIPTION,`）、`bash` 1836/1852（`dsh-tool-bash/lib/index.js:261` — `description: bashDescription(backgroundEnabled, escalationModes),`）、`list_agents` 1094/1100、`subagent_fork` 854/858、`subagent` 827/831、`todo_write` 805/809、`read_image` 545。

## 1.7 工具很多时是否有裁剪 / 延迟暴露

- `[CODE]` **`native` 模式下完全没有按数量/预算的裁剪，也没有延迟暴露。** `dsh-tools/lib/index.js:2730` — `schemas: [...view.visible.values()].map((definition) => this.schemaOf(definition, false)),`。
- `[CODE]` 全文检索 `maxTools` / `toolBudget` / `toolLimit` / `deferTools` / `lazyTools` / `SCHEMA_BUDGET`：**未找到证据**（零匹配）。
- `[CODE]` 唯一会折叠目录的是 **`ptc` 模式**：只留 `run_code` 一个 schema，其余改由生成的 SDK 提示词承载 —
  `dsh-tools/lib/index.js:2736` — `schemas: schemas.filter((schema) => schema.name === RUN_CODE_NAME),`；折叠文案 `:2421` — ``const PTC_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. ...`;``
- `[CODE]` 唯一的「隐藏」是**显式** `tools.restrict()`（按名 allow/deny），不是自动裁剪：`dsh-tools/lib/index.js:2792`。
- `[YAML]` 部署实际：`native`。`dsh-web-app/cordis.patch.yml:38` — `mode: !!js process.env.DSH_TOOLS_MODE`（未设置 → schema 默认 `native`，`dsh-tools/lib/index.js:2574` — `]).default("native"),`）；standard preset 不含 presentation 行。**27 个工具因此全量常驻**。
- `[YAML]` plan mode 明确**不改**工具目录：`dsh-agent-presets/presets/standard/agent.cordis.yml:119` — `The tool catalog stays the same across modes for request-cache stability. ... those tools remain listed to keep the tool catalog unchanged.`

## 1.8 与旧文档的差异（第一部分）

| 旧文档说法 | 本次结论 |
|---|---|
| §Q4/§13 把「系统提示词 = 历史节点 0」讲清了，但未给出分段清单与规模 | **补充**：21 段、6 829 字符、≈1 707 token，顺序由 `SECTION_ORDERS` 固定（本文 §1.2） |
| §11「指令基线 append-only、cache-friendly」 | **补充/量化**：本会话重投 23 次 / 159 312 字符 / ≈39 828 token，同一文件多版本共存于历史（§1.4） |
| 未提及 skills 的注入位置 | **新增**：目录走 `skill-catalog` user message；正文按需；本部署休眠（§1.5） |
| 未给出工具声明规模 | **新增**：27 工具 / 27 285 B / 13 531 字符描述（§1.6） |
| 未提及是否存在工具裁剪 | **新增**：`native` 下无任何裁剪；只有 `ptc` 折叠（§1.7） |

---

# 第二部分：agent 循环

## 2.1 一步（step）的精确结构

`[CODE]` `dsh-agent-loop/lib/index.js:919` — `async turn() {`，`:1008` — `async step(decision) {`。展开为：

1. **turn 边界**：`:926` — `this.session.append("turn/start", { turn });`
2. **pre-step（每步一次）**：`:937` — `const decision = await this.preStep(target, { turn, step });`
   - `:889` 认领 inbox（`this.inbox.claim(target, position.turn)`）
   - `:890` **重新装配系统提示词与工具**：`const assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal));`
   - `:893` 投影运行时上下文快照（仅当文本变化才产生新消息）
   - `:894` 跑 `agent/pre-step` waterfall（压缩、指令、重复提醒、goal、plan-mode 都挂在这里）
3. **step/start**：`:951` — `this.session.append("step/start", { turn, step });`
4. **请求准备**：`:1127` `prepareRequest` → `agent/request` waterfall → `llm.prepareCall()`（拿到 `contextWindow` 与 `systemPromptUpdate` 能力）。
5. **系统提示词投影**：`:1019-1027`，必要时 append 或 replace（见 §2.8）。
6. **首尝试才提交用户消息**：`:1028` — `if (firstAttempt) for (const message of decision.messages) this.session.append("user/message", message, { surfaceOp: "append" });` ⇒ **重试不会重复注入用户消息**。
7. **构建请求**：`:1030` → `:1166 buildRequest`：`canonicalHeader({config, adapterDefaults, tools})` → 记录 `request/header`（`initial`/`resume`/`change`/`series` 四种 reason）→ 记录 `request/context`（仅当 provider/model/contextWindow/systemPromptUpdate 变化）→ `:1204` `const boundaryMessages = session.deriveMessages();` → `:1205-1212` **deepFreeze 每条消息** → 返回 `{...config, messages, tools, sessionId, signal}`。**请求里没有 `system` 字段**。
8. **流式**：`:1036-1043` `this.loopCtx.llm.stream(request)` → `live.push(chunk)`；每个 chunk 先**持久化**再对外 emit（README `:119`）。
9. **落 assistant/message**：`:1108-1114`（含 `usage`）。
10. **执行工具调用**：`:1116-1118`。

## 2.2 一次请求能产出几个工具调用 / 是否并行

- **数量**：一次 assistant 消息可以带任意多个 `tool-call` block，全部在**同一个 step** 内执行。`[CODE]` `dsh-agent-loop/lib/index.js:1116-1118` —
  `const toolCalls = message.content.filter((block) => block.type === "tool-call"); ... await executeToolCalls(this.loopCtx, turn, step, toolCalls, signal, ...)`
- **并行**：按工具自身的并发分类切成「独占屏障」或「有界滚动池」。
  - `[CODE]` `dsh-agent-loop/lib/index.js:529-530` —
    `const mode = ctx.tools.executionMode(first.exec).kind;` / `const outcome = await runGroup(ctx, turn, step, mode === "parallel" ? planned.slice(next) : [first], mode, signal, acceptContext);`
  - `[CODE]` `:625-627` 池上限与重分类 —
    `while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) { const nextCall = group[nextToStart]; if (nextToStart > 0 && mode === "parallel" && ctx.tools.executionMode(nextCall.exec).kind !== "parallel") break;`
  - `[CODE]` `:1226` — `const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10;`（`:1465` schema 默认同值；部署未覆盖）。
  - `[CODE]` **默认独占**：`dsh-tools/lib/index.js:2953` — `if (!tool?.isConcurrencySafe) return { kind: "exclusive" };`
  - `[CODE]` **只有 5 个工具声明并发安全**：`read`（`dsh-tool-fs/lib/index.js:414`）、`read_image`（`:1064`）、`web_search`（`dsh-tool-web/lib/index.js:306`）、`web_fetch`（`:802`）、`subagent`/`subagent_fork`（`dsh-tool-subagent/lib/index.js:489`）。**`bash`、`glob`、`grep`、`edit`、`write`、`todo_write`、`present`、`job_*`、`skill`、`ask_user_question` 全部是独占**。
- **结果顺序确定性**：`[CODE]` `:571-582` `commitReady()` 严格按「模型顺序」提交（`while (committed < group.length) { const slot = slots[committed]; if (slot === void 0) break; ... }`）——并发执行、**串行落盘**，保证同一 step 的历史顺序恒等于模型输出顺序。
- `[RUNTIME]` **实际批处理极低**：2162 条 assistant 消息中，工具调用数分布 = `{0: 39, 1: 1775, 2: 333, 3: 3, 4: 11, 5: 1}` ⇒ **82.1% 的步骤只发 1 个工具调用**，平均 1.16 个。系统提示词里没有任何「请并行/批量调用」的强制引导（只有 subagent 段 `:578` 一句「Start independent delegations together in one assistant message」）。

## 2.3 工具结果如何回灌

- `[CODE]` 每个结果作为独立事件追加并**引用 call 的 seq**：`:697-712` —
  `session.append("tool/result", { turn, step, message, ...result.error?.info ? { error: result.error.info } : {}, ... }, { surfaceOp: "append", sourceEventSeqs: [callSeq] });`
- `[CODE]` 工具可以附带 `additionalContexts`，进入 **next-step inbox**（不是历史重写）：`:578` — `for (const context of result.additionalContexts ?? []) acceptContext(context);`；接线在 `:1118` 的 `(context) => this.inbox.splice("next-step", this.inbox.nextStep.length, 0, [context])`。`dsh-repeat-tool-reminder` 正是靠这条通道注入提醒（`dsh-repeat-tool-reminder/lib/index.js:1500-1508`）。
- `[CODE]` `isError` 结果同样进历史（模型能看到失败），`:698-702`。

## 2.4 循环终止条件

- **无工具调用 ⇒ 本 step 完成**：`[CODE]` `:1117` — `if (toolCalls.length === 0) return { kind: "completed" };`
- **工具可主动结束 turn**：`[CODE]` `:579` — `concluded ||= result.concludesTurn === true;`，`:1119` — `return concluded ? { kind: "completed" } : null;`。生产组合里用它的只有子代理的结构化输出工具：`dsh-subagent-in-process-driver/lib/index.js:75` — `exec.concludeTurn();`。
- **输出被 max tokens 截断 ⇒ 不结束，继续下一步**（自动续写）：`[CODE]` `:1115` — `if (finish.kind === "max-tokens") return { kind: "max-tokens" };` + `:958` — `if (turnEnds === null || turnEnds.kind !== "max-tokens") turnEnds = stepEnd;`（即 `max-tokens` 不写入 `turnEnds`，循环继续）。
- **turn 结束条件**：`[CODE]` `:973` — `if (turnEnds && this.inbox.nextStep.length === 0) break;` ⇒ **只要 next-step inbox 里还有东西（steering / 工具附加上下文 / 目标轮次），turn 就继续**。
- **turn 前会跑 `agent/turn-stopping` 串行钩子**：`:966-972` — `await this.dispatch.serial("agent/turn-stopping", { turn, signal });`。`[CODE]` 该钩子的设计意图：「a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox」（`dsh-tool-cordis/lib/index.js:5076`）。
  `[RUNTIME]`/`[YAML]` **本部署无订阅者**：只有 `dsh-hooks-codex`(`lib/index.js:272`)、`dsh-hooks-claude-code`(`lib/index.js:292`) 订阅，而二者**不在** base/web/preset 任一 mount 列表中 ⇒ **实际不存在钩子级的「强制验证/强制总结」**。
- **没有内建 turn 上限**：`[CODE]` `dsh-agent-loop/README.md:200` — `**No built-in turn budget** — tool calls or steering continue the current turn; a policy that bounds runaway turns must cancel from an existing lifecycle extension point such as \`agent/turn-stopping\`.` `[RUNTIME]` 单 turn 最多 **192 step**（见 §3.1）。
- `[RUNTIME]` turn 结束原因分布：`completed` 38、`error` 3（均为 `TRANSPORT`，重试耗尽）。

## 2.5 重试 / 错误如何呈现给模型

- **模型请求级重试**走 `agent/request-error` waterfall：`[CODE]` `:1088-1098` —
  `const action = await this.dispatch.waterfall("agent/request-error", { turn, step, provider, failure: finish.failure, retryPolicy: preparedCall?.retryPolicy, signal }, () => Promise.resolve(void 0)); ... if (action?.kind !== "retry") throw new LlmError(...); continue;`
  ⇒ 重试是 `continue`，**回到同一个 while 循环重新 prepareRequest + 重新投影系统提示词 + 重新 deriveMessages**，但**不重复用户消息**（`firstAttempt` 已 false）。请求字节前缀不变 ⇒ 重试**复用 KV cache**（`[CODE]` README `:188` — `Append-only; each synthetic result follows the reusable request prefix and does not invalidate existing KV-cache entries.`）。
- `[RUNTIME]` 重试策略实际值（`policyKey`）：`["normal",5,["EMPTY_RESPONSE","RATE_LIMIT","SERVER","TIMEOUT","TRANSPORT"],500,10000,0.1]` ⇒ 模式 normal、**最多 5 次**、退避 500 ms→10 000 ms、抖动 0.1。实测退避序列 481 / 927 / 2177 / 4170 ms。
- `[RUNTIME]` 全会话 **54 次 `llm/retry` + 54 次 `llm/retry-started`**（2166 steps ⇒ ≈2.5% 的步骤至少重试一次），失败原因几乎全是 `"DeepSeek API request to https://api.deepseek.com failed"`；**3 个 turn 在重试耗尽后以 `{"kind":"error","error":{"code":"TRANSPORT"}}` 结束**。
- **错误呈现给模型的路径**：工具错误 → `isError` 的 `tool/result`（模型可见）；**模型请求错误不在历史里留下任何模型可见文本**（只留 `assistant/attempt` 与 `turn/end.reason.error`）⇒ 用户必须重新发话，模型不会自动看到「上一轮我失败了」。
- **中断的收尾**：`[CODE]` `:1049-1064`（把已交付前缀落成 `interrupted: true` 的 assistant/message）与 `:669-685`（未派发的调用补 `"Error: tool call aborted before dispatch"` 的合成结果，`code: TOOL_ABORTED_BEFORE_DISPATCH`）。

## 2.6 是否有「必须验证 / 必须总结」的强制环节

- 主循环**没有**。唯一强制的结构化总结出现在**子代理**（`provider: spawn` 且带 schema）：`[CODE]` `dsh-subagent-in-process-driver/lib/index.js:27` —
  `When you have your final answer, you MUST report it by calling the \`structured_output\` tool with arguments matching its parameter schema exactly. Do not finish with a plain text answer: only the tool call counts as your result.`
  配套：`exec.concludeTurn()`（`:75`）+ 递归调用守卫 `dsh-subagent-in-process-driver/lib/index.js:85` — `childCtx.tools.guard((exec) => captured === void 0 && pending === void 0 ? void 0 : \`structured output already recorded: the run is complete, so \\\`${exec.name}\\\` is not executed\`);`
- **目标（goal）轮次**提供「必须继续 + 先取证再收尾」的强制语义：`[CODE]` `dsh-goal-round-driver/lib/index.js:15` —
  `...Make concrete progress and verify the result. Before claiming completion, gather evidence that the whole objective is achieved, read the current goal, and mark it complete. If work remains, leave the goal active for the next round.`（以 `<goal_round>` 包裹，`：14-16`）
- **反循环机制**：`dsh-repeat-tool-reminder` 在同一 `[name, arguments]` 连续重复到阈值时注入提醒。`[CODE]` `dsh-repeat-tool-reminder/lib/index.js:1385` —
  `const GENTLE_REMINDER = "You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.";`
  `[YAML]` 部署阈值：`dsh-base/cordis.patch.yml:419-422` — `thresholds: [3, 5, 8]` / `argumentsPreviewChars: 500`。注意它挂在 `tools/post-execute`，注释说明**被拒绝的调用也计数**（`:1470-1474` — `because denied calls also flow through this waterfall ... a model hammering a denied call is exactly the loop worth breaking`）。

## 2.7 用户中断与追加指令（steering / queue）如何进入循环

- `[CODE]` 三个入口（`dsh-agent-loop/lib/index.js:789-797`）：
  - `followup(input)` → `send(input, "next-turn", true)`（下一轮）
  - `steer(input)` → `send(input, "next-step", true)`（**本轮的下一步**，并唤醒 drive）
  - `inject(input)` → `send(input, "next-step", false)`（本轮的下一步，**不唤醒**）
- `[CODE]` 唤醒语义：`:783-787` — 若正在运行且当前 phase 已 abort，则降级为 `next-turn` 并延迟唤醒。
- `[CODE]` 取消：`:798-804` `cancel()` 清空 inbox（除非 `keepInbox`）并 abort。
- `[CODE]` 目标选择：`turn()` 内 `target` 初值 `"next-turn"`，第一步之后切到 `"next-step"`（`:932`、`:974`）⇒ 用户中途发的话在**下一个 step 边界**生效，不必等整轮结束。
- `[RUNTIME]` inbox 事件统计：`next-turn` 84 次、`next-step` 84 次（含工具附加上下文与 steering）。
- `[CODE]` **前部历史从不被 steering 改写**：steering 只 `splice` inbox，新内容作为新 `user/message` 追加。

## 2.8 循环中是否有改写已发送历史/前部的动作

**有，但是受条件门控的两处，且都在 `dsh-agent-loop` 内：**

1. **系统提示词节点的 replace（会重写 surface node 0）**
   `[CODE]` `:274-277` —
   `if (!input.inHistory || input.startsSeries || rendered.length === 0) { const updates = nodes.slice(1).filter((node) => node.text !== "").map((node) => this.replace(node.seq, "")); if (head.text !== rendered) updates.push(this.replace(head.seq, rendered)); return updates; }`
   `replace` 产生真正的面替换 op：`:289-294` — `surfaceOp: { op: "replace", startSeq: seq, endSeq: seq }`。
   `startsSeries` 的判定：`:1021` — `startsSeries: startsRequestSeries || this.requestSurfaceGeneration !== this.session.surface.replaceGeneration || this.toolsChanged(assembly.tools)`。
   ⇒ **工具目录变化、跨请求序列重启、或发生过 surface 替换（压缩/剪枝）之后的第一条请求，会把系统提示词原地重写**（node 0 重写 = 从该节点第一个 token 起缓存全失效）。本部署 `deepseek-flash` 声明 `systemPromptUpdate: "in-history"`（`[CODE]` `dsh-llm-deepseek/lib/index.js:1849` — `systemPromptUpdate: "in-history"`），所以**文案变化时走 append 分支**（`:280-283`）。
   `[RUNTIME]` 本会话**仅 1 条 system/message、无 replace 事件**，因为 6 829 字符的提示词在整个会话中恒定。
2. **运行时上下文快照的追加与失效**
   `[CODE]` `:339` — `if (this.retained?.text === snapshot) return;`（文本不变就不发）；`:327` — 当保留节点被替换事件 shadow 时清空保留态。
   `[RUNTIME]` 7 次快照：seq 9（452 字符，`workspace-write` + `ask`）→ seq 53（390 字符，`danger-full-access` + `never`，因用户执行 `/permission danger-full-access` 并由 `approval/policy` 改为 `never`）→ 之后 5 次**内容完全相同**（进程重启/会话 resume 导致投影重建；`[CODE]` `:308-320` 构造时从日志恢复 retained，若节点仍存活就不再发——但 resume 后的第一条请求仍各自 append 了一次）。后续 5 次均紧随 `request/header reason:"resume"` 出现。
3. **注意**：压缩/剪枝本身也是 surface 替换，会改变「已发送历史」的中段；这属于旧文档 §2/§3 已覆盖的范围，本节只补「循环自身触发的改写」。

## 2.9 循环的实测节奏（`[RUNTIME]`）

| 指标 | 值 |
|---|---|
| turns / steps | 42 / 2166 |
| 每 turn 步数 | 均值 **51.6**，最大 **192** |
| 一次 assistant 消息的工具调用数 | 1 占 82.1%；平均 1.16 |
| step 墙钟耗时 | p50 **4 916 ms**，p75 9 563，p90 **24 215**，p99 125 100，max 407 413；合计 7.39 h |
| 工具耗时（取每个 callId 首个结果） | p50 265 ms，p90 9 344，p99 105 894，max 404 066；`bash` 1437 次 / p50 523 ms；`edit` 541 / p50 72 ms；`read` 311 / p50 52 ms |
| 重试 | 54 次 / 2166 steps；3 个 turn 重试耗尽后失败 |
| 压缩 | 自动 1 次（turn 12）、手动 `/compact` 5 次（其中 1 次失败）、`compaction/prune` 7 次 |
| 指令重投 | 23 次 / 159 312 字符 |

---

# 第三部分：影响执行顺畅度/收敛速度的因素（量化）

> 口径提醒：`[RUNTIME]` 的墙钟时长含宿主休眠空档（相邻事件最大间隔 378 518 s，另有 79 171 / 148 523 / 244 347 s 三个跨日空档），因此只用 p50/p90 与「首次结果」配对，长尾作废。工具耗时的正确配对必须取**每个 callId 的首个 `tool/result`**：剪枝会以新时间戳重发同 callId 的 `tool/result`（`[RUNTIME]` seq 65 → 3575），错误配对会把 0.6 s 的调用算成 9 627 s。

## 3.1 单步上下文规模（`[RUNTIME]`）

每个 turn 的最大请求规模（`inputTokens + cacheReadTokens`，即真实 prompt token 数）：

- 中位数（全会话逐步）**264 018** token；p90 **614 208**；峰值 **790 512**（turn 12）；末次 **476 995**。
- 每 turn 峰值曲线：turn 1 257K → turn 11 746K → **turn 12 790 512 →（自动压缩）→ turn 13 257K** → 之后在 143K–476K 之间锯齿上行。
- 每步「新增（未命中缓存）」token 中位数仅 **255**，p95 2 032，最大 34 083 ⇒ 每步几乎只付增量。

**直接后果**：单步上下文长期在 25 万–79 万 token，模型每次都要在极大的窗口里定位信息；这是「来回多」的最大结构性成本。

## 3.2 工具粒度

- 27 个工具，粒度**粗**（一个工具一件事，无通配/批量工具；`bash` 是唯一通用逃生口）。`[RUNTIME]` 调用分布：`edit` 541、`bash` 1437、`read` 311、`write` 84，其余 ≤54。
- **并发分类严重偏串行**：只有 `read`/`read_image`/`web_search`/`web_fetch`/`subagent(_fork)` 是 parallel，其余 22 个默认 exclusive。`[CODE]` `dsh-tools/lib/index.js:2953` — `if (!tool?.isConcurrencySafe) return { kind: "exclusive" };`
- `glob`/`grep` **也是 exclusive**（未声明 `isConcurrencySafe`），所以「先 glob 再 read」这类常见组合**无法并行**。
- **`bash`/`pwsh` 没有定义级超时**：`[CODE]` `dsh-tool-call-timeout-policy/lib/index.js:123` — `const timeoutMs = ctx.tools.get(exec.name, exec.agent)?.timeoutMs;`、`:124` — `if (timeoutMs === void 0) return next();`；全仓只有 web 与 fs-search 声明了定义级 `timeoutMs`（`dsh-tool-web/lib/index.js:305`、`dsh-tool-fs-search/lib/index.js:795`）。⇒ 前台 `bash` 若不显式传 `timeoutMs`（1437 次里只有 198 次传了）**可能无限期挂着**，只能靠用户取消。

## 3.3 一次回复的工具调用批处理策略

- 机制上允许一次多调用 + 滚动池（上限 10），但**实测 82.1% 的步骤只有 1 个调用**（平均 1.16）。
- 结果是顺序 `step`：`模型 → 1 个工具 → 模型 → 1 个工具`。2166 步 / 42 轮 = 每轮 51.6 步（最大 192）——**收敛慢的主因是往返次数，不是单步耗时**。
- 系统提示词里唯一的批量引导只针对子代理（`dsh-tool-subagent/lib/index.js:578`），对其他工具没有任何「独立调用请合并到一条消息」的指令。

## 3.4 流式与 UI 节奏

- 循环侧**不批处理**：每个 chunk 立即成帧并同步 emit（`dsh-agent-loop/lib/index.js:402` — `push(chunk) {`；`:1032` — `this.dispatch.emit("agent/assistant-stream", { frame });`）。
- UI 侧合并为 **animation-frame** 档，且用双 `requestAnimationFrame` 实现（`dsh-client-ui-conversation/lib/client.js:2541-2543` — `if (publication === "animation-frame" && typeof requestAnimationFrame === "function") { if (this.frame !== void 0) return; this.frame = requestAnimationFrame(() => { this.frame = requestAnimationFrame(() => {`）⇒ 约 2–3 帧（≈33–50 ms）刷新一次；文本/推理 delta 用该档位（`dsh-client-ui-chat/lib/client.js:4597` — `return type === "usage" || type === "finish" ? "none" : "animation-frame";`）。
- **慢渲染不反向节流 loop**（未找到任何「loop 等待渲染」的证据）；被节流的是持久化写回：`[YAML]` `dsh-base/cordis.patch.yml:165-166` — `writeEveryEvents: 200` / `writeIntervalMs: 5000`。

## 3.5 超时与重试

- 重试默认值：`[CODE]` `dsh-llm/lib/index.js:232-235` — `const DEFAULT_MAX_RETRIES = 5;` / `DEFAULT_INITIAL_DELAY_MS = 500` / `DEFAULT_MAX_DELAY_MS = 1e4` / `DEFAULT_JITTER_RATIO = .1`；可重试码 `:236-241`（`EMPTY_RESPONSE`/`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`）。`[RUNTIME]` 与 `policyKey` 实测一致。
- 每次重试 = **一次额外整包请求**（`[RUNTIME]` 54 对 `llm/retry` / `llm/retry-started`），但因前缀字节不变而**复用 KV 缓存**；模型侧不可见。
- 流空闲看门狗 300 s：`[CODE]` `dsh-llm-deepseek/lib/index.js:1390` — `const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;`
- 工具级协作超时只在 web/fs-search：web search 部署实际 60 s（`[YAML]` `dsh-base/cordis.patch.yml:454` — `searchTimeoutMs: 60000`），web fetch 与新 glob/grep 30 s（代码默认）。
- `[RUNTIME]` 人工交互是最大单点延迟：`ask_user_question` 5 次，p50 **141 986 ms**、最大 404 066 ms；`job_output` 54 次 p50 33 s。

## 3.6 沙箱与权限模型（是否阻塞交互）

- 三种模式与升级方向：`[CODE]` `dsh-sandbox/lib/index.js:31-32` — `"read-only": ["workspace-write", "danger-full-access"], "workspace-write": ["danger-full-access"]`；`:42` — `const ESCALATION_TARGETS = ["workspace-write", "danger-full-access"];`。
- 拒绝的模型可见形态：`[CODE]` `dsh-sandbox/lib/index.js:65` — ``return `[sandbox: file access denied under ${mode} mode]`;``；bash 工具描述里也逐字写明该标记与「不要绕道重试」的指引（`dsh-tool-bash/lib/index.js:127`）。
- 没有可用后端时**拒绝在无约束下运行**：`[CODE]` `dsh-sandbox/lib/index.js:185` — `super(\`sandbox mode "${mode}" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. ...\`, SANDBOX_UNAVAILABLE);`。本机即此情形（`[RUNTIME]` 审批理由原文：`escalate sandbox to danger-full-access: No sandbox backend (bubblewrap/Landlock) exists on this host ...`）。
- **审批是同步阻塞的人机往返**：`[RUNTIME]` 会话仅 2 次 `approval/asked`（seq 24、38），均 `outcome: "allowed-once"`；随后用户把策略改为 `never`（`approval/policy` seq 45），此后 `[RUNTIME]` 运行时上下文改为「Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation」（`[CODE]` 文案 `dsh-user-approval/lib/index.js:39`）。
- 对执行顺畅度的影响：`ask` 策略下每次越权命令要等人（实测审批等待以分钟计）；`never` 下越权即失败且**不可重试**（模型收到的是策略文本，而非工具结果）。

## 3.7 让任务更快收敛的机制（确有实现）

| 机制 | 效果 | 证据 |
|---|---|---|
| 并行工具池（≤10） | 仅对 5 个工具生效 | `dsh-agent-loop/lib/index.js:1226`、`:625` |
| `concludesTurn` | 省掉一次「模型再开口」往返 | `dsh-agent-loop/lib/index.js:579`；`dsh-tools/lib/index.js:1303` |
| 子代理 `structured_output` 强制结构化收尾 | 只对 spawn+schema 子代理 | `dsh-subagent-in-process-driver/lib/index.js:27,75` |
| 重复调用提醒 [3,5,8] | 打断原地打转 | `dsh-repeat-tool-reminder/lib/index.js:1385`；`dsh-base/cordis.patch.yml:419-423` |
| goal 轮次自动续跑（默认上限 256） | 跨轮次推进长任务 | `dsh-goal-round-driver/lib/index.js:12-16`；`dsh-goal/lib/index.js:588` |
| max-tokens 自动续写 | 截断不结束 turn | `dsh-agent-loop/lib/index.js:1115`、`:958` |
| 自动压缩 + 结果剪枝 | 溢出后自救 | `dsh-compaction-basic/lib/index.js:820-841`；pruner `thresholdChars 8192` |
| 后台作业 + 后台子代理 | 并行推进、结果以 `user/message` 回灌 | `[RUNTIME]` 41 次 `run_in_background`；`subagent-settled` 11 次 |
| 工作区指令自动重投 | 文件被改后模型能看到新版 | `[RUNTIME]` 23 次 / 159 312 字符 |

## 3.8 让任务更慢/更容易跑偏的因素

1. **每轮 51.6 步、每步 4.9 s**：一次 turn 常常 4 分钟起步（p90 单步 24 s，含 bash）。
2. **82% 的步骤只发 1 个工具调用**，且 22/27 个工具是串行屏障。
3. **`bash` 无定义级超时**，可以无限挂起。
4. **单步上下文 25 万–79 万 token**，模型定位成本高。
5. **指令重投把陈旧内容留在窗口**：23 次共 15.9 万字符，且同一文件多版本共存（旧版本不会被移除，只能等压缩）。
6. **`/compact` 会失败**：`[RUNTIME]` seq 9934 — `{"error":"DeepSeek API stream from https://api.deepseek.com failed"}`，随后 `command/done` 文本为 `Compaction could not produce a useful summary. The conversation is unchanged; the attempt is reco...`（用户被迫立刻重发一次 `/compact`）。
7. **模型请求错误不进入对话历史**：3 个 turn 以 `{"code":"TRANSPORT"}` 结束，模型侧没有任何「上一步失败了」的可见文本，需要用户再次发话。

---

# 第四部分：与 `DSH-CONTEXT-AUDIT.md` 的矛盾 / 更新清单

1. **【矛盾·重要】「0.8 × 1e6 的窗口意味着 DSH 实际几乎从不压缩」不成立。**
   `[RUNTIME]` 本会话发生 **1 次自动压缩 + 5 次手动 `/compact`**。且自动压缩**不是**由 0.8 比例门触发，而是由 provider 400 触发：
   seq 3573 `assistant/attempt` — `"This model's maximum context length is 1048576 tokens. However, you requested 1049843 tokens (793843 in the messages, 256000 in the completion). ..."`，`code: "CONTEXT_WINDOW_EXCEEDED"`；
   `[CODE]` `dsh-compaction-basic/lib/index.js:820` — `ctx.on("agent/request-error", async ({ agent, failure, signal }, next) => {`、`:821` — `if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted) return next();`、`:841` — `return { kind: "retry" };`。
   因为 `maxTokens = 256000`（窗口的 25.6%）大于 0.8 门留下的 20% 余量，**比例门（800 000）永远晚于溢出门**。
2. **【重要】旧文档未提的运行时事实**：压缩后上下文 790 512 → 14 231 token（turn 12 一步回到解放前）；6 次压缩使前缀缓存从「改写点」起完全失效（`[RUNTIME]` 每次 `compaction/*` 后紧跟 `request/header reason:"resume"` 与重发的运行时上下文快照）。
3. **【更新】系统提示词规模**：旧文档只讲「是历史节点 0」，未给规模。实测 **21 段 / 6 829 字符 / ≈1 707 token**，且**跨父会话与 3 个子代理会话逐字节相同**（sha1 `7c92c8ecbcb3`）。
4. **【更新】工具声明是提示词主体**：27 个工具 / 27 285 B JSON / 描述 13 531 字符 ≈ 6 8xx token，是系统提示词的 4 倍；排序为**名称码点序**，`toolOrder` 部署未配置。
5. **【新增】不存在工具裁剪/延迟暴露**（`native` 模式）；只有 `ptc` 会折叠成单一 `run_code`。
6. **【更新】指令注入成本被大幅低估**：本会话 23 次重投、159 312 字符，且是「Updated … instead of the previous content」的**并存**而非替换。
7. **【新增】skills 路径**：目录走 `skill-catalog` user message、正文按需加载；本部署因无技能根目录而休眠。
8. **【新增】运行时上下文快照会重复发射**：内容不变也会在每次进程 resume 后 append 一次（`[RUNTIME]` 7 次，其中 5 次字节相同）。
9. **【补充】`tool-result-pruner` 的产物**是**新的 `tool/result` 事件（新时间戳、同 callId）**，不是原地修改；做日志分析时必须取首个结果（`[RUNTIME]` seq 65 vs 3575）。
10. **【确认】旧文档 §13「无 turn 预算」正确**，且本部署 `agent/turn-stopping` 无订阅者 ⇒ **没有钩子级的强制验证/总结**。

# 第五部分：未找到证据的项

- 任何「工具数量/预算裁剪、延迟暴露」机制（`maxTools`/`toolBudget`/`deferTools`/`lazyTools`/`SCHEMA_BUDGET` 全仓零匹配）。
- 主循环内任何「必须验证/必须总结」的强制要求（`agent/turn-stopping` 在本部署无订阅者；harness 未挂 `dsh-hooks-codex`/`dsh-hooks-claude-code`）。
- `TEAM_POLICY`(600)、`TOOL_PTY`(1700)、`TOOL_LSP`(2200)、`TOOL_SESSION_QUERY`(2300)、`TOOL_REPORT`(2900)、`TOOLS_SDK`(5000) 的任何注册点。
- `dsh-time-context` / `dsh-tmux-context` 的挂载（不在 base/web/preset 任一 mount 列表 ⇒ 本部署不注入当前时间/终端上下文）。
- 对 `system-prompt/assemble` waterfall 的订阅者（扩展点存在但本部署无人使用）。
- 技能文件的字节数上限（`dsh-skill` / `dsh-skill-filesystem` 内零匹配）。
