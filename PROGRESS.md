# 架构修复进度追踪

## 阶段状态
- [x] 阶段零：准备与冻结
- [x] 阶段一：目录结构重置
- [x] 阶段二：清理 .pi/ 下扩展
- [x] 阶段三：构建适配器层
- [x] 阶段四：迁移第一个功能（web-search）
- [x] 阶段五：迁移其余功能
- [x] 阶段六：便携化简化
- [x] 阶段七：上游同步设置
- [x] 阶段八：脚本精简
- [x] 阶段九：最终验证

## 第三轮修复（fix/skeleton-rebuild 分支）
- [x] 阶段零：准备与备份
- [x] 阶段一：清理 .pi/ 下的悬空链接与无关内容
- [x] 阶段二：重建仓库骨架
- [x] 阶段三：修复 portable/ 目录
- [x] 阶段四：文档清理与更新
- [x] 阶段五：最终验证

## 每阶段完成后在此记录

### 阶段零：准备与冻结
- 完成时间：2026-09-20
- 验证结果：脚本运行成功，发现 5 个违规项（F-01, F-04x3, F-07），符合预期
- 遇到的问题：无

### 阶段一：目录结构重置
- 完成时间：2026-09-20
- 验证结果：所有隔离边界验证通过
- 遇到的问题：check-isolation.sh 需要修复（vendor/pi 是主仓库的一部分，不是独立仓库）

### 阶段二：清理 .pi/ 下扩展
- 完成时间：2026-09-20
- 验证结果：.pi/extensions/ 已清空，隔离检查通过
- 遇到的问题：无

### 阶段三：构建适配器层
- 完成时间：2026-09-20
- 验证结果：所有隔离边界验证通过，3 个适配器已实现
- 遇到的问题：check-isolation.sh 需要允许 import type（编译后被擦除，不产生运行时依赖）

### 阶段四：迁移第一个功能（web-search）
- 完成时间：2026-09-20
- 验证结果：所有隔离边界验证通过，logic.ts 零 Pi 依赖，TypeScript 检查通过
- 遇到的问题：无

### 阶段五：迁移其余功能
- 完成时间：2026-09-20
- 验证结果：所有隔离边界验证通过
- 迁移的功能：context、link、memory、mode、plan-mode、intervention、subagent、tmux、browser、voice、autopilot
- 遇到的问题：无

### 阶段六：便携化简化
- 完成时间：2026-09-20
- 验证结果：my-pi.sh 已更新为优先使用 tsx 加载 TypeScript 源码，构建脚本仅构建 coding-agent
- 遇到的问题：无

### 阶段七：上游同步设置
- 完成时间：2026-09-20
- 验证结果：sync-upstream.sh 已配置 upstream remote，脚本已修复注释行解析，LAST_SYNC_POINT 存在
- 遇到的问题：网络 SSL 连接问题（环境问题，非代码问题）

### 阶段八：脚本精简
- 完成时间：2026-09-20
- 验证结果：scripts/ 仅保留 4 个脚本（check-isolation.sh, sync-upstream.sh, build.sh, dev.sh），无子目录
- 遇到的问题：无

### 阶段九：最终验证
- 完成时间：2026-09-20
- 验证结果：
  - TypeScript 类型检查通过（`npx tsc --noEmit -p custom/`）
  - 隔离边界验证通过（`bash scripts/check-isolation.sh`）
  - 所有 12 个功能已迁移并注册
  - 适配器层已修复（tool-adapter, hook-adapter, agent-adapter）
  - tsconfig.json 已更新（移除 include/exclude，使用 @earendil-works/pi-coding-agent 路径映射）
  - my-pi.sh 使用构建后的 dist 输出
  - patches/001-branding.patch 存在且可应用
  - vendor/pi/LAST_SYNC_POINT 存在
  - portable/ 包含 5 个数据目录
  - custom/ 下仅有 adapters/, core/, features/, bootstrap.ts, README.md
- 遇到的问题：
  - tool-adapter.ts 注释中的 `*/` 被误解析为注释结束符（已修复）
  - agent-adapter.ts 动态 import 路径需从 src/ 改为 dist/（已修复）
  - web-search/index.ts 参数名不匹配（已修复）
  - check-isolation.sh 脚本的 grep 管道问题（已修复）
  - 根目录 README.md 需要更新以反映当前实际结构（已修复）
  - custom/README.md 已重写以反映新架构

### 第三轮阶段零：准备与备份
- 完成时间：2026-09-20
- 备份目录：/tmp/my-pi-backup-20260920-120657
- 备份内容：.pi/、.github/、.husky/、.pi/skills/、根目录文件清单、符号链接清单
- 验证结果：备份完成

### 第三轮阶段一：清理 .pi/ 下的悬空链接与无关内容
- 完成时间：2026-09-20
- 验证结果：
  - ✅ .pi/scripts/ 已删除（11个符号链接，620个文件）
  - ✅ .pi/logs 和 .pi/memory 符号链接已删除
  - ✅ .github/ 和 .husky/ 已删除
  - ✅ .pi/skills/ 全部技能已删除（pi-backup、pi-full-audit、pi-translate-zh、pi-bug-diagnosis）
  - ✅ .pi/data/ 已删除
  - ✅ 根目录 data/、deploy/、docs/、packs/、pi-backup/、searxng/ 已删除
  - ✅ .pi/ 下多余目录（.snapshots、node_modules、recovery、sessions、stats）已删除
  - ✅ .pi/ 下剩余符号链接：0个
  - ✅ check-isolation.sh 全部通过
- 遇到的问题：无

### 第三轮阶段二：重建仓库骨架
- 完成时间：2026-09-20
- 验证结果：
  - ✅ scripts/ 下 4 个脚本（build.sh、dev.sh、sync-upstream.sh、check-isolation.sh），可执行、无子目录
  - ✅ package.json 含 piConfig（name=my-pi, configDir=.my-pi）
  - ✅ my-pi.sh 便携启动脚本，可执行，`./my-pi.sh --version` 返回 0.85.1
  - ✅ vendor/pi 存在；LAST_SYNC_POINT = `5afd80c65 2026-09-15 v0.85.1`
  - ✅ patches/001-branding.patch 可应用（在 vendor/pi 下 `git apply --check` 通过）
