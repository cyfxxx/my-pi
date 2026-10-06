# 上游升级报告：v0.99.1 → v1.0.4（`28dcce2ba`）

**范围**：`vendor/pi` 上游区间 `d2931ad3d5bf6936fbdfa5dfc81fb32f875499b2..28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9`（不含本仓库 `local: 001-009` 提交）。
**规模**：**156 个提交**，837 个文件变更，`+42684 / -116560`（`git diff --shortstat`）——**删除远多于新增**，主体是 `packages/agent` 的实验 harness 被整块移除。
**同步日期**：2026-10-05/06；同步后基线 commit `28dcce2ba`，本仓库补丁栈 `local: 001-009` 全部原样重放（详见末节）。

**方法学提醒**：
- 每条断言标注来源：「changelog」= 该包 CHANGELOG 明确写；「diff」= 从代码 diff 推断；「实测」= 本机在同步后实际跑过（`tsc` / 构建 / golden / 冒烟）。
- 兼容性结论一律给**本仓库实测**，不靠"看起来应该没事"。

## 版本时间线

| 版本 | 日期 | 距基线提交数 | 一句话主题 |
|---|---|---|---|
| v0.99.2 | 2026-09-30 | 23 | MCP 不再阻塞首轮、`/reload` 启用新增 `defaultTools` |
| v1.0.0 | 2026-10-01 | 69 | **fullscreen 成为默认 TUI**、codemode 提示词瘦身约 40%、**agent harness 整体删除**、pi-durable 客户端/服务端 |
| v1.0.1 | 2026-10-03 | 98 | Nix flake、项目级 MCP 覆盖、`registerToolRenderer()`、`npm-shrinkwrap` 移除、brace-expansion 安全修复 |
| v1.0.2 | 2026-10-04 | 104 | `samplingParamsByThinkingLevel`（按思考档位设 temperature/top_p） |
| v1.0.3 | 2026-10-05 | 127 | **Azure provider 改名**（破坏性）、Home/End 语义变更、codemode 图片落盘、终端 EIO 崩溃修复 |
| v1.0.4 | 2026-10-05 | 155 | `--tools`/`--exclude-tools` 支持通配 + `--no-mcp`、codemode `read` 返回图片、MCP OAuth 原生客户端注册 |
| `[Unreleased]`（至 `28dcce2ba`） | 未发布 | 156 | changelog 占位提交 |

各包改动量（增+删，Top）：`agent` 97224、`durable` 22864、`coding-agent` 19170、`env` 7742、`session-backends` 4407、`ai` 2746、`codemode` 511、`mcp` 500、`tui` 461、`server` 174。**新增包 `env`，删除包 `packages/session-backends`**。

## 一、对本仓库的兼容面（逐项实测）

| 依赖面 | 结论 | 依据 |
|---|---|---|
| `custom/adapters` 的 import | 只 import `@earendil-works/pi-coding-agent` 与 `pi-tui`；**不碰 `pi-agent-core`**，故 harness 删除对本仓库零影响 | diff + `npx tsc --noEmit -p custom/` **通过**（实测） |
| `ExtensionAPI` 成员 | **26 → 27，只增不减**：新增 `registerToolRenderer`。我们用到的 `registerTool`/`registerCommand`/`registerShortcut`/`registerFlag`/`registerMessageRenderer`/`sendMessage`/`sendUserMessage`/`appendEntry`/`setSessionName`/`setActiveTools`/`getActiveTools`/`getAllTools`/`getFlag`/`getThinkingLevel`/`setThinkingLevel` 全部保留 | diff（接口成员集合）+ tsc（实测） |
| `ExtensionContext` 成员 | **18 → 18，零变化** | diff |
| `ExtensionEvent` 事件名 | **零变化**（我们注册的 18 个事件全在：`session_start`/`before_agent_start`/`context`/`tool_call`/`tool_result`/`tool_execution_start`/`message_end`/`message_update`/`agent_end`/`agent_settled`/`turn_start`/`turn_end`/`input`/`before_provider_request`/`session_before_compact`/`session_compact`/`session_shutdown`/`thinking_level_select`） | diff（事件字面量集合完全相同） |
| CLI flag | `--mode json/rpc`、`-p`、`--no-session`、`--no-extensions`、`--session-dir`、`--append-system-prompt`、`--continue`、`--tui-mode` 全部保留 | diff + 冒烟（实测） |
| 技能加载 | `core/skills.ts` 仍在，仍 `import { getAgentDir } from "../config.ts"` → `portable/agent/skills/` 继续生效 | diff |
| `tsconfig.base.json` | **逐字未变**（`custom/tsconfig.json` 继续继承；ES2024/Node16/`erasableSyntaxOnly` 不变） | diff |
| Node 要求 | `>=22.19.0` 未变（本机 v22.23.1） | diff |
| `settings.json` 键 | `packages`/`transport`/`compaction.*`/`skills`/`steeringMode`/`followUpMode`/`defaultProjectTrust`/`modelThinkingLevels`/`collapseChangelog`/`hideThinkingBlock` 全部仍被文档支持 | diff（settings 文档） |
| 构建脚本 | `build.sh` 直接 `cd vendor/pi && npm run build:offline`，上游新的 build 链已含 `env` 并去掉 `session-backends` → **本项目脚本无需改** | diff + 构建成功（实测） |
| 模型数据 | 上游把 provider `azure-openai-responses` 改名为 `azure`，生成数据里多了 `azure.json`（数据目录 gitignore、需联网生成） | 构建失败→`npm run hydrate-model-data` 修复（实测） |

