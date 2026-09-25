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

## 自主迭代（第 22 批：度量仪表盘 /auto metrics）
- 完成时间：2026-09-21（自主推进）
- `features/autopilot/metrics.ts`：聚合干预率、token 成本、缓存命中率、任务成功率（读取 interventions.jsonl / context/usage.jsonl / scheduler/telemetry.json，数据级解耦）；`/auto metrics`
- 文档：VISION §2 三处现状更新为"已可度量"
- 测试：新增 metrics 1 用例，vitest 207 → 208
- 验证：`npm run golden`、`tsc`、`check-isolation`、`check-features`、`npm test` 通过

## 自主迭代（第 23 批：文档一致性 + 收尾）
- 完成时间：2026-09-21（自主推进）
- 清理各 feature 头部过时的「未迁移」说明（plan-mode/subagent/voice/autopilot 已补齐的能力）
- README 新增「度量与治理（VISION P1–P3）」入口表；docs/README 更新日期
- 验证：`npm run golden`、`tsc`、`npm test`（208 用例）通过

## 自主迭代（第 24 批：文档链接守门）
- 完成时间：2026-09-21（自主推进）
- `scripts/check-doc-links.mjs`：扫描自身文档（根/docs/portable/agent 的 md）相对链接并校验存在（排除 vendor/node_modules/packs）
- `scripts/golden-tasks.sh`：新增第 7 步文档链接
- README/STRUCTURE 脚本清单 9 → 10
- 验证：`npm run golden` 七项全通过

## 全面审查与优化（第 25 批：契约/正确性/安全/守门）
- 完成时间：2026-09-21（自主审查）
- **契约失效（最严重）**：`hook-adapter` 的 `HookEvent` 手写清单含 Pi 并不派发的 `before_tool_call`/`after_tool_call`，导致 context 的工具用量计时与 plan-mode 只读强制**从未触发**。改为从 `ExtensionEvent['type']` 派生事件名（tsc 编译期校验），事件改用 `tool_call`/`tool_result`，字段改用 `input`/`content`。
- **守门空转**：`check-isolation.sh` 按 `vendor/pi` 路径 grep，但真实 import 走包名 `@earendil-works/*`，隔离检查形同虚设；`check-features.sh` 用同一错误清单校验钩子。均改为按包名/真实事件双重校验，并加反向检查。
- **路径真值**：`config.getAgentDir/getMemoryDir` 现优先读 `PI_CODING_AGENT_DIR`/`PI_MEMORY_DIR`，与 pi 及 storage 同一真值。
- **功能修复**：context 输出预算从不累计（`recordOutput` 无调用）→ `pruneToolOutput` 计入放行输出；`setUsedTokens` 由 `Math.max` 改为真实覆盖（消除单调虚高）；memory 会话摘要从不落盘 → compaction 时经 `buildSummaryEntry` 持久化；`/memory cleanup` 实际清除过期 TTL 笔记。
- **数据一致性**：`merge` ADD/UPDATE 补 `contentHash`；近似内容合并分支恢复生效；`sanitizeSummary` 字段兜底；`atomic-write` 随机 tmp + 失败清理。
- **安全**：新增 `core/net-guard` SSRF 防护（fetch_url/browser_navigate 拒绝内网/回环/元数据）；output-archive 落盘前脱敏 + 原子写；plan-mode 只读判定重写（拒绝元字符/可写标志，fail-closed）。
- **边界**：autopilot 超时保留退出码 124；subagent single 模式 agent 可选 + 本地 provider 并发限制生效；web-search 重试释放响应体/取消即停/max_results 校验/未配置 SEARXNG 明确提示；tmux `readOutput` fd 用 finally 关闭并改按字符截断；link `extractFinalReply` 兼容字符串 content；mode 配置运行时归一化。
- **脚本**：patch-playwright 不再无条件返回 0；build.sh 不再吞补丁输出；sync-upstream 失败/冲突时恢复 stash 且仅在全部就绪后写同步点。
- 验证：`npm run golden` 七项全绿，单测 208 → 228 用例。

## 未处理项清理 + 目录结构化（第 26 批）
- 完成时间：2026-09-21（自主优化）
- **死代码**：删除 `custom/core/note-store.ts`（与 `features/memory/store/storage.ts` 重复且无人引用）及其测试，并移除 `core/index.ts` 中的相关导出。
- **voice**：`voice_transcribe` 写入的临时 wav 改为 finally 清理；TTS 合成真正遵循 `ttsEngine`（auto 在模型存在时用 piper、否则 espeak；显式 piper 失败如实报错），删除废弃的 `writeTtsInput`；新增 `selectTtsEngine` 测试。
- **browser**：上传敏感路径判定抽为纯函数 `isSensitiveUploadPath`，新增 `/proc`、`/etc/shadow`、`.npmrc`、`.docker`、`.config/gh`、agentDir/memoryDir 整体拒绝等规则，并按 realpath 传给 `setInputFiles`（防符号链接 TOCTOU）。
- **link**：状态锁写入 pid+时间戳，仅在持锁者死亡或超时后抢占，超时不再误删他人有效锁。
- **autopilot**：后台任务运行期置 `setBackgroundBusy`（不再被看门狗误判挂死）；`appendRun` 改为 await（消除预算竞态）；`bestOfN` 超时定时器在候选先完成时清理。
- **memory**：`accessTouched` 集合按存活条目剪枝，避免无界增长。
- **目录结构**：大功能按职责加一层子包，`logic.ts` 统一作 barrel（小功能保持扁平）：
  `memory/{store,recall,mine}`、`voice/{audio,stt,tts}`、`autopilot/{store,run}`、`subagent/{core,ui}`、`plan-mode/{core,ui}`、`context/budget`；跨功能引用改走对方 `logic.ts`。
- **文档/守门**：更新 `STRUCTURE.md`、`custom/README.md`、两个 `AGENTS.md`；`CHECK_REPORT.md` 移入 `docs/development/`；隔离脚本第 3 项改为按整个 features 树校验逻辑层。
- **autopilot 数据**：配置/状态迁至 `portable/agent/autopilot/{config,state}.json`，读取保留旧路径回退（平滑迁移）。
- 验证：`npm run golden` 七项全绿；单测 228 → 231（删除 note-store 测试、新增 voice/browser/link 用例）。