- 遇到的问题：vendor/pi 由主仓库追踪而非独立 clone（见阶段五记录与 DECISIONS.md）

### 第三轮阶段三：修复 portable/ 目录
- 完成时间：2026-09-20
- 验证结果：✅ portable/ 下 5 个目录齐全（config/sessions/extensions/skills/memory），无运行时依赖
- 遇到的问题：无

### 第三轮阶段四：文档清理与更新
- 完成时间：2026-09-20
- 验证结果：
  - ✅ STRUCTURE.md 存在并与实际结构一致（含「已知偏离」章节）
  - ✅ README.md 修正 vendor/patches 路径与默认配置路径
  - ✅ patches/README.md 重写，移除对不存在脚本的引用
  - ✅ custom/README.md 无过时描述
- 遇到的问题：无

### 第三轮阶段五：最终验证（收尾修复）
- 完成时间：2026-09-20
- 验证结果：
  - ✅ check-isolation.sh 升级为第三轮 9 项检查，`npm run check` 输出「所有隔离边界验证通过」
  - ✅ `npx tsc --noEmit -p custom/` 无错误
  - ✅ patches/001-branding.patch 重生成并可在 vendor/pi 应用
  - ✅ vendor/pi/package.json 恢复为 pristine（pi-monorepo），品牌化仅存于补丁
  - ✅ .pi/AGENTS.md 与 .pi/README.md 重写，移除 core/services/extensions/skills/scripts 符号链接/data/docs 等过时内容
  - ✅ sync-upstream.sh 增加「vendor/pi 非独立仓库则拒绝执行」保护，避免误操作主仓库
- 遇到的问题：
  - GitHub clone 超时（仅 ls-remote 可用），无法将 vendor/pi 转为独立 clone；
    为多设备同步与离线可用性，保留 vendor/pi 由主仓库追踪，已记入 DECISIONS.md

## vendor/pi 独立化（fix/vendor-independent 分支）
- 完成时间：2026-09-20
- 背景：网络恢复后确认 `earendil-works/pi-mono` 可达，且主仓库 `main` 即 canonical pi 源码
- 验证结果：
  - ✅ `vendor/pi` 为独立 git clone，HEAD = `1cdf55e64`（基线 `71dca871b` + branding + local mods + LAST_SYNC_POINT）
  - ✅ 上游 remote `upstream` = `https://github.com/earendil-works/pi-mono.git`
  - ✅ `vendor/PINNED_COMMIT` = `71dca871b`（v0.85.1）
  - ✅ 本地 pi 改动抽为 `patches/002-local-pi-mods.patch`（6 文件），可在基线应用
  - ✅ 主仓库 `.gitignore` 排除 `vendor/pi/`，已 `git rm -r --cached`（1689 文件转为未追踪）
  - ✅ `scripts/build.sh` 支持 vendor 缺失时自动引导（clone + checkout PINNED_COMMIT + 应用补丁）
  - ✅ 保留 `node_modules`/`dist`/provider 数据，`./my-pi.sh --version` 返回 0.85.1
  - ✅ `check-isolation.sh`、`npx tsc --noEmit -p custom/` 通过
- 遇到的问题：无（先前「保留主仓库追踪」的决策由 DECISIONS.md 新决策取代）

## 删除 .pi/，配置收敛到 portable/agent（方案 B）
- 完成时间：2026-09-20
- 验证结果：
  - ✅ `.pi/` 全部内容迁入 `portable/agent/`，`.pi/` 已删除
  - ✅ 跟踪：`settings.json`、`keybindings.json`、`AGENTS.md`、`APPEND_SYSTEM.md`
  - ✅ 停止跟踪并忽略：`models.json`（含 apiKey）、`models-store.json`、`auth.json`、`modes.json`、`trust.json` 及运行时状态文件
  - ✅ `.gitignore` 改为 portable 规则（config/sessions/extensions/skills/memory 仅保留 `.gitkeep` 与共享配置）
  - ✅ `check-isolation.sh` 符号链接检查适配 `.pi` 不存在
  - ✅ 文档更新：STRUCTURE/README/AGENTS/portable-config-AGENTS/DECISIONS
  - ✅ `./my-pi.sh --version`、`check-isolation.sh`、`tsc` 通过
- 遇到的问题：
  - `models.json` 之前被 git 跟踪且含 apiKey，已停止跟踪；历史中的 key 如需彻底清除需重写历史并轮换该 key

## pi-tools 内容迁移（第一批：纯逻辑模块）
- 完成时间：2026-09-20
- 来源：`https://github.com/cyfxxx/pi-tools`（`agent/` 目录）
- 迁移内容：
  - `custom/features/context/budget.ts`：上下文预算/token 估算/截断/输出预算/缓存统计（迁移自 `services/token-budget`）
  - `custom/features/context/output-archive.ts`：工具输出归档（默认写入 `portable/memory/tool-outputs`）
  - `context/index.ts` 接入真实 `ctx.getContextUsage()` 校准预算（session_start 重置、before_agent_start/after_tool_call 校准）
  - `custom/core/secrets.ts`：密钥脱敏（迁移自 `core/secrets.ts`）
  - `custom/core/atomic-write.ts`：原子 JSON 写入
  - `custom/core/note-store.ts`：笔记持久化（原子写 + 写时脱敏，数据落 `portable/memory`）
  - `custom/features/memory/logic.ts`：笔记读写改由 `note-store` 承接（不再是空实现）
  - `custom/features/subagent/logic.ts`：内置 reviewer/scout/worker 角色定义并注册（迁移自 `agent/agents/*.md`）
- 验证：
  - ✅ `npx tsc --noEmit -p custom/` 通过
  - ✅ `npx vitest run`：4 个测试文件、27 个用例全部通过（context budget/output-archive/secrets/note-store）
  - ✅ `bash scripts/check-isolation.sh` 通过；`./my-pi.sh --version` = 0.85.1
  - ✅ 新增 `npm test` 脚本
