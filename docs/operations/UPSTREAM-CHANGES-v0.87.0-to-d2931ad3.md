# 上游升级报告：v0.87.0 → d2931ad3（v0.99.1 + 19 个未发布提交）

**范围**：`vendor/pi` 上游区间 `v0.87.0..d2931ad3d5bf6936fbdfa5dfc81fb32f875499b2`（不含本仓库 `local: 001-008` 提交）。
**规模**：**130 个提交**，744 个文件变更，`+90664 / -24881`（`git diff --shortstat v0.87.0 d2931ad3`）。
**方法学提醒（重要）**：

- 上游**没有 0.88.0–0.98.x 发布**：全仓库 CHANGELOG 在该区间内只有 `0.87.1 / 0.99.0 / 0.99.1` 三个版本段（`git grep -hE '^## \[0\.(8[89]|9[0-8])' d2931ad3 -- '**/CHANGELOG.md'` 为空），git tag 也只有 `v0.87.0 / v0.87.1 / v0.99.0 / v0.99.1`。因此本报告覆盖 **0.87.1（在提交区间内但版本号 < 0.88）+ 0.99.0 + 0.99.1 + [Unreleased]**。
- 固定基点 `d2931ad3` **比 `v0.99.1` tag 多 19 个提交**（`git log v0.99.1..d2931ad3 | wc -l` = 19），所以各包 CHANGELOG 的 `[Unreleased]` 段（尤其 durable）也属于本次升级。
- 各包 0.87.0 段落在 tag `v0.87.0` 上已经存在（`git show v0.87.0:packages/agent/CHANGELOG.md`），**不属于**本次升级（例如 agent 删除 `shouldStopAfterTurn`、ai 的 `TranscriptContext` 改造都在区间外）。
- 每条断言都标注来源：「changelog」= 该包 CHANGELOG 明确写；「diff」= 从代码/文档 diff 推断；未提及处写 **未说明**。

## 版本时间线

| 版本 | 日期 | 提交数 | 一句话主题 |
|---|---|---|---|
| v0.87.1 | 2026-09-22 | 19 | 前沿模型（Claude Opus 5.5、GPT-6 Sol/Luna、Grok 4.7）与 xAI 默认模型变更 |
| v0.99.0 | 2026-09-29 | 87 | codemode + MCP + System 主题 + ChatGPT 登录 + 虚拟模型 + 分类器模型（本跳的主体） |
| v0.99.1 | 2026-09-29 | 5 | 新增 GPT-6.1 Sol，并成为 OpenAI Codex 默认模型 |
| `[Unreleased]`（至 d2931ad3，2026-09-30） | 未发布 | 19 | durable 工具链/inbox/usage、`pi-ai/models` 入口、codemode `image()` 校验、Z.AI CN 溢出识别 |

## 模型与 provider