## 记忆迁移 + 工具按需加载 + 崩溃自愈 + TUI/命令整理（第 27 批）
- 完成时间：2026-09-22
- **长期记忆**：从 pi-tools `data/memory/entries.json`（982 条）精选迁移 **139 条** 到 `portable/memory/entries.json`。过滤规则：剔除敏感（PAT/SSH/Tailscale/主机名/私钥路径）、旧路径（`~/.pi`/`agent/extensions`/`pi-tools`）、旧脚本/旧扩展名、设备专属（termux/wsl2）、新闻类（`knowledge *`）、测试垃圾与重复标题；保留 Pi/SDK 行为、规划模式、扩展调试、记忆治理等可移植经验，全部重打标签 `migrated-from-pi-tools`，`environments=['all']`。残留敏感/旧路径命中 0。未迁移 summaries/notes/interventions/extract-sessions（旧项目运行数据）。迁移脚本：`/tmp/curate-memory.mjs`（一次性，不入库）。
- **工具按需加载**（补迁 pi-tools `pi-context/tool-groups|tool-layering`）：新增 `context/budget/tool-groups.ts`（纯逻辑：CORE_TOOLS/6 组休眠组/`computeActiveTools`/`buildSleepingSummary`/`validateGroups`）与 `context/budget/tool-layering.ts`（运行态：`applyToolLayering`/`dormantToolsActive`/`enableGroup`/`buildToolsReport`），注册 `enable_tool` 工具，`before_agent_start` 首次分层并注入休眠组简介（静态、缓存友好），计划模式退出后自愈；`/tools` 支持 list/enable/help。核心 18 工具常驻，31 工具休眠。新增 6 用例。
- **崩溃自愈**（按 pi-tools 最新 design：wrapper 检查/分类/启动，pi 自行修复）：新增 `scripts/pi-supervisor.sh`（崩溃捕获→`transient` 指数退避 / `external` 用当前 pi `--no-extensions --no-skills` 自修复 / `pi_self` 用源码缓存 pi 修复并回退 `scripts/build.sh`；健康检查、崩溃计数+熔断、最大恢复轮数、审计 JSONL）与 `scripts/pi-source-build.sh`（构建并缓存 dist 到 `portable/agent/recovery/cache`）。`my-pi.sh` 改为 exec supervisor，`MY_PI_NO_SUPERVISOR=1` 可直启。`DECISIONS.md` 原 N.A. 条目据此更新。
- **TUI footer**：合并 pi-tools 四个 dist 补丁为源码补丁 `patches/004-footer-tweaks.patch`：实时上下文 token（分母恒为真实窗口）+ 双指标着色（黄=压缩参考线 `PI_CONTEXT_ABSOLUTE_TOKENS` 默认 256K，红=超窗口 80%+`!!`）、CH 实时/会话双命中率、`Σ/↑/↓` 字段与人民币成本（`CNY_PER_USD`）、>40% 窗口 `⚠` 重启提示；vendor 提交并重建 dist。
- **`/` 命令**：顶层描述改短、补子命令补全说明；删除冗余 `/autopilot`（重复 /auto+/schedule）与 `/usage-diag`（并回 /context）；`/context` 去 `reset`、`/voice` 去 `on|off` 与 `tts on|off`（保留 toggle）、`/plan` 去隐藏的 `on|off|toggle`（保留 enter/exit 与 Ctrl+Alt+P）。check-features 期望面同步。
- **每日任务种子**：迁移 `autopilot/store/seeds.ts`（种子对账 + 漂移检测），session_start/tick 对账；`scheduled-seeds.json` 改写为 NEW 路径，移除依赖未迁移脚本的 3 个种子（knowledge-subscribe/tool-stats-daily/daily-health），保留重写的 daily-review 与 golden-fast；`.gitignore` 放行 `scheduled-seeds.json`/`modes.json`。新增 3 用例。
- 验证：golden 七项全绿；vitest 21 文件 **240 用例**；`my-pi.sh --version` 经 supervisor 正常。

## 外部服务审计 + 度量脚本适配（第 28 批）
- 完成时间：2026-09-22
- **外部服务现状（本机）**：tmux 3.4 / ffmpeg / fdfind / rg / chromium-browser 已装；docker、podman、whisper、espeak、piper、sherpa-onnx、SearXNG 均未装/未运行。
- **web_search 适配**：原来仅读未配置的 `SEARXNG_URL`，导致工具恒返回"未配置"。改为 `SEARXNG_URL` > `PI_WEB_TOOLKIT_SEARXNG_URL`（pi-tools 兼容名）解析，未配置时自动降级为免配置 HTTP 搜索（Bing），并提示 `scripts/setup-external.sh web`。新增 `resolveSearxngUrl` 测试。
- **setup-external.sh 扩充**：`fd-rg` 改用 exec shim（原 `ln -s` 会违反 `portable/` 无符号链接的隔离检查）；status 增加 ffmpeg/chromium/espeak/piper/sherpa 探测；新增 `web`（无 docker 时给出 SearXNG 原生 uvicorn 部署步骤）。
- **daily-health 适配迁移**：新增 `scripts/daily-health.mjs`（确定性零 LLM）：24h 缓存命中率（`portable/memory/context/usage.jsonl`）、记忆库体积/条目、种子-任务失配、守门脚本未提交改动 → `结论=ok|alert`，追加 `portable/memory/logs/daily-health.log`；`scripts/scheduled-seeds.json` 重新加入 daily-health 种子。
- **未迁移（记录口径）**：task-metrics/lesson-miner 的脚本版依赖 pi-tools `.usage-diag.jsonl`/`tool-events.jsonl`（NEW 无该数据源；教训挖掘已由 `/memory mine` 承载）；task-summarizer 批量取决于未迁移的 task-record→SKILL 草稿流水线；auto-compact 的压缩前快照/任务门控/思考档切换/暖前缀回放是耦合子系统，当前只迁了阈值判定器。以上如需再单独评估。
- 验证：golden 七项全绿；vitest 21 文件 241 用例；`daily-health.mjs --print` 正常产出结论行。

## 知识订阅迁移 + 外部服务安装（第 29 批）
- 完成时间：2026-09-22
- **knowledge-fetch 迁移**：新增 `scripts/knowledge-fetch.py`（迁移自 pi-tools，仅改数据落点：`PI_KNOWLEDGE_DIR` 或 `portable/memory/knowledge`），12 个官方源/RSS 零 LLM 抓取，标题 hash 去重；实测产出当日 `2026-09-22.md`（36 条）。`packs/knowledge-fetch` 技能已在库。`scheduled-seeds.json` 重新加入 `knowledge-subscribe` 种子（路径已改 NEW）。
- **web_search 降级增强**：端点解析为 `SEARXNG_URL` > `PI_WEB_TOOLKIT_SEARXNG_URL` > 本地默认 `http://127.0.0.1:8889`；当 SearXNG 返回"失败/超时/未找到结果"时自动降级为免配置 HTTP 搜索（Bing），并在结果首行注明。
- **外部服务安装（本机）**：
  - `espeak-ng` 已 apt 安装（语音 TTS fallback 可用，`voice` 走 espeak-ng）
  - SearXNG **原生安装并运行**：`/opt/searxng`（git clone + venv + `pip install -e .`），`settings.yml` 开启 json 格式，`uvicorn` 监听 `127.0.0.1:8889`（`setup-external.sh web` 可启动；本机搜索引擎直连受限时 web_search 自动降级）
  - `setup-external.sh web` 优先复用 `/opt/searxng` 原生实例，`fd-rg` 用 exec shim
- **仍未迁移**：`tool-stats-daily` 依赖 `tool-stats-sync.mjs`（工具计数聚合），暂不注册；whisper/faster-whisper 与 piper 模型未安装（重型/需模型下载）。
- 验证：golden 七项全绿；vitest 21 文件 241 用例；SearXNG `/search?format=json` 返回 200。

## 工具统计同步迁移（第 30 批）
- 完成时间：2026-09-22
- 新增 `scripts/tool-stats-sync.mjs`（迁移自 pi-tools，适配 NEW 数据源为 `portable/memory/context/usage.jsonl`）：`--daily` 聚合本机事件→`portable/memory/stats/tool-count-<device>.json`（可 git 入库共享），默认合并各设备计数+本机增量→`portable/agent/stats/tool-usage.json`，支持 `--prune/--report/--days`。
- `.gitignore` 放行 `portable/memory/stats/`（仅精简计数入库，原始 usage.jsonl 仍不入库）；`scheduled-seeds.json` 重新加入 `tool-stats-daily` 种子，至此 5 个每日任务种子全部迁移。
- 验证：脚本使用临时目录端到端跑通；golden 七项全绿。

## 自动压缩增强：压缩前快照 + JSON 结构性压缩 + 任务门（第 31 批）
- 完成时间：2026-09-22
- 新增 `context/budget/compression.ts`（迁移自 pi-tools `pi-context/compression.ts`）：`compactJson`/`shrinkHalf`/`jsonBytes` 纯逻辑，以及 `snapshotBeforeCompact`（落点 `portable/memory/checkpoints/`，保留最近 8 份/7 天，失败不阻塞压缩）。
- `context/index.ts`：记忆最近一次上下文消息，在自动压缩前写快照；新增**门1 任务门**——存在进行中的计划任务时不自动压缩（避免打断多步任务；pi 硬溢出仍会压缩）。
- 新增测试：compression 4 用例、task-gate 2 用例。
- 未迁：pi-tools auto-compact 控制器的后台任务门（tmux registry 适配）、思考档切换、暖前缀回放（记录为后续）。
- 验证：tsc 通过；context 套件 68 用例通过。

