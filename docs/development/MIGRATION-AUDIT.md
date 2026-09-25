# pi-tools → my-pi 迁移完整性对比审计

> 本报告对比原项目 pi-tools（本地克隆 `/tmp/pi-tools`，commit `848d53a`）与当前项目 my-pi（`/root/my-pi`），
> 逐层核对迁移完整性，并区分「有意适配」「真实缺口」「本轮已修复缺陷」。
> 审计时间：2026-09-25。基线：`be1f83ed4`。

## 一、结论摘要

**总体迁移是成功的**：pi-tools 的核心能力（10 个扩展 → 12 个功能、863 个 packs 文件、packs/agent 配置、
补丁体系、运维脚本、部署产物）均已迁移或按 my-pi 的新架构有意重构，且大部分偏离在
[DECISIONS.md](../../DECISIONS.md)、[PROGRESS.md](../../PROGRESS.md)、[docs/README.md](../README.md) 中有明确记录。

审计同时发现**9 个确证缺陷**（其中 4 个曾使项目自身守门变红），本轮已全部修复并验证：

| # | 缺陷 | 影响 | 状态 |
|---|------|------|------|
| 1 | `webhook.test.ts` 使用非法 `TaskType: 'prompt'` | `tsc` 失败（4 处类型错误） | ✅ 已修复 |
| 2 | `check-features.sh` 用 `apply --check/--reverse` 判定补丁，顺序叠加补丁 004 被误判 | 守门 exit 1（假失败） | ✅ 已修复 |
| 3 | `golden-tasks.sh` 步骤 5 同一误判逻辑 | 守门 exit 1 | ✅ 已修复 |
| 4 | `injection-baseline.json` 未随 AGENTS.md 有意改动更新 | 注入面守门 exit 1 | ✅ 已修复 |
| 5 | `./my-pi.sh install/list/remove` 不可用（`--extension` 抢占 argv[0]） | **P0 功能回归**，与文档不符 | ✅ 已修复 |
| 6 | `.git/config` 的 `core.hooksPath=.husky/_` 指向已删除目录 | git 钩子静默失效 | ✅ 已修复 |
| 7 | `check-features.sh` 注册面清单陈旧（漏 18 个工具/1 个命令/1 个脚本） | 守门覆盖不足 | ✅ 已修复 |
| 8 | `.gitignore` 的 `!portable/memory/stats/**` 过宽，暴露原始运行时文件 | 原始 usage 数据"仍不入库"的约定被破坏 | ✅ 已修复 |
| 9 | `pi-memory/scripts/memory-lifecycle.mjs` 未迁移，且丢失「垃圾嫌疑/聚合候选」治理信号 | 定时任务拿不到生命周期报告；垃圾条目可能被升格为规则 | ✅ 已修复 |

修复后 `bash scripts/golden-tasks.sh` **全绿**（11 步；`--smoke` 另加无头冒烟）。

**仍有若干真实缺口未修**（非本轮引入，多为已记录的延后项），按优先级见第五节。

## 二、对比方法与范围

- 文件清单：`git ls-files` 双向对比（pi-tools 2281 个跟踪文件，my-pi 1173 个）。
- 内容：`diff -r` / `diff -u` / `cmp` 逐文件；JSON 做结构化键值对比。
- 注册面：解析 `registerTool`/`registerCommand`/`registerShortcut`/`on(event)` 调用，双向集合差。
- 符号面：对每个 pi-tools 模块抽取导出符号，在 my-pi 功能目录中做存在性核对。
- 运行验证：`tsc`、`vitest`、`check-isolation.sh`、`check-features.sh`、`check-injection-surface.sh`、
  `check-doc-links.mjs`、`golden-tasks.sh`，以及包管理子命令的实测。

排除项：`node_modules`、`portable/agent/recovery/cache/`（构建缓存）、`portable/memory/` 运行时数据。

## 三、分层对比结论