- **GPT-6.1 Sol（`gpt-6.1-sol`）** 加入 OpenAI、Azure OpenAI Responses、OpenAI Codex，并成为 **OpenAI Codex 默认模型**（ai CHANGELOG 0.99.1 Added/Changed；coding-agent CHANGELOG 0.99.1「GPT-6.1 Sol — … now the default OpenAI Codex model」）。
- **Claude Sonnet 5.5** 加入 Anthropic 内置目录，带 adaptive thinking、1M 上下文（ai CHANGELOG 0.99.0 Added）。
- **Claude Opus 5.5、GPT-6 Sol、GPT-6 Luna、Grok 4.7** 加入内置目录（含 GitHub Copilot）；**xAI 默认模型改为 Grok 4.7**（ai CHANGELOG 0.87.1；coding-agent CHANGELOG 0.87.1 New Features）。
- **默认模型表变更**（diff：`packages/coding-agent/src/core/model-resolver.ts`）：`openai-codex` gpt-5.5→`gpt-6.1-sol`；`xai` grok-4.6→`grok-4.7`；`fireworks`→`kimi-k3`；`together`→`moonshotai/Kimi-K3`；`opencode-go`→`kimi-k3`（Kimi K2.6 上游被移除，见 coding-agent CHANGELOG 0.99.0 Fixed 三条）。
- **OpenAI Codex provider 改名为「OpenAI Codex (legacy)」**，由 OpenAI provider 上的 ChatGPT 登录取代（ai CHANGELOG 0.99.0 Changed；coding-agent 同）。
- **Sign in with ChatGPT**：`openai` provider 新增 OAuth（`/login openai`）；`Models.login()` 接受 `LoginOptions.getDeviceId()`；订阅额度错误不重试（ai CHANGELOG 0.99.0 Added；diff 新增 `packages/ai/src/auth/oauth/openai-chatgpt.ts`、`callback-server.ts`）。
- **分类器（Jev）模型**：内置 TypeSafe `jev-latest`，以及 OpenRouter、Cloudflare Workers AI、Vercel AI Gateway、OpenCode Zen 的继承条目；新 API `typesafe-system-one`、`cloudflare-workers-ai-system-one`、`llama-cpp-classify`（ai CHANGELOG 0.99.0 Added；diff 新增 `packages/ai/src/api/*system-one*.ts`、`llama-cpp-classify.ts`）。
- OpenAI SDK `6.40.0 → 7.19.0`（diff：`packages/ai/package.json`）；openai SDK 升级在 CHANGELOG 0.99.0 中列为 fix。

## 扩展 API 与 TUI

- **工具暴露模型**：新增 `exposure`（`direct` / `model-only` / `codemode` / `deferred` / `hidden`）、`namespace`、`annotations`、`outputSchema` + `structuredContent`、`defaultActive`、`prepareLoadout()`，以及 `ctx.executeTool()` 嵌套调用（事件带 `parentToolCallId`，结果记 `nestedCalls`）（coding-agent CHANGELOG 0.99.0 Added；diff：`src/core/extensions/types.ts`）。
- **`ToolDefinition.execute` 的 ctx 类型从 `ExtensionContext` 变为 `ExtensionToolContext`**（diff：`types.ts`）。新类型是旧类型的子接口，旧 handler 仍可通过类型检查；但显式标注 `ExtensionContext` 的回调需重新标注。
- **`ProviderModelConfig` 变为联合类型** `ProviderChatModelConfig | ProviderImageModelConfig | ProviderClassifierModelConfig`；`api` 字段类型放宽为 `string`（diff：`types.ts`）。只消费不构造的扩展无感；直接读取 `reasoning`/`contextWindow` 的扩展需要收窄。**changelog 未提及此破坏性**。
- **`ProviderConfig` 新增 `images` / `classifiers` 操作实现**（diff；ai CHANGELOG 0.99.0 对应 `Provider.generateImages?`）。
- **新事件**：`provider_stream_event`（归一化前的 provider 原始事件，opt-in `/debug-provider` 示例）与 `mcp_servers_change`（coding-agent 0.99.0 Added；diff `types.ts`）。
- **新 API**：`pi.getSettings()`、`pi.registerVirtualModel()`/`unregisterVirtualModel()`、`pi.registerMcpServer()`/`unregisterMcpServer()`/`getMcpServers()`（diff `types.ts`；coding-agent 0.99.0 Added）。
- **内置扩展命名**：`<inline:name>` / `<builtin:name>` 统一为 **`builtin:<name>`**，`--no-extensions` 现在**同时禁用内置扩展**（含 llama.cpp provider），用 `-e builtin:<name>` 单独加载（coding-agent CHANGELOG 0.99.0 Changed）。
- **TUI 破坏性**：`TUI.queryTerminalColorScheme()` / `queryTerminalBackgroundColor()` 被 `TUI.queryTerminalColors()`（OSC 10/11/4 一次往返，返回 `TerminalColors`）取代，`parseOsc11BackgroundColor()` 移除（tui CHANGELOG 0.99.0 Breaking Changes）。
- **颜色与主题 API**：新增 `Color` 类型、`parseColor()`（`#rgb`/`#rrggbb`/`oklch()`/`okhsl()`）、`mixColors()`、`styleText()`、`getTerminalColorMode()`，以及 `theme.style()`、`theme.colors`、`theme.appearance`（tui/coding-agent 0.99.0 Added）。
- **全屏滚轮**：`TuiAltScreenOptions.wheelScrollLines` 支持 `"auto"`，新增 `setWheelScrollLines()` 与 `fullscreenWheelScrollLines` 设置（tui/coding-agent 0.99.0；coding-agent CHANGELOG 0.99.0 Added）。
- **`defaultTools` 支持 `+name` / `-name`**（增量增删，项目层叠加在用户层之上）（coding-agent CHANGELOG 0.99.0 Added；diff `settings-manager.ts`）。
- **RPC**：`prompt`/`steer`/`follow_up` 成功响应新增 per-input disposition；`RpcClient.prompt()` 接受 `streamingBehavior`（coding-agent 0.99.0 Added）。
- `bash`/`powershell` 的结构化结果面向 codemode 提升到 **最多 1 MiB**（原 2000 行 / 50 KB），新增 `truncated`、`full_output_path`（coding-agent 0.99.0 Changed）。
- 未带自定义渲染器的工具（含 MCP 直调）现在会显示调用参数；MCP 调用标题为 `server/tool`（coding-agent 0.99.0 Changed）。