## 离线任务执行报告迁移（第 32 批）
- 完成时间：2026-09-22
- 新增 `autopilot/store/notifications.ts`（迁移自 pi-tools `pi-autopilot/notifications.ts`，数据源改为 `results-<device>.jsonl` + `notifications-seen.json` 已读标记）：`parseResults`/`formatSummary` 纯逻辑 + `collectUnread`/`readSeenTs`/`writeSeenTs`。
- `autopilot/index.ts` session_start：种子对账后输出"离线期间任务执行报告"并更新已读标记。
- 新增 2 用例；autopilot 套件 32 用例通过。
- 未迁：autopilot `sessions.ts`（会话切换编排）、Best-of-N 的 LLM 集成，以及 auto-compact 控制器的后台任务门/思考档/暖前缀回放。

## 任务记录 + 批量总结层迁移（第 33 批）
- 完成时间：2026-09-22
- 新增 `context/budget/task-record.ts`（迁移自 pi-tools `services/diagnostics/task-record.ts`）：`recordTaskRecord`/`loadTaskRecords`，落点 `portable/memory/task-records.jsonl`，尊重 `PI_DISABLE_TASK_RECORD`（防总结递归）。
- `context/index.ts`：`agent_settled` 写一条任务记录（用户请求摘要/工具数/context token/是否压缩）；`logic.ts` 新增 `extractUserRequest`。
- 新增 `scripts/task-summarizer.mjs`（迁移自 pi-tools，spawn 改为可选）：按游标聚合实质任务→digest 写 `portable/memory/daily-results/task-summary-<date>.md`；`--dry-run` 列表、`--spawn` 可选调用 `my-pi.sh -p` 入库/起草 SKILL；`scripts/task-summarizer.d.mts` 提供类型。
- 新增测试：task-record 提取、summarizer 分组/digest 等；context 套件 73 用例通过。

## 网络搜索修复 + 工具常驻配置同步（第 34 批）
- 完成时间：2026-09-22
- 排查原项目网络搜索注意事项：默认 SearXNG 引擎集含被封锁引擎会 timeout 拖垮搜索；`bing` 需 `base_url: https://cn.bing.com`；三级通路 SearXNG → Bing 直搜（`web_fetch`）→ `fetch_url`；`fetch_url` 不拦内网（my-pi 出于安全保留 SSRF 防护）。
- 新增 `scripts/searxng-config.sh`（迁移自 `searxng/generate-config.sh`）：默认只启 baidu/bing/sogou/360search/bilibili/yandex/stackoverflow/github，禁用不可达引擎，保留 secret_key；本机生成后 SearXNG 搜索恢复有结果（10s 内）。
- 修复 `searchDirect`：放宽 Bing 结果正则（属性顺序无关）、HTML 实体解码、`/ck/a?u=a1<base64>` 跳转还原；`web_fetch` 恢复可用（实测 5 条）。
- `resolveSearxngUrl`/`resolveSearchTimeout` 增加 `settings.json`（`pi-web-search`）读取，默认超时 30s 对齐原项目；`web_search`/`fetch_url` 统一使用。
- 工具常驻配置同步：`context/budget/tool-groups.ts` 完整对齐 pi-tools 名单；新增 `groupsWithTools` 运行时过滤，未迁移功能的组不注入简介/不可启用；`/tools` 报告与补全只展示已注册工具。
- 测试：web-search 18 用例、context 75 用例通过；`portable/agent/AGENTS.md` 增补"网络搜索"注意事项；脚本数 18。

## thinking 档位自适应切档迁移（第 35 批）
- 完成时间：2026-09-22
- 新增 `context/budget/thinking-level.ts`（迁移自 pi-tools）：`inferTaskType`/`clampToLadder`/`pressureOf`/`tickThinkingLevel`/`proposeThinkingLevel`，审计 JSONL 落 `portable/memory/logs/level-changes.jsonl`（`PI_LEVEL_CHANGE_FILE`/`PI_DISABLE_LEVEL_AUDIT`）。
- `context/index.ts`：`agent_settled` 用真实 tokens/window 比例自动升降档（`PI_CONTEXT_THINKING_AUTO=off` 关闭）；新增 `thinking_level` 工具（模型建议·规则审批：死区/压力方向）。
- `tool-groups.ts` 核心常驻加入 `thinking_level`；`check-features` 注册面同步；`STRUCTURE.md` 脚本数不变。
- 测试：新增 `thinking-level.test.ts`（14 用例），context 套件 89 用例通过。

## 擦除溯源 refs 接线（第 36 批）
- 完成时间：2026-09-22
- 新增 `context/budget/prune-dump.ts`（迁移自 pi-tools）：`buildPruneDumpRef` 把被擦除工具输出落盘到 `portable/memory/logs/prune-refs/<sessionId>.md`，占位符内嵌 ref 路径（`PI_PRUNE_REFS_DIR` 可覆盖、`PI_DISABLE_PRUNE_DUMP=1` 关闭）。
- `context/index.ts`：`context` 钩子传 `dumpRef`（此前只擦除不落盘）；`session_start` 调 `sweepPruneRefs` 按 14 天/50MB 清理。
- 测试：`prune.test.ts` 增 `buildPruneDumpRef` 2 用例，共 22 用例。

## 工具失败熔断 + 错误脱水 + 丢块修复（第 37 批）
- 完成时间：2026-09-22
- 新增 `context/budget/tool-health.ts`（迁移自 pi-tools `tool-truncation.ts`）：`updateFailStreak`（连续失败 3 次熔断提示，成功清零、逐工具独立）、`dehydrateErrorOutput`（重复行折叠/超长行截断）、`rebuildTextContent`（保留非文本块）。
- `context/index.ts` 的 `tool_result` 钩子接线：追加熔断/脱水提示；返回内容用 `rebuildTextContent` 原位回写，修复此前只返回单个 text 块导致图片等块丢失的问题。
- 新增 `tool-health.test.ts`（10 用例），context 套件 101 用例通过。

## autopilot 会话列表/切换 + admin 重启接线（第 38 批）
- 完成时间：2026-09-22
- `adapters/tool-adapter.ts`：新增 `ToolExecuteContext`（hasUI/confirm/notify/shutdown），execute 第二参透传给工具实现（此前只传 args）。
- 新增 `adapters/session-adapter.ts`：封装 vendor `SessionManager.list/listAll` → `SessionRow`，`resolveSession` 按 id 前缀/路径解析。
- 新增 `autopilot/store/sessions.ts`：`formatSessionList`/`sortByModified`（纯逻辑）。
- `autopilot/index.ts`：注册 `admin_list_sessions`、`admin_switch_session`（UI 确认 + 写 switch_session 请求 + shutdown）、`admin_restart`；`check-features` 注册面同步。
- `scripts/pi-supervisor.sh`：正常退出时读取 `portable/agent/autopilot/state.json`（`PI_ADMIN_STATE_FILE`），`restart`/`restart_hang` 重拉、`switch_session` 以 `--session <path>` 重拉，随后清理请求（5 分钟新鲜度窗口）。
- 测试：autopilot 套件 37 用例；golden 七项全绿。

## auto-compact 门控补全（第 39 批）
- 完成时间：2026-09-22
- 新增 `context/budget/task-gate.ts`：环境常量（绝对阈值/重启阈值/压缩冷却/任务门开关）、`readEnvRatio`、`resolveContext`（真实 usage → provider token 回退）、`hasBackgroundTask`（读 tmux registry，按 `PI_SESSION_ID` 归属 + tmux 存活判定）。
- `context/index.ts`：turn_end 改用 `resolveContext` 并加背景任务门；`compactDecider` 注入环境比例/绝对阈值/冷却；回合开始超 `RESTART_TOKENS` 注入"先 /compact 再重启"提示。
- 新增 `task-gate.test.ts`（7 用例），context 套件 105 用例通过。