- 未迁移（按增量纪律留待后续）：autopilot/browser/link/voice/tmux/intervention/mode/plan-mode 等涉及 Pi API 编排的完整实现，以及 searxng/deploy/scripts/packs

## pi-tools 内容迁移（第二批：packs / skills / docs）
- 完成时间：2026-09-20
- 来源：`https://github.com/cyfxxx/pi-tools`
- 迁移内容：
  - `packs/`：整目录迁移（14M / 863 文件，16 个技能包 + INDEX.md/README.md），`diff -r` 校验与源完全一致；按需读取，不注入系统提示词
  - `portable/agent/skills/`：4 个技能迁移并改写为 my-pi 语境
    - `pi-backup`（备份/恢复 my-pi 仓库，重写 COMMANDS/MANIFEST，删除 pi-tools 专有的 cron/wrapper/systemd/searxng/venv 命令）
    - `pi-bug-diagnosis`（诊断纪律，路径与记忆功能引用更新）
    - `pi-full-audit`（模块化为 my-pi 结构，review.sh 重写为 my-pi 确定性检查脚本）
    - `pi-translate-zh`（patch-all-zh.mjs 新增 vendor/pi 路径解析优先候选；SKILL 路径更新）
  - `docs/`：精选迁移 8 篇并改写（FAQ、TROUBLESHOOTING、development/{PI-EXT-DEV-NOTES,PI-SDK-EXTENSION,SKILLS-MAINTENANCE}、operations/{ENVIRONMENTS,TERMUX-DEV-NOTES,alacritty-tmux-setup}），新增 `docs/README.md` 索引与来源说明
  - 丢弃 pi-tools 专有文档 10 篇（一次性报告/路线图/已消失子系统描述），清单见 `docs/README.md`
- 关键发现与修正：
  - **技能实际加载路径是 `portable/agent/skills/`**（pi 的 `agentDir/skills`），`settings.json` 的 `+skills/<name>/SKILL.md` 是相对 `agentDir` 的覆盖模式；`PI_SKILLS_DIR` 不被 pi 识别
  - `.gitignore` 为 `portable/agent/skills/` 增加白名单，技能随仓库分发
  - `settings.json` skills 数组补充 `+skills/pi-bug-diagnosis/SKILL.md`
  - 文档如实记录 `PI_SESSION_DIR`/`PI_EXTENSION_DIR`/`PI_SKILLS_DIR` 不被 pi 识别（见 STRUCTURE.md「已知偏离」）
- 验证：
  - ✅ `packs/` 与源递归 diff 无差异
  - ✅ 技能/文档语法：`bash -n review.sh`、`node --check patch-all-zh.mjs` 通过；frontmatter name 保持不变
  - ✅ 文档交叉引用全部可解析（无死链）
  - ✅ `npm run check`、`npx tsc --noEmit -p custom/`、`npx vitest run` 通过
- 未迁移：searxng/deploy/scripts 与涉及 Pi API 编排的扩展实现（仍留待后续）

## 根目录文档收敛与 VISION 迁移
- 完成时间：2026-09-20
- 根目录文档精简（9 → 6）：
  - 移除 `CHANGELOG.md`（pi-tools 迁移期日志，条目已指向不存在的 rebuild.sh/pi-wrapper.sh/setup-*.sh）
  - 移除 `CONTRIBUTING.md`（个人项目，内容与 AGENTS/portable AGENTS 重复）
  - 移除 `SECURITY.md`（上游 pi 模板，报告入口指向 earendil 安全邮箱，非本项目）
  - 保留 `README.md`、`AGENTS.md`、`STRUCTURE.md`、`DECISIONS.md`、`PROGRESS.md`、`LICENSE`
- VISION 迁移与更新：pi-tools `docs/design/VISION.md` → `docs/design/VISION.md` v2.0
  - 保留 §1–§3（终极目标、三大核心功能判据、软硬结合方法论）与 §5（记忆治理规则）
  - §4 度量体系由 pi-tools「全部已落地」改写为 my-pi 真实差距：度量层整体缺失（无 usage/cache 统计、无干预落盘、无任务遥测、无 golden tasks、记忆无治理字段）
  - §5 明确标注为**目标设计**（当前 note-store 为简单键值）
  - 新增 §6 落地路线（P0 已完成 → P1 度量基建 → P2 防退化 → P3 记忆生命周期 → P4 升格通道），替代 pi-tools 的 `SELF-OPTIMIZING-ROADMAP.md`
- 引用同步：
  - `docs/FAQ.md` 的「如何贡献代码」改为「如何添加第三方扩展 / 如何自己改功能」（含 install 落点与 `-l` 禁用理由）
  - pi-backup（COMMANDS/BACKUP-MANIFEST）与 pi-full-audit（CHECKLIST/MODULES/WORKFLOW）的仓库文档清单移除三个已删文件
- 核实事实（写入文档）：
  - 会话实际存放 `<agentDir>/sessions/<转义 cwd>/` = `portable/agent/sessions/--root-my-pi--/`；`PI_SESSION_DIR` 无效，正确变量是 `PI_CODING_AGENT_SESSION_DIR` 或 `--session-dir`
  - 第三方扩展落点：`portable/agent/extensions/`（自动发现）、`portable/agent/npm/node_modules/`（npm）、`portable/agent/git/<host>/<path>`（git），来源记入 `settings.json` 的 `packages`
- 验证：文档无死链；`npm run check`、`npx tsc --noEmit -p custom/`、`npx vitest run` 通过