## 权限与安全

- **codemode 沙箱**：QuickJS（WASM，worker thread，带堆上限）内运行模型生成的 JS，脚本只能通过 `tools.<name>(args)` 触达其他工具（codemode CHANGELOG 0.99.0；diff `src/extensions/codemode/execute.ts`）。
- `ctx.executeTool()` 被明确设计为「与模型发起的调用走同一套校验、hooks 与权限检查」（diff：`types.ts` 注释）。**未说明**是否有新增的独立权限网关。
- **项目信任范围扩大**：`.pi/mcp.json` 现在属于需要项目信任的资源（diff：`packages/coding-agent/docs/security.md`）。项目 MCP 服务器仅在授予信任后读取（`src/extensions/mcp/config.ts`）。
- `docs/security.md` 被重写为《Run Pi safely》：明确「把模型生成的命令与代码视为不可信」「项目信任不是安全边界」，并引导使用容器/虚拟机隔离（diff）。属于文档立场变化，无代码行为变化。
- 托管 git 包不再自动安装 Pi peer 依赖，并对把宿主提供模块写进 `dependencies` 的扩展包发警告（coding-agent CHANGELOG 0.99.0 Fixed）。
- MCP OAuth 刷新跨进程串行化；`/mcp` 登录 URL 改为可点击超链接，并复用共享回调服务器（仅允许 `localhost`/`127.0.0.1`/`[::1]`）（coding-agent 0.99.0 Fixed + Unreleased；diff `packages/ai/src/auth/oauth/callback-server.ts`）。
- 新增全局设置 **`deviceId`**（稳定 UUID，ChatGPT 登录首次需要时生成，仅全局；从 bug report 中剔除）（diff `settings-manager.ts`、`bug-report.ts`）。
- **遥测/分析未变化**：`enableInstallTelemetry` 默认 `true`、`enableAnalytics` 默认 `false`、`trackingId` 行为在三处 ref（v0.87.0 / d2931ad3）完全一致；`packages/telemetry` 本次只有版本号变更（8 行 CHANGELOG + 版本/dep 调整），无功能改动。

## 新包与新工具