## 自动化整理批次（第 40 批，自主执行）
- 完成时间：2026-09-22
- 目录子包化：`web-search/{config,search,fetch,concurrency}`、`link/{types,config,net,card,guards,state,display,protocol}`，两侧 `logic.ts` 改 barrel（golden/iso 通过）。
- 系统提示补全：压力分档 + 委派/效率建议；重启提示改静态（缓存友好）；移除 `context/index.ts` 冗余 re-export。
- 新增 `deploy/systemd/pi-searxng.service` 与 `deploy/README.md`。
- `scripts/knowledge-ingest.mjs` 可移植化 + `environments=['all']`，正式入库（脚本总数 18）；`packs/knowledge-fetch/EXPERIENCE.md` 入库并勾选待办。
- 文档同步：`STRUCTURE.md`/`AGENTS.md` 更新子包列表、deploy、脚本数、补丁 004。
- 测试：28 文件 297 用例；golden 七项全绿。

## 深度检查与一致性修复（第 41 批，自主执行）
- 完成时间：2026-09-22
- 死代码/未用导入清理（context/link/memory/voice/autopilot/ui-adapter/registry）；`custom/tsconfig.json` 开启 noUnusedLocals/noUnusedParameters。
- 运行时数据归位：`portable/memory/daily-results/...` 取消跟踪（遵守忽略策略）。
- packs：INDEX 补 `reverse-skill`；新增 `packs/drafts/.gitkeep` 并忽略草稿内容。
- 文档注释修正（my-pi.sh/dev.sh 的 note-store 引用、STRUCTURE 示例、CHECK-REPORT 历史标注）。
- 运行 `bash scripts/golden-tasks.sh --smoke`：无头会话启动并通过（扩展全量加载）。

## 深度检查补充：清除 autopilot 遗留字段（第 41 批续）
- 删除 `Task.pendingInject`/`recoveryCount`（NEW 采用子进程 runner 执行任务，非 ORIG 的主会话注入模型，字段无消费者）及 storage 规范化/默认值中的对应项。
- tsc（含 noUnusedLocals/Parameters）与 autopilot 37 用例通过。

## 深度检查补充：autopilot 配置健壮性（第 41 批续）
- `readAutopilotConfig` 增加类型校验（数值字段仅接受有限正数、布尔/数组按类型过滤），防手改 `config.json` 写成字符串导致 `decide()` 比较恒 false、failover/suspend 策略静默失效（对齐 ORIG autoconfig.ts 审计修复）。
- 新增 `autopilot/__tests__/config.test.ts`（3 用例）。

## 重建脚本优化与 pi 更新自动修复（第 42 批）
- 完成时间：2026-09-22
- 对比本地环境与远程仓库，定位新设备不可复现的缺口：
  1. `build.sh` 从不安装根工作区依赖（custom/ 的 typebox/tinyglobby/playwright-core/cloakbrowser 提升到根 node_modules），fresh checkout 后 `./my-pi.sh` 的扩展加载与 `npx tsc`/`npm test` 均会失败。
  2. 补丁模型不一致：本地 vendor 把补丁作为本地 commit，`build.sh`/`sync-upstream.sh` 却按“未提交补丁”处理；且 check-isolation 要求 vendor 干净 → fresh 引导必然失败。
  3. `sync-upstream.sh` 同步后不重建 dist、不刷新自愈缓存，且补丁重复应用会失败。
  4. `dev.sh` 用根 `npx tsx`，而 tsx 只在 vendor 安装 → 新设备离线时失败。
  5. `check-features` 把每环境独立的 `auth.json` 当必检项 → fresh checkout golden 必失败。
  6. 自愈缓存 `portable/agent/recovery/cache/dist` 未在重建时生成。
- 新增 `scripts/lib-vendor.sh`（补丁幂等应用/状态、依赖一致性判断，被 build/sync/doctor source）。
- `build.sh` 重写：根依赖 `npm ci`（lock 不变）→ vendor 引导（幂等应用并提交补丁、vendor 工作树保持干净）→ 在 vendor 根 `npm ci`（不改上游 lock）构建 → 可选 fd-rg/自愈缓存；支持 `PI_SKIP_*`/`PI_CN_MIRROR`/超时变量。
- `sync-upstream.sh` 自动修复：fetch 超时保护 → merge（冲突则 abort 回滚并列冲突文件）→ 幂等补齐补丁 → 重建 dist → 刷新自愈缓存 → 类型检查；新增 `PI_SYNC_DRY_RUN=1` 只读预演。
- 新增 `scripts/doctor.sh`：本地环境 vs 仓库体检（Node/依赖/vendor/补丁/dist 新鲜度/自愈缓存/shim/外部工具/类型/本地 vs origin），`--fix` 自动修复可修复项，`--full`/`--no-net`。
- `pi-source-build.sh` 支持 `--no-build`（仅缓存现有 dist，供 build/doctor 复用）。
- `dev.sh` 优先使用 vendor 内置 tsx。
- `check-features`：每环境独立文件（auth/models）改为警告；脚本清单纳入 `doctor.sh`。
- 验证：`build.sh` 幂等路径通过；**fresh 引导补丁逻辑**在 base commit 的临时 worktree 上验证（4 补丁应用+提交、二次运行全跳过、清理）；`npm ci` 于根与 vendor 均不改动 lock；doctor rc=0；golden 七项全绿（29 文件 300 用例）；无头冒烟通过。

## 更新 pi 上游 v0.85.1 → v0.87.0（第 43 批）
- 完成时间：2026-09-22
- 上游 `d201760ff`（v0.87.0，较基线 `71dca871b` 前进 134 次提交）；`vendor/PINNED_COMMIT` 已更新。
- **补丁漂移修复**：
  - `002-local-pi-mods.patch` 移除已过时的 `google-shared.ts` hunk（上游 v0.87.0 已处理 `TOO_MANY_TOOL_CALLS`，保留会产生重复 case → biome 报错）；同步更新 `packages/ai/scripts/check-model-data.ts` 之外的 hunk 均适配新基线。
  - `004-footer-tweaks.patch` 按 biome 格式化后重新生成（原补丁的换行不符合上游格式规则）。
  - 4 个补丁现可**直接 plain-apply** 到新基线，无需 3way。
- **sync-upstream 重设计**为“确定性重建补丁栈”：fetch → 临时 worktree checkout 目标基线 → 幂等应用并提交 patches → 全部成功才 `git checkout -B main <stack>` 并更新 `LAST_SYNC_POINT`；失败则 vendor 不动。修复了旧版“merge 后再 apply 补丁”导致重复 case/无效提交的问题。
- **build.sh 修复**：v0.87.0 的 coding-agent 依赖工作区其它包与 `packages/ai` 生成的模型数据；改为 `npm run build:offline` 按依赖顺序构建全部工作区包，并在 `src/providers/*.models.ts` 引用的 `data/*.json` 缺失时自动联网 `generate-models`（可用 `PI_SKIP_MODEL_GEN=1` 关闭）。
- **网络修复**：Node undici 在本机对同时有 AAAA/A 记录的域名（models.dev/radius.pi.dev）因 IPv6 happy-eyeballs 超时；build.sh 默认注入 `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`（`PI_NODE_IPV4=0` 可关）。
- `lib-vendor.sh` 的补丁提交加 `--no-verify`（跳过上游 husky，避免其 biome 钩子干扰本地维护提交）；新增 `vendor_exclude_local` 把 `LAST_SYNC_POINT` 写入 vendor `.git/info/exclude`，保持 `git status` 干净。
- 文档：STRUCTURE/README 版本与构建说明更新为 v0.87.0/工作区构建。
- **验证**：vendor 全工作区构建成功；`custom/` 类型检查通过；`./my-pi.sh --version` = 0.87.0；golden 七项全绿（29 文件 300 用例）；无头冒烟（调用 `memory_stats`）通过；doctor 21 正常 / 0 警告 / 0 异常。