| 层 | pi-tools | my-pi | 判定 |
|----|----------|-------|------|
| 扩展 → 功能 | `agent/extensions/`（10 个扩展 + plan-mode/subagent） | `custom/features/`（12 个功能） | ✅ 注册面全覆盖，my-pi 为超集 |
| 工具 | 61 个 | **64 个** | ✅ 无缺失；my-pi 新增 `voice_transcribe`/`voice_speak`/`voice_record`（pi-tools 只有 `/voice` 命令，无对应工具） |
| 命令 | 10 个 | **11 个** | ✅ 无缺失；my-pi 新增 `/context` |
| 快捷键 | 4 处（voice ×3、plan ×1） | 2 处（voice `Ctrl+Alt+R`、plan `Ctrl+Alt+P`） | ⚠ voice 的 `Enter`/`Shift+Enter` 条件拦截未迁移（依赖未迁移的上游补丁，见 G3） |
| 钩子事件 | 含 `session_before_compact` | 已注册 `session_before_compact` | ✅ 已补齐（G2 快照部分）；LLM 会话提取有意不迁移 |
| packs | 863 个文件 | 863/863 全在，另有 2 个新增 | ✅ 完全迁移 |
| agentDir 配置 | `agent/*` | `portable/agent/*` | ✅ 语义等价，逐文件核对（见 4.2） |
| skills | 23 个文件 | 23/23 全在 | ✅ 无缺失（22 篇适配、1 篇逐字节一致） |
| docs | 18 篇 | 迁移 9 篇 + 2 篇新增 | ✅ 9 篇丢弃均有记录 |
| deploy | systemd ×2 + tmux ×3 | systemd ×1 + tmux ×3 + README | ⚠ `pi-whisper.service` 有意延后（有记录） |
| 上游补丁 | 13 类 dist 补丁 | `patches/*.patch` 6 个 + 2 个脚本 | ⚠ 4 类未覆盖（见 G1/G3/G4/G7） |
| 运维脚本 | 32 个（6 子目录） | 32 个（扁平） | ✅ 能力映射核对完成，多数为拆分/重设计；本轮补齐 `memory-lifecycle.mjs` |

## 四、完全迁移与有意适配

### 4.1 完全迁移（逐字节或全量）

- **`packs/`**：pi-tools 863 个文件全部存在，`diff -r` 无内容差异；my-pi 新增
  `packs/drafts/.gitkeep`、`packs/knowledge-fetch/EXPERIENCE.md`，并在 `packs/INDEX.md` 补登记 `reverse-skill`。
- **`APPEND_SYSTEM.md`、`agents/{reviewer,scout,worker}.md`、`keybindings.json`**：`cmp` 逐字节一致。
- **注册面**：pi-tools 的 61 个工具与 10 个命令在 my-pi 中**无一缺失**。

### 4.2 agentDir 配置（有意适配）

- `settings.json`：无缺失键；新增 `transport`、`modelThinkingLevels`、`compaction.enabled`、
  `compaction.modelOverrides` 与 `+skills/pi-bug-diagnosis/SKILL.md`；`lastChangelogVersion` 随 pi 版本更新为 `0.87.0`。
- `modes.json`：由 pi-tools 的 `full/light/quick` 预设（`extensions/skills/appendSystemPrompt` schema）
  重构为代码内固定档位 `full`/`minimal` + JSON 可选 `roleplay`（新 schema `features/appendPrompt/memoryNamespace`）。
  这是有意的架构收窄（`custom/features/mode/logic.ts` 的 `FIXED_MODES`）。
- `scheduled-seeds.json`：同名 5 个种子全在，路径改写为 my-pi 落点；`daily-review` 提示词大幅精简（见 G5）。
- `skills/**`：23/23 齐备，方法论保留，仅改路径/命令/子系统引用，frontmatter `name` 未变。

### 4.3 脚本与部署（拆分/重设计）

pi-tools `scripts/rebuild.sh`（1497 行）拆分为 my-pi 的
`build.sh` + `doctor.sh` + `sync-upstream.sh` + `lib-vendor.sh` + `setup-external.sh` + `searxng-config.sh`；
崩溃自愈由 `pi-wrapper.sh` 重写为 [pi-supervisor.sh](../../scripts/pi-supervisor.sh)
（分类/修复者 pi/健康检查/熔断/审计均已迁移）。
`searxng/generate-config.sh` → `scripts/searxng-config.sh`（并改进：保留 secret_key、`SEARXNG_HOME`/`SEARXNG_PORT`）。

## 五、真实缺口（未修，按优先级）

### G1（P0，功能性）语音 STT/TTS 服务脚本缺失 → `voice_transcribe` 实际不可用 —— ✅ 已修复（2026-09-25）

- 证据：`custom/features/voice/config.ts` 默认 `whisperScript = <memoryDir>/voice/pi-whisper.sh`、
  `sherpaScript = <memoryDir>/voice/pi-sherpa.sh`；两者**在 my-pi 中不存在**（全树无 `pi-whisper*`/`pi-sherpa*`）。