- **`packages/mcp`（全新，4,623 行，+4623/-0）**：独立 MCP 客户端 —— JSON-RPC 生命周期、工具发现/调用、取消、progress、roots、stdio 与 Streamable HTTP、内存测试传输（mcp CHANGELOG 0.99.0）。
- **`packages/codemode`（全新，2,829 行，+2829/-0）**：`CodemodeSandbox` 在 worker 线程运行模型 JS，注入 `tools.<name>(args)`（codemode CHANGELOG 0.99.0）。注意 `durable` **不是**新包（0.86.0 已存在）。
- **4 个内置扩展**：`llama.cpp`（改为 `builtin: true`）、`codemode`、`tool-search`、`mcp`（diff `src/extensions/index.ts`）。`codemode` 与 `tool_search` **默认注册但不激活**（`defaultActive: false`）；`mcp` 读取配置后才连接。
- **新 CLI 子命令**：`pi mcp add|remove|list|login|logout`（diff `src/cli/args.ts` 帮助文本；`src/extensions/mcp/cli.ts`）。
- **新斜杠命令**：`/mcp`（及 `/mcp login|logout|reconnect`）（docs/mcp.md）。
- 新扩展事件 `mcp_servers_change`；MCP 工具命名为 `mcp__<server>__<tool>`，per-tool `toolExposure` 可用 glob 覆盖（docs/mcp.md）。
- **`@earendil-works/pi-ai/models` 轻量入口**（不加载 TypeBox/内置目录/provider SDK）（ai CHANGELOG Unreleased；diff `packages/ai/package.json` exports）。
- 新导出：`@earendil-works/pi-durable/testing`（存储一致性套件与基准）、`/storage/jsonl`、`/env`（durable CHANGELOG 0.99.0 Added）。
- 新依赖 `quickjs-wasi@3.6.2`，binary 构建新增 `./src/extensions/codemode/worker.ts` 入口（diff `packages/coding-agent/package.json`）。
- 新脚本/CI：`scripts/model-catalog-protocol.ts`（与 pi.dev 共享目录协议，260 行）、改写 `publish-model-catalog.mjs`、新增 `scripts/check-browser-smoke.mjs`、`.github/workflows/publish-model-catalog.yml`（会向 Cloudflare R2 上传模型目录）、`scripts/biome/model-type-comparison.grit`。

## 默认值与行为变化

- **默认主题从 `dark` 变为 `system`**（对比：`v0.87.0:docs/settings.md` 为 `"dark"`，d2931ad3 为 `"system"`）。`system` 从终端 OSC 10/11/4 推导配色并在终端明暗切换时重建；首次设置默认选中 System，且不再显示「Detected system appearance」（diff `docs/themes.md`、`first-time-setup.ts`）。
- **启动时总是查询终端颜色**（即使 `theme` 不是 `system`，因为 `""` 终端默认色 token 需要）：最多等 100 ms，超时后用 ANSI 回退，颜色晚到仍会应用（diff `src/cli/startup-ui.ts`，调 `requestTerminalColors`）。这是**从 diff 推断**的行为变化。
- 启动横幅移除 `[Themes]` 段；头部改为显示 pi logo + 版本号（coding-agent 0.99.0 Changed；diff 新增 `components/pi-logo.ts`）。内置 `dark`/`light` 主题改用 OKHSL 重写。
- **MCP 工具默认 exposure 为 `codemode`**（不直接声明给模型），且 `autoEnableCodemode` 默认 `true`：一旦连接了 `codemode`/`codemode-deferred` 暴露的服务器，**codemode 工具会被自动激活**（diff `src/extensions/mcp/config.ts`；docs/mcp.md）。
- `codemode.mode` 默认 `"on"`，`codemode.inlineBudget` 默认 `3000`（docs/settings.md）。
- `fullscreenWheelScrollLines` 默认 `"auto"`；本地 macOS 终端每格 1 行，其他/SSH 加速到最多 6 行，Alt+滚轮 ×5（docs/settings.md）。
- 会话文件改为**在第一条用户消息时**创建（修复此前首响应前退出会丢会话）（coding-agent 0.99.0 Fixed）。
- `TERM=*-direct` 现在被识别为 truecolor；明暗检测顺序改为「上报背景色 → 终端明暗上报 → `COLORFGBG`」（coding-agent 0.99.0 Changed）。
- 流式渲染 CPU 降低：footer 缓存用量合计、折叠 bash 结果缓存预览、`sanitizeBinaryOutput()` 不再逐字符拆数组（coding-agent 0.99.0 Fixed；tui 同）。