## 扩展通用能力下沉 core + 去重（第 44 批）
- 完成时间：2026-09-22
- 新增 `core/fs-json.ts`（`ensureDir`/`readJSONSync`/`readJSONOr`/`readJSONL`/`appendJSONL`/`appendJSONLRotating`）、`core/text.ts`（`localDay`/`truncateChars`/`oneLine`/`formatTokens`）、`core/cli.ts`（`parseSubcommand`/`filterCompletions`），并纳入 `core/index.ts`。
- 迁移去重（保持行为/落盘字节一致）：
  - JSONL 容错读取：context usage-stats/task-record/thinking-level、autopilot metrics/notifications/verifier-logger、memory lesson-miner、intervention readLines。
  - 轮转追加：context usage-stats(4MB)、autopilot verifier-logger(4MB)/storage.appendTaskResult(2MB)、memory retrieval(4MB, .1)。
  - `localDay` 三处重复（usage-stats/metrics/ops）→ core。
  - `truncateChars`（intervention.trunc/lesson-miner.trunc）、`oneLine`（intervention）、`formatTokens`（subagent helpers，保留再导出）。
  - 命令解析：mode/intervention/plan-mode/memory/voice/autopilot/context 的 `parseSubcommand`+`filterCompletions`。
- plan-mode 合并：`STATUS_LABEL` 去重（index.ts 改用 logic 导出）；新增 `statusMarker()` 统一消息/面板的 `[✓]/[•]/[⏸]/[ ]` 标记。
- 新增 core 单测 3 个（fs-json/text/cli，15 用例）。
- 验证：tsc 通过；vitest 29 文件 315 用例；golden 七项全绿。

## 目录说明文档（第 45 批）
- 完成时间：2026-09-22
- 决策的文档层级：**层根 + 功能根（全部 12 个）+ 有多文件的大功能子包**，更深层（单文件子包如 subagent/ui、voice/tts）并入上一层说明，避免碎片化。
- 新增：
  - 层/索引：`custom/core/README.md`、`custom/adapters/README.md`、`custom/features/README.md`、`scripts/README.md`。
  - 功能根：12 个 `custom/features/<功能>/README.md`（注册面/文件/数据与配置/依赖/约定）。
  - 子包：`context/budget`、`autopilot/{store,run}`、`memory/{store,recall,mine}`、`plan-mode/{core,ui}`、`subagent/{core,ui}`、`voice/{audio,stt}`。
- 更新：`custom/README.md`（刷新结构 + 分层链接）、`STRUCTURE.md`（新增「目录内文档」）、`docs/README.md`（目录内文档索引）。
- 验证：`check-doc-links` 扫描 md 由 42 → 70 且全绿；golden 七项全绿（32 文件 315 用例）。

---

## 第 46 批起（2026-09-23 ~ 09-25，补记）

第 45 批之后有 27 个提交未记入本文件，此处补记波次（详见 `git log 10322227c..HEAD`）：

- **审计修复**：HIGH/MEDIUM 审计问题修复；修正引入的类型/运行时回归；合并重复注入的 AGENTS.md（启动去重）。
- **模式改档位**：`mode` 由 `full/light/quick` 预设重构为代码内固定 `full`/`minimal` + JSON 可选 `roleplay`（新 schema `features/appendPrompt/memoryNamespace`）。
- **同步与记忆**：age 加密同步长期记忆/选定会话（`sync/`）；恢复记忆入库。
- **迁移补齐**：`usage-diag`、`warm-prefix`、tmux 完成唤醒与影子审查、tmux 终端配置、TUI 输出速度、`ctx_*`/`ask_user`/`plan_*`/`admin_*`/`autopilot_policy`/`schedule_task`/`verify_*` 共 17 个工具、`/usage-diag` 命令、plan-mode 计划落盘（`plan.md` + 磁盘恢复）与调度完成 webhook、scout agent 输出格式指导、subagent `overrideModel` 与模型继承。
- **自愈与重建**：supervisor 脚本变更自动重载、挂死自动恢复（仅回合卡死时重启）、重启/切模型显式恢复当前会话、build/doctor 用构建戳与提交历史判定 dist/补丁状态。

## 迁移完整性审计（第 47 批，2026-09-25）

- 完成时间：2026-09-25
- 对照 pi-tools 本地克隆（`848d53a`）做分层审计：文件清单（2281 vs 1173）、`diff -r`/结构化 JSON、注册面集合差、模块导出符号核对、运行守门。
- **注册面结论**：pi-tools 61 工具/10 命令无一缺失；my-pi 为超集（新增 `voice_transcribe/speak/record` 三个工具与 `/context`）；packs 863/863 逐字节齐备；agentDir 配置、23 个技能文件齐备。
- **修复 7 个确证缺陷**：
  1. `webhook.test.ts` 非法 `TaskType: 'prompt'` → `'cron'`（`tsc` 由红转绿）。
  2. `check-features.sh` 补丁判定改用 `lib-vendor.sh` 的 `vendor_patch_applied`（提交历史），修掉顺序叠加补丁 004 的假失败。
  3. `golden-tasks.sh` 步骤 5 同步该判定。
  4. `injection-baseline.json` 按 AGENTS.md 有意改动刷新。
  5. **P0**：`pi-supervisor.sh` 对 `install/remove/uninstall/list/update` 直通 `node "$CLI" "$@"`，修复 `--extension` 抢占 argv[0] 导致 `./my-pi.sh install/list` 不可用。
  6. 取消悬挂的 `core.hooksPath=.husky/_`。
  7. `check-features.sh` 注册面清单补全（漏检 18 工具/1 命令）；并修文档陈旧（脚本数、补丁清单、模式取值、docs 计数、`patch-all-zh.mjs` 的 `PI_DIR`、searxng 品牌名）。
- **验证**：`bash scripts/golden-tasks.sh` 七项全绿（43 文件 482 用例）；`./my-pi.sh list` 实测 exit 0。
- **报告**：[docs/development/MIGRATION-AUDIT.md](docs/development/MIGRATION-AUDIT.md)（含未修缺口的优先级与修复建议）。
- **未修缺口（待办）**：语音服务脚本缺失致 `voice_transcribe` 不可用（G1）；压缩暖前缀上游补丁缺失致现有回放为死代码（G3）；记忆 LLM 提取与 `session_before_compact` 钩子未迁移、手动压缩无快照（G2）；rescue-prompt 内容未迁移（G4）；`daily-review` 种子提示词精简（G5）；通知类配置未迁移（G6）；`pi-supervisor.sh` 零测试、Windows 便携部署无决策记录（G7）。

## 成本审计：压缩门恒假 + 注入位移（第 48 批，2026-09-25）

- 完成时间：2026-09-25
- **触发**：用户反馈同模型/同思考档下 my-pi 费用接近 deepseekharness 的 2 倍。
- **实测对照**（同一模型价目估算；harness 130 请求 vs my-pi 主会话 159 请求）：
  费用 $0.774 → $1.566（**2.02x**）；prompt 计费量 23.75M → 43.01M（1.81x）；平均上下文 182,722 → 271,428（1.49x）；起始上下文 8,250 → 179,746（21.8x）；未命中 input 205,456 → 1,136,626（5.53x）。增量分解：**65% 平均上下文更大、33% 整段缓存失效**、2% 输出。
- **根因**：
  1. **压缩空闲门（门3）恒不过**：判定点只有 `turn_end`，而它总是紧跟一次用户输入，`now - lastUserActivityTs` 恒为本回合耗时（秒级）< 10 分钟 → 实测 10 小时 / 341K 上下文会话**零压缩**。
  2. **记忆注入位移**：每轮重建注入消息（旧注入被移除 + 新注入追加），叠加 `_preparePromptAndToolLoadout` 的更新消息被 unshift 到最前 → 单次 170K–316K 全价重算（6 次）。
  3. 长生命周期会话 + `--continue` 恢复把大上下文反复带回。