- pi-tools 提供：`agent/extensions/pi-voice/scripts/{pi-whisper.sh, whisper-server.py, pi-sherpa.sh, pi-sherpa-server.py}`。
- `scripts/setup-external.sh` 只**打印**安装指引，不安装脚本。
- 运行时实证：`portable/agent/sessions/**/2026-09-22T09-11-33*.jsonl` 中 `voice_transcribe` 返回
  `转写失败: whisper 服务不可用且自动启动失败：bash: .../portable/memory/voice/pi-whisper.sh: No such file or directory`。
- **修复**：4 个脚本移入 `custom/features/voice/scripts/`（对应 pi-tools 扩展内位置），`PI_HOME` 改为按脚本位置上溯仓库根、
  日志落 `portable/memory/logs/voice/{whisper,sherpa}/`、配置读 `portable/agent/pi-voice.json`；
  `config.ts` 新增 `voiceScriptsDir()` 并把两个默认路径指向该目录；`diagnostics.ts`/`setup-external.sh` 指引更新；
  新增回归测试断言默认路径存在且可执行（防再次指向不存在的脚本）。
  注：**faster-whisper / sherpa-onnx 的 venv 仍需手动安装**（依赖较重），但脚本缺失这一层已消除，报错会指向真实原因。

### G2（P1，功能性）记忆的 LLM 会话提取与压缩前快照钩子缺失 —— 快照部分 ✅ 已修复（2026-09-25）

- pi-tools `pi-memory/extract.ts`（worker 守卫、锁、提示词构造、结果解析、冷却、pending 队列、
  `processPendingExtracts`、`extractConversation`）与 `snapshot.ts`（`writeCompactionSnapshot`）**整体未迁移**；
  `session_before_compact`、`session_shutdown` 两个钩子也未注册。
- 已在 `PROGRESS.md` 记为延后项（"LLM 提取 extract.ts…snapshot"），my-pi 以
  「压缩摘要持久化（`store/summary*.ts`）+ `task-summarizer.mjs` + `/memory mine`」替代，属有意重构，
  但**能力不对等**：无压缩时自动提取记忆、无会话结束提取。
- 附带行为回退（**已修复**）：`snapshotBeforeCompact` 原先只在自动压缩判定路径调用 →
  **手动 `/compact` 不产生快照**。现已在 `context` 注册 `session_before_compact` 钩子覆盖所有压缩，
  并用 `snapshotDoneForCompact` 标记避免与自动路径重复快照；`reason` 增加 `'manual'`。
- **LLM 提取仍不迁移**（评估后维持）：它会为每个会话额外发起 LLM 调用（成本敏感），而 my-pi 已有
  「压缩摘要落盘 + `task-summarizer` 批量总结 + `/memory mine` 教训挖掘」的零/低增量替代路径。
  如后续确需，应作为独立特性评估（含成本开关），而不是补迁移。

### G3（P1，功能/成本）压缩暖前缀回放补丁缺失，现有实现为死代码

- pi-tools `patch-compaction-warm-prefix.mjs` 为上游 `compaction.js` 注入 `setCompactionWarmPrefixProvider`
  与 `onPayload` 桥；my-pi 的 `vendor/pi` 中**零匹配**。
- my-pi 改走扩展钩子 `before_provider_request`（`custom/features/context/index.ts`），但该事件只挂到
  主 agent 循环的 `onPayload`；压缩走 `agent.streamFunction` 直连且不带 `onPayload`，
  因此 `isSummarizationMessage` 分支**永不触发** → 暖前缀回放失效，摘要请求按全价计费。
- `custom/features/context/budget/README.md` 已记录该上游 provider 缺失并"静默降级"。
- 建议：补上游补丁（或让 SDK 把 `onPayload` 转发给压缩路径）；否则删除死代码并明确标注能力缺失。

### G4（P1，内容损失）救援提示词与配置未迁移 —— ✅ 已修复（2026-09-25）

- pi-tools `agent/recovery/rescue-prompt.md`（150 行完整救援 playbook）与 `rescue-config.json` 在 my-pi 中不存在；
  `pi-supervisor.sh` 只内联 5 行指令，且未使用 `--append-system-prompt`。
- **修复**：新增 `portable/agent/recovery/rescue-prompt.md`，按 my-pi 事实改写（`vendor/pi` 只读、
  改动走 `patches/`、源码缓存 `portable/agent/recovery/cache/dist/cli.js`、`scripts/build.sh` 回退、
  `doctor.sh` + `golden --fast` 验证、`portable/memory/` 不可删、不提交）；
  `run_fix_pi` 在文件存在时以 `--append-system-prompt` 追加。