## 删除 portable 占位目录，统一运行时数据到 agentDir
- 完成时间：2026-09-20
- 删除零引用占位目录：`portable/skills/`、`portable/extensions/`、`portable/sessions/`（各仅含 `.gitkeep`；pi 不读取，代码无引用）
- 启动器修正（`my-pi.sh`、`scripts/dev.sh`）：移除无效的 `PI_SESSION_DIR`/`PI_EXTENSION_DIR`/`PI_SKILLS_DIR` 导出与 `mkdir`，只保留 `PI_CODING_AGENT_DIR`（pi 识别）与 `PI_MEMORY_DIR`（`custom/core/note-store.ts` 识别）
- `.gitignore`：移除三个目录的忽略规则，保留 `portable/agent/*` + 白名单（含 `skills/`）与 `portable/memory/*`
- 会话保持 pi 默认位置 `portable/agent/sessions/`（未启用 `--session-dir`；现 2 个会话文件 3.9 KB 无需迁移）
- 文档同步（17 处引用）：STRUCTURE（portable 章节、数据流向、已知偏离重写）、portable/agent/AGENTS、README（目录树与数据映射表）、docs/{FAQ,TROUBLESHOOTING,ENVIRONMENTS,PI-EXT-DEV-NOTES}、pi-backup（SKILL/COMMANDS/BACKUP-MANIFEST）、pi-full-audit（CHECKLIST/MODULES/RUNTIME-CHECK/review.sh）
- review.sh：去重会话排除项，补齐 `portable/agent/{npm,git}` 的运行时数据排除与追踪检测
- 收敛后的规则：agent 的配置/技能/会话/扩展都在 `portable/agent/`（agentDir）下，`portable/memory/` 只放 my-pi 自定义功能数据
- 验证：`bash -n review.sh` 通过；文档无死链；`npm run check`、`npx tsc --noEmit -p custom/`、`npx vitest run` 通过

## agentDir 改名与 custom 层接线修复
- 完成时间：2026-09-20
- 起因：`agentDir` 按 pi 约定同时承载配置/技能/会话/扩展，与文档中"config 只放配置"的旧描述冲突
- 改名：`portable/config` → `portable/agent`（`git mv`，28 个跟踪文件；auth/models/sessions 等运行时文件随目录迁移）
- 引用同步：`.gitignore`、`my-pi.sh`、`scripts/dev.sh`，以及 docs/技能/根文档共约 30 个文件（含 `patch-all-zh.mjs` 的 `REPO_ROOT/portable/config`）
- 修复缺陷：
  - **D1** `custom/core/config.ts`：`getConfigDir` → `getAgentDir`；`skills/sessions/extensions` 挂到 agentDir 下；`ensureDirectories()` 由"目录不存在则抛错"改为创建 agentDir 与 memory（此前引用已删除目录，必然崩溃）
  - **D2** 删除 `custom/adapters/agent-adapter.ts`：以扩展方式运行时 session 由 pi 自身创建，该适配器无人使用，且 `cwd: sessionDir` 语义错误、`extensionDir/skillsDir/memoryDir` 参数从未被使用
  - **D3** `custom/bootstrap.ts` 改为**默认导出**扩展工厂 `(pi) => void`：pi loader 取默认导出并要求是函数（`loader.ts` 的 `jiti.import(path, { default: true })`）。此前为具名导出，实测报 `does not export a valid factory function` 且 `./my-pi.sh` 退出码 1——**12 个功能此前一个都没加载**
  - **D4**（连带发现）`tool-adapter.ts` 的 `parameters` 由普通对象改为编译成 TypeBox object schema（pi 的 `ToolDefinition.parameters` 要求 `TSchema`）；`web_search.maxResults` 标记为 optional
- 验证：
  - `./my-pi.sh -p "..."` 实际启动：12 个功能全部注册成功，退出码 0
  - 工具可被模型调用并可执行：`web_search` 被实际调用并返回结果（因本机无 SearXNG 返回网络错误，属预期）
  - `npx tsc --noEmit -p custom/`、`npm run check`、`npx vitest run`（27 用例）全部通过

## 删除 custom 构建产物
- 完成时间：2026-09-20
- 删除 `custom/dist/`（07:17 的旧编译产物，含已删除的 `agent-adapter.js`，曾误导排查）
- `scripts/build.sh`：移除 custom 编译步骤，只构建 vendor/pi；补注释说明 custom/ 由 pi 的加载器直接加载 TypeScript
- `custom/tsconfig.json`：移除已无意义的 `outDir`（`dist-custom`）与 `rootDir`，保留 `noEmit: true`（本文件只用于类型检查）
- 文档/技能同步：STRUCTURE、portable/agent/AGENTS、FAQ、pi-backup（SKILL/COMMANDS/BACKUP-MANIFEST，含"构建阶段"表与进度报告模板）、pi-translate-zh、pi-full-audit/CHECKLIST
- 决策：旧决策「my-pi.sh 使用构建产物而非 tsx」的前提不成立（TS 支持来自 pi 自带的 jiti，非 tsx），已在原条标注取代
- 验证：删除后 `./my-pi.sh` 仍正常启动并注册 12 个功能；`npx tsc --noEmit -p custom/`、`npm run check`、`npx vitest run` 通过
## 功能逐步移植（第 1 批：intervention / context / web-search）
- 完成时间：2026-09-21
- 原则遵循：`logic.ts` 零 Pi 依赖；Pi API 只经 `custom/adapters/`；数据落 `portable/memory`；按需移植 pi-tools 纯逻辑并补测试
- intervention（完整迁移，对应 VISION P1 干预捕获）：
  - `logic.ts`：abort 快照构造/JSONL 落盘/corrective prompt 关联/统计（迁移自 pi-tools `pi-intervention/{types,helpers}.ts`）
  - `index.ts`：`before_agent_start`/`tool_execution_start`/`input`/`agent_end` 四钩子 + `/intervention recent|stats|help`
  - 数据文件：`portable/memory/interventions.jsonl`
- context（纯逻辑 + 运行时接线）：
  - `prune.ts`：工具输出分层擦除 / thinking 预算剪枝 / refs 清理（迁移自 `services/token-budget/prune.ts`）
  - `auto-compact.ts`：窗口比例压缩阈值 + 防抖判定 + 压缩后自动继续门（迁移自 `services/token-budget/auto-compact.ts`）
  - `index.ts` 新增 `context`（去重 compactionSummary + 分层擦除）、`tool_result`（输出预算截断）、`turn_end`（自动压缩判定）、`session_compact`（自动继续）
  - 修复：`readBodyLimited` 等价函数（web-search）单块超 cap 漏报截断