## 二、默认值与行为变化（需要知道，不会报错）

- **TUI 默认 fullscreen**（1.0.0）：`tuiMode` 默认从 `regular` 变 `fullscreen`；`--tui-mode regular` 或 `tuiMode: "regular"` 可回到终端原生滚动。相关设置同时新增：`fullscreenExitOutput`（退出时打印 transcript 还是恢复提示）、`fullscreenScrollbar`、`fullscreenCopyOnSelect`、`fullscreenWheelScrollLines`。**本仓库按用户决定采用 fullscreen 默认**（`portable/agent/settings.json` 不写 `tuiMode`）。
- **Home/End 语义**（1.0.3）：`Home`/`End` 恒为编辑器行首/行尾；transcript 首尾改到 `Ctrl+Home`/`Ctrl+End`。本仓库 `keybindings.json` 未绑定这两个键 → 跟随上游默认。
- **`--provider` 不带 `--model` 直接报错**（1.0.0）：此前会静默用别的 provider 的默认模型。本仓库 `pi-supervisor.sh` 的 `set_model` 始终成对传参 → 无影响。
- **`npm-shrinkwrap.json` 从发布包移除**（1.0.1）：npm 安装不再锁定传递依赖；本项目从不依赖它（`grep shrinkwrap` 无命中）。
- **`/reload` 启用新增到 `defaultTools` 的工具**（0.99.2）：与我们在 `AGENTS.md` 写的"不要在会话中途改工具集"一致，属已知项。
- **codemode 提示词显著变短**（1.0.0）：声明式工具一行说明 + `models` API 移到按需读取的参考文档；实测"默认工具 + codemode"下 GPT-5.6 请求 5300 → 3300 token。**工具声明是前缀最大构件，这对我们的缓存/成本指标是净收益**。
- **每条渲染消息的内存降到约 1/5**（1.0.0）；模型目录查询由二次降为线性（0.99.2/1.0.0）；会话变长后提交不再变慢（0.99.2）。

## 三、新包与新工具

- **`packages/env`（新）**：SSH 远程执行环境与 daemon（Windows 支持、base64 上传、超时与 watcher 修复）。本项目**未采用**；将来 `link` 若要做"远程环境执行"可复用它（已记入 `UPSTREAM-UPDATE.md` 待办表）。
- **`packages/durable` 大幅扩展**：异步 SQLite 存储、`FileSystem.watch`、结构化并发、compaction/overflow、端口化的实验 TUI 客户端/服务端。`packages/session-backends`（sqlite-node）**被删除**，并入 durable。
- **`ExtensionAPI` 新增**：`registerToolRenderer()`（给"尚未注册的工具"画调用，如恢复会话里的 MCP 工具）、`registerEntryRenderer()`、`registerMarkdownTransformer()`、`getSessionName()`、`setLabel()`、`exec()`、`getMcpServers()`、`getSettings()`、`setModel()`（1.0.x 内陆续加入）——都可选采用，本项目尚未使用。
- **`--tools` 支持通配**（1.0.4）：如 `--tools read,codemode,'mcp__radius__*'`；`--no-mcp` 单次关闭 MCP。
- **`samplingParamsByThinkingLevel`**（1.0.2）：OpenAI 兼容 API 可按思考档位设 `temperature`/`top_p` —— 对 `freellmapi` 这类 OpenAI 兼容链路可用，未启用。

## 四、权限与安全