- 未迁移 `rescue-config.json`：pi-tools 用它把 `appendSystemPrompt` 路径传给 wrapper；my-pi 的
  supervisor 直接引用固定路径，无需该配置文件（保留为显式的不迁移项）。

- （原证据）pi-tools 原文大量硬编码 `~/.local/share/pi-node/node-v22.23.1-…` 与 `~/.pi/…`，
  直接复制会引入失效路径，故按 my-pi 的 `vendor/pi` + `portable/agent/recovery/cache` 模型重写。
- 崩溃分类/修复者/缓存构建逻辑本身早已迁移，本次补齐的是**提示词内容的可操作性**（证据链/路径/纪律/输出格式）。

### G5（P2，语义 + 功能）`daily-review` 种子提示词精简丢步骤，且其依赖的生命周期脚本未迁移 —— ✅ 已修复（2026-09-25）

**发现 1（提示词语义丢失）**：`scheduled-seeds.json` 的 `daily-review` 由 1638 字符降至 541 字符：
丢失 Voyager 课程/workticket 提案步骤、`memory-lifecycle` 报告步骤、其他设备长期未跑的显式提醒，以及强制的结果首行格式。

**发现 2（脚本缺口，本轮审计新发现）**：pi-tools `agent/extensions/pi-memory/scripts/memory-lifecycle.mjs`（237 行，零 LLM 只读报告）
**完全未迁移**，而 `DECISIONS.md` 的 P3 条目声称记忆治理报告已落地 —— 实际只落地了 my-pi 版 `/memory lifecycle` 命令，
该命令在 **headless 定时任务里不存在**（任务以 `--no-extensions` 运行），且实现丢失了「垃圾嫌疑」「聚合候选」两类信号
（噪声条目会混入升格候选，导致把 test 类垃圾升格为规则的旧缺陷复发）。

**修复**：

- `custom/features/memory/mine/lifecycle.ts` 补齐 `junkSuspects`（content 归一化 <30 字符 / 噪声标题）与
  `aggregationCandidates`（solutions/procedure 标题 bigram-jaccard 并查集聚类，组内 ≥3 条且 Σrecurrence ≥8），
  并让垃圾嫌疑**不进升格候选**（迁移 pi-tools 2026-08-29 的缺陷修复）；`formatLifecycleReport` 增两段。
  未迁移的 pi-tools 两类：「空壳心跳」（my-pi `MemoryEntry` 无 `tools`/`hit` 字段）、
  「环境标签冲突」（my-pi 用 `environments: string[]`，不存在 termux/wsl2 标签混用形态）。
- 新增 [scripts/memory-lifecycle.mjs](../../scripts/memory-lifecycle.mjs)（`--json` / `--limit`），经 `scripts/run-ts.sh` 调用同一份纯逻辑，
  使 headless 定时任务拿到与命令一致的确定性报告（不再让 LLM 手搓统计）。
- `daily-review` 提示词改写：步骤 5 改为调用该脚本；补回「其他设备长期未跑要明确指出」；明确淘汰/合并/聚合归纳为写操作需用户确认。
- 明确**不迁移 Voyager 课程/workticket 提案步骤**：它依赖 pi-tools 的 `SELF-OPTIMIZING-ROADMAP.md` ROADMAP 5.7 与运行时状态
  `~/.pi/logs/lesson-course.json`（两仓库均无此文件），且提示词中写的落点 `docs/OPTIMIZATION-LOG.md` 在 pi-tools 里也是错的
  （实际为 `docs/maintenance/OPTIMIZATION-LOG.md`）；my-pi 以 `/memory mine` 教训挖掘 + `task-summarizer.mjs` 批量总结 +
  `packs/drafts/` 预留目录替代，不再引入自我提案回路。

### G6（P2，配置）通知类配置未迁移 —— ✅ 已裁定取代（2026-09-25，记录见 DECISIONS）

- pi-tools `agent/notify.example.json`（模板命令通道：Bark/ServerChan 一条 curl 模板 + `rateLimitMinutes` 去重 + 静默失败，
  由 `pi-autopilot/scripts/pi-notify.sh` 驱动）与 `agent/ntfy-relay.json`（`injectMode=rpc`，手机 ntfy → 本机注入的入站通道，
  由 `ntfy-relay.js/.sh` 驱动）在 my-pi 中无对应物。