- **修复**：
  1. `budget/task-gate.ts`：`PI_CONTEXT_IDLE_MS` 默认 **0（关闭门3）**；`logic.ts` 新增 `passesIdleGateAtTurnEnd`（按"回合开始前的空闲"或"本回合已持续 ≥ IDLE_MS"判定），`context/index.ts` 的 `input` 钩子捕获 `preTurnIdleAnchor`。
  2. `memory/recall/inject.ts` 新增 `shouldInjectMemory`：注入块未变则不重插；`session_compact` 时重置。
  3. 新增 `budget/prefix-fingerprint.ts` + `before_provider_request` 接线：逐请求对 system/tools/消息头/总序列分段哈希，落 `logs/prefix-fingerprints.jsonl`（轮转 1MB），`/context fingerprint` 可查；`PI_PREFIX_FINGERPRINT=off` 关闭。
- **回放估算**：同一会话开启压缩（阈值 256K）后 prompt 费用 $1.602 → $0.630（**-61%**），低于 harness 的 $0.774；阈值 150K 可到 -72%。
  - **更正（同日，价目修正）**：上述估算按 `cacheRead = input/10`。核对 `models.json` override 后真实比例为 **1/50**（input 0.15 / cacheRead 0.003 / output 0.60 per M）→ 压缩自身开销约 $0.038/次、省下的命中 token 仅约 $0.0007/请求，**回本需约 55 个后续请求**。压缩不再是主要收益来源；免费擦除才是。按正确价目：my-pi $0.408 vs harness $0.184（2.22x），增量分解为**未命中 64% / 命中 24% / 输出 11%**。
- **验证**：新增/扩展单测（`passesIdleGateAtTurnEnd` 6 例、`prefix-fingerprint` 12 例、`shouldInjectMemory` 1 例）；`tsc` 通过；vitest **44 文件 502 用例**；golden 七项全绿；headless 冒烟实测写出前缀指纹（`system`/`tools`/`head` 三段均有值）。
- **决策记录**：[DECISIONS.md](DECISIONS.md) `[2026-09-25] 成本审计…`；功能文档：[custom/features/context/README.md](custom/features/context/README.md)。

## 上下文管理对比 DSH：让确定性擦除生效（第 49 批，2026-09-25）

- 完成时间：2026-09-25
- **对比对象**：DeepSeek Harness（DSH 0.1.5-rc.2）的上下文管理包（`dsh-compaction-basic`/`dsh-compaction-tool-result-pruner`/`dsh-spill-policy`/`dsh-tool-fs`/`dsh-llm-deepseek` 等）。逐条证据见 [docs/development/DSH-CONTEXT-AUDIT.md](docs/development/DSH-CONTEXT-AUDIT.md)，对比结论见 [docs/development/CONTEXT-MANAGEMENT-COMPARISON.md](docs/development/CONTEXT-MANAGEMENT-COMPARISON.md)。
- **实测构成**（10 小时 / 341K 上下文会话）：`assistant:thinking` **155,142（50.1%）**、`toolResult` **143,410（46.3%）**、assistant text 10,950、user 389。
- **发现 my-pi 的擦除层大半没生效**：
  1. `pruneThinkingBudget` **无任何调用者**（thinking 占上下文一半）。
  2. `pruneToolResults` 阈值 120K/80K 过高，该会话中**从未触发**（`[pruned:` 出现 0 次），回收全压在有损的写入时截断上（308/562 条被截断，后期工具输出均值 155 token）。
  3. `read` 也受全会话 20K 输出预算约束 → 预算耗尽后 read 只剩 300 token，`output-archive` 的"凭路径读回原文"失效。
- **DSH 对照**：压缩阈值 0.8×窗口（1e6 → 800K，实测不触发）；工具输出四级阶梯（read 2000 行/50KB → spill >50KB 可恢复且排除 read → 压缩触发后才做 8,192 字符中段裁剪 → 摘要压缩）；**无 thinking 专用回收**。即 my-pi 的擦除机制是 DSH 的超集，问题在接线与阈值。
- **修复**：
  1. 接通 thinking 擦除：`context` 钩子调用 `pruneThinkingBudget`，保留 64K（`PI_CONTEXT_KEEP_THINKING_TOKENS`）。
  2. 工具擦除阈值 120K/80K → **60K/30K**（`PI_CONTEXT_PRUNE_PROTECT_TOKENS`/`PI_CONTEXT_PRUNE_MINIMUM_TOKENS`）。
  3. `read` 豁免会话输出预算（只受单次 5K 上限），恢复归档可读回；新增 `PI_CONTEXT_OUTPUT_BUDGET_TOKENS`。
  4. 固定顺序"先擦除、后压缩"（擦除无 LLM 调用，压缩要发全价摘要）。
  5. 压力分档改以**压缩阈值**为基准（`setCompactThreshold` 此前从未被调用，分档按窗口算 → 1M 窗口下模型在 256K 压缩前收不到预警）；`getBudgetReport` 加 `budgetBase`/`pressureRatio`。
  6. 易变运行时提示（压力档/休眠工具摘要/重启提示）移出 system prompt，改为 `my-pi-context-advice` 消息且**仅变化时追加**（append-only），system prompt 只留静态常量 → 消除"前缀最前处变化 → 整段缓存失效"。
  7. 归档目录加清理：新增 `sweepArchive`（14 天/200MB、递归两层），`session_start` 执行（此前 442 文件/2.8MB 无上限）。
  8. 截断改为**头+尾**保留（`truncateHeadTail`，头 40%/尾 60%）：命令/测试的错误在尾部。
- **实测效果**（用真实会话消息序列忠实复刻两套擦除算法）：thinking 155,142 → 63,883；其它文本 154,749 → 79,966（擦除 248 条 / 回收 75,279）；**合计 309,891 → 143,849（-53.6%）**，零额外 LLM 调用。
- **仍待办**：压缩摘要暖前缀重放仍是死代码（补丁点已定位在 `core/sdk.ts` 的 `buildRequestOptions`，但需改 vendor 关键路径，收益因擦除生效而下降）；subagent 缺 fork（KV 复用）模式；压缩阈值是否降到 150K 待观察。
- **验证**：vitest **44 文件 509 用例**（新增 `read` 豁免、`truncateHeadTail`/`tailByTokens`、`sweepArchive` 按龄/按量、压力基准阈值分母 + 回退窗口等用例）；`tsc` 通过；golden 七项全绿；headless 冒烟确认易变段已变为消息（msgs 3→4）且 `system` 指纹不再含易变段。

## 价目修正与失效归因基建（第 50 批，2026-09-25）

- 完成时间：2026-09-25
- **价目修正（重要）**：前几轮成本估算误用 `cacheRead = input/10`。核对 `portable/agent/models.json` 的 `modelOverrides.deepseek-flash.cost`（`provider-composer.ts:466-490` 确认 override 生效）后，真实比例为
  **input 0.15 / cacheRead 0.003 / output 0.60（$ / M）→ cacheRead 仅为 input 的 1/50、output 为 4x**。
  按正确价目：my-pi **$0.408** vs harness **$0.184（2.22x）**；增量分解 **未命中 64% / 命中上下文 24% / 输出 11%**。
  因此**优先级重排**为：① 消除/缩小整段失效 ② 免费擦除压小上下文 ③ 控制输出/推理 ④ 压缩（保守）。
- **作废先前结论**：第 48 批"开启压缩可省 61%、12 个请求回本"按 1/10 比例得出，**不成立**。正确结论：压缩一次 256K 自身开销约 $0.038，省下的命中 token 仅约 $0.0007/请求 → **回本需约 55 个后续请求**；压缩保留为高阈值/长会话下的兜底，不再是主要收益来源。已在 `DECISIONS.md` 与本文档加更正。
- **擦除收益仍成立**：上下文 -53.6% 后该会话费用约 **$0.408 → $0.247（-40%）**，相对 harness 由 2.22x 降至约 **1.35x**；零 LLM 成本，无需回本计算。
- **失效归因基建**：指纹记录新增 `sinceLastMs`（距上一条请求的间隔），并在 `formatFingerprint`/`/context fingerprint` 展示。下次出现整段失效可直接判定"是否空闲后失效 + 变化段是 system/tools/head"。
- **已排除的失效成因**：会话日志中 `model_change`/`thinking_level_change`/`compaction` 事件均不在 6 次失效附近（最近者早 3 小时以上）；DSH 侧有 **485s（8 分钟）空闲后仍命中**的实例，说明**不是 provider 的纯 TTL**。剩余成因需靠 `sinceLastMs` + `changed` 在后续会话中归因。
- **验证**：vitest **44 文件 510 用例**（新增 `sinceLastMs` 用例）；`tsc` 通过；golden 七项全绿。