- **codemode 加固**：脚本运行前冻结内建对象（`Array.prototype.toJSON = …` 之类不再崩 pi）；脚本输出上限（16M 字符 / 100000 项，防 print 循环 OOM）；`tools.read()` 图片改为返回 image block。
- **MCP OAuth 加固**：RFC 9207 `iss` 校验、按"服务器名 + URL"存凭据、step-up 登录保留已授权 scope、原生客户端注册（修 `invalid_redirect_uri`）。
- **输出文件权限**：被截断工具输出、二进制 MCP 资源、codemode 生成的图片落盘后**仅用户可读**。
- **终端健壮性**：终端消失时不再报 `read EIO`/`setRawMode EIO` 崩溃（1.0.3）。
- **依赖安全**：`brace-expansion` 三个 advisory 通过固定 5.0.12 修复（1.0.1）。
- 遥测/分析默认值未变（延续上次结论）。

## 五、破坏性变更与本仓库处置

| 破坏性变更 | 影响 | 处置 |
|---|---|---|
| `@earendil-works/pi-agent-core` 删除实验 harness（AgentHarness、sessions、durable runtime、pico3、harness tools、compaction、skills、prompt templates、system prompt helpers、telemetry schemas、`uuidv7`、`./harness/*` 等子路径导出） | **无**：本仓库只用 `coding-agent` + `tui` | 无动作 |
| Azure provider 改名 `azure-openai-responses` → `azure`（auth/models/settings 的键都要改） | **无**：本项目未使用 azure（`grep` 无命中） | 无动作 |
| `Home`/`End` 语义变更 | 手感变化（fullscreen 下 transcript 首尾改 Ctrl+Home/End） | 跟随上游；需要回退就在 `keybindings.json` 显式绑定 |
| TUI 默认 fullscreen | **有**：终端原生 scrollback 不再承载历史，改为应用内滚动/搜索 | **按用户决定采用默认**；一个设置值可回退 |
| `npm-shrinkwrap.json` 移除 | 无 | 无动作 |

## 六、本次同步实际做了什么

1. **补丁栈重放前修复**（这是本次唯一的"人工改补丁"）：
   - `001-branding.patch`：上游改了根 `package.json` 的 `workspaces`/`scripts` 段 → 按新基线重新生成（净效果仍只有 `name: my-pi` + `piConfig`）。
   - `006-footer-cost-and-cache-window` / `007-footer-reorder`：这两个补丁的上下文停留在一个更早的上游 `footer.ts`（`this.session.sessionManager.getEntries()`），**在 v0.99.1 基线上也已经无法线性应用**（此前只能靠 `git apply --3way` 或手工落地）。本次按 vendor 本地提交链的真实中间态（`595ce1589 → 9dd28ff19 → ac57dc758`）重新生成，`+/-` 行与原补丁逐字一致，只有一行上下文与 index 行更新。
   - `002-local-pi-mods.patch`：刷新其中的 `packages/README.md` 包清单（补 `durable`/`env`/`codemode`/`mcp`，去掉已删的 `session-backends`，并修掉一个失效链接）。
2. `bash scripts/sync-upstream.sh 28dcce2ba…`：临时 worktree 重建补丁栈 → **9/9 全部线性应用、0 失败**（无三方合并）→ 移动 `vendor/main`、更新 `vendor/PINNED_COMMIT` 与 `STRUCTURE.md`。
3. 模型数据：构建时发现缺 `azure.json`（provider 改名所致）→ `npm run hydrate-model-data`（只写 gitignore 的数据目录，不动上游源码）。
4. 重建 dist、刷新崩溃自愈缓存、`vendor-bundle.sh create`（`vendor/pi-28dcce2ba45c.bundle`，70M，含当前 PINNED）。
5. 验证：`npx tsc --noEmit -p custom/` 通过；`vitest` 72 文件 / 784 用例通过；`test-supervisor.sh` 56 项；`test-web-terminal` 36 项；`test-usage-metrics` 46 项；`test-prepush-scope` 7 项；`doctor.sh` 24 正常 / 1 警告（旧的离线归档不含新 PINNED，已补新归档）/ 0 异常；`./my-pi.sh -p` 冒烟实测回复正常（同一提示词实测 4.6s–145s：免费 provider 抖动，故把无头冒烟的判定改为**失败重试一次**，见 `golden-tasks.sh` 第 18 步注释）。

## 七、未采用 / 与本仓库无关

Nix flake、Radius 登录、Cloudflare Clef 分类器、Anthropic 内联工具与 copy-code 登录、`durable`/`env`/`client`/`server` 的新能力、图片生成、`quietStartup`、项目级 `.pi/mcp.json` 覆盖（我们不用 MCP）。它们不影响本项目行为，未来需要时再评估。