- **裁定**：出站通知由 `autopilot/store/webhook.ts`（`PI_SCHEDULER_WEBHOOK` / `settings.webhookUrl`，任务完成时 POST JSON）
  取代——Bark/ServerChan/ntfy 均提供 HTTP 端点，webhook 免去「任意 shell 模板」这一注入面；
  入站远控由 `link` 功能（SSH 通道 `link_send` + `/link watch|attach`，含文件锁与去重防抖）取代——
  依赖自有 SSH 而非第三方中继，且 tmux 故障时仍可用（正是 ntfy-relay 的 rpc 模式要解决的问题）。
  不迁移 `notify.json`/`ntfy-relay.json`。

### G7（P2/P3，潜在）上游补丁与守门覆盖

- `patch-plan-tools.mjs`（`--continue` 会话刷新新增工具 schema）无对应补丁，需运行时验证
  `plan_enter`/`plan_exit` 在续接会话中可见性；未复现前不作为功能缺陷。
- `patch-autocomplete-startswith`/`patch-fuzzy-match-type`/`patch-truncate-type`（非字符串类型守卫，LOW）
  未移植；my-pi 自家 provider 返回 `{value:string}`，风险低。
- 上游 `pi-whisper.service`、SearXNG `stop` 能力、Termux 前置脚本、tmux.conf 自动同步、
  pi-link `authorized_keys` 安装、工具统计 post-merge 钩子、CI（`.github/workflows/ci.yml` 已删）
  与 `pi-bench`/`test-recovery` 等度量脚本缺失——多数被 my-pi 的本地守门/新架构取代，
  但 **`pi-supervisor.sh` 目前零测试**，且冒烟由 9 域缩为 1 条（`golden-tasks.sh --smoke`）。
- **Windows 单目录便携部署**（`portable/start.ps1|.bat`、`portable/bin/*.ps1|.js`、`tools/tmux/tmux.cmd`、
  `ca-bundle.crt`）随 `portable/` 改作运行时数据而被移除，但**在任何决策文档中都未记录**，
  属未记录的偏离；建议补一条 DECISIONS 说明。

### G8（P3，文档陈旧）

`PROGRESS.md` 最后更新停在批次 45（commit `10322227c`，2026-09-22），
其后 **27 个提交**（含 17 个工具补齐、tmux 唤醒、plan 落盘、age 同步、模式改档位等）未记入；
建议补一轮批次记录（本轮已追加一节，见文末）。

## 六、本轮修复明细（含验证）

| 文件 | 改动 |
|------|------|
| `custom/features/autopilot/__tests__/webhook.test.ts` | 非法 `TaskType: 'prompt'` → 合法 `'cron'`（4 处），`tsc` 恢复通过 |
| [scripts/check-features.sh](../../scripts/check-features.sh) | source `lib-vendor.sh`，补丁判定改用 `vendor_patch_applied`（提交历史）优先，消除顺序叠加补丁假失败；注册面清单补全至 64 工具/11 命令（改搜整个功能目录，排除 `__tests__`）；脚本清单补 `sync-memory.sh` |
| [scripts/golden-tasks.sh](../../scripts/golden-tasks.sh) | 步骤 5 同样改用 `vendor_patch_applied` |
| `portable/agent/injection-baseline.json` | 按 AGENTS.md 有意改动刷新基线 |
| [scripts/pi-supervisor.sh](../../scripts/pi-supervisor.sh) | 包管理子命令（`install/remove/uninstall/list/update`）直通 `node "$CLI" "$@"`，不再注入 `--extension`，修复 P0 回归 |
| `.git/config` | 取消悬挂的 `core.hooksPath=.husky/_` |
| [STRUCTURE.md](../../STRUCTURE.md) | 脚本数 20→21；补 005/006 补丁；订正 002 补丁描述；订正 `modes.json`/`scheduled-seeds.json` 的跟踪状态 |
| `portable/agent/AGENTS.md` | 脚本数 18→21 |
| [README.md](../../README.md)、[docs/FAQ.md](../FAQ.md) | 模式取值 `full/light/quick` → `full/minimal/roleplay`（与 `FIXED_MODES` 一致） |
| [DECISIONS.md](../../DECISIONS.md) | docs 计数 8/10 → 9/9；订正 `deploy/tmux` 的"不迁移"陈述（实已于 2026-09-23 迁移） |
| `portable/agent/skills/pi-full-audit/MODULES.md` | 目录描述与脚本数订正 |
| `portable/agent/skills/pi-translate-zh/patch-all-zh.mjs` | `PI_DIR` 由不存在的 `portable/config` 修正为 `portable/agent` |
| [scripts/searxng-config.sh](../../scripts/searxng-config.sh) | `instance_name` 由 `.pi SearXNG` 改为 `my-pi SearXNG` |
| [patches/README.md](../../patches/README.md) | 移除 002 补丁中已删除的 Google `TOO_MANY_TOOL_CALLS` 描述 |
| [.gitignore](../../.gitignore) | `!portable/memory/stats/**` 收窄为仅放行 `tool-count-*.json`，其余运行时文件不再暴露 |