## 破坏性变更

按包汇总（changelog 明确标注的）：

- **ai（0.99.0 Breaking Changes，最重）**：图片模型并入统一 `Provider`/`Models` 表面 —— 删除 `ImagesModels` 集合、`createImagesModels()`、`createImagesProvider()`、`ImagesProvider`、`openrouterImagesProvider()`、`builtinImagesProviders()`、`builtinImagesModels()`；删除复数类型名 `ImagesModel`/`ImagesApi`/`KnownImagesApi`/`KnownImagesProvider`/`ImagesProviderId`；生成模型数据 schema 升到 **v6**（每条目带 `type`）；删除 `image-models.generated.ts` 与 `scripts/generate-image-models.ts`，需重跑 `npm run hydrate:model-data`。
- **tui（0.99.0 Breaking Changes）**：见上「扩展 API 与 TUI」的颜色查询 API 替换。
- **durable（0.99.0 + `[Unreleased]` 两段 Breaking Changes，合计数十条）**：Storage 扫描参数顺序改为 limit 在前；`Tx.createConversation()`/`forkConversation()` 拆分；`TaskRef` → branded 数字 ID；任务定义必须用 `defineTask()` 且 `phases` 穷举 + `abort`；移除 `Tx.setTask()`；`TaskRuntime`/`ToolExecutionApi` 新增必需成员；busy 提交不再抛 `ConversationBusy` 而进入 `pi.inbox`；`ShellExecOptions.capture`/`onUpdate` 被 `onOutput` + `spill` 取代。属实验性包，CHANGELOG 自述为 experimental usage guide。
- **构建/工具链（coding-agent 0.99.0 Changed + diff `package.json`、`tsconfig.base.json`）**：从 TypeScript native preview 切到 **TypeScript 7.0.2**（`tsgo` → `tsc`），target/lib 升到 **ES2024**，`tsx` 被删除改用 Node 内置 type stripping；移除 `@typescript/native-preview`、`tsx` 依赖；`tsconfig.base.json` 移除 `experimentalDecorators`/`emitDecoratorMetadata`/`useDefineForClassFields`，新增 `verbatimModuleSyntax`。
- `--no-extensions` 语义变化（现在也禁用内置扩展）；内置资源标识符改为 `builtin:<name>`。
- **agent / client / protocol / server / telemetry / session-backends 在本区间没有 Breaking Changes 条目**：agent 0.99.0 只有两项 Added（`onProviderStreamEvent`、assistant message 记录 `thinkingLevel`）；后四者只有空的版本标题（`git diff v0.87.0 d2931ad3 -- packages/client/CHANGELOG.md` 只增标题行）。
- **chord**：无 `CHANGELOG.md`（v0.87.0 与 d2931ad3 均不存在）→ **未说明**。15,372 行改动集中在 delta tracker / services / 状态测试，**从 diff 推断**为内部重构与测试重写。

## 可能不受欢迎或需评估的变更

面向「最小化、本地优先、缓存友好、无遥测」的维护者：