- web-search：新增 `fetch_url`（HTTP GET，协议白名单/超时/512KB 上限）、`web_fetch`（Bing fallback）工具，工具面 1 → 3
- 测试：新增 intervention(5)/prune+auto-compact(13)/fetch(7)，vitest 由 27 → 71 用例
- 验证：`npx tsc --noEmit -p custom/`、`npm test`（8 文件 71 用例）、`scripts/check-isolation.sh`、`scripts/check-features.sh` 全通过
- 未完成（后续批次）：memory（storage/retrieval/merge/tools）、subagent（runner/renderer）、tmux（core/watcher）、link（config/state/outbox/card）、mode（apply/thinking）、plan-mode（store/overlay）、autopilot（scheduler/failover）、voice（recording/TTS）、browser（playwright impl）

## 功能逐步移植（第 2 批：tmux / mode）
- 完成时间：2026-09-21
- tmux（工具型，工具面 0 → 6）：
  - `logic.ts`：tmux CLI 封装（execFile argv 无注入）、会话名规范化、日志尾部读取/单代轮转、注册表（写前重读）、三态探测、wait 轮询、shutdown 清理（迁移自 `pi-tmux/{core,config}.ts`）
  - `index.ts`：注册 `tmux_run/status/read/send/stop/wait` + `session_shutdown` 清理钩子
  - 数据落点：日志 `portable/memory/tmux/`，注册表 `portable/memory/tmux-registry.json`
  - 未迁移：pi-tools 的 Windows 原生模拟后端（my-pi 目标为 Linux/Termux）
- mode（命令型，改为读写真实 modes.json）：
  - `logic.ts`：`modes.json` 读写 + `applyModeRuntime`/`needsRestart`（迁移自 `pi-mode/{types,config,apply}.ts`）
  - `index.ts`：`/mode <list|name|help>` 真实切换 + 思考级别立即生效（`ui-adapter` 新增 `get/setThinkingLevel`）+ session_start 提示
  - 移除旧的硬编码 MODES 与 `setActiveTools` 伪造逻辑
- 测试：新增 tmux(8)/mode(5)，vitest 由 71 → 85 用例
- 验证：`tsc`、`npm test`（10 文件 85 用例）、`check-isolation.sh`、`check-features.sh` 全通过
- 未完成（后续批次）：memory、subagent、link、plan-mode、autopilot、voice、browser

## 功能逐步移植（第 3 批：memory）
- 完成时间：2026-09-21
- 范围：pi-memory 核心（存储/检索/消解/注入）+ 5 工具 + /memory 命令（VISION P3 记忆生命周期基础）
- 新增模块（均纯逻辑，零 Pi 依赖）：
  - `types.ts`：MemoryEntry/SummaryEntry/Stats 等（含 recurrence/confidence/environments/validUntil/links/contentHash 治理字段）
  - `env.ts`：Termux/WSL2/Linux/macOS/Windows 运行环境检测与按环境可见性过滤
  - `storage.ts`：entries/summaries/notes 持久化（原子写 + 写前重读合并 + 写时脱敏 + 损坏备份 + 内容哈希去重 + 软删/剪枝 + 注册表风格统计 + 双向链接）
  - `retrieval.ts`：BM25 + 质量分混合检索、MMR 多样性、跨会话 round-robin、bi-temporal 回溯、检索台账
  - `merge.ts`：Mem0 ADD/UPDATE/DELETE/NOOP 规则消解 + 矛盾检测（语义反转 → superseded）
  - `inject.ts`：每轮注入块（token 预算 + 无时间戳，缓存前缀稳定）
  - `logic.ts`：统一再导出
- `index.ts`：`memory_store/search/recall/stats/forget` 5 工具 + `/memory` 命令 + session_start/before_agent_start(注入)/context(过滤)/session_compact 钩子
- `tool-adapter.ts` 扩展：支持 `string[]` 与 `enum` 参数（schema 编译）
- 测试：新增 memory 15 用例，vitest 由 85 → 100 用例
- 验证：`tsc`、`npm test`（11 文件 100 用例）、`check-isolation.sh`、`check-features.sh` 全通过
- 未迁移（后续）：LLM 提取 extract.ts、ctx_* 工具（exec-sandbox/checkpoint/notes）、snapshot
- 未完成（后续批次）：subagent、link、plan-mode、autopilot、voice、browser

## 功能逐步移植（第 4 批：link）
- 完成时间：2026-09-21
- 范围：pi-link 多设备互联（纯逻辑 + SSH/RPC + 工具 + 命令）
- `logic.ts`（纯逻辑，零 Pi 依赖）：设备配置读写与加固校验（host/user 拒绝 `-` 开头/空白）、设备卡片构建/校验、局域网 IP 打分选卡（含 WSL2 ipconfig 解析）、并发去重 guards、状态/活跃文件（带 `.lock` 互斥）、信箱环形缓冲、帮助文本。数据落点 `portable/agent/pi-link*.json`，`PI_LINK_STATE_DIR` 可重定向
- `link.ts`：SSH 链路核心（`probeDevice`/`sendToDevice`/`remoteExec`/`readRemoteState`/`watchRemote`/`readRemoteOutbox`/`attachToRemote`、指令模板、会话连续性握手、多地址 failover、AbortSignal 取消）
- `index.ts`：工具 `link_send`/`link_status` + `/link send|status|watch|inbox|export-card|import-card|attach|help` + 状态钩子（input/turn_start/agent_settled/agent_end）
- 安全对齐 pi-tools：远程默认 `--no-extensions`、无人值守拒绝跨设备指令、参数单引号包裹防注入
- 测试：新增 link 13 用例，vitest 由 100 → 113 用例
- 验证：`tsc`、`npm test`（12 文件 113 用例）、`check-isolation.sh`、`check-features.sh` 全通过
- 未完成（后续批次）：plan-mode、subagent、autopilot、voice、browser