第二轮（G5/G6 语义与配置闭环）：

| 文件 | 改动 |
|------|------|
| `custom/features/memory/mine/lifecycle.ts` | 补齐 `junkSuspects`/`aggregationCandidates`（迁移 pi-tools `memory-lifecycle.mjs` 的治理信号），垃圾嫌疑不进升格候选；`formatLifecycleReport` 增两段 |
| [scripts/memory-lifecycle.mjs](../../scripts/memory-lifecycle.mjs) | 新增：headless 可用的生命周期只读报告（`--json`/`--limit`），与 `/memory lifecycle` 共用纯逻辑 |
| `custom/features/memory/__tests__/memory.test.ts` | 新增垃圾嫌疑/聚合候选用例（含"垃圾不进升格候选"回归），格式断言四段→六段 |
| `portable/agent/scheduled-seeds.json` | `daily-review` 步骤 5 改调脚本、补回"其他设备长期未跑"提醒；`knowledge-subscribe` 改零 LLM 脚本入口 |
| [scripts/check-seeds-headless.mjs](../../scripts/check-seeds-headless.mjs) | 新增守门：定时任务提示词不得引用 `--no-extensions` 下不存在的扩展工具/斜杠命令（golden 步骤 11） |
| [scripts/run-ts.sh](../../scripts/run-ts.sh)、`scripts/memory-store.mjs`、`scripts/reseed-seeds.mjs` | 新增：headless 写入记忆/知识入库入口；种子提示词改版后显式应用到已存在任务（种子对账只补缺失） |
| [DECISIONS.md](../../DECISIONS.md) | 新增「headless 定时任务的能力边界」与「通知/inbound 通道由 webhook + link 取代」两条决策 |

验证（全部通过）：

```
bash scripts/golden-tasks.sh
  ✓ 1 隔离边界   ✓ 2 功能注册面   ✓ 3 死导出   ✓ 4 类型检查   ✓ 5 单元测试（44 文件/514 用例）
  ✓ 6 补丁状态（6 个）   ✓ 7 补丁行为标记   ✓ 8 注入面基线   ✓ 9 文档链接（79 篇）
  ✓ 10 supervisor 测试（29 项）   ✓ 11 定时任务提示词（headless 可用）
  🎉 golden tasks 全部通过
bash scripts/golden-tasks.sh --smoke
  ✓ 12 无头会话冒烟（已产出回复）
./my-pi.sh list   →  No packages installed.   (exit 0)
```

## 七、建议的后续行动顺序

1. ~~**G1**：移植语音服务脚本~~ ✅ 已完成（2026-09-25，4 个脚本入 `custom/features/voice/scripts/`）。
2. ~~**G2**（快照部分）：把手动压缩纳入快照钩子~~ ✅ 已完成（2026-09-25，`session_before_compact` 钩子）；
   LLM 会话提取经评估**不迁移**（额外 LLM 调用、已有零增量替代路径）。
3. ~~**G4**：改写并接线 my-pi 版 rescue prompt~~ ✅ 已完成（2026-09-25，`portable/agent/recovery/rescue-prompt.md` + `--append-system-prompt`）。
4. ~~**G7**：补 `pi-supervisor.sh` 的最小测试；补一条 Windows 便携部署的决策记录~~ ✅ 已完成（2026-09-25）。
5. ~~**G5**：恢复种子提示词步骤；补齐未迁移的 `memory-lifecycle.mjs` 并给它 headless 入口~~ ✅ 已完成（2026-09-25）。
6. ~~**G6**：裁定通知/入站通道~~ ✅ 已完成（2026-09-25，出站 webhook + 入站 `link`，见 DECISIONS）。
7. ~~**G8**：补进度记录~~ ✅ 已完成（PROGRESS 追加批次 50）。
8. **G3**（唯一遗留）：修压缩暖前缀（成本/延迟收益明确），或删死代码。