1. **默认 System 主题 + 每次启动都发 OSC 10/11/4 终端查询**（最多阻塞 100 ms，颜色晚到会触发重渲染）。纯本地/受限终端或已有 `theme` 固定配色时属可省的开销；可通过显式设置 `theme` 规避，但查询本身仍会发生（diff `startup-ui.ts`）。
2. **体积膨胀显著**：durable 41,516 行 churn、chord 15,372 行、新增 mcp 4,623 行与 codemode 2,829 行。即使默认不激活，也直接抬高 vendored 源码体量、`npm run build` 顺序（根 `build` 新增 codemode、mcp 两步）与 CI 时间。
3. **新增网络/子进程能力面**：MCP stdio 会 spawn 子进程、Streamable HTTP 会出网、OAuth 会打开浏览器；`pi mcp` 相关 CLI 与 `/mcp` 命令（docs/mcp.md）。本地优先场景需要明确基线（默认无 mcp.json 时不连接，**从 diff 推断**为安全默认）。
4. **codemode 自动激活**：只要配置了任一默认 exposure 的 MCP 服务器，codemode 即被激活并向模型暴露脚本执行能力（`autoEnableCodemode` 默认 `true`）。想保持「显式启用」的维护者需显式关掉。
5. **新增全局 `deviceId` 持久 UUID**（ChatGPT 登录用），虽从 bug report 剔除，但这是新的安装级标识符（diff `settings-manager.ts`）。
6. **新增 `quickjs-wasi` WASM 依赖与额外 binary 入口**，对本仓库的自定义打包/裁剪脚本是新的构建负担（diff `packages/coding-agent/package.json`）。
7. **构建工具链大改**（TS 7.0.2、ES2024、删 `tsx`、`tsgo`→`tsc`）。若本仓库有本地 patch 或自定义 build/test 脚本，需逐条验证；`erasableSyntaxOnly` 仍保留，AGENTS.md 新增了 `src/config.ts` 资产路径规范。
8. **CI 侧新增向 Cloudflare R2 上传模型目录的 workflow**（`.github/workflows/publish-model-catalog.yml`）。不影响本地运行，但引入了外部存储与凭据依赖。
9. **OpenAI Codex provider 改名 legacy + ChatGPT 登录**：既有配置/文档/脚本中引用 Codex provider 名称的地方需要核对（ai 0.99.0 Changed）。
10. **遥测基线未变但需复核**：`enableInstallTelemetry` 仍默认 `true`，`settings.md` 新增说明它还会发送「selected provider attribution headers」。本区间**没有**新增 analytics 事件，但若本仓库已有针对性 patch，应确认新代码路径（如 `provider_stream_event`、MCP OAuth）未绕过它。
11. **文档被大规模重写/搬迁**（`packages/coding-agent/docs` 42 文件 `+4484/-10749`，删除 `docs/development.md`，`extensions.md` `+165/-2996`、`rpc.md` `+130/-1555`，并新增 `cli.md`、`mcp.md`、`message-types.md`、`virtual-models.md` 等）。本地若有基于旧文档的补丁，会大量冲突。

---

### 引用索引（关键文件）

- 提交区间与规模：`git log --oneline v0.87.0 d2931ad3 | wc -l`（130）、`git diff --shortstat v0.87.0 d2931ad3`（744 files / +90664 / -24881）
- 各包 CHANGELOG：`packages/{coding-agent,ai,tui,agent,client,protocol,server,telemetry,codemode,mcp,durable}/CHANGELOG.md`
- 扩展 API：`packages/coding-agent/src/core/extensions/types.ts`
- 内置扩展装配：`packages/coding-agent/src/extensions/index.ts`
- 默认模型：`packages/coding-agent/src/core/model-resolver.ts`
- 设置项：`packages/coding-agent/src/core/settings-manager.ts`、`docs/settings.md`
- MCP：`packages/coding-agent/src/extensions/mcp/{config,tools,cli,oauth}.ts`、`docs/mcp.md`
- codemode：`packages/coding-agent/src/extensions/codemode/{index,tool,execute}.ts`、`docs/cli.md`
- 主题：`packages/coding-agent/src/modes/interactive/theme/{system-theme,theme-controller}.ts`、`docs/themes.md`
- 构建：`package.json`、`tsconfig.base.json`、`packages/*/package.json`