## 功能逐步移植（第 5 批：plan-mode）
- 完成时间：2026-09-21
- 范围：plan-mode 任务状态机 + todo 工具 + /plan 命令 + 只读强制（核心）
- 纯逻辑（零 Pi 依赖）：`state.ts`（任务状态机/合法转移/失败记录上限）、`store.ts`（进程内状态）、`selectors.ts`（分组/计数）、`view.ts`（列表/详情格式化 + plan.md 渲染/解析防污染）、`logic.ts` barrel
- `index.ts`：`todo` 工具（create/update/list/get/delete/clear）、`/plan enter|exit|clear|resume|todos|status|help`、Ctrl+Alt+P 快捷键、before_tool_call 只读强制（edit/write 禁用 + bash 只读白名单）、session_start 提示；`ui-adapter` 新增 `getAllToolNames`（退出受限模式时恢复全量工具，避免硬编码清单遗漏扩展工具）
- 测试：新增 plan-mode 11 用例，vitest 由 113 → 124 用例
- 验证：`tsc`、`npm test`（13 文件 124 用例）、`check-isolation.sh`、`check-features.sh` 全通过
- 未迁移（后续）：计划文件 git 版本化、TodoOverlay、events.ts 的上下文注入/自动完成流程
- 未完成（后续批次）：subagent、autopilot、voice、browser

## 功能逐步移植（第 6 批：subagent）
- 完成时间：2026-09-21
- 范围：subagent 子代理（发现 + runner + 工具，single/parallel/chain 三模式）
- 纯逻辑（零 Pi 依赖）：
  - `agents.ts`：自实现 frontmatter 解析 + agent 发现（user=`agentDir/agents`，project=`<cwd>/.pi/agents`，readonly/tools 解析）
  - `helpers.ts`：并发控制（Termux/本地 provider 分级）、readonly 白名单收紧、风险分级 1σ/2σ/3σ、`{previous}` 占位符替换（函数替换防 `$` 注入）、字节级输出截断、SIGTERM→SIGKILL 链
  - `runner.ts`：spawn `pi --mode json -p --no-session --no-extensions`，敏感环境变量过滤、JSONL 解析、用量统计、30 分钟总超时、AbortSignal
  - `types.ts` / `logic.ts` barrel
- `index.ts`：`subagent` 工具（single/parallel/chain）+ session_start 提示可用 agent
- `tool-adapter.ts` 新增 `json` 参数类型（支持 tasks/chain 数组对象）
- 内置角色 `portable/agent/agents/{scout,worker,reviewer}.md`（迁移自 pi-tools `agent/agents/*.md`）
- 测试：新增 subagent 16 用例，vitest 由 124 → 140 用例
- 验证：`tsc`、`npm test`（14 文件 140 用例）、`check-isolation.sh`、`check-features.sh` 全通过
- 未迁移（后续）：TUI renderCall/renderResult（rendering.ts）
- 未完成（后续批次）：autopilot、voice、browser

## 功能逐步移植（第 7 批：autopilot）
- 完成时间：2026-09-21
- 范围：pi-autopilot 任务调度/存储/策略/失败自愈/遥测（核心）
- 纯逻辑（零 Pi 依赖）：
  - `types.ts`：Task/TaskStore/Config/Policy/Budget/Telemetry 等
  - `storage.ts`：任务 CRUD（写前重读 + withStoreLock 串行化）、调度表达式解析（interval/once/cron）、**内置 5 字段 cron 解析器**（pi-tools 依赖 croner，my-pi 不引入额外依赖）、指数退避重试、结果跨设备 JSONL、会话锁
  - `ops.ts`：autopilot 配置读写、admin 状态文件、遥测（按模型/任务统计 + 本地时区日界）、预算三锁、failover 选择/计划/执行、错误分类与策略决策（failover 熔断）
  - `logic.ts` barrel
- `index.ts`：工具 `autopilot_status/stats/failover`、`/auto status|stats|policy|failover|pause|resume`、`/schedule list|loop|remind|cron|edit|delete|enable|disable|preview|history|help`、兼容 `/autopilot`、session_start 摘要
- 数据落点：`portable/memory/scheduler/{tasks.json,telemetry.json,logs}`、`portable/memory/daily-results/`
- 测试：新增 autopilot 18 用例（含 cron 解析/任务存储/策略/预算/failover），vitest 由 140 → 159 用例
- 验证：`tsc`、`npm test`（15 文件 159 用例）、`check-isolation.sh`、`check-features.sh` 全通过
- 未迁移（后续）：后台执行/注入循环、watchdog 自动重启、Best-of-N verifier、seeds/sessions/notifications

## 功能逐步移植（第 8 批：browser）
- 完成时间：2026-09-21
- 范围：pi-browser 浏览器自动化（引擎 + 18 工具）
- 纯逻辑（零 Pi 依赖）：
  - `types.ts` / `config.ts`：浏览器配置（settings.json 的 `pi-browser`/`pi-web-toolkit` + `PI_BROWSER_*`/`PI_WEB_TOOLKIT_*` 环境变量）
  - `impl.ts`：`BrowserManager`（cloakbrowser/Playwright 引擎：导航/截图/点击/输入/滚动/提取/求值/穿透 Shadow DOM 定位/等待/下拉/弹窗策略/网络日志/下载/上传/PDF/cookie），含协议守卫（仅 http/https，含重定向落地校验）、上传敏感凭据黑名单、下载路径穿越防护、httpOnly cookie 脱敏
  - `index.ts`：18 个工具（`browser_navigate/screenshot/click/type/scroll/extract/evaluate/find/wait_for/network/select_option/dialog/download/upload/cookies/pdf/help/close`）+ session_start/session_shutdown 钩子
- `cloakbrowser` 采用顶层 import（my-pi 禁止内联导入）
- 测试：新增 browser 6 用例（配置解析/临时目录隔离/navigate 协议守卫/upload 敏感拒绝，均无需启动浏览器），vitest 由 159 → 165 用例
- 验证：`tsc`、`npm test`（16 文件 165 用例）、`check-isolation.sh`、`check-features.sh` 全通过
- 未迁移（后续）：patch-playwright-core（Termux android→linux 适配，属平台补丁）
- 未完成（后续批次）：voice（依赖录音/whisper 外部服务）