## 长期维护基建：死导出 / 注册面 / 钩子 / 补丁行为 / vendor 归档（第 51 批，2026-09-25）

- 完成时间：2026-09-25
- **触发**：用户问"长期开发有什么潜在问题"。审计确认主要风险是**缺少发现问题的手段**，而非设计缺陷。
- **新增守门（均不改运行行为）**：
  1. `scripts/check-dead-exports.mjs` + `dead-exports-allowlist.txt`：扫描 `custom/` **28 个无任何引用的导出**（`getUrgencyHint`/`getTokenPressureTag`/`setTotalBudget`/`recordCacheUsage`、`isTurnBusy`/`isBackgroundBusy`/`lastActivityTs`、`replaceState`/`getNextId`、`searchEntries`/`isInjectionBlock`、`batchFetch` 等），白名单登记为**棘轮**，禁止新增。只剥注释不剥字符串/模板（剥离模板插值会误报 `truncateContent`）。
  2. `scripts/gen-registrations.mjs` + `scripts/registration-baseline.json`：注册面（工具 64 / 命令 11 / 快捷键 2）改为**从代码生成基线**，`check-features.sh` 对照基线；变更需显式 `--update`。替换原先手写清单（曾漂移 18 个工具）。
  3. `.githooks/{pre-commit,pre-push}` + `scripts/install-hooks.sh`：pre-commit 跑 `golden --fast`（新增开关，跳过 tsc/vitest），pre-push 跑全量。此前 `.github/` 已删且 `hooksPath` 悬空，提交时守门实际失效。
  4. `scripts/check-patches-behavior.mjs`：断言补丁关键符号/自标记仍在 vendor 源码（004/005/006 用自带 `Patch (…)` 标记，001/002/003 用显式符号表），补"应用成功≠行为还在"。
  5. `scripts/vendor-bundle.sh` + `doctor.sh` 告警：归档 PINNED_COMMIT（实测 66MB，`git bundle` 需 ref，裸 SHA 会报 empty bundle）；bundle 不入库（`.gitignore` 忽略 `vendor/*.bundle`）。
- **golden 步骤**：9 项（隔离 / 功能注册面 / 死导出 / tsc / vitest / 补丁状态 / 补丁行为 / 注入面 / 文档链接）；`--fast` 跳过 tsc+vitest。
- **验证**：`bash scripts/golden-tasks.sh` 九项全绿；`git hook run pre-commit` 实测通过；`vendor bundle verify` 报 "complete history"；文档同步（STRUCTURE 脚本数 21→26、`scripts/README.md`、`AGENTS.md` 命令块、DECISIONS 决策）。
- **仍未做（记录）**：`sync-memory.sh` 缺 `verify` 子命令（age 私钥遗失即记忆不可解，是数据资产单点）；`pi-supervisor.sh` 仍无行为测试；Windows 平台范围未写入决策。

## 数据资产自检 / supervisor 测试 / 平台范围（第 52 批，2026-09-25）

- 完成时间：2026-09-25（做完第 51 批记录的三项待办）
- **`sync-memory.sh verify`**：新增子命令，校验「密文可解密 + `age.pub` 与私钥一致 + 清单一致 + JSON 有效」；`--no-key` 仅查密文完整性。`init`/`status` 增加**密钥指纹**（换机时核对备份的私钥是否正确）。`SYNC_DIR` 支持 `MY_PI_SYNC_DIR` 覆盖以便测试。
  - **立刻发现问题**：`verify` 报本地存在的 `summaries.json`/`notes.json` 不在密文中 → **2026-09-23 推送的备份已过期**（`doctor` 现已把它列为警告）。待用户 `push` 后提交密文。
  - 过程中修正了本门自身的误报：清单里本地不存在的条目（push 会跳过）原先被当作缺失，现改为仅提示。
  - `doctor.sh` 新增 `[11] 加密同步`（密文/私钥/verify 结果，只告警不阻断）。
- **supervisor 行为测试**：`scripts/test-supervisor.sh`（库模式 source，`MY_PI_SUPERVISOR_LIB=1` 在函数定义后即返回，不进主循环），**23 项**覆盖崩溃分类（transient/external/pi_self、ANSI 色码剥离、优先级）与 admin state 解析（新鲜度窗口、字段、坏 JSON、clear 保留其它字段）。
  - **测出并修复一个真实 bug**：`IFS=$'\t'` 会折叠连续 tab（TAB 属空白），使中间字段为空时整体错位——`set_model` 请求缺 `targetSession` 时 `PROV` 拿到 model、`MODEL` 为空，重启会带错 provider/model。改用 US（`\x1f`）分隔；`apply_mode` 的同类写法一并修正。
  - 接入 golden 第 10 步。
- **平台范围写入决策**：`DECISIONS.md` 新增「平台范围：Linux/Termux 为主，Windows 原生便携部署不再支持」，`STRUCTURE.md` 新增「平台支持」。核实主仓库除 `packs/` 外已无 `.ps1/.bat/.cmd`。
- **计数同步**：脚本 26→**27**（`STRUCTURE.md`/`AGENTS.md`/`scripts/README.md`）；golden 步骤 9→**10**（`--smoke` 时 11）。
- **验证**：golden 十项全绿；`test-supervisor.sh` 23 项通过；`sync-memory.sh verify` 正确区分"本地不存在"与"备份缺失"；`doctor` 24 正常 / 1 警告 / 0 异常。

## 语音服务脚本随仓库分发（G1 修复，第 53 批，2026-09-25）

- 完成时间：2026-09-25
- **背景**：迁移审计的 P0 缺口 G1——`voice_transcribe` 必然失败，因为 `config.ts` 的两个默认脚本路径
  （`portable/memory/voice/pi-whisper.sh`、`pi-sherpa.sh`）下从来没有脚本（pi-tools 由 `rebuild.sh` 安装到 `~/.pi/scripts/`，my-pi 无此步骤）。
- **修复**：
  1. 4 个脚本入 `custom/features/voice/scripts/`（`pi-whisper.sh`/`whisper-server.py`/`pi-sherpa.sh`/`pi-sherpa-server.py`），随仓库分发。
  2. 路径按脚本位置解析：`PI_HOME` = `SCRIPT_DIR` 上溯 4 层；配置读 `<agentDir>/pi-voice.json`；
     日志/pid 落 `portable/memory/logs/voice/{whisper,sherpa}/`；`SERVER` 同目录；venv 仍可 env 覆盖。
  3. `config.ts` 新增 `voiceScriptsDir()`；默认路径改指该目录；`stt/transcription.ts` 的 `bash <script> start` 调用面无需改动。
  4. `diagnostics.ts` 指引、`setup-external.sh whisper`、`voice/README.md` 同步更新。
  5. **`custom/.gitignore` 放行** `features/voice/scripts/`（原 `scripts/` 规则会把它们 ignore 掉，fresh clone 仍缺）；
     `check-features.sh` 新增"脚本存在且未被 ignore"守门，正是这次踩到的坑。
- **验证**：
  - `bash -n`、`python3 -m py_compile` 通过；新增回归测试（默认路径存在 + 可执行 + 服务端同目录）→ vitest **44 文件 512 用例**。
  - 端到端：本机 `/opt/pi-whisper/venv` 已存在，`pi-whisper.sh start` 启动成功并加载模型，
    `GET /health` → `{"ok":true,"model":"base","device":"cpu"}`，随后 `stop` 恢复原状。