## 功能逐步移植（第 9 批：voice / 全部完成）
- 完成时间：2026-09-21
- 范围：pi-voice 语音（转写/TTS/配置）+ 收尾
- 纯逻辑（零 Pi 依赖）：
  - `types.ts`：CommandResult/nowStamp/runCommand/TranscribeResult
  - `config.ts`：VoiceConfig 加载（环境变量 > portable/agent/pi-voice.json > 默认）与校验/持久化
  - `tts.ts`：`cleanForSpeech`（Markdown 清洗）、`isSpeechWorthy`、`createTtsDispatcher`（串行 + 只读最新合并）、`extractAssistantText`、`speak`（termux-tts / espeak-ng+paplay）
  - `whisper.ts` / `transcription.ts`：whisper/sherpa 健康检查、服务确保（可注入 deps）、WAV POST 转写、按 backend 分派
  - `logic.ts` barrel
- `index.ts`：`voice_transcribe`/`voice_speak` 工具、`/voice on|off|status|tts|model|device|backend|language|doctor`、Ctrl+Alt+R、message_end 自动朗读
- 未迁移（后续）：录音（termux/sox）、唤醒词、诊断基准、sherpa/whisper 服务脚本（外部服务）

## ✅ 12 个功能全部完成迁移（第 1–9 批）
intervention、context、web-search、tmux、mode、memory、link、plan-mode、subagent、autopilot、browser、voice
- 架构原则保持：`features/*/logic.ts` 零 Pi 依赖；Pi API 仅经 `custom/adapters/`；运行时数据收敛 `portable/`
- 验证：`npx tsc --noEmit -p custom/`、`npm test`（17 文件 176 用例）、`scripts/check-isolation.sh`、`scripts/check-features.sh` 全通过
- 各功能仍存在原 pi-tools 的部分运行编排/外部服务依赖未迁移（详见各批次条目），但核心逻辑与注册面已对齐

## 功能移植补充（第 10 批：autopilot 执行循环）
- 完成时间：2026-09-21
- `runner.ts`：任务执行器（子进程 `pi --mode json -p --no-session --no-extensions`，JSONL 解析、用量/时长、超时熔断、敏感环境变量过滤、输出封顶）
- `index.ts`：执行循环（session_start 起每分钟 tick；到期任务经预算校验后顺序执行；成功/失败写遥测 + `updateTaskAfterRun`；失败经策略 `decide` 产出诊断提示；session_shutdown 停 tick）
- 测试：新增 runner 纯函数 2 用例，vitest 176 → 178
- 验证：`tsc`、`npm test`（17 文件 178 用例）通过
- 安全：执行循环默认受 autopilot 配置 `enabled` 与预算三锁约束；失败不自动重启（仅提示，避免意外打断）

## 功能移植补充（第 11 批：voice 录音核心）
- 完成时间：2026-09-21
- `recording.ts`：平台规格（termux m4a/需转码；linux parec wav 直出）、`startRecording`/`stopRecording`（SIGTERM→SIGKILL / termux -q、实例归属与会话锁防多实例误杀）、`queryRecording`、`convertToWav`（ffmpeg 16k mono）、`waitForFileStable`（m4a moov 尾部就绪）、`cleanupStaleAudio`、`detectAudioLevel`、`deleteAudioPair`/`fileExists`
- `index.ts`：新增 `voice_record` 工具（start/stop/status，stop 后转码返回 wav 路径）
- 未迁移：Windows dshow 录音、唤醒词、诊断基准
- 测试：新增 recording 6 用例，vitest 178 → 184
- 验证：`tsc`、`npm test`（17 文件 184 用例）、`check-isolation.sh`、`check-features.sh` 通过

## 功能移植补充（第 12 批：voice 唤醒/诊断/Windows 录音）
- 完成时间：2026-09-21
- `recording.ts`：新增 Windows dshow 录音规格（ffmpeg dshow，stdin 'q' 优雅停止）
- `wake.ts`：KWS 唤醒监听（Linux parec 流式采音 → sherpa `/wake`；环形缓冲、采集停滞看门狗、文件滚动重启）
- `diagnostics.ts`：`doctor`（录音/ffmpeg/whisper/sherpa/TTS 检查）、`benchSuggestion`、`benchmark`（录音→转写 RTF）、`platformInstallGuide`
- `index.ts`：`/voice wake <on|off|status>`、`/voice bench`、session_shutdown 停唤醒
- 测试：新增 3 用例，vitest 184 → 187
- 验证：`tsc`、`npm test`、`check-isolation`、`check-features` 通过

## 功能移植补充（第 13 批：subagent TUI 渲染）
- 完成时间：2026-09-21
- `rendering.ts`：`getDisplayItems`/`formatToolCall`/`renderSingleResult`/`renderChainResult`/`renderParallelResult`（迁移自 pi-tools subagent/rendering.ts）
- `tool-adapter.ts`：`ToolDefinition` 新增可选 `renderCall`/`renderResult` 并透传给 Pi
- `ui-adapter.ts`：导出 pi-tui 的 `Text/Container/Markdown/Spacer/getMarkdownTheme`（功能层经适配器使用，不直接 import vendor/pi）
- `subagent/index.ts`：为 `subagent` 工具接入 renderCall/renderResult（single/parallel/chain 折叠与展开视图）
- 说明：TUI 渲染依赖运行时 pi-tui 解析（由 pi 加载器提供），vitest 无法解析故未加渲染单测；`tsc` 校验类型
- 未迁移：plan-mode TodoOverlay（交互式 overlay 组件）
- 验证：`tsc`、`npm test`（17 文件 187 用例）、`check-isolation`、`check-features` 通过

## 功能移植补充（第 14 批：browser Termux 补丁 + 脚本编排）
- 完成时间：2026-09-21
- `scripts/patch-playwright-core.mjs`：Termux 下把 playwright-core 平台判断扩展至 android（幂等 `patchSource`；适配 my-pi 的 playwright-core 1.63.0 布局，与 pi-tools 1.53.x 精确文件表不同）
- `scripts/setup-external.sh`：可选外部服务/依赖（`status`/`fd-rg`/`tmux`/`searxng`/`whisper`/`all`），对应 rebuild.sh 的外部服务阶段
- 文档：README/STRUCTURE 脚本清单更新（5 → 7）；README 外部服务段落引用 setup-external.sh
- 未迁移：rebuild.sh 的镜像加速/Node 自动升级/TUI 补丁编排/cron-systemd 安装/wrapper（wrapper 与 my-pi 直启架构不符）
- 验证：`tsc`、`npm test`（17 文件 187 用例）、`check-isolation`、`check-features` 通过