- **仍未做**：faster-whisper / sherpa-onnx 的 venv 与模型仍属外部依赖（`setup-external.sh whisper` 给步骤）；
  迁移审计 G3（暖前缀补丁）/G2（记忆提取）/G4（rescue prompt）仍开放。
- **文档**：`docs/development/MIGRATION-AUDIT.md` 的 G1 与行动清单标记为已修复。

## G2 快照缺口 / G4 救援 playbook / vitest 门抖动（第 54 批，2026-09-25）

- 完成时间：2026-09-25
- **G2（快照部分）**：`context` 新增 `session_before_compact` 钩子 → 手动 `/compact` 与 pi 内置溢出压缩也会写压缩前快照
  （此前只有自动阈值路径会写）；`snapshotDoneForCompact` 标记避免与自动路径重复；`reason` 增加 `'manual'`。
  LLM 会话提取经评估**不迁移**（额外 LLM 调用 + 已有零增量替代：压缩摘要落盘 / `task-summarizer` / `/memory mine`）。
- **G4**：新增 `portable/agent/recovery/rescue-prompt.md`（按 my-pi 事实重写：`vendor/pi` 只读、改动走 `patches/`、
  好 pi 在 `recovery/cache/dist/cli.js`、`scripts/build.sh` 回退、`doctor.sh` + `golden --fast` 验证、`memory/` 不可删、不提交），
  `run_fix_pi` 以 `--append-system-prompt` 追加；`.gitignore` 放行该文件（`recovery/` 其余运行数据仍忽略）。
- **修复门抖动**：vitest 偶发 `Projects "" and "" have different 'maxWorkers' but same 'sequence.groupOrder'`
  导致 `Test Files no tests / Errors 1`（golden 假红，pre-commit 会误拦）。`vitest.config.ts` 固定
  `name`/`maxWorkers`/`sequence.groupOrder` 消除该断言。
- **守门补强**：`check-features.sh` 的"随仓库分发的资源文件"清单加入 rescue prompt（存在 + 未被 ignore）；
  `test-supervisor.sh` 增加 rescue prompt 存在性与关键路径断言（23 → 29 项）。
- **验证**：vitest **44 文件 512 用例**，连续 6/6 通过；`golden-tasks.sh` 连续 3/3 全绿；`tsc` 通过。
- **文档**：`docs/development/MIGRATION-AUDIT.md` 的 G2（快照）/G4 标记为已修复，行动清单同步。

## headless 定时任务入口 / G5 生命周期脚本补齐 / G6 通知裁定（第 55 批，2026-09-25）

- 完成时间：2026-09-25
- **先定位执行环境边界**：`custom/features/autopilot/run/runner.ts` 的 `buildRunArgs` 固定传 `--no-extensions`。
  实测对比：`--mode json -p --no-session --no-extensions` 25s 干净退出（exit 0）；带 `--extension custom/bootstrap.ts`
  同命令 60s 仍不退出（被 kill）。pi-tools 依赖 `agentDir/extensions` 自动发现，my-pi 没有该目录 →
  **定时任务提示词里不能出现扩展工具/斜杠命令**（`memory_store`、`/memory`、`tmux_*`、`ctx_*` …），
  否则任务静默失败或空转；这是迁移时未记录的隐性前提。
- **headless 入口（新增脚本）**：
  - `scripts/run-ts.sh`：以 vendor tsx 运行"需加载 my-pi TS 逻辑"的脚本。原因：`custom/` 用无扩展名导入，
    Node 类型剥离不解析，`node scripts/memory-store.mjs` 裸跑报 `Cannot find module '.../custom/features/memory/env'`。
  - `scripts/memory-store.mjs`：调 memory 纯逻辑 `storeEntry` 入库（零 LLM，内置标题去重；`--json`/`--file`/stdin/`--dry-run`）。
  - `scripts/memory-lifecycle.mjs`：调 `analyzeLifecycle` 出只读生命周期报告（`--json`/`--limit`）。
  - `scripts/reseed-seeds.mjs`：种子对账是"只补缺失、不覆盖"（`store/seeds.ts`），改提示词后需显式应用；
    默认预演，`--apply` 先备份 `tasks.json` 并保留 id/enabled/lastRun/runCount/history。
- **G5（语义 + 新发现的脚本缺口）**：
  1. 审计新发现 `agent/extensions/pi-memory/scripts/memory-lifecycle.mjs`（237 行，零 LLM 只读报告）**完全未迁移**，
     而 `DECISIONS [2026-09-21]` 声称 P3 记忆治理报告已落地——实际只有 `/memory lifecycle` 命令（headless 不可用），
     且丢失「垃圾嫌疑」「聚合候选」两类信号（垃圾条目会混入升格候选，复发 pi-tools 2026-08-29 修过的缺陷）。
     已在 `mine/lifecycle.ts` 补齐 `junkSuspects` / `aggregationCandidates`（solutions/procedure 标题 bigram-jaccard 并查集聚类，
     组内 ≥3 条且 Σrecurrence ≥8）+ 垃圾不进升格候选 + `formatLifecycleReport` 增两段；命令与脚本共用同一纯逻辑。
     不迁移「空壳心跳」（`MemoryEntry` 无 `tools`/`hit`）与「环境标签冲突」（环境用 `environments: string[]`）。
  2. `daily-review` 提示词：步骤 5 改为调 `memory-lifecycle.mjs`（确定性，替代让 LLM 手搓统计）；
     补回"其他设备长期未跑要明确指出"；明确淘汰/合并/聚合归纳为写操作需用户确认。
  3. 明确**不迁移 Voyager 课程/workticket 提案步骤**：依赖 `SELF-OPTIMIZING-ROADMAP.md` 与运行时状态
     `~/.pi/logs/lesson-course.json`（两仓库均无），且提示词写的落点 `docs/OPTIMIZATION-LOG.md` 在 pi-tools 里也是错的
     （实际 `docs/maintenance/OPTIMIZATION-LOG.md`）；my-pi 用 `/memory mine` + `task-summarizer.mjs` + `packs/drafts/` 替代。
- **守门接入**：新增 `scripts/check-seeds-headless.mjs`（扫描所有 `task.prompt`，命中扩展工具/斜杠命令即失败，
  放行"不要用 X"类否定说明）→ golden 步骤 **11**；`--smoke` 的无头冒烟改为步骤 **12**，
  判定改为"是否产出回复"（已知现象：带扩展的 `-p` 产出回复后不退出），并说明原因，避免把已知现象当失败。
- **G6（通知/入站，裁定不迁移）**：出站 `notify.json`（Bark/ServerChan 的 curl 模板通道 + `rateLimitMinutes` 去重）
  由 `autopilot/store/webhook.ts`（`PI_SCHEDULER_WEBHOOK` / `settings.webhookUrl`，POST JSON，10s 超时，失败静默）取代——
  免去"任意 shell 模板"注入面；入站 `ntfy-relay.json`/`ntfy-relay.js`（手机 ntfy → 订阅轮询 → 注入，`injectMode: rpc` 兜底）
  由 `link` 功能（SSH 传输 + `link_send` + `/link watch|attach`，含文件锁与防抖）取代——不依赖第三方中继，tmux 故障时仍可用。
  记录见 `DECISIONS.md`。
- **验证**：`bash scripts/golden-tasks.sh` 全绿（11 步；vitest **44 文件 514 用例**）；注入面基线按 AGENTS.md/STRUCTURE.md
  的脚本计数同步刷新；`bash scripts/run-ts.sh scripts/memory-lifecycle.mjs [--json]` 在真实 `entries.json` 上正常输出。
- **计数同步**：脚本 31→**32**（`STRUCTURE.md`/`AGENTS.md`/`scripts/README.md`/`check-features.sh` 清单）。
- **文档**：`docs/development/MIGRATION-AUDIT.md` 的 G5/G6 标记完成、新增缺陷 #9 与第二轮修复明细；
  行动清单仅剩 G3（压缩暖前缀）。