## 功能移植补充（第 15 批：plan-mode TodoOverlay）
- 完成时间：2026-09-21
- `overlay.ts`：`TodoOverlay`（ctx.ui.setWidget aboveEditor 面板；全部完成时隐藏；opencode todos 风格勾选行；宽度自适应截断防渲染崩溃）
- `selectors.ts`：补 `selectOverlayLayout`/`OverlayLayout`（此前遗漏）
- `index.ts`：todo 工具与 /plan 各子命令后刷新面板；session_start 注入 uiCtx + 刷新；session_shutdown dispose
- 测试：新增 selectOverlayLayout 2 用例，vitest 187 → 189
- 验证：`tsc`、`npm test`（17 文件 189 用例）、`check-isolation`、`check-features` 通过

## 功能移植补充（第 16 批：build.sh 编排增强）
- 完成时间：2026-09-21
- `scripts/build.sh`：
  - Node 版本前置检查（engines >= 22，缺失/过低给出升级指引）
  - 可选国内 npm 镜像（`PI_CN_MIRROR=1` 或 `PI_NPM_REGISTRY=<url>`）
  - vendor/pi 已存在时核对 `patches/*.patch` 应用状态（幂等，不改动）
  - Termux 下自动核对 playwright-core 平台补丁
- 说明：wrapper / crash-recovery / L4 源码缓存与 my-pi 直启架构不符（N.A.）；cron/systemd 离线调度由 autopilot 会话内 tick 承担，未提供独立安装脚本

## 功能移植补充（第 17 批：voice dictation 状态机）
- 完成时间：2026-09-21
- `dictation.ts`：录音/转写状态机 `createDictation`（idle→recording→transcribing；依赖注入；超时自动停止、录音进程异常退出续录/重试、假成功检测、转码重试、音量判定、即用即弃删除、cancel/cleanup）
- `index.ts`：Ctrl+Alt+R 改为听写开关（录音→转写→发送），结果经 sendUserMessage 注入；`/voice record <start|stop|cancel|status>`；session_shutdown 清理
- `recording.ts`：新增 `micLabel`
- 测试：新增 dictation 5 用例，vitest 189 → 194（18 文件）
- 验证：`tsc`、`npm test`、`check-isolation`、`check-features` 通过

## 功能移植补充（第 18 批：autopilot watchdog / verifier）
- 完成时间：2026-09-21
- `watchdog.ts`：挂死检测（lastActivity + 最新会话 mtime 双信号、busy 宽限）；`triggerHangRecovery` 写重启请求
- `index.ts`：活动信号钩子（turn_start/turn_end/agent_settled/input）+ tick 内挂死提示（my-pi 无 wrapper，仅提示不自动重启）
- `verifier.ts`：`parseJudgeScores`/`selectBest`/`shouldVerify`/`ProgressTracker`/`bestOfN`（生成与评分注入，未提供评分 fail-open）
- `verifier-logger.ts`：JSONL 记录 + `summarize` 聚合（落 `portable/memory/scheduler/`）
- `types.ts`：补 `VerifierConfig`/`defaultVerifierConfig`
- 测试：新增 watchdog/verifier 5 用例，vitest 194 → 199
- 验证：`tsc`、`npm test`（18 文件 199 用例）、`check-isolation`、`check-features` 通过

## 自主迭代（第 19 批：P1 度量基建 + P2 防退化）
- 完成时间：2026-09-21（用户离开期间自主推进，目标对齐 VISION §6）
- P1 度量基建：
  - `context/usage-stats.ts`：工具 token/缓存读写持久化（`portable/memory/context/usage.jsonl`，`PI_USAGE_FILE` 可覆盖），`summarizeUsage` 产出命中率/今日成本/高频工具
  - `context/index.ts`：`tool_result` 钩子记录用量；`/usage-diag` 追加持久化统计
  - 至此 VISION §4 三项判据（干预率/token 成本/缓存命中率）均可测量
- P2 防退化：
  - `scripts/check-injection-surface.sh`：system prompt 注入面前缀指纹基线（`portable/agent/injection-baseline.json`，`--update` 更新）
  - `scripts/golden-tasks.sh`：聚合隔离/注册面/类型/单测/补丁/注入面（`--smoke` 无头冒烟）
  - `npm run golden` 入口
- 文档：VISION §4/§6 状态更新；README/STRUCTURE 脚本清单 7→9
- 测试：新增 usage-stats 4 用例，vitest 199 → 203（19 文件）
- 验证：`npm run golden` 六项全通过；`tsc`/`check-isolation`/`check-features`/`npm test` 通过

## 自主迭代（第 20 批：P3 记忆生命周期只读报告）
- 完成时间：2026-09-21（自主推进）
- `features/memory/lifecycle.ts`：`analyzeLifecycle`（淘汰候选：>180天未访问且引用≤1且置信度<0.7；升格候选：solutions/fact 且 recurrence≥5；冲突嫌疑：同类别标题 bigram-jaccard≥0.5；规模/陈旧度）+ `formatLifecycleReport`
- `memory/index.ts`：`/memory lifecycle` 子命令（只读，不做写操作）
- 文档：VISION §6 P3 状态更新
- 测试：新增 lifecycle 2 用例，vitest 203 → 205
- 验证：`npm run golden` 通过；`tsc`/`check-isolation`/`check-features`/`npm test` 通过

## 自主迭代（第 21 批：P3 教训挖掘 → 入库闭环）
- 完成时间：2026-09-21（自主推进）
- `features/memory/lesson-miner.ts`：读取 interventions.jsonl 的纠正意图，生成教训候选（跳过无纠正、按内容哈希与标题去重）；`candidateToEntry` 转记忆条目；`formatLessonReport`
- `memory/index.ts`：`/memory mine [--ingest]`（默认只读报告；--ingest 经 `storeEntry` 写入并自动去重）
- 文档：VISION §6 P3 标记完成
- 测试：新增 lesson-miner 2 用例，vitest 205 → 207
- 验证：`npm run golden`、`tsc`、`check-isolation`、`check-features`、`npm test` 通过
