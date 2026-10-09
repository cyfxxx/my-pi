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

## 全量文档校订：按实现回填状态、修过期引用（第 56 批，2026-09-25）

- 完成时间：2026-09-25
- **范围**：60 篇项目自有文档（根文档 + `docs/` + `custom/**/README.md` + `scripts`/`patches`/`deploy`/`sync`/技能），
  以「文档声明 vs 代码/脚本事实」为准逐项核对。方法：抽取各功能注册面（钩子/工具/命令）与
  `scripts/registration-baseline.json` 比对；抽取文档中引用的文件与符号做存在性核对。
- **状态回填（此前文档落后于实现）**：
  - `docs/design/VISION.md`：§4 度量表「记忆治理」由**部分**改为**已有**（生命周期报告 + headless 入口）；
    §5 标注为已落地并补「垃圾嫌疑/聚合候选」规则（垃圾不进升格候选）；§6 明确 P1–P3 达成、仅 P4 未完成；
    §3.3 安全网由「27 用例 + check」改为 golden 11 步（514 用例）+ `.githooks/`；新增 v3 变更记录。
  - `docs/README.md`：更新日期；新增「审计与对比」分组（迁移审计/上下文对比/DSH 证据/历史检查报告），
    从「项目主文档」表移除重复条目。
  - `README.md`：补 005/006 补丁；scripts 段改为列出守门脚本并指向 `scripts/README.md`（32 个）；
    度量表补 headless 生命周期入口与 11 步 golden；验证段补 `--fast`/`--smoke` 与 `install-hooks.sh`。
  - `docs/FAQ.md`：备份补 `sync-memory.sh`（含 `verify --no-key`）；清理旧记忆改走只读 `memory-lifecycle`；
    性能/缓存命中率改为「先归因（`/context fingerprint`）再查注入面」；验证补 golden 与钩子。
  - `docs/TROUBLESHOOTING.md`：快速清单补 `npm run golden` 与失败判读行。
- **过期引用/缺口修复**：
  - `custom/features/context/budget/README.md` **重写**：原文档只描述 warm-prefix 且教人新建不存在的
    `adapters/warm-prefix-adapter.ts`（还用了 `any`）。现覆盖 14 个模块、关键常量与 `PI_CONTEXT_*` 环境变量、
    缓存纪律，并显式标注 warm-prefix 为死代码（指向 G3）。
  - `custom/features/context/README.md`：补 `session_before_compact` 等 4 个遗漏钩子；撤销已作废的
    「压缩可省 61%」结论（改为「压缩回本约需 55 个请求，免费擦除才是主力」）；补归档 sweep。
  - `custom/features/autopilot/README.md`：工具 6 → 16；新增 `tools/README.md`；补 headless 执行边界、
    `run-ts.sh`/`memory-store.mjs` 入口与种子对账 add-only 语义。`run/README.md` 补 `--no-extensions` 实测原因；
    `store/README.md` 补种子不覆盖语义。
  - `custom/features/voice/tts/README.md` 新增（此前 audio/stt 有、tts 缺）；`custom/features/README.md`
    模式取值 `full/light/quick` → `full/minimal/roleplay`，校验段补注册面基线/死导出/golden。
  - `custom/features/memory/README.md` 补 4 个 `ctx_*` 工具；`link/README.md` 明确「入站远控通道」定位
    （取代 pi-tools ntfy 中继）；`subagent/ui`、`voice` 的失效引用订正。
  - `patches/README.md`：目录树修正；补丁验证改为「提交历史判定 `vendor_patch_applied` + 行为标记守门」，
    并说明为何不能用 `git apply --check --reverse` 逐个判定（004/005/006 同改 `footer.ts`，顺序叠加会假失败）。
  - `sync/README.md`：补 `status`/`verify`/`verify --no-key` 与 `MY_PI_AGE_KEY`/`MY_PI_SYNC_DIR`，
    说明 verify 区分「本地不存在」与「备份缺失」。
  - `STRUCTURE.md`：子包清单补 `autopilot/tools` 与 `context/usage-diag`，`docs/` 描述补 `design/` 与审计文档。
  - `portable/agent/skills/pi-full-audit/MODULES.md`：脚本数 21 → 32。
  - `docs/development/CHECK-REPORT.md`：加「权威结论见 MIGRATION-AUDIT」指引。
- **守门缺陷（校订时发现并修复）**：`check-doc-links.mjs` 只扫到 79 篇 md，实际 88 篇 ——
  `readdirSync(..., { withFileTypes: true })` 的 **d_type 在本环境不可靠**（新建普通文件被报成 `DT_LNK`，
  `isFile()`/`isDirectory()` 均 false），导致 `rescue-prompt.md`、`alacritty-tmux-setup.md`、4 篇技能文档与
  2 篇新增 README 被静默跳过。同类写法还存在于 `check-dead-exports.mjs`、`gen-registrations.mjs`、
  `check-patches-behavior.mjs`（当前恰好无受影响文件，但命中即假绿）、`sweepArchive` 收集（归档永不清）、
  `listPlans`、`loadAgentsFromDir`（静默丢计划/角色）。四个 walker 与三处运行时判定全部改为 **`stat` 为准**，
  见 DECISIONS 的「不信任 dirent 的 d_type」。扫描数 79 → **88**，链接全绿。
- **验证**：`bash scripts/golden-tasks.sh` 全绿（含 `check-doc-links.mjs` 对新增/改动链接的校验）；
  `tsc` 通过；vitest **44 文件 514 用例**。

## packs 技能包裁剪与迁移后路径引用订正（第 57 批，2026-09-25）

- 完成时间：2026-09-25
- **裁剪技能包（用户决定，移除 28 个文件）**：
  - `wechatide-skill`（微信开发者工具，27 文件）：CLI 只在 Windows/macOS 侧运行，本项目一等目标是 Linux/Termux，
    且仅服务微信小程序/小游戏场景；
  - `repo-size-audit`（1 文件）：能力已由 `scripts/doctor.sh` + `git count-objects -vH` 覆盖，且其收尾依赖
    `memory_store` 入库（headless 不可用）。
  - 结果：`packs/` 16 包 863 文件 → **13 包 + `drafts/`，837 跟踪文件**；`INDEX.md`/`README.md` 同步
    （README 中原先误置于末尾的 `repo-size-audit`/`skill-integration` 两行一并归位，后者正式列入「当前包」）。
- **路径引用订正（packs 由 pi-tools 的 `~/.pi/packs` 变为仓库内 `packs/`）**：
  - `packs/README.md`、`knowledge-fetch/{README,SKILL,daily-prompts}.md`、`pcb-design`、`embedded-dev`、
    `gamedev`、`pdf-toolkit`、`skill-integration`、`cangjie-skill` 的 `~/.pi/packs`/`/root/.pi/...` 全部改为仓库内相对路径。
  - `knowledge-fetch`：每日任务说明改写为「权威定义在 `portable/agent/scheduled-seeds.json` + headless 脚本入口」，
    `daily-prompts.md` 标注 pi-tools v3 原文为历史归档（原文里 `memory_store`/`~/.pi/logs/` 已失效）；
    SKILL.md 第 4 步由 `memory_search`+`memory_store` 改为 `run-ts.sh scripts/knowledge-ingest.mjs`（零 LLM、内置去重）。
  - `dg-piagent`：本机 pi 版本 `0.84.2` → `0.87.0`，SDK 类型路径改指 `vendor/pi/packages/...`，新增「路径映射」说明
    （`~/.pi/agent` ↔ `portable/agent`；`agentDir/extensions` 自动发现不适用于 my-pi 自有功能）；
    修 5 处内部失效链接（`SKILLS-MAINTENANCE` 相对层级、`references→SKILL.md`、两个场景编号错位）。
  - `gamedev`：`VERSION-SUPPORT.md` 指回 `references/`，`create-game-assets` 路径由 `disciplines/` 改 `design/`，
    上游未随包分发的 `docs/SKILL-FORMAT.md` 由链接改为纯文本引用。
- **反向验证**：`diff -rq /tmp/pi-tools/packs packs` 仅剩本次有意改动与 2 处删除；其余（含 `reverse-skill` 863 文件、
  `media-toolkit`、`novel-writing`、`colab-bridge`、`comfyui-agent`）与 pi-tools **逐字节一致**。
  `reverse-skill` 内 4 处失效链接（运行时生成的 `skills/tool-index.md`、`tools/反弹shell.md`、
  `phishing-case-study.md`）在 pi-tools 中同样失效，属上游既有问题，为保持逐字节一致不改。
- **文档**：`docs/development/MIGRATION-AUDIT.md` 新增 G9 并更新 packs 相关结论（863→837、16→13 包）；
  `DECISIONS.md` 新增「移除 wechatide-skill 与 repo-size-audit」条目。
- **验证**：`golden-tasks.sh` 全绿（隔离/注册面/死导出/tsc/vitest 514/补丁/补丁行为/注入面/文档链接/supervisor/种子提示词）；
  packs 内相对链接用一次性脚本核对（`check-doc-links` 按设计排除 `packs/`）。

## 重启续接修复 / 擦除成本反转 / 重启通知注入（第 58 批，2026-09-26）

用户报告两个问题：① 模型调用重启工具后回不到原会话，且重启后无任何自动注入；② API 消耗与
DSH 相比明显异常（本机 ¥8.04 / 544 请求 / 42.3M tokens vs DSH ¥18.01 / 1765 请求 / 472.9M tokens）。

- **重启续接断裂（supervisor 主循环）**：`EXTRA_ARGS=()` 在**每轮开头**重置，而重启/切换分支在**轮末**
  写入 `--session`/`--continue` 后 `continue` → 参数被下一轮开头清空，pi 永远空参启动（新建会话）。
  改为 `EXTRA_ARGS=("${PENDING_ARGS[@]}")` + 立即清空 `PENDING_ARGS`；参数映射抽成纯函数
  `build_admin_args`（原项目 `pi-wrapper.sh` 在同一处重置+赋值，故无此问题）。
- **重启通知从未注入**：`consumeRestartLog()` 只有定义没有调用（pi-tools 在 `session_start` 消费并注入
  "系统已重启。操作: … | 原因: …"）。已在 `custom/features/autopilot/index.ts` 的 `session_start` 接线
  （`ctx.ui.notify` + `sendUserMessage`），仅交互会话消费以免 headless `-p` 子进程抢先吃掉。
- **成本归因（用本机会话记录复原真实调用序列）**：`2026-09-26T11-31-12` 会话 105 请求 / 约 250K 上下文
  / 自动压缩 1 次 = $0.645，其中 16 个请求缓存命中率 < 50%，占 **$0.481（75%）**；若按正常命中率只需 $0.048。
  离线重放（把真实会话喂给 `pruneToolResults`/`pruneThinkingBudget`，逐条比对相邻请求变换后的消息序列）
  证明根因是 **`context` 钩子每轮从未改写的历史重算擦除计划**，擦除边界随会话增长前移 →
  **每轮**都在更靠后的位置与上一轮分叉 → 其后 190K–250K token 全价重发（单次 $0.03）。
- **决策：每轮擦除默认关闭**（`PI_CONTEXT_ERASE=on` 保留旧行为）。缓存命中价是未命中价的 1/50，
  擦除 F token 每请求只省 `F×0.003/M`，断裂一次却付 `S×0.15/M` → 回本需 `49×S/F` 次后续请求
  （S=200K、F=10K → 约 1000 次），不可达。**"减少 token 数量"与"降低费用"是两个目标**，
  TUI 的 `Σ` 变小不代表花得少。回收上下文交给压缩。见 `DECISIONS.md` 同日条目。
- **验证**：`bash scripts/test-supervisor.sh` **44 项**通过（新增 `build_admin_args` 9 例 +
  用 stub CLI 跑真实主循环的端到端 6 例；把修复回退后"第二轮收到 --session"确实失败，回归有效）；
  vitest **48 文件 565 用例**全绿（新增 `restart-log.test.ts` 4 例、`PER_TURN_ERASE` 3 例）；
  `tsc` 通过；`bash scripts/golden-tasks.sh --fast` 全绿（隔离/注册面/死导出/补丁/补丁行为/注入面 92 文档/supervisor/种子）。
- **保持原设计（不改）**：
  ① 会话中途 `enable_tool` 改工具集——每次全量重算（实测 3 次约 $0.08），但休眠分层本就是显式低频操作，
  按用户决定保持现状；
  ② 记忆注入的 `filterInjectedMessages` 去重——与原项目 `pi-memory` **逐字一致**（my-pi 另加
  `shouldInjectMemory` 去抖，刷新次数比原项目更少）。复核后订正了本批次早先的判断：移除点始终是
  "上一条注入"（注入追加在轮末，故通常即上一次请求尾部 → 便宜），**并非每次都在头部**；
  只有会话首次刷新因上一条注入落在第 3 条消息（头部）而整段失效一次（实测 $0.029/会话）。
  故不修改，仅订正注释与文档（`recall/inject.ts`、`context/README.md`）。

## 关闭工具按需加载，全部工具常驻（第 59 批，2026-09-26）

承接第 58 批的成本归因：工具 schema 在请求最前处，`enable_tool` 一改工具列表就整段断缓存
（实测 3 次：11:50 启用组 $0.0107、12:41 启用组 $0.0361、12:52 重启后重新启用 $0.0752），
且启用状态是进程内存态、重启复位 → 每次重启都要再付一次。

- **开关**：`custom/features/context/budget/task-gate.ts` 新增 `TOOL_LAYERING`（`PI_CONTEXT_TOOL_LAYERING=on`
  才启用），默认 **off = 全部工具常驻**；`tool-groups.ts` 新增纯函数 `effectiveActiveTools(names, enabled, layered)`。
- **接线**：`applyToolLayering` 按开关下发；`dormantToolsActive` 关闭时恒 false（不再回调）；`enableGroup`
  关闭时直接说明"无需启用"；`buildToolsReport`/`/tools` 汇报"全部常驻"；`enable_tool` 描述与 `/tools`
  补全项按开关生成；休眠组摘要不再注入易变提示（避免误导模型去 enable）。
- **盈亏平衡（保守上限）**：休眠 schema 按 20K token、上下文 250K 估，常驻 100 请求 ≈ 20K×0.003/M×100
  = **$0.006**；一次中途 enable = 250K×0.15/M = **$0.0375** → 一次 enable 即抵消整场会话的常驻成本。
- **验证**：tsc 通过；vitest 全绿（新增 `effectiveActiveTools` 4 例 + `TOOL_LAYERING` 3 例）；
  注入面基线已 `--update` 刷新（`portable/agent/AGENTS.md` 的 `web_fetch` 不再要求 `enable_tool`）；
  `golden-tasks.sh` 全量通过。

## 浏览器接入通道（第 60 批，2026-09-29）

承接"远程/移动端用 my-pi"的需求，并先量化了"移植 DSH WebUI"的代价（结论与依据见 `DECISIONS.md`
同日条目）。本批落 `custom/web-terminal/`：服务在 pty 里拉起**原样的 TUI**，浏览器用 xterm.js 接管。

- **pty 层**（`pty-session.ts`）：`script -q -e -f -E never -c '<prelude>; exec <cmd>' /dev/null`
  分配 pty；prelude 写 tty 路径到临时文件并设初始行列；改尺寸用 `stty -F <pts>`（内核发 SIGWINCH）；
  `forceRedraw()` 用"行数抖动"在尺寸未变时强制整屏重绘（重连场景）；输出 4 MiB 回放缓冲；
  `attach()` 原子地"注册监听 + 取快照"，避免重连时丢块或重复；`dispose()` 用 `kill(-pid)` 回收整个进程组。
  不用 node-pty（无本地编译依赖）。
- **鉴权**（`auth.ts`，纯逻辑）：256 位随机 token 随 URL 打印 → `GET /?token=` 换 HMAC-SHA256 签名
  cookie（`v1.<payload>.<mac>`，载荷含 authority 与起止时间，`HttpOnly; SameSite=Strict; Path=/`，
  名字按 authority 摘要）→ 每请求与每次 WS 升级过 Host/Origin 栅栏（拒 `sec-fetch-site: cross-site`、
  Origin 必须等于 Host）。密钥落 `portable/agent/web-terminal-secret.json`（0600，已被 gitignore 覆盖），
  故重启不掉线。**只绑 127.0.0.1**：cookie 不带 `Secure`，暴露到非回环等于明文承载长期 bearer cookie。
- **服务与前端**：`server.ts` 路由只有 `/`（鉴权+页面）、`/assets/*`（xterm 由 node_modules 直接映射，
  无打包器）、`/healthz`（免鉴权、不含会话内容）、`WS /ws`（二进制帧 = pty 字节，文本帧 = JSON 控制：
  `resize`/`restart`/`redraw`/`ping`）。前端原生 ES 脚本 + xterm.js，移动端按 `visualViewport` 与
  `interactive-widget=resizes-content` 适配，断线指数退避重连、多标签共享同一会话。
- **首屏反馈**：pi 自身启动约 19 秒（jiti 编译 `custom/` + 加载模型，实测无 web 层同样如此），故前端按
  **输出字节阈值**（400 B）而非"有任意输出"判定 TUI 就绪——supervisor 会先打一行 23 字节横幅，用后者
  会误报"已连接"。等待期间显示"agent 启动中… Ns"。
- **新增依赖**：`ws`、`@xterm/xterm`、`@xterm/addon-fit`（+ `@types/ws`，均精确锁版本在 `custom/package.json`）。
- **验证**：`npx tsc --noEmit -p custom/` 通过；vitest **56 文件 621 用例**全绿（新增
  `custom/web-terminal/__tests__/` 4 文件 33 例：auth 16 / static 6 / args 5 / pty-session 6，
  其中 pty 集成测试在缺 `script`/`stty` 时自动跳过）；新增 `scripts/test-web-terminal.mjs`
  **22 项**进程级守门并接入 `golden-tasks.sh` 第 12 步；`bash scripts/golden-tasks.sh` 全量通过。
  真实 TUI 经此通道在 headless Chromium 中渲染成功（CJK 与 UI 正常，控制台零错误）。

## 浏览器终端：移动端滑动修复（第 60 批追加，2026-09-29）

用户反馈"滑动屏幕不顺畅"。按"先量后改"处理，结论与证据见 `DECISIONS.md` 同日条目。

- **根因**：xterm 6.0.0 移除了 `.xterm-scroll-area` 占位元素，`.xterm-viewport` 内无子元素，
  `scrollHeight === clientHeight` —— 浏览器侧没有可滚动区域，触摸滑动无作用对象。
- **排查过程**（每步都可证伪）：① 先排除自家 `fit()`/`visualViewport` 抖动（实测滚动期间
  resize 帧 0 次）；② DOM 量出无滚动区域；③ 纯 xterm 页面隔离复现，换 5.5.0 即有
  `scrollHeight 7014 / clientHeight 476`；④ 发现 `Input.synthesizeScrollGesture` 绕过页面触摸
  监听（在朴素 div 上也不动），改用 `Input.dispatchTouchEvent` 投递真实触摸序列。
- **修复**：`@xterm/xterm` 5.5.0 + `@xterm/addon-fit` 0.10.0（5.x 线），恢复原生滚动与
  系统级惯性滑动。
- **验证**：真实应用第二个实例上，手指下滑后首行 350 → 348、再上滑回 350；`tsc` 通过；
  `scripts/test-web-terminal.mjs` 22 项通过；`custom/web-terminal/README.md` 记录"升级前需复验
  滚动占位元素"这一约束。

## 成本归因与缓存不变量加固（第 61 批，2026-09-29）

起因：加权缓存命中率 94.10%（逐请求中位数 99.65%），但实际费用约 ¥11/亿 token，DSH 为 ¥4/亿。
完整归因与证据见 `DECISIONS.md` 同日四条条目；结论是**钱不在命中率上，而在 3.4% 请求的
"前缀前端变更"**（每次把 15K–32K…15万–32万 token 上下文按全价重算）。

**归因要点**

- 按日拆解（667 次调用）：94.10% 被 **09-26 单日**（命中 80.66%、未命中 337 万 = 57.5%、
  ¥26.11/亿）拖低，而那天踩的是两个**已删除的默认值**（每轮擦除、工具按需加载）。09-27 ¥9.85、
  09-28 ¥8.49、09-24 ¥6.01；DSH 参照 ¥4.03。
- 未命中高度集中：≥100K 的 23 次（3.4%）占 78.5%，≥200K 的 10 次占 41.3%，中位数仅 421。
- **不是缓存过期**：23 次大未命中距上次请求的间隔中位数 **16 秒**。
- `prefix-fingerprints.jsonl` 499 条中 17 条（3.4%）`system`/`tools`/`head` 变化，与 23 次
  大未命中比例一致、时间戳逐条对齐。
- **新发现**：切 thinking 档位使整段前缀失效——09-27 12:05:59 切 `low`，前一次 141,184/141,406
  （99.8%）→ 下一次 0/142,075（0%），其间其它分段无变化、空闲 7.2 秒。切换到 `deepseek-flash`
  会被自动解析成 `max`（4/4 次）。
- 记忆注入"删旧插新"占全部未命中 **39.0%**（注入后 83 次命中 61.1% vs 其余 96.2%）。
- 剩余差距的第二来源是**输出强度**：09-28 缓存读成本/亿已与 DSH 持平（$0.293 vs $0.297），
  差距 84% 在输出 token（$0.721 vs $0.186）；单位上下文输出是 DSH 的 3.88 倍。

**已实施的修复**

- **注入 append-only**：`memory/index.ts` 不再调用 `filterInjectedMessages`（只保留最新一条会让
  历史在旧注入处位移）。块首改为"以最新一块为准"。旧注入随压缩折叠，因此有界。
- **切档默认关闭 + 档位钳制**：`PI_CONTEXT_THINKING_AUTO` 改为 **opt-in**；新增
  `clampForCacheSafety`/`PI_THINKING_MAX_LEVEL`（默认 `high`），在 `thinking_level_select`
  钩子上夹档（模型切换本身已使缓存失效，故夹档免费）。工具描述与返回值提示缓存代价。
- **工具集空操作防护**：`applyToolLayering` 只在集合真的变化时才调 `setActiveTools`（顺序无关比较）。
- **探针补盲区**：`prefix-fingerprint` 增加 `level` 分段与 `total` 兜底标记（旧实现 `total` 算了
  从不比较、`messages` 仅按条数判断，中段改写会记成 `changed: []`）。
- **度量修复**：`daily-health.mjs` 改读 `.usage-diag.jsonl`（每轮用量）而非 `usage.jsonl`
  （工具级台账无缓存字段，导致日报连续 `命中=n/a(无数据)`、命中率跌到 80.66% 也不告警）；
  新增加权命中率/未命中每次/输出占比/**前缀前端变更次数**与三项阈值告警。

**守门与验证**

- 新增 `scripts/test-usage-metrics.mjs`（13 项，零 LLM，合成数据驱动真实脚本），接入
  `golden-tasks.sh` 第 13 步（无头冒烟顺延为第 14 步）。
- 新增/扩充单测 14 例：`clampForCacheSafety`/`cacheSafeMaxLevel` 5 例、
  `fingerprintRequest` 的 `level`/`total` 标记 4 例、`applyToolLayering` 空操作防护 3 例、
  memory 注入 append-only 源码级不变量 2 例。
- `npx tsc --noEmit -p custom/` 通过；vitest 全绿；`npm run check`、`check-features`、
  `check-dead-exports`、`check-doc-links` 通过；`check-injection-surface.sh --update` 刷新基线
  （AGENTS.md 脚本数与缓存约定有变）。
- 文档同步：`custom/features/context/README.md`、`custom/features/memory/README.md`、
  `memory/recall/README.md`、`docs/FAQ.md`（订正"擦除已默认开启"的错误说法）、
  `STRUCTURE.md`、`scripts/README.md`、`portable/agent/AGENTS.md`。

## 浏览器终端：孤儿 pty 会话回收（第 61 批追加，2026-09-29）

起因：用户问"界面上一直显示有一个后台任务在运行"，查证是此前按需启动的浏览器终端服务（正常）。
但顺手检查进程时发现**我自己的排查脚本泄漏了 12 个 pty 会话（24 个进程，PPID=1）**——探针
SIGKILL 服务器后，`script` → `pi-supervisor.sh` → `pi` 被 reparent 到 PID 1 且永不退出。

- **判据**：临时文件名内嵌属主 pid（`mypi-web-tty-<serverPid>-<hex>`），故"属主不存在"即
  "无人管理"。属主仍存在（含 EPERM）→ 不动，天然支持多实例；pid 复用只会造成漏回收，不会误杀。
- **实现**：新增 `custom/web-terminal/stale-sessions.ts`（纯逻辑：`parseOwnerPid` /
  `selectStaleSessions` / `isPidAlive`）与 `pty-session.ts` 的 `reapStaleSessions`（`ps` 定位
  持有该文件的 `script` + 后代进程组 → 全体 SIGTERM → 一个宽限期 → 全体 SIGKILL → 删文件）。
  服务启动时自动执行，`--sweep` 可手动只跑回收，`PI_WEB_TERMINAL_SWEEP=off` 关闭。
- **批量语义**：只等**一个** `TERMINATE_GRACE_MS`，启动延迟恒为一次 `ps` + 400ms，不随孤儿数增长。
- **验证**：`scripts/test-web-terminal.mjs` 从 24 项扩到 **36 项**，新增真实孤儿场景（用独立
  `TMPDIR` 隔离）：启动实例 → `script` 确认持有 pty → `SIGKILL` 服务器进程组 → 断言 pty 子进程
  仍在（真的成了孤儿）→ `--sweep` → 断言 `script` 进程与临时文件都消失 → 再断言**存活实例的
  会话不被误回收**。单测新增 `stale-sessions.test.ts`（13 例）；`args.test.ts` 补 `--sweep`。
  顺手修掉守门脚本自身的进程泄漏（杀掉服务器进程组**波及不到** setsid 后的 pty 负载，现于
  teardown 用 sweep 回收），跑完零残留。
- **文档**：`custom/web-terminal/README.md`（新章节「孤儿会话回收」+ 文件表 + 用法）、
  `docs/TROUBLESHOOTING.md`（6.2b：杀不掉的 `pi`/`script` 进程）、`STRUCTURE.md`、
  `scripts/README.md`、`DECISIONS.md` 同日条目。

### 追加：补齐运维操作文档（同日）

复查"这些启动方式有没有写进文档"时发现两个缺口——**后台常驻（tmux）配方**与**停止方法**
（文档里 0 处，`Ctrl-C` 只出现在运行时横幅）。已补：

- `custom/web-terminal/README.md` 新增「常驻与停止」小节：tmux 一行启动 / `capture-pane` 取令牌地址 /
  attach 与脱离 / 两种停止方式 / 被强杀后靠 `--sweep` 回收；并写明三条运维性质——同端口重启免
  重新授权（换端口要重授权）、agent 崩溃由 supervisor 自动拉起（页面重连即可）、一服务一会话。
- `docs/FAQ.md` 的浏览器条目补上"同端口重启免重授权"与指向该小节的交叉引用。
- 其余操作点（启动命令、隧道、令牌流程、参数表、首屏 20 秒、单会话、多标签镜像、
  每环境独立密钥、xterm 5.5.0 约束）复核后确认**原本已有记录**，不再重复。

## 成本与效率优化收尾：P2-3 评估（第 72 批，2026-10-01）

方案里最后一项未处理条目 P2-3（重试策略复核）评估完成，**结论是保持现状**：

- 实测频率：`context_edit`（重试前删除失败 assistant 投影所写）**39 次 / 1436 条 assistant 消息 =
  2.72%**，其中 **29 次集中在同一个 provider 故障会话**（2026-09-30 那次）。
- 判断：删除发生在"请求刚失败"之后——那段前缀本来未必已进缓存；而保留半截/报错的 assistant
  消息会污染历史（模型看到自己的残缺输出）。改为"保留投影 + 标记重试"收益极小、正确性代价明确，
  故**不动**，只把结论记录下来。

至此方案分阶段清单全部有结论（完成 / 按 ROI 关闭 / 判定非缺陷），问题清单与阶段表已同步标记。

## 成本与效率优化 Phase 3 收口：自主度归因 + 子代理 fork + 两项按 ROI 关闭（第 71 批，2026-10-01）

### P3-1 自主度：归因完成，判定**非缺陷**

98 个用户轮统计：步/轮 p50=11 / p90=29 / max=102 / 均值 14.7；工具调用/轮 p50=12。轮结束形态：
**92% 是模型主动收尾**（结尾无工具调用），8% 在工具批次中途结束；主动收尾的轮里 **42% 是在向用户提问**；
23% 的轮含工具错误（这些轮更长，p50 18 步）；**0 个轮在 todo 仍有 in_progress 时收尾**（任务纪律在生效）。

结论：原假设"框架/规则在鼓励早汇报"**不成立**——真正原因是用户自己 `AGENTS.md` 的
「我提出的问题，必须先回答/给方案，同意后才能执行」，加上任务类型差异（DSH 那 42 轮多为一次性交办）。
故不改任何对话纪律（那是用户的偏好），该项按"非缺陷"关闭。

### P3-3 子代理 fork 模式（对齐 DSH 的 fork/spawn 之分）

- 新增纯函数 `buildSubagentArgs`（`subagent/core/runner.ts`）与 `subagent` 的 `context: spawn|fork` 参数：
  - `spawn`（默认）：`--no-session`，空上下文；
  - `fork`：`--fork <父会话>`，继承父会话历史——**父会话刚发过请求时那段前缀是暖的**，首请求按
    cacheRead 计价（≈全价 1/50），既拿上下文又便宜；缓存已冷时为整段历史付全价，故**显式 opt-in**。
  - 拿不到 `ctx.sessionFile`（headless/无会话）时静默退回 spawn。
- 单测 5 例（默认 spawn / fork 且不带 `--no-session` / 空值退回 / 参数顺序 / 空工具数组不生成 `--tools`）。

### 按 ROI 关闭的两项（诚实收口）

- **P2-1 工具声明瘦身：不追。** 实测 62KB/15.6K token 是前缀最大构件，但剩下的便宜手段
  （去 `additionalProperties`、enum 改 `{type,enum}`）合计仅省约 5%（≈800 token/epoch），
  却要放松校验或引入非 TypeBox 原生 schema——风险大于收益。将来若要压，正确做法是**按模式在启动期
  静态收窄工具面**，而不是会话中途分层。
- **P2-2 文档体积预算：已被覆盖。** 工作区指令有 64KB 预算（丢宽泛/截断/说明），工具声明有
  `toolsBytes` 实测 + 80KB 告警，双轨齐备。

## 成本与效率优化 Phase 3：步延迟拆解 + bash 前台硬上限（第 70 批，2026-10-01）

### P3-2 拆解结果：墙钟的元凶是工具，不是缓存

口径：只取 deepseek、且"自动继续"的步（上一条 assistant 有工具调用、下一条仍是 assistant、中间无用户消息），
`toolMs = 最后一个 toolResult − 该步 assistant`，`restMs = 下一条 assistant − 最后一个 toolResult`。样本 **1099–1101 步**。

| 部分 | p50 | p90 | p99 | 合计 |
|---|---|---|---|---|
| 工具执行 | 318ms | **26.6s** | **180s** | **12,200s（63.6%）** |
| 请求处理（前缀+生成+网络） | 4.4s | 10.8s | 45.8s | 6,978s（36.4%） |

二元最小二乘（`rest_ms ≈ a + b·未命中 + c·输出`）：`a=3307ms`、**`b=0.0085 ms/未命中 token`**、
`c=3.37 ms/输出 token`（≈297 tok/s）。于是请求处理时间里：生成 47.5%、前缀重放 **0.5%**、其余为网络/排队/截距。

按工具拆（单调用步，可精确归属）：

| 工具 | n | p50 | p90 | p99 | 合计 |
|---|---|---|---|---|---|
| `bash` | 568 | 440ms | **36.4s** | **164s** | **7,757s** |
| `ask_user` | 17 | 66.2s | 98.3s | 222s | 1,042s（人机等待） |
| `subagent` | 3 | 277s | 303s | — | 743s（同步阻塞） |
| read/write/edit | 162 | 69–151ms | ≤283ms | ≤22.8s | 74s |

**两条结论**：① 前几轮的缓存工作省的是**钱**，不是时间——300K 未命中也只值 ~3s；② 顿挫感来自
**前台长命令**（`bash` p99 164s）。所以"命中率高=更顺畅"这个直觉在本项目不成立，要分开优化。

### P3-6 已实施：`bash` 前台硬上限 240s

`AGENTS.md` 里"长任务后台化"是软提示、实测没被稳定遵守（才有 p90 36.4s / p99 164s），故按
VISION §3.2 硬优先落到代码：`tool_call` 钩子（pi 允许原地改 `event.input`）对**未显式指定
`timeout`** 的 `bash` 注入 240s（`PI_BASH_TIMEOUT_CEIL` 可调，≤0 关闭）；显式指定者原样尊重。
`AGENTS.md` 的"后台任务"约定同步写明上限与改法（它现在是尾部注入，改它很便宜）。
单测 5 例（注入默认/尊重显式/非法值按未给/非 bash 不动/可关闭）。

## 成本与效率优化：前缀体积口径落地 + P2-1 优先级修正（第 69 批，2026-10-01）

### 实测：工具声明才是前缀的大头（比之前估的更准）

- 给指纹记录加 `toolsBytes`/`systemBytes`（请求体的真实字节数），一次真实会话实测：
  **工具声明 62,454 字节 ≈ 15.6K token**，system 仅 7,380 字节 ≈ 1.8K。
- 静态排序（一次性脚本注册全部 12 个功能、逐个量 schema）：62 个自定义工具 ≈ 21,197 字符，
  按功能 browser 4,940 / autopilot 4,699 / memory 4,316 / tmux 1,944 / plan-mode 1,832；
  单工具最大 `schedule_task` 1,365、`todo` 1,074、`memory_search` 1,029、`memory_store` 1,014。
- 对照 DSH：27 个工具 / 27,285 字节 ≈ 6.8K token → 我们是他 2.3 倍。

### 但 ROI 算下来要**下调** P2-1 的优先级（诚实修正）

砍 20% ≈ 省 3K token，而且只省在**每次冷启动**一次；而实测冷启动的代价是
`冷启动=8(177023/平均22128)`——平均 22,128 token/次，大头是 `--session` 续接要重发的**整段历史**，
不是静态前缀。所以 P2-1 从「最大杠杆」降为「顺手优化」：只做便宜且无损的部分（schema 瘦身、
描述精简），**不值得为它牺牲工具可用性**（例如把 browser/voice 从默认声明里摘掉）。
已在方案文档中改写该项并说明理由。

### 顺带：把前缀体积做成日常可见指标

`daily-health` 新增 `工具声明=<KB>KB/system=<KB>KB`（取窗口内最近一次实测），并设上限告警
`PI_HEALTH_TOOLS_KB_CEIL`（默认 80KB）——工具面无声膨胀会在当天就报出来。守门
`test-usage-metrics.mjs` 26 → **29 项**（体积被报出 / 超限告警 / 无字段时不臆造）。

## 成本与效率优化 Phase 3：headless 一次性运行不再引爆后台任务（第 68 批，2026-10-01）

P3-5 完成，且**根因与最初猜测不同**——最初怀疑扩展里的 `setInterval` 未 `unref()`，实测两个定时器
（autopilot tick、tmux watcher）**都已经 unref**；直接跑 `node cli.js --extension … -p` 也是干净退出。
真正机制是：

- `my-pi.sh -p` / golden 无头冒烟这类**一次性会话**里，autopilot 的 `session_start` 同样启动调度器
  并立刻 `runDueTasks()`。当时 5 个每日任务全部逾期 → 立刻触发（每个都是一次完整子代理会话、
  数分钟）→ 进程被拖住，表现成「产出回复后不退出」。
- 更严重的是副作用：**一次「问一句就退出」的调用会凭空引爆若干后台任务**。旁证是
  `portable/memory/stats/tool-count-localhost.json` 被自动任务 `git add` 过（那是 tool-stats-daily
  的行为），而我从没让它跑。

修法：`session_start` 开头加网关——无头会话只做种子对账（幂等、零 LLM）后返回，不启动调度器，
也不消费未读通知（否则会把该给交互会话看的报告标记成已读而丢失）。调度器自己的工作进程走
`--no-extensions -p`，不加载扩展、不会回到这个钩子。

守门：golden 无头冒烟第 14 步从「容忍挂起（有回复即通过）」改为**严格要求 `rc=0`**，并写明若再挂住
先查调度器网关。实测 `bash scripts/golden-tasks.sh --fast --smoke` → `✓ headless smoke（正常退出）`。
文档：`docs/TROUBLESHOOTING.md` 新增 0.1 节。

## 成本与效率优化 Phase 1 主体：工作区指令移出 system 前缀（第 67 批，2026-10-01）

P1-1 完成。用户已授权"自行决策与执行"，故按 VISION 的目标（缓存/成本不劣化、硬优先、防退化）自行决策实施。

### 设计：把"变更代价"与"权威性"解耦

- **system 层**保留：`APPEND_SYSTEM.md`（pi 原生）+ 新增 `HARD_RULES` 常量（五条不变量摘要：
  上游隔离 / 接口隔离 / 缓存纪律 / 状态不入库 / 后台任务）。短、静态、逐字节稳定 → 权威性不降。
- **尾部消息层**：`AGENTS.md` 等全部工作区指令改由 `custom/features/context/budget/workspace-instructions.ts`
  收集（复刻 pi 的发现规则：agentDir 优先 → cwd 向上，宽泛→具体，按路径去重）并渲染为
  `my-pi-workspace-instructions` 消息注入；**只在内容变化时追加完整替换**。
- pi 侧 `--no-context-files`（supervisor 两处 + dev.sh 三处）关掉原生 project_context 注入。
- 新增 DSH 式**体积预算**（64KB，超出从最宽泛的开始丢、单份超限则 UTF-8 安全截断并显式说明）。

### 验证（临时工作区 A/B，不触碰真实文档）

| 判据 | 结果 |
|---|---|
| 改工作区文档后 `system` 指纹是否变 | **不变**（VERSION-ONE → VERSION-TWO，两次进程同为 `23e6fc3fa017`） |
| 会话内改文档的指纹标记 | `changed=['head','messages']`（尾部追加），**不含 `system`** |
| system 分段是否还有 `project_context` | **已消失**（preamble/tools/rules/docs/addendum/skills/cwd） |
| 指令是否真的注入 | `custom_message: my-pi-workspace-instructions`（7973 字符，含被改前的内容） |
| 发现规则/预算/截断 | 新增单测 11 例（顺序、override 优先、去重、确定性 hash、丢宽泛、UTF-8 安全截断） |

### 顺带（两处既有隐患）

- `check-injection-surface.sh` 的指纹源加入 `hard-rules.ts`（system 层新增内容必须被守门覆盖），基线已刷新。
- **vitest 默认 5s 超时太紧**：本轮新增一个测试文件（提高并发）后 `enable-tool` / `search-tool` 两个用例
  超时假红。查根因是 `adapters/tool-adapter` 静态拉入 `typebox`——**单独 import 实测 ~3.5s**
  （用于注册期把简化参数声明编译成 TypeBox schema），于是"import 一个 feature + 注册"整体约 5–6s，
  一直贴着默认线跑。已在 `vitest.config.ts` 把 `testTimeout` 提到 20s 并写明原因（这些用例做的是真实
  模块加载，不是慢逻辑）。
- **headless `-p` 挂起**：真实启动路径验收时复现"产出回复后进程不退出"（golden 冒烟注释里已记为已知）。
  已作为 P3-5 记入方案（怀疑是我们扩展的 `setInterval` 未 `unref()`）。
- **`check-isolation` 会被"部分提交"误伤**：本轮两次提交被 pre-commit 拦下、报 `vendor/pi 有未提交的修改`
  + `fatal: unable to read <sha>`，而手动跑门是全绿。根因是 `git commit -- <pathspec>` 用**临时索引**
  并把 `GIT_INDEX_FILE` 传给钩子，钩子里 `git -C vendor/pi diff` 便拿主仓库索引比对 vendor 仓库。
  已用 `GIT_INDEX_FILE=$PWD/.git/index git -C vendor/pi diff --quiet` 决定性复现（同一 sha、rc=128）；
  修法是在 `check-isolation.sh` 顶部 unset 这些 git 环境变量，并写进 `docs/TROUBLESHOOTING.md` 第 0 节。

## 成本与效率优化 Phase 1（部分）：删历史默认关 + 断裂口径修正（第 66 批，2026-10-01）

### P1-2 旧压缩摘要去重改为默认关闭

- 它是当前**唯一默认开启的删历史动作**（`context/index.ts` 的 `context` 钩子：≥2 条
  `compactionSummary` 时删掉旧摘要）。摘要位置通常靠前 → 删除即从该点起整段前缀重放；而保留它
  每轮只花它自己的 token（cacheRead 价 ≈ 全价的 1/50）。按同一个盈亏平衡公式（49×S/F 次请求才回本）
  默认是净亏 → 改为 `PI_CONTEXT_DEDUP_SUMMARIES=on` 才启用，并加 3 例门控测试（默认关/显式开/其它取值不误开）。

### P1-3 断裂归因：口径修正 + 真实断裂数重算（本轮最有价值的发现）

- 实测发现**度量误报**：起一个真实的两次请求 headless 会话，第 2 次请求 `msgs 3→5` 被记为
  `changed=['head','messages']`，但 `segments` 并未分叉——`head` 只覆盖前 6 条消息，**分不清
  「改写」与「在头窗内追加」**。历史数据里那些 `head,messages @ msgs≈6-7` 大多是这类误报。
- 修正：`daily-health` 的判定改为「`system`/`tools`/`level` ∪ 新记录的 `messages@0-*` 分叉定位」，
  **旧记录的 `head` 不再计入**（与追加无法区分，继续计入只会把误报留下去）。
  实测窗口内的「前端变更」由 **7 次降到 4 次**（只剩 `system`）。
- 用新口径重算全部 763 条记录：**真实前端断裂 14 次 = `system` 9 + `tools` 5**，
  **冷启动 20 次**；旧口径报的 42/20 次里有 **19 次是头窗内追加的误报**。
- 这条修正让"会话中途断裂"从 20 次缩到 14 次、且构成清晰：9 次是 system 消息被重渲染
  （工作区文档/技能/工具面变化 → P1-1 正是对症的修复），5 次是工具面变化（默认关闭分层后不应再出现）。
- 守门 `test-usage-metrics.mjs` **23 → 26 项**：新增「旧记录仅 head 不计入前端变更且不告警」「冷启动未命中被配对计数」。

### P1-4 冷启动代价量化（直接回答"my-pi 经常改自身"的代价）

- `daily-health` 把每个冷启动与**它之后的第一条每轮用量**配对（指纹写在请求发出前、用量写在响应结束后，
  故取"之后第一条"、上限 300s 防串会话；配不上记 0、不猜），输出形如
  `冷启动=5(119867/平均23973)`。
- 近 24h 实测：**5 次冷启动、合计 119,867 token 全价、平均 23,973/次**——占该窗口全部未命中的约 21%。
- 注意这比"静态前缀 8.7–23.2K"更贵：`my-pi` 重启会用 `--session` 续接，首请求要重发的**不只是静态前缀，
  还有整段历史**（本次 5 次里多半是较新的短会话，才压在 24K 量级）。这条数字是 P1-1 与"少重启"最直接的论据。

## 成本与效率优化 Phase 0：让未命中可归因（第 65 批，2026-10-01）

依据 [docs/development/COST-LATENCY-OPTIMIZATION-PLAN.md](docs/development/COST-LATENCY-OPTIMIZATION-PLAN.md)（本会话四份证据：DSH 运行时审计、pi 运行时审计、运行数据统计、上游体检）。

### P0-1 分段指纹：把"整段失效"从布尔量变成"失效起点"

- 旧口径的盲区：`head` 只覆盖**前 6 条消息**，而 `total` 兜底会被"条数变化"抢先命中 →
  大未命中只剩 `['messages']` 这种**无法定位**的标签。实测 60 条 `input>10K` 的大未命中里
  **37 条（≈全部未命中的 50%）归因不出来**。
- 现在对**整条消息序列**做分段指纹（每 8 条一段，`FINGERPRINT_SEGMENT_MESSAGES`），
  变化时给出首个分叉段：`messages@0-7`（起点在头部＝等价整段重放，最贵）→ `messages@120-127`
  （中后段改写，代价递减）。
- 关键修正：**尾部追加不算分叉**。最后一个未满段的内容会随追加变化（6 条→7 条时段 0 变），
  但前缀并未失效——所以判定只比较"两侧都完整的段"，条数变化时只看 `messages` 计数。
  不做这步会把正常追加误报成整段失效（首版实现就踩了，单测当场抓出）。
- 单测：`prefix-fingerprint.test.ts` 21 例（新增分叉定位、位置后移、追加不误报、边界）。

### P0-2 `daily-health` 新口径 + 守门

- 输出新增 `首段分叉=` `中后段分叉=` `冷启动=`：
  - **首段分叉**（`messages@0-7`）计入告警原因（旧的 `FRONT_SEGMENTS` 只有 system/tools/head/level，
    这类最贵的断裂**根本不会被计入**）；
  - **中后段分叉**单独计数、不告警（代价递减，混在一起就分不清"该修"与"可接受"）；
  - **冷启动**＝指纹里没有 `sinceLastMs` 的记录（进程首个请求），阈值 `PI_HEALTH_COLDSTART_CEIL`（默认 8）
    ——这是"自改/重启代价"的先行指标。
- 真实数据实跑：`命中=98.1% 未命中/轮=2125 前端变更=7 首段分叉=0 中后段分叉=0 冷启动=5`
  （分叉两项为 0 是因为历史记录由旧代码产生、没有 `segments` 字段；新记录起生效）。
- 守门 `test-usage-metrics.mjs` **13 → 23 项**：新增首段分叉告警/中后段不误报/冷启动计数与阈值三组用例。

### P0-3 文档修正（已在 9b38b98a5 提交）

- 两份运行时审计入库；`CONTEXT-MANAGEMENT-COMPARISON.md` 顶部加更正块，改掉三处被代码与实测推翻的结论
  （压缩阈值 ≈967K 而非 256K、擦除默认关闭、DSH 实测压缩过 6 次并由 provider 400 触发）。

### 台账

- `pruneThinkingBudget`/`pruneToolResults` 的默认关闭状态、压缩阈值 ≈967K、重试会删失败投影等
  已一并写进审计报告，Phase 1/2 将据此逐条处理。

## 落实上级分析的建议动作（第 64 批，2026-10-01）

来源：`pi 更新影响分析`那一轮给出的五条建议动作，逐条落地。

- **① 加严离线归档判据（`doctor.sh` + `vendor-bundle.sh`）**：此前只检查"归档存在"，于是 v0.87.0
  时代的旧归档一路绿灯、而 `restore` 后 `checkout` 必然失败——假安全比没有归档更危险。现在用
  `git bundle list-heads` 比对，要求**至少一个归档含当前 `PINNED_COMMIT`**；`vendor-bundle.sh status`
  也逐个标注（含当前 PINNED ✅ / 不含 ⚠ + 归档头 sha）。顺带修掉 `vendor-bundle.sh status` 的退出码：
  末尾 `[ ] && echo` 在条件为假时让脚本以 1 退出，会打断调用方的 `&&` 链。
  验证：正向 `✓ 离线归档可用（2 个，其中 1 个含 PINNED d2931ad3d）`；**反向实测**（把可用归档移走）
  → `⚠ 23 正常 / 1 警告`；复原后回到 24/0/0。
- **② `AGENTS.md` 缓存纪律补两条**：`/reload` 会启用新加入 `defaultTools` 的工具（任何工具数组变化
  都让前缀全价重算，故不要在会话中途热改工具集）；以及**运行时状态不入库**（`modes.json` 的 `current`
  与上游新增的 `deviceId` 两次同类踩坑，给出各自处置）。
- **③ `deviceId` 处置约定**：写进 `AGENTS.md` 与 `UPSTREAM-UPDATE.md` 的「已知待办」——
  不用 `Sign in with ChatGPT` 则零影响；用了就在提交前清掉该键（下次登录会重建）。
- **④ 上游待办触发条件化**：`UPSTREAM-UPDATE.md` 新增「已知待办（触发条件式）」表，把
  "接 MCP 前先升 v0.99.2"（缓存修复 + 低风险体检结论）与上一条落成可查的触发条件，而不是靠记忆。
- **⑤ `VISION.md` §4 现状列回填（v3.1）**：缓存口径由"工具级台账 `usage.jsonl`"更正为
  "每轮用量 `.usage-diag.jsonl` + 前缀断裂归因 `prefix-fingerprints.jsonl`（加权命中率/未命中每轮/
  输出占比/前缀前端变更次数）"；回归 12 步 → **13 步、622 → 696 用例 / 60 文件**；新增「上游」行
  （`check-upstream.sh` 把升级代价变成同步前读数）；任务行补 `/daily`。§1–§3、§5 未动（需用户确认的
  部分不碰）。
- **⑥ 钩子输出落盘（当天实测逼出来的补充）**：这次推送被 pre-push 拦了一次，而 golden 的分步日志
  `/tmp/golden-*.log` 会被**下一次**运行覆盖，于是事后完全没有证据可查——重跑即过、无法归因。
  现在 pre-commit / pre-push 都用 `tee` 把完整输出写到 `/tmp/my-pi-golden-{precommit,prepush}.log`
  （配 `set -o pipefail` 保证管道返回 golden 的真实退出码），失败时打印该路径。这属于"防退化的
  防退化"：一个间歇性变红的门如果无法归因，很快就会被当成噪音而失去作用。

## 模式切换修复：current 分离 + 自动重启（第 63 批，2026-10-01）

起因：用户报告"用 `/mode` 切到角色扮演，**重启后没生效**"，并提出"切换后应该自动重启"与
"模式切换必须重启吗，能不能热重载"。

### 诊断（先证伪机制，再定位数据）

- supervisor 侧用临时 agent 目录实测 `apply_mode`：`--append-system-prompt …/modes/roleplay.md`
  与 `PI_MEMORY_NAMESPACE=roleplay` 都正确产出 → **解析机制没问题**。
- 根因在数据落点：`current` 写在**入库**的 `portable/agent/modes.json`（`.gitignore` 特意放行该文件），
  切模式只是把入库文件改脏，**任何 git 操作都会静默把它退回 `full`**。旁证：该文件现在是 `full`
  且工作区干净；`portable/memory/` 下从来没有 `roleplay/` 命名空间目录（roleplay 从未真正激活）。
- 附带发现：模式应用逻辑只写在 `pi-supervisor.sh` 里，**`dev.sh` 静默不注入人设**（入口漂移）。

### 修复

- **config/state 分离**：`modes.json` 只留 `default` + 模式定义（入库）；`current` 落
  `portable/agent/modes-state.json`（gitignored）。切模式不再让工作区变脏，git 操作也不可能回退它。
  旧格式（`modes.json.current`）仍被识别，保证迁移平滑。
- **`/mode <name>` 自动重启**：需要重启时写 `modes-state.json` 并提交 admin restart（带
  `--session` 续接当前会话）后 `ctx.shutdown()`，不再提示用户手动 `/exit` 重启；只改思考档位仍即时生效。
  响应进行中（`ctx.isIdle()` 为 false）则拒绝切换且**什么都不落盘**——否则会留下"配置已改、进程没重启"
  的半切换状态（pi 自己的 `/reload` 也有同样的保护）。
- **启动一致性校验**：`session_start` 比对"磁盘持久化模式"与"本进程实际注册模式"，不一致就告警并给出
  `/mode <磁盘模式>` 修复命令——直接覆盖本次故障症状（`PI_AGENT_MODE_SOURCE=env` 时跳过，避免误报）。
- **入口一致化**：新增 `scripts/lib-mode.sh`，supervisor 与 `dev.sh` 共用模式解析，dev 也能注入人设。
- **为热重载留路口**：`PI_AGENT_MODE_SOURCE` 区分"外部注入"与"bootstrap 回写"的 `PI_AGENT_MODE`——
  此前回写值会让 `/reload` 永远读到旧模式（这正是"热重载切模式不成立"的隐性原因）。
  但默认仍走重启，理由见下与 `custom/features/mode/README.md`。

### 关于热重载的结论（写进 mode README）

查实 `/reload` 会 `clearExtensionCache()` 重跑扩展工厂，所以**功能白名单可热切**；但 ① 人设是
CLI 参数，扩展 API 只有只读的 `getSystemPrompt()`，热切需改用 `context_with_system` 自行拼 system prompt；
② 记忆命名空间热切会造成同一会话跨命名空间，破坏记忆治理与执行-知识分离；
③ **热重载在缓存上没有收益**——模式切换必然改工具数组，重启与 reload 的前缀代价相同。
故维持"重启是模式的正确语义"，热重载仅在将来确有需要时再做。

### 验证

- 新增 `custom/features/mode/__tests__/mode-switch.test.ts`（**27 例**）：状态分离（含"切模式不得
  改动 modes.json"的回归断言）、旧格式迁移、无效/损坏状态回落、来源区分、自动重启接线、
  **响应进行中拒绝切换且不落盘**、一致性告警三态（不一致/一致/env 强制）。
- `scripts/test-supervisor.sh` 44 → **54 项**：新增 `apply_mode` 的 bash 侧契约（状态文件优先、
  旧格式兼容、人设缺文件不注入、命名空间仍注入、外部 env 覆盖优先）。
- `npx tsc --noEmit -p custom/` 通过；全量 golden 通过；`modes-state.json` 确认被 gitignore 覆盖。

## 计划模式标识 + 每日任务命令 + 上游更新体检（第 62 批，2026-10-01）

用户一次提了四件事：计划模式没有界面标识、需要每日任务的查看/启停命令、上次跳版（v0.87.0 →
v0.99.1）都改了什么、以后更新前如何先看变化以及遇到不想要的变更怎么办。

### 计划模式常驻标识（vendor 补丁 009）

- 现状：footer 第一行是硬编码的 `pwd (branch) • sessionName`，扩展的 `setStatus` 只能落到第三行；
  进入计划模式只发一次 `notify`（滚走即无痕迹）。
- 补丁 009 做成**通用前缀约定**：状态 key 以 `badge:` 开头 → 剥离前缀后用 `warning` 色渲染到第一行
  （`~/my-pi (main) [⏸ 计划模式]`），其余 key 行为不变（`tps` 仍进第二行、其余仍进第三行）。
- `plan-mode` 侧把标识同步挂到**唯一状态出口** `applyPlanMode()`，并把 `/plan resume` 里那处直接赋值
  收口过去；UI 上下文在 `session_start` 捕获、命令/快捷键/工具里兜底再抓一次。工具侧此前拿不到
  `setStatus`，顺带在 `tool-adapter` 的 `ToolExecuteContext` 上补了这个字段（钩子/命令侧本来就有 `ctx.ui`）。
- 新增 `patches/009-footer-badge.patch`（由 vendor 本地提交 `local: 009-footer-badge` 导出），
  更新 `patches/README.md`；重建 vendor dist 后生效。

### 每日任务命令 `/daily`

- 「每日任务」= `tasks.json` 里 `tags` 含 `daily` 的任务；当前 5 个（`golden-fast` 07:30、
  `daily-health` 07:50、`knowledge-subscribe` 08:20、`daily-review` 09:05、`tool-stats-daily` 23:30）。
- 新增 `custom/features/autopilot/daily.ts`（纯逻辑：筛选/概览/详情/cron 时刻解析/时长与相对时间）
  与 `/daily <list|show|on|off|help>`，默认输出概览（今日完成·待跑·失败 + 逐条一行 + 失败提示）。
- 关键口径：无 `daily` 标签时降级显示全部并说明（不静默丢任务）；今日进度按 `lastRun` 本地日期；
  cron 只在 `M H * * *` 时显示 `HH:MM`，复杂表达式原样显示；`on` 不重算 `nextRun`（错过的触发点下一轮补跑）。
- `__tests__/daily.test.ts` 18 例；`gen-registrations.mjs --update` 刷新注册面（命令 11 → 12）。

### 上游 v0.87.0 → d2931ad3 变更报告

- 子代理产出 `docs/operations/UPSTREAM-CHANGES-v0.87.0-to-d2931ad3.md`（126 行）：130 提交 / 744 文件 /
  `+90664-24881`；churn 前五 `durable` 41516、`coding-agent` 36108、`chord` 15372、`ai` 10422、`mcp` 4623（新包）。
- 关键结论：上游**没有 0.88–0.98 发布**（只有 0.87.1 / 0.99.0 / 0.99.1，基点还比 v0.99.1 多 19 个提交）；
  最需要注意的是 codemode+MCP 新包与自动激活、默认主题改 `system`、TS7/ES2024 工具链、ai 图片模型 API 删除、
  `--no-extensions` 语义变化；**本区间未新增遥测**。

### 更新前体检 `check-upstream.sh` + 补丁策略文档

- 新增 `scripts/check-upstream.sh`（只读）：目标版本/区间提交数/各包 churn/新增包、changelog 新增版本段
  与破坏性关键词、**逐个补丁的目标文件是否被上游改过**、adapters 依赖的 API 面（入口文件 + 逐符号核对）；
  结论=已最新/可同步/需先改补丁；`PI_CHECK_NO_FETCH=1` 离线、`PI_CHECK_STRICT=1` 风险时 `exit 2`。
- 新增 `docs/operations/UPSTREAM-UPDATE.md`：四步流程（体检 → 读懂 → 决策 → 同步 → 验证）、
  `sync-upstream.sh` 六步在做什么与失败后的状态、以及**「不想要的变更」四档手段**
  （关配置 → 改默认值 → 删入口 → 跳过整版）与硬约束（不手改 vendor、不手写 LAST_SYNC_POINT、
  每条不接受的上游变更在 `DECISIONS.md` 留记录）、新增补丁的标准流程与自标记注释约定。
- 实测：脚本首次真跑就发现上游已到 `v0.99.2`（+40 提交 / 217 文件），**9 个本地补丁只有 `002` 的
  `config.ts` 被上游动过**，adapters 导入符号一个没少 → 结论"需先改补丁（1 个）"，属低风险升级。

### 跳版后暴露的两个本地隐患（顺手修掉）

体检脚本的价值立刻体现了一次——顺着"上游删了什么"去查本地依赖，发现两处**只在换机/重新引导后才爆**
的隐患（本机因为 `npm ci` 没被触发，残留还在，所以表面上一切正常）：

1. **`run-ts.sh` 借的是 `vendor/pi` 的 tsx，而上游 v0.99.0 已删除该依赖**。本地
   `vendor/pi/node_modules/tsx@4.23.15` 只是升级前的残留（`vendor/pi/package-lock.json` 里已无任何
   tsx 条目），fresh `npm ci` 后消失 → autopilot 的 `daily-review`、`knowledge-subscribe`（都靠
   `bash scripts/run-ts.sh scripts/memory-store.mjs` 写记忆）会在换机后**静默失效**。
   修法：`custom/package.json` 声明 `"tsx": "4.23.15"`（`npm install` → 根 `node_modules/.bin/tsx`），
   `run-ts.sh` 改为「根 → vendor 残留（告警）→ npx（告警）」三级回退。`package-lock.json` 增 tsx +
   esbuild 及 26 个平台可选包。
2. **vendor 离线归档停留在旧 pin**：`vendor/pi-d201760ffee1.bundle` 是 v0.87.0 时代建的（PINNED
   还是 `d201760f…`），用它 `restore` 后 `checkout d2931ad3…` 必然失败——但 `doctor` 只检查"归档存在"，
   会给出虚假的安全感。已重新 `vendor-bundle.sh create` 生成 `vendor/pi-d2931ad3d5bf.bundle`（69M，不入库）。

两处的共同教训：**上游删依赖 / 换 pin 时，本地"看起来还能用"不等于还能用**——`check-upstream.sh`
报的是"补丁与 API 面"，这类"借来的依赖"要靠人顺藤摸瓜，已写进 `UPSTREAM-UPDATE.md` 的常见坑。

### 验证与文档

- `npx tsc --noEmit -p custom/` 通过；新增单测 `autopilot/__tests__/daily.test.ts`（18 例，视图口径）
  与 `plan-mode/__tests__/badge.test.ts`（6 例：session_start/工具/快捷键/`/plan enter·exit`/`/plan resume`
  五条状态变更路径都同步标识，非交互环境不抛错）；vitest 全绿。
- **footer 渲染实测**：直接构造 `FooterComponent`（初始化 theme）渲染三行并断言——
  无 badge 时第一行 `~/my-pi (main)`；设 `badge:plan` 后为 `~/my-pi (main) [⏸ 计划模式]` 且**行数不变**；
  同时设 `tps` 与其它状态时，`tps` 仍进第二行 stats、其它状态仍进第三行、第一行不重复出现；
  传 `undefined` 与空串都清除。这是补丁 009 的端到端证据（不是只断言源码里有标记）。
- `doctor.sh --no-net`：24 正常 / 0 警告 / 0 异常（`补丁齐备（9）`、`dist 与源码同步（stamp b2347bec2）`）；
  `check-isolation`、`check-features`、`check-dead-exports`、`check-doc-links`（109 md）、
  `check-injection-surface`（AGENTS.md 变更后已 `--update`，新指纹 `143bf914…`）、`golden-tasks.sh` 全通过。
- 顺带修掉一个长期假告警：`patch-playwright-core.mjs` 的 `TARGET_FILES` 里还留着 1.53.x 的两个路径
  （`lib/server/utils/hostPlatform.js`、`lib/server/registry/index.js`），1.63.0 已把它们并入
  `lib/coreBundle.js`，于是每次构建都打印"缺失目标，需人工核对"——把这两项删掉（合并目标本来就在表内），
  现在输出 `应用 0 / 跳过 4 / 缺失 0`。这是 v0.99.1 跳版之外的**既有**遗留（playwright-core 由
  `custom/package.json` 锁定，与 vendor 无关），但它正好是"构建输出里不该有噪音"的例子。
- 文档：`patches/README.md`（009 行 + 自标记要求）、`scripts/README.md`、`STRUCTURE.md`（脚本 35 → 36）、
  `docs/README.md`（新增两篇运维文档）、`custom/features/plan-mode/README.md`（标识机制与原因）、
  `custom/features/autopilot/README.md`（`/daily` 全表 + 口径）、`custom/adapters/README.md`（`setStatus`）、
  `portable/agent/AGENTS.md`（脚本数 + 同步前体检 + 补丁优先策略 + 深度文档入口）。

## P4 升格通道第一批（2026-10-01）

VISION §6 的 P4 是唯一未完成的路线阶段：按 §3.1 把"反复有效但只写在提示词里"的软引导硬化，
并同步降权原软引导（判据：软层条目不无限增长、注入预算受控）。本批处理 6 条，全部有证据与降权动作。

### 硬化（软 → 硬）

- **system 注入装配唯一入口**：新增 `custom/features/context/budget/system-prompt.ts`
  （`buildSystemPrompt` / `appendedSystemParts` / `findVolatileInjection` + 三个字节预算常量），
  `index.ts` 不再手写模板串；8 类易变内容（日期/时钟/百分比/绝对路径/字节数/sha/版本号）由
  `context/__tests__/injection-stability.test.ts` 拒绝。**理由**：前缀一变其后整段按全价重算
  （命中价 1/50，单次实测 170K–316K），而这条纪律此前只写在 AGENTS.md 里。
- **约定守门** `scripts/check-conventions.sh`，接入 `golden-tasks.sh` 第 14 步（`--fast` 也跑）：
  A 运行时状态不入库（`settings.json` 禁 `deviceId`、`modes.json` 禁 `current`）；
  B 敏感文件/运行时数据不入库（已跟踪 + **暂存区**，含 `*-state.json`、会话、扩展安装位、私钥、`.env`）；
  C 生产代码规范（禁 `any`、禁动态 `import(`；测试与 `node_modules` 排除）。三条原为 AGENTS.md 软约定，现状 0 违规。
- **`tmux_wait` 同轮等待硬上限**：新增纯函数 `clampWaitTimeout`（显式值原样尊重、随后按上限截断，
  非法值回落默认值，`PI_TMUX_WAIT_CEIL_SEC` ≤0 停用），默认 60s；截断时在结果里给出改法。
  与 `bash` 的 240s 上限同一约定（P3-6），补上"前台同步等待"的第二条通路。

### 降权（§3.1 要求的对价）

删除 AGENTS.md 的「git 提交」「上游隔离」「接口隔离」三条重复条目（分别与开发规范、架构原则、HARD_RULES 重复，
且前两条已由守门覆盖），并把「运行时状态不入库」「缓存友好」「代码质量」「后台任务」压成规则 + 守门指针；
**12346 → 11829 B（−517 B）**。注入预算基线：system 追加 **767 B** / 上限 4096，APPEND_SYSTEM **789 B** / 上限 2048，
工作区指令 11829 B / 上限 65536。台账（含"待评/不硬化"及其原因）：`docs/design/UPGRADE-LEDGER.md`。

### 验证

- `injection-stability.test.ts` 10 例；tmux 单测 29 例（新增 5 例边界）；`check-conventions.sh` 负数测试
  （临时 `: any` 文件、`"current"`/`"deviceId"` 注入即失败；`packs/`、`tool-count-localhost.json` 不误伤）。
- `golden-tasks.sh --fast` 14 步全绿；`check-injection-surface.sh --update` → 新指纹 `a09e666c…`。
- 文档：VISION（§4 结论 / §6 P4 / §9 v4）、`docs/design/UPGRADE-LEDGER.md`、`docs/README.md`、DECISIONS、AGENTS.md。

## P4 升格通道第二批（2026-10-01，同日续做）

第二批由第一批的"待评"项倒逼：要硬化 AGENTS.md 的「bash 优先合并碎调用」，先查度量落点，
结果查出一个被守门放行的真实缺陷。

### 死导出守门：测试引用不算接线

`recordToolCallEvent` / `recordToolCall` 等工具事件落盘函数**只在单测里被调用**，生产路径从未接线，
于是"工具调用分布"这条度量落点长期为空；而旧守门 `check-dead-exports.mjs` 统计的是"任何引用"，
单测引用让它顺利通过。现在新增规则：**零生产引用（但存在测试引用）同样报错**，实测扫出
**32 个存量**（工具事件/用量子系统 10 个、预算与暖前缀 10 个、Best-of-N 3 个、其他 9 个），
作为棘轮登记在 `dead-exports-allowlist.txt` C 段，**新增**即失败（负数测试验证：临时"仅测试引用"导出 exit 1）。

### 注入面运行期体检

新增 `auditSystemInjection`，在 `context` 扩展注册时跑一次：超预算或出现日期/百分比等易变内容即
`console.warn`。动机是测试守门只在提交时跑，而注入文本常在会话中被改——现在启动即可见，
三个预算常量也因此进入生产路径（不再只是"测试专用常量"）。

### 度量落点更正

`portable/memory/context/usage.jsonl` 每行本就是一次工具调用（`ts`/`tool`/`ok`/`durationMs`，1784 行），
"工具调用分布"**不缺原料**，缺的是"按回合配对"。因此"碎调用"硬化的前置条件从"新增埋点"
改为"用 `.usage-diag.jsonl` 的 usage 记录作回合边界做统计"，列入台账下一批优先候选。

### 验证

`injection-stability.test.ts` 14 例（新增 4 例运行期体检）；`check-dead-exports` 负数测试通过；
文档：`docs/design/UPGRADE-LEDGER.md`（第二批小节 + 待评行更正 + B-3 条目 + 下一批复核）。

## P4 升格通道第三批 · 度量落点（2026-10-01，同日续做）

### 先测量，再决定：`碎调用` 规则其实被稳定遵守

扫 6 个会话的**真实 bash 命令 1103 条**：单命令占比 **1.4%**（15/1103），每步 bash 调用数
p50=1 / p90=2 / max=3（≥3 次的步仅 1.4%）。也就是说 APPEND_SYSTEM.md 的「合并独立检查为一次调用」
不是"没被遵守的软引导"，硬化成限制属于解错问题。正确处置是**可观测化 + 降权**。

### 指标落地

- `usage.jsonl` 的 bash 记录新增 `merged`/`segments`：`tool_result` 事件自带原始 `input`（pi
  `ToolResultEvent`），故无需配对表；`analyzeBashCommand`（纯函数）剥离引号后按 `;`/`&&`/`||`/`|`/换行 判定段数。
- `daily-health.mjs` 新增 `每步bash=p50/p90/max(n)` 与 `单命令=占比(单/总)`：回合边界取每轮用量记录，
  工具调用按"最后一个严格小于它的边界"归桶；**漂移告警**阈值 25%、判定样本 ≥30（基线 1.4%，故不误报现状）；
  旧记录无 `merged` 字段时记 `n/a`，不猜。
- 守门：`test-usage-metrics.mjs` 29 → **35 项**（分位、无字段记 n/a、10% 不告警、100% 告警点名）；
  新增 vitest `bash-command-shape.test.ts` 7 例（判定语义 + 写入 + 并行计时）。

### 顺带修掉一个计时缺陷

`toolCallStarts` 原先按**工具名**作键，而 pi 默认并行执行工具——一步内同名工具多次调用会互相覆盖，
时长失真。改用 `toolCallId`（两个事件都带），并有回归测试（p2 先返回后，p1 仍有时长）。

### 降权

APPEND_SYSTEM.md 那条从"优先合并…碎调用会显著推高 token 消耗"压缩成一句（去掉解释，保留规则）：
789 → **737 B**；注入面基线更新为 `2ca79271…`。

## P4 升格通道第三批 · B-3 存量处置（2026-10-01，同日续做）

死导出守门升级后扫出的"仅测试引用"存量里，第一批处置 4 个：

- **发现一个静默诊断缺陷**：`/usage-diag` 摘要里的「自动压缩触发」「分层擦除」两节一直在读
  `auto-compact`/`prune` 事件，但这两类事件的**生产者自 2026-09-24 起被断开**
  （`recordAutoCompact`/`recordPrune` 在生产代码零调用，而旧守门因"测试引用"放行）
  ——摘要恒显示 0 次。已接线到真实触发点（压缩决策处、擦除处含 thinking），`usage-missing`
  一并接线并在摘要里渲染（provider 未返回 usage 时提示"命中率与成本为估算口径"）。
- **删除** `recordThinkingMeter` 及其事件类型：两侧皆无（用量记录已含 `reasoning`，重复度量）。
- 三个已接线的函数移出 `dead-exports-allowlist.txt` C 段——再被断开就是守门失败（棘轮）。
- 新增摘要渲染测试（1 次压缩 / 2 次擦除 / 1 轮无用量），锁住"事件写进来就看得见"。

剩余 legacy 工具台账（`recordToolEnable`/`recordToolCallEvent`/`recordToolCall`/`loadToolCallRecords`/
`loadToolEnableEvents`/`pruneToolEvents`/`recomputeToolUsage` + 私有类型）消费方确认完成
（`tool-stats-sync.mjs` 只读 `usage.jsonl` 与 `tool-count-*.json`），下一步整族删除。

### B-3 整族删除：legacy 跨设备工具台账（同日续做）

- 删除 `diag.ts` 里 legacy 工具台账整族：15 个导出（`recordToolEnable`/`recordToolCallEvent`/
  `loadToolCallRecords`/`loadToolEnableEvents`/`recordToolCall`/`pruneToolEvents`/`recomputeToolUsage`/
  `loadToolUsage`/`getToolEventsFile`/`getToolUsageFile`/`getToolEventsDir`/`toolUseFile`/`getDeviceId`/
  `recordToolUsage`/私有默认路径 helper）+ 4 个接口 + 4 个常量 + 3 个类型守卫，**434 → 265 行**。
- 消费方确认：`scripts/tool-stats-sync.mjs` 自迁移起只读 `context/usage.jsonl` 与 `stats/tool-count-*.json`；
  磁盘上 `tool-use`/`tool-call`/`tool-enable` 事件最后一笔是 **2026-09-24**。
- 同步删除 C 段白名单 7 行、测试里 6 个 legacy 用例（16 → 10 例）；`usage-diag` 只保留仍然活着的口径。
- 剩余 21 个"仅测试引用"导出（预算/暖前缀族 10、`usage-stats` 2、Best-of-N 3、其他 6）已在台账写明，
  下一批逐条"接线或删除"。

### B-3 收尾：剩余 21 项逐条判定（同日续做）

判定标准：**是被活的实现取代的重复，还是未接线但保留的能力**——前者删，后者接线或写理由保留。

- **接线 3**：`getOutputReport` → `/context report`（数据本就由 `pruneToolOutput` 累计，只是没人渲染）；
  `loadLevelChanges` → `/context report`（档位切换正是"前缀前端变更"的直接原因，报告里正缺这条）；
  `shadowReviewReport` → `/intervention stats`（影子审查在生产写、聚合报告无人读）。
- **删除 10**：`markCompacted`+`justCompacted`（`setUsedTokens` 改为直接覆盖后，该标记无人读）、
  `recordOutput`（与 `pruneToolOutput` 内部记账重复）、`formatSpeed`（footer 用 `formatSpeedCompact`）、
  `passesIdleGate`（被 `passesIdleGateAtTurnEnd` 取代）、`readUsage`/`summarizeUsage`/`formatUsageSummary`
  （脚本侧与 usage-diag 各有一份）、`buildWarmPrefixData`/`updateCompactWarmAllowed`/`canProvideWarmPrefix`
  （被 `buildReplayedPayload`/`canReplayWarmPrefix` 取代的第三份守卫）；同步删对应用例。
- **保留并写明理由 15**：`compactJson`/`jsonBytes`/`shrinkHalf`（JSON 结构压缩能力，接入 R4 需产品决策——
  本批一度误删，已恢复）、`filterInjectedMessages`/`isInjectionBlock`（注入 append-only 不变量：
  生产路径禁止调用并由回归测试断言，保留纯逻辑供离线分析）、`resolveAndApply`/`mergeCandidates`、
  Best-of-N 3 项、4 个测试辅助。
- 白名单按 **A 能力/公共 API、B 测试辅助、C 待清理** 三类重排，每条必须写理由；
  C 段还剩 18 条历史"零引用"条目（无理由），列为下一批第一优先。

### 最后一批：C 段 18 条历史"零引用"条目（同日续做）

- **先复核再删**：allowlist 登记 ≠ 现在仍死。用守门口径（排除声明文件自身）重算引用数后发现
  `consumeRestartLog` 其实是**活代码**（`session_start` 消费重启日志 + 6 处测试引用），
  条目陈旧 → 只删条目、保留代码。
- 其余 17 个零引用逐个确认"功能是否在别处活着"后删除：`taskTmpDir`、`isTurnBusy`、`isBackgroundBusy`、
  `lastActivityTs`、`listSchedulerFiles`、`loadTaskRecords`、`resetEnvironmentCache`、`searchEntries`、
  `clearCompactionFlag`、`resolveAppendPromptPath`、`getNextId`、`replaceState`（与 `commitState` 函数体完全相同）、
  `formatPlanMessageLine`、`formatAgentList`、`riskToolRestrictions`、`voiceGuideError`、`batchFetch`；
  连带清理因此变成未使用的 `os`/`readdirSync`/`schedulerDir` 借道导出/`readJSONL` 引用。
- `createConcurrencyLimiter` 因 `batchFetch` 删除而变成仅测试引用，但它是有文档的并发原语
  （批量抓取场景），按"能力保留"登记到 A 段并写明理由。
- 同步更新 6 个 feature README 的函数清单（web-search / context-budget / plan-mode-ui / subagent /
  subagent-core / autopilot-run），避免文档指向已删符号。
- 结果：白名单 **C 段清空**，A 段 17 条 + B 段 4 条每条都有理由；死导出守门（含"仅测试引用"规则）绿。

## P4 台账候选：工具面前缀收窄（2026-10-01）

先测量再决策（新增守门 `custom/features/context/__tests__/tools-payload.test.ts`，注册全部 12 个
功能后逐工具序列化 schema）：

- **本仓库 62 个工具 = 28.5 KB**：`autopilot` 6.4 / `browser` 6.3 / `memory` 5.5 / `tmux` 2.8 /
  `plan-mode` 2.5 / `subagent` 1.5 / `web-search` 1.1 / `voice` 1.0 / `link` 0.8 / `context` 0.7 KB；
  请求里 `toolsBytes` = 62.4 KB，其余约 **33 KB 是 pi 内置工具**（不在本仓库控制内）；
  单工具最大 `schedule_task` 1.7 KB，参数 schema 占单工具体积约 80%。
- **守门**：总量 ≤32 KB、单项 ≤2 KB、数量 ≤66（超出时打印占比最高的工具）；另断言"模式白名单确有收窄效果"。
- **交付**：新增可选 `lean` 模式（`web-search`/`context`/`memory`/`plan-mode`/`intervention`/`subagent`/`tmux`），
  去掉 `browser`/`voice`/`link`/`autopilot` 四组共 **14.5 KB**（本仓库工具面减半，整段 payload 62.4 → ~48 KB）。
  依据与"为什么不改默认"记入 `DECISIONS.md`：能力缺失会成为常态、会话中途改工具数组是最贵的做法
  （实测 150K–320K token/次）、描述裁剪收益已被 P2-1 否掉。
- 模式白名单在**启动期**过滤功能注册（未注册即 0 字节，会话内工具数组不变 = 缓存安全）；
  `custom/features/mode/README.md` 的模式表补上 `lean` 与实测依据。

## 转正执行 + 全流程审计（2026-10-01）

### 转正（§3.1/§5 升格通道）

- 机制核对：升格候选 = `solutions`/`fact` 且 recurrence ≥ 5（`promoteRecurrence` 默认值）；recurrence 由
  `storeEntry` 去重命中时自增（"同一教训被重复入库"的次数），召回/注入不计数——与 §5「反复有效」一致。
- 实测（`run-ts.sh scripts/memory-lifecycle.mjs --json`）：61 条 / 活跃 58，recurrence 分布 1×54、2×7，
  **最大 2 → 无合格升格候选**；聚合候选同为 0。通道正常，是数据未达阈值。
- 同期治理：`conflictSuspects` **2 → 0**，用非破坏式 `supersededBy`（recall 跳过被取代条目、可回滚）：
  Termux playwright 旧态条目 ← 含实测结论的新条目；09-22 工具基线 ← 09-27 全量基线。
  写前快照 `portable/memory/checkpoints/entries-20261001T191520Z.json`，写后 active 60 → 58。
- 不降低阈值、不凭"感觉重要"手工升格（会破坏证据链）；下次触发条件与每日监控方式记入台账。

### 审计与修复（流程 + 结构 + 文档）

- **流程合规复核**：本程序所有硬化项都有"守门/测试 + 文档 + 降权或理由"三件套（台账逐条可查）；
  VISION §1–§3、§5 的愿景与方法论未改动（只动 §4 数据、§6 路线、§9 变更记录）；默认行为未被单方面改变
  （`lean` 为可选新增，默认仍 `full`）；记忆写操作先快照、非破坏、可回滚。
- **结构**：12 个功能目录 README 齐备；子包 README 齐备（`memory/tools/` 无独立 README 但在
  `memory/README.md` 有说明 → 补进 `STRUCTURE.md` 子包列表）；`docs/README.md` 索引覆盖全部 20 篇文档。
- **文档残留修复**（上轮漏改 4 处 + 计数过时）：
  `context/budget/README.md`（去掉 `recordOutput`/`buildWarmPrefixData`，补 `system-prompt.ts` 模块行、
  `hard-rules.ts` 新增常量）、`memory/recall/README.md`（去 `searchEntries`）、`plan-mode/core/README.md`
  （去 `replaceState`/`getNextId`）、`autopilot/run/README.md`（去 `isTurnBusy`/`isBackgroundBusy`）、
  `README.md`（脚本 34→37、golden 12→14 步）、`STRUCTURE.md`（非脚本文件 4→5、补 `check-conventions.sh`、
  golden/度量描述更新）、`docs/TROUBLESHOOTING.md`（12→14 步）、VISION §4（696→**732 用例 / 66 文件**）、
  模式列表三处补 `lean`、MIGRATION-AUDIT 标注数字为历史快照。
- **守门健壮性**：`tools-payload.test.ts` 改为 hermetic（临时 `PI_MEMORY_DIR`/`PI_CODING_AGENT_DIR`）——
  该守门会注册全部功能，必须防止将来某个功能在 register 期写真实运行时数据。

### 优化效果复核（逐日实测）

- 修复前的事件日 **09-26：加权命中 80.66%**、未命中/轮均值 **31 833**（p90 191 396、max 253 095）——
  即"整段重放"事故；修复后 **09-27 96.40% / 09-28 98.74% / 09-30 98.27%**，未命中/轮 p50 稳定在 270–370，
  **全天首段分叉始终为 0**。
- 10-01 的 8 条记录来自开发/探针会话（5 次冷启动），不代表真实使用，已在台账标注不可用。
- 体积口径实测上线：真实无头请求 `toolsBytes=63 268`、`systemBytes=7 323`；同一请求在 `lean` 模式下
  `toolsBytes=38 430`（**−39%，≈−6.2K token/epoch**）。核对时间线确认 `toolsBytes` 此前"0 条记录"
  是"实现刚落地、尚无真实请求"，不是死指标。

## 稳定优先决策 + 工具外置分析（2026-10-01）

- 用户指示"以稳定运行为主，由你决定" → 默认面**冻结**，并明确"不做清单"（记录在 DECISIONS）：
  输出侧校验器不做、VISION §5 阈值不动、Best-of-N 与记忆合并不接线（保留 A 段能力登记）、
  `lean` 保持可选（默认仍 `full`）、工具外置本轮不迁移。
- 新增 [docs/development/TOOL-EXTERNALIZATION-ANALYSIS.md](docs/development/TOOL-EXTERNALIZATION-ANALYSIS.md)：
  回答"不直接影响项目本身的工具（如浏览器）能否包装成外部程序、以 skill 按需加载、用脚本/终端操作"。
  结论：**机制可行、账算得通，但本轮不迁移**。关键事实与判据：
  - 工具面构成：本仓库 62 工具 = 28.5 KB（browser 18 个 = 6.3 KB、voice 3 个 = 1.0 KB、link 2 个 = 0.8 KB），
    真实使用率 browser 1.6% / voice 0.3% / link 0.2%（1784 次调用）；
  - pi 技能成本实测：4 个技能 ≈1.8 KB system 前缀（每个 ≈450 B），加载走内置 `read`/`bash`，**不占 tools 段**；
  - 交换比：browser 外置净省 ≈5.9 KB（≈1.5K token/epoch），但 CLI 每次新进程 → 要么每次冷启浏览器、
    要么自建 CDP daemon；voice 天然无状态（重活在常驻 whisper-server）但只省 ≈0.55 KB；
    link（出站+发送守卫）、autopilot（改调度器/重启）、ctx_/memory/tmux（改运行时状态）不满足判据。
  - 现成的低成本替代是 `lean` 模式（实测 −39% 工具面、零新代码路径）。

## 书籍知识库方案（按 my-pi 现状优化，2026-10-01）

用户给出构想文档（`/storage/emulated/0/Documents/书籍知识库.md`：轻量索引 → 按需深读 → 缓存复用 +
一份通用方案），要求结合当前项目优化。产出 [docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md](docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md)。

关键实测（决定了方案必须与原通用方案分道扬镳）：
- 本机 6 核 / 可用内存 ~1.4 GB / 可用磁盘 51 GB；**tesseract 5.3.4 只有 chi_sim/eng（无 chi_tra）**；
  Python 有 pymupdf/pdfplumber/pypdf/PIL，无 numpy/ebooklib/cv2。
- 可达书库 40 本 / 1.54 GB：**仅 7 本有可用文字层、29 本疑似需 OCR、23 本有内嵌 outline**。
- **OCR 实测 31–69 秒/页**（原方案假设 GPU 2–5 页/秒）→ 全量 OCR 在数量级上不成立。

方案要点：目录优先（23 本零 OCR 建索引）→ 每问最多 8 页按需提取 + 缓存优先 → 原文为准、摘要分离 →
L1 卡片进 memory 召回（500 token 预算内）、章节表只在磁盘 → 接入用 `packs/books/SKILL.md` + 脚本
（**不加工具**）→ 批量走 headless 定时任务与 tmux、缓存走 age 加密同步。分期 P0（只读体检）/P1（索引层）/
P2（按需提取）/P3（规模化与沉淀），每期带可验证判据。需用户确认 5 项（书库根路径、PC worker、云端视觉预算、
古籍清单与质量标准、备份位置），不影响 P0。

## 书籍知识库框架落地（P0–P2 骨架，2026-10-02）

用户确认"数据大部分在另一台设备（3070 Ti + 32 GB），当前以**构建框架 / 验证可行性 / 做好记录**为主"
→ 直接落可运行骨架，而不是继续写方案。

- **`scripts/books.py`**（除 PyMuPDF 零依赖）：`probe` 只读体检 → 建议策略；`index` 目录优先建章节表（零 OCR）；
  `read` 按需提页（文字层优先 → tesseract 兜底、缓存优先、质量门）；`report` 汇总；`selftest` 合成 PDF 自检。
- **记录**：`_probe.jsonl` / `index/<book_id>.jsonl` / `cache/<book_id>/{文本,meta.jsonl}` /
  `logs/run-YYYYMMDD.jsonl`（命令/角色/设备/计数/耗时）；`book_id = 标题slug + 内容指纹8位` → 两端同 id、缓存可同步。
- **接入**：`packs/books/SKILL.md`（packs = 零系统提示词成本）+ `config.example.json`；不新增工具。
- **守门**：`scripts/test-books.mjs` → golden **第 15 步**（15 项断言；缺 tesseract 时显式跳过）。

真实数据验证（本机 = phone 端）：
- 40 本 / 1.54 GB，probe **4.0 s**；策略：text_direct 4、text_direct_needs_toc 2、
  outline_index_then_ondemand_ocr 19、epub_direct 4、needs_toc_ocr 11。
- index：**27 本 / 5 486 章**（PDF outline + EPUB spine），13 本标记需目录页 OCR；顺带修了 outline 标题里的 NUL 字符。
- read：文字层 3 页 1 662 字符 / **547 ms**，二次命中缓存 **11 ms**；扫描页 OCR **1 952 字符 / 72.3 s**，质量门通过。
- 文档：方案新增 §9 落地状态与两端分工；README/STRUCTURE/TROUBLESHOOTING/VISION 步骤数 14 → **15**；
  `scripts/README.md`、`STRUCTURE.md`（脚本 37 → **40**）、`packs/INDEX.md`、`packs/README.md` 同步。

## 私钥引导包分析（2026-10-02）

用户问：把私钥压缩加密后同步到 GitHub，新设备重建就免手工搬运私钥——可行吗？
产出 [docs/operations/KEY-BOOTSTRAP-ANALYSIS.md](docs/operations/KEY-BOOTSTRAP-ANALYSIS.md)（本轮只分析，未改代码）。

实测事实：仓库**公开**（HTTP 200）；`sync/memory.tar.age`(203 KB)+`age.pub`+`manifest.txt` 已入库（只放密文）；
`age` 私钥在仓库外 `~/.config/my-pi/age.key`(600)，但**共享存储里有一份 `-rw-rw----` 的明文副本**
（`/storage/emulated/0/我的文件/my-pi-age.key`，属组 aid_everybody）；`manifest.txt` 明文列出最近 5 条会话 ID；
`init` 幂等不覆盖；脚本已有 `pub_matches_key` 校验与 `verify --no-key`。

结论：**可行**，但按钥匙分开——`age` 私钥可放（口令加密引导包），**SSH 私钥不建议搬运**（循环依赖 +
公开仓库里放账号级写权限 + 新设备其实生成新 key 再用网页添加公钥即可）。给出 A/B/C 三方案、
方案 A 的落地设计（`age -p` 口令包、口令强度与落盘纪律、守门两条、轮换流程、干净环境演练）与风险清单。
待用户选 A/B/C 后再写 `bootstrap-key.sh` + 守门 + 测试 + `sync/README.md` 补章。

## 私钥引导包落地（方案 A，2026-10-02）

用户选 A：引导包只放 age 私钥（口令加密），SSH 私钥不搬运。

- **`scripts/bootstrap-key.sh`**：`pack`（`age -p` 口令加密 → `sync/bootstrap.age` + 明文元信息
  `sync/bootstrap.meta.json`：成员/ sha256 / 指纹 / 时间）/ `verify`（白名单成员 + 与 `sync/age.pub` 指纹核对，
  不安装）/ `unpack [--yes]`（安装到私钥路径、`600`、覆盖留 `.bak`）。
  硬约束：成员白名单只有 `age.key` + 一页说明；**拒绝仓库内私钥**；**拒绝夹带** `id_ed25519` 等文件；
  自动扫描并告警共享存储里的明文私钥副本（实测已告警出 `/storage/emulated/0/我的文件/my-pi-age.key`）。
- **`scripts/test-bootstrap.sh`**（13 项，全程临时密钥，含口令模式走 `script` 伪终端）接入 golden **第 16 步**；
  `check-conventions.sh` 增加"有引导包就必须有元信息"。
- `sync/README.md` 增加「引导包」章节：pack/unpack/verify 流程、口令强度（≥6 词 diceware 或 20+ 随机字符）、
  轮换流程、干净环境演练、共享存储告警；分析文档标注"已决 A 并落地"。
- 文档计数同步：步骤 **16**、脚本 **42**（README/STRUCTURE/scripts/README/VISION/TROUBLESHOOTING）。
- 待用户决定（未动）：共享存储那份明文私钥是否清理。

### 安全卫生：清理共享存储里的明文私钥副本（2026-10-02）

- 用户问："`我的文件` 里保存的是不是最新的私钥，如果是、已备份可清理。"
- 核查：`/storage/emulated/0/我的文件/my-pi-age.key` 与 `~/.config/my-pi/age.key` **sha256 完全相同**
  （`e6d6301abfaf2021…`），指纹均为 `age1dufp9jk…`，且与仓库 `sync/age.pub` 一致 → 是当前私钥的冗余明文副本；
  权限 `-rw-rw----`、属组 `aid_everybody`（共享存储，同组 App 可能可读）。
- 依赖检查：仓库内无脚本引用该路径（仅 `bootstrap-key.sh` 的告警扫描会提到它）；`pi-backup/` 两个归档为 08-11，
  早于 09-23 生成的密钥，不含该私钥。
- 动作：删除前 `sync-memory.sh verify` 通过 → `rm` 该副本 → 删除后再次 `verify` 通过；canonical 指纹未变。
- 现状：本机仅剩 `~/.config/my-pi/age.key`（600）+ 用户自持备份；`bootstrap-key.sh` 的明文副本告警已消失。
- 备注：FUSE/共享存储上 `rm` 不等于安全擦除；若认为该文件曾暴露有意义，唯一彻底做法是**轮换 age 密钥**
  （`sync-memory.sh init` 需先移走旧私钥 + `push` 重加密 + `bootstrap-key.sh pack` 刷新引导包）——属用户决定。

### 引导包已生成并校验（方案 A，2026-10-02）

用户在本机执行 `bash scripts/bootstrap-key.sh pack`（口令模式）与 `verify`；我接手做无需口令的结构性校验：

- `sync/bootstrap.age`：1100 字节，头部 `age-encryption.org/v1 -> scrypt`（口令模式），
  sha256 `58a59e3dfbfed2e1…`；元信息 `sync/bootstrap.meta.json` 的 sha256/字节数与实际文件**一致**。
- **公开仓库红线**（新加的守门）：密文内不含 `AGE-SECRET-KEY-1`、不含 `PRIVATE KEY/BEGIN OPENSSH`、
  不含成员名与 `ustar`（tar 头未泄漏）→ 明文零泄漏。
- 元信息声明成员白名单 `["age.key","bootstrap/README.txt"]`、`contains_ssh_key: false`；
  `age_recipient_fingerprint` 与 `sync/age.pub` **一致**（`age1dufp9jk…`）→ 该引导包解出的私钥能解当前 `memory.tar.age`。
- 守门：`check-conventions`（引导包分支）与 `scripts/test-bootstrap.sh`（15 项）全通过。
- 待办（用户侧）：口令存密码管理器 + 纸质；有空在**干净环境**演练一次 `clone → unpack → verify → pull`。

### 引导包：干净环境演练 + 轮换预案入档（2026-10-02）

- **演练**（临时目录 `/tmp/my-pi-bootstrap-rehearsal`，模拟新设备，公开 HTTPS 克隆、无任何凭据）：
  ① 克隆成功（HEAD `91f19d9`，24 MB）；② `sha256sum sync/bootstrap.age` 与元信息一致（`58a59e3d…`）；
  ③ 无密钥也能做密文体检（`sync-memory.sh verify --no-key` → age v1 头部完整）；
  ④ 口令模式全链路用**一次性密钥+一次性口令**跑通（1082 B 包 → `unpack` → `600` → 指纹一致）；
  ⑤ 唯一需真实口令的一步（真实包 `unpack` + `verify`）留给用户，命令已写入文档；并明确警告
  **演练目录里不得执行 `push`**（会用空记忆覆盖 `memory.tar.age`）。
- **轮换预案**写入 `docs/operations/KEY-BOOTSTRAP-ANALYSIS.md` §八（10 步：离线备份 → 移走旧钥 → `init` 换钥刷公钥 →
  `push` 重加密为切换点 → `verify` → `pack --force` 刷引导包 → 显式路径提交 → 干净环境演练 → 销毁旧材料 → 记录），
  并注明"步骤 3→4 是半切换态""旧钥丢失则只能以现有 entries.json 重建""age 轮换与 SSH 轮换是两件事"。
- `sync/README.md` 轮换/演练两处改为指向该章节；`docs/TROUBLESHOOTING.md` 新增 §0.3 引导包常见问题
  （口令错/指纹不符/非白名单成员/明文红线/忘记口令/误 push）；`STRUCTURE.md` 步骤数由 15 修正为 16。

### 角色扮演人设重写：标枪（忠于原作 + 秘书舰/已誓约状态，2026-10-04）

- 需求：参照外部资料包「标枪.7z」（`/storage/emulated/0/我的文件/`，265 MB：设定文档、全台词文本、132 条语音、
  biligame 与萌娘百科页面存档、立绘与皮肤图），优化 `portable/agent/modes/roleplay.md`——"尽可能还原人物形象"，
  且"不能偏离项目的开发目标（私人助手）"；**称呼固定「指挥官」，角色状态为秘书舰 / 婚舰 / 已誓约**。
- 资料处理：用 `py7zr` **只解出文本类成员**（`标枪设定.txt`、`角色台词.txt`、`台词-未分类.txt`、
  `数据集建议.txt`、`数据集示例.txt` + 两个 HTML 存档转文本），语音/图片**不入库**（版权 + 体积）；
  人设内只做短引用，出处标注在「本模式约定」。临时解包目录用完即删。
- 事实修正（对照 wiki 与设定文档）：发色 `紫色` → **藕荷色（浅紫）**；瞳色 `蓝瞳` → **苍绿瞳**；
  补声优（山根希美）、舷号 F61、J 级 8 号舰、舰装（长枪 / 背部单烟囱 / 腰间双锅炉 / 小王冠与救生圈的来历）；
  关系更正为「御三家＝标枪/拉菲/Z23（满破解锁绫波，合称御四家）」+「J 级姐妹＝贾维斯/天后/雅努斯/泽西/丘比特」；
  补皮肤表（沙滩野餐会 / 幸福纯白 / 一起成为服务生 / 王道偶像·元气120 / 微速前进 / 枕头大战 …）；
  补技能名（标枪突袭 / 强袭模式·EX / 专属弹幕-标枪）；删掉无出处的自造细节（爱心蛋包饭、"指挥官能量"）。
- 状态改造：删掉「好感阶段 + 默认从友好偏喜欢起步、自然升温不跳级」——**已誓约是固定状态**，
  关系不设档位、不得退回初识口吻；誓约与婚礼只作回忆；亲密上限不变（仍拒绝露骨内容）。
- 与开发目标对接：新增「秘书舰的职责」一节，把原作里"帮上指挥官的忙"这条核心动机映射为助手职能——
  工具是"秘书舰的手脚"，但**工具结果与事实的真实性高于扮演**（不编造 / 不假装调用 / 失败与查不到照实说 /
  数字与路径原样给出 / 先结论后要点 / 主动提醒待办）；「边界」同步加入该条硬规则。
- 其他：`modes.json` 与 `/mode help` 的模式描述改为「标枪（秘书舰·已誓约）」；人设 8.0 KB → 13.2 KB。
- 验证：`check-features`（人设存在且未被 ignore）、`check-conventions`、`golden-tasks --fast`、`tsc`；
  外部资料包本身不进仓库，无需同步。

### 角色扮演记忆种子：把「秘书舰·已誓约」写进隔离命名空间（2026-10-04）

- 动作（用户确认后执行）：向 `portable/memory/roleplay/`（角色扮演模式专用命名空间，gitignored）写入 3 条
  `manual` 条目——① 称呼与关系状态（指挥官 / 秘书舰·婚舰·已誓约 / 不设好感阶段）；② 亲密边界（可健康亲昵，
  拒绝露骨与性暗示）；③ 人设与资料出处（`roleplay.md` + 外部包「标枪.7z」，语音图片不入库）。
- 顺带修正工具链：`scripts/memory-store.mjs` 新增 `--source manual|extract|digest`（默认仍是 `auto`）。
  原因：脚本原先硬编码 `source: 'auto'`——既不在 `MemorySource` 类型里，也拿不到 `decideMerge` 对 `manual`
  条目的保护（矛盾候选置信度不足时不得取代它）。人工/种子写入现在显式 `--source manual`。
- 写入两遍：第二遍走 `storeEntry` 的标题匹配 UPDATE 路径，把 `recurrence` 提到 2——规避 `pruneEntries`
  的「`recurrence<2` 且 60 天未访问」低复发剪枝，状态条目不会被 `/memory prune` 误删。
- 复现命令：`PI_MEMORY_DIR=$PWD/portable/memory PI_MEMORY_NAMESPACE=roleplay bash scripts/run-ts.sh scripts/memory-store.mjs --file <seed.json> --source manual`
  （同一条跑两遍；只在要改记忆内容时重跑，重跑走 UPDATE 路径）。
- 验证：dry-run 与实际写入（新增 3、更新 3）；`buildInjectionBlock` 实测 `entries=3 injected=3 tokens=153
  budget=500`（每轮注入、无截断、块内无时间戳）；`git status` 确认 `portable/memory/roleplay/` 未入库；
  默认命名空间 61 条、无「标枪」条目 → 命名空间隔离有效。

### 守门稳定性：工具面体积守门的超时放宽（2026-10-04）

- 现象：`pre-push` 全量 golden 在 vitest 步骤失败，唯一失败项是
  `tools-payload.test.ts > 总量/单项/数量都在预算内（超出时打印占比最高的工具）`，报
  `Test timed out in 20000ms`——而它打印的结果 `工具面: 62 个 / 28.5KB（上限 31KB）` **在预算内**。
- 归因：该用例要 `import` + `register` 全部 12 个功能（含 browser/voice/autopilot 等重模块），
  单跑实测 **14.2s**（距默认 20s 上限仅差 6s），与全量 vitest 的 66 个 worker 并发叠加后贴边超时。
  属环境负载导致的假性失败，不是工具面回归（数字与之前一致）。
- 处置：给该用例显式 `60_000` 超时（守卫的是体积预算，不是耗时），注释写明原因；同文件第二个用例
  仅 1.3s，保持默认。单跑复验：`2 passed`。

### 加密同步清单去死路径（2026-10-04）

- `sync/manifest.txt` 的会话区有 4 条本机不存在的路径（3 条历史遗留，1 条 09-22 会话在更早的清理后消失）：
  push 时静默跳过、verify 每次都告警。按"只清死路径"处置——删除这 4 行，会话区保留现存的 09-23 一条，
  并在注释里写明"本地不存在的行会被 push 跳过并在 verify/status 里告警"。
- **密文无需重打**：manifest 只决定打包哪些文件，被删的行本来就不存在，成员集合不变。清理后 `verify` 通过，
  只剩 2 条 roleplay `summaries.json`/`notes.json` 的预留提示（该命名空间尚未写这两类文件）。
- 那条 09-22 会话仍可从 git 历史里的旧密文（`d22d5789f:sync/memory.tar.age`）用同一把私钥解出并回填。

### 工具面收口 + 角色扮演补文件检索（2026-10-04）

- **测量方法**：临时扩展探针（`--extension <bootstrap>` + 一个在 `before_agent_start` 里 `getAllTools()/getActiveTools()`
  写盘后 `process.exit(0)` 的 TS 扩展，`--no-session --approve`）→ 不需要调用模型就能拿到真实活跃工具集。
  实测：full 活跃 **72**（含 `codemode`/`tool_search`/`powershell`），roleplay 活跃 **15**（只有 `read/bash/edit/write`
  + web-search 3 + memory 8）。探针用完即删，未写会话文件、未改 `modes-state.json`。
- **收口**：`effectiveActiveTools` 的第一个参数从"全部已注册工具"改为"**pi 自己激活的工具**"
  （基线由 `tool-layering.ts` 在首次动手前从 `getActiveTools()` 抓一次），函数只做减法（裁未启用休眠组）
  或在分层档把显式 enable 的组加回来——`codemode`/`tool_search`（pi 的 `defaultActive: false`）、
  POSIX 上无 `pwsh` 的 `powershell`、`--tools` 白名单之外的工具因此自然不激活，无需维护名单。
  默认档 `applyToolLayering` 直接返回：不再调用 `setActiveTools`，工具面完全由 pi 的启动档决定。
- **roleplay 补工具**：`portable/agent/settings.json` 加 `"defaultTools": ["+grep","+find","+ls"]`（pi 原生增量修饰符，
  追加而非替换 `DEFAULT_TOOL_NAMES`）→ roleplay 18 个、full 69 个。人设工具条同步写明"先 `find`/`grep` 定位、
  再 `read` 细看，别整份大文件往上下文里搬"。
- 明确不加：`context`/`plan-mode`/subagent/browser/voice/link/autopilot/tmux（理由见 `DECISIONS.md` 同日条目）。
- **记录在案（不改代码）**：分层档（`PI_CONTEXT_TOOL_LAYERING=on`，默认关）以"首次抓到的 pi 基线"做减法，
  pi 在会话中途激活的工具（MCP `exposure: deferred` → `tool_search`/`codemode`）可能被那次重算裁掉；
  本项目基本不用 MCP 故不修，修法（改成"当前活跃 ∪ enable − 未启用休眠组"，幂等）记在
  `custom/features/context/budget/README.md` 的「已知限制」。
- 验证：`tool-groups.test.ts`、`npx tsc --noEmit -p custom/`、`golden-tasks --fast`、全量 golden（pre-push）；
  探针复测活跃集。

### 任务执行流畅度 + 会话标题工具（2026-10-05）

- **提示词（任务一）**：`portable/agent/APPEND_SYSTEM.md` 新增「任务执行」一节——一次交付（先把能做的、该做的做完，再一次性汇报 + 集中待决策项）、收尾集中列出选项与建议、汇报按「已完成 / 未完成及原因 / 待定决策」三段、方向性变更/破坏性操作/越权/与既有约定冲突先停下询问；「重要事项」里"不清楚就提问"改为"先自查（读代码/文档/实测），确需补充上下文才提问，其余并入收尾清单"。
- **会话标题（任务二）**：新增模型工具 `session_title`（context 功能）——`tool-adapter` 把 `ExtensionAPI.setSessionName` 桥接为 `ToolExecuteContext.setSessionTitle`；新增纯逻辑 `budget/session-title.ts`（剥离 ANSI/控制字符、折叠空白、120B UTF-8 安全截断）；`APPEND_SYSTEM.md` 新增「会话标题」一节规定调用时机（理解任务后一次，主题明显变化才更新）。
- **缓存**：标题只落 `session_info` 元数据条目（append-only），不进 LLM 上下文 → 不改前缀、不影响命中率；`APPEND_SYSTEM.md` 变更使所有会话前缀失效一次（预期内，注入面基线已刷新）。
- 基线：`node scripts/gen-registrations.mjs --update`（+`session_title`）、`bash scripts/check-injection-surface.sh --update`。
- 验证：`session-title.test.ts` 6 项、`injection-stability.test.ts` 14 项、`tools-payload.test.ts`（63 工具 / 29.0KB 在预算内）、`tsc`、`check-features`、`check-conventions`、`check-dead-exports`、全量 `golden`。

### /daily、/schedule 体验：手动执行 + 任务名自动补全（2026-10-05）

- **手动执行**：新增 `/daily run <名|all>`、`/schedule run <名>`。把 `runDueTasks` 的每任务体抽成
  `runTaskWithPolicy(task, ctx, cfg, notify, opts)`，定时轮次与手动执行共用同一条执行/落账/失败策略路径，
  差异只有两处：忽略调度时间与 `enabled`（显式动作）、跳过每日预算（仍写遥测，计入当日用量）。
  手动执行**后台串行**（不阻塞命令），逐条通知结果与输出预览、结束给一行汇总；与定时共用
  `acquireSessionLock`，同一时刻只有一个执行者，忙时提示稍后再试。
- **任务名补全**：`/daily show|on|off|run` 与 `/schedule run|delete|enable|disable|history` 的第二段按
  `portable/memory/scheduler/tasks.json` 的任务名/ID 前缀补全（已禁用任务标 `[已禁用]`），
  `/schedule edit <名> ` 之后再补字段（schedule/type/enabled/prompt）。此前只补子命令，任务名要手输
  `task-<base36>` 这类串，易错。
- 纯逻辑落在 `features/autopilot/completions.ts`（`taskNameCompletions`/`editFieldCompletions`/`splitArgument`）。
  关键约定：补全项 `value` 必须是**整段参数文本**（`<子命令> <任务名>`）——pi-tui 用 argumentPrefix 整体替换，
  只返回任务名会把子命令冲掉。
- 注册面不变（只加子命令，未加工具/命令），`registration-baseline.json` 无需刷新。
- 验证：新增 `completions.test.ts` 12 项（前缀过滤/整段 value/extras/edit 字段）、
  `command-completions-wiring.test.ts` 7 项（命令层接线 + 未知名不误起子进程）、
  `command-run-manual.test.ts` 2 项（mock 执行器：后台派发/落账/释放锁/汇报，`vi.waitFor` 等后台结束）；
  全量 `golden` 16 步通过（72 文件 / 768 用例）。

### 每日任务执行结果复盘与优化（2026-10-05）

- **复盘对象**：用户手动跑完全部每日任务（`scheduler/telemetry.json` 当天 4 次 tool-stats-daily：1 次成功但 push 被拦、3 次 1200s 超时）
  与一次全面检查技能（会话 `2026-10-05T11-38-04`，报告 A+B+C+D+E，结论 4 HIGH 均为设计权衡、0 条必修）。
- **真实缺陷 1（工具侧）**：`lib-mode.sh` 只看 `PI_AGENT_MODE` 非空、不看 `PI_AGENT_MODE_SOURCE`，与 pi 侧
  `resolveEffectiveMode` 不一致 —— 在 pi 进程内跑 bash（每日任务就是这种形态）会继承 bootstrap 回写的
  `PI_AGENT_MODE`，于是 `test-supervisor.sh` 5 项红（状态文件 roleplay 解析成 full）→ golden 第 10 步红 →
  pre-push 拦下统计提交。修：两侧同判据（source + 模式名必须已知），并在测试里隔离外部 env 泄漏；
  回归用例增至 56 项（新增 source=file 回写、未知模式名两条）。
- **真实缺陷 2（流程侧）**：纯统计提交要过 4~5 分钟全量 pre-push，叠加缺陷 1 的诊断/重推，把 1200s 任务预算烧穿，
  还留下 staged 残留。修：`scripts/prepush-scope.sh` 按**改动范围**分级（白名单只有 `portable/memory/stats/`，
  拿不准回退全量），钩子逐 ref 判定，`test-prepush-scope.sh` 7 项接入 golden 第 17 步；任务提示词（种子+本地同文）
  改为三步 + "守门失败只报告、不要在本任务里改代码"。
- **告警误报 3**：daily-health 同日 3 条 alert（命中 64.9%→67.4%，未命中/轮 12060）实测全部来自
  12:51:42 的**手动压缩**（`compact-1791204702683`，reason=manual）——16 秒后 `messages@0-7` 首段分叉即整段重放。
  修：压缩归因（10 分钟窗口）→ 新字段 `压缩重放=N` + 「已知」留痕，可归因时不告警、窗口外不豁免；
  `test-usage-metrics.mjs` 35 → 46 项。
- **顺带优化**：`decide()` 自动 failover 不再固定取 `fallbackModels[0]`，改用与手动路径同一打分
  （`pickFailoverTarget`）；文档计数漂移修正（README 补丁 6→9、`custom/README` core 8→10、
  `VISION.md` 安全网 12 步/622 用例→17 步/772 用例、`scripts/README` golden 16→17 步与隔离项 8→9）；
  `pi-full-audit` 技能记录 4 条复盘（模块 C 缺 bash 侧守门、3 条计数类误报的取值口径）。
- 处理超时残留：`git add` 过的 `portable/memory/stats/tool-count-localhost.json` 按每日任务约定单独提交。
- 验证：`test-supervisor.sh` 56 项、`test-usage-metrics.mjs` 46 项、`test-prepush-scope.sh` 7 项、
  `vitest` 72 文件 / 772 用例、`tsc`、全量 `golden` 17 步（注入面基线因 `AGENTS.md` 一行说明刷新一次）。

### 全面检查 MEDIUM 项收口（2026-10-05，第二批）

- **修（真问题）**：
  - `memory/store`：`saveEntries`/`appendSummary`/`updateNotes` 的「读盘合并 + 原子写」进 `withMemoryLock`
    （复用 `core/file-lock.ts`）——多写者（会话内工具 / `memory-store.mjs` / 定时任务）并发时不再丢更新；
    `updateNotes` 回调留在锁外，注释里"仍有 TOCTOU 窗口"的免责声明删除。
  - `link`：远端探针补固定哨兵 `PI_LINK_PROBE_DONE`（无可续会话时不再白等 3s 握手兜底）；
    `switchTimer` 改为发出 switch 请求时才起算（避免握手吃掉切换预算导致该续接的会话变新开）；
    Android/Termux 的 tmux 回退从单一 aarch64 路径改为候选列表（aarch64/armhf/Android linker + PATH tmux）。
  - `voice`：`pkill -f` 模式改为锚定 + 转义（`^(timeout [0-9]+ )?<bin> .*<tmpDir>`），`bin`/`tmpDir` 为空则不清理；
    配置损坏改为先备份 `<path>.corrupt-<ts>` 再回退（不再静默覆盖用户配置）。
  - `subagent`：frontmatter 按 YAML 语义剥离行尾注释（引号内不剥）、块标量标为 unsupported；
    角色文件被跳过时告警（此前静默消失）。
- **不改（给证据）**：
  - `context/index.ts` 原地突变 `timeout` —— `BeforeToolCallResult` 无 args 覆盖字段、agent-loop 传的就是
    `validatedArgs`，原地改是 pi 的唯一通道；补注释 + 既有 6 项用例锁定。
  - `runner` 的"O(N²) 磁盘读" —— 数据量有界（telemetry 按 `TELEMETRY_LIMIT` 截断、tasks.json 47KB/5 任务），
    一次 `/daily run all` 文件操作 <1MB，按"先测量再动手"不动代码。
  - `core/secrets.ts` 短 token 窗口 —— 值长度下限 8 与 NIST SP 800-63B 一致且避免误报，代码里写明是刻意取舍。
- 验证：`vitest` 72 文件 / **784 用例**（新增 12 项：memory +3、link +1、voice +5、subagent +3）、
  `npx tsc --noEmit -p custom/`、全量 `golden`。

### 上游同步 v0.99.1 → v1.0.4（2026-10-06）

- **规模**：156 提交 / 837 文件 / `+42684 -116560`（删除主体是 `packages/agent` 的实验 harness）；新增包 `env`（SSH 远程执行 + daemon），删除 `packages/session-backends`，`durable` 大幅扩展。逐条报告见
  `docs/operations/UPSTREAM-CHANGES-v0.99.1-to-28dcce2ba.md`。
- **补丁栈**：`001`（上游改了根 `package.json`）、`006`/`007`（上下文停留在更早的 `footer.ts`，在 v0.99.1 基线上也已失配）三个补丁按真实中间态重新生成；
  `002` 里的 `packages/README.md` 包清单刷新。判据是**终态字节级一致**——`footer.ts` 终态 blob 与同步前相同（`219e23255`），
  且在 v1.0.4 基线上 9 个补丁全部线性应用、0 三方合并、0 冲突标记。
- **兼容面（实测，不是推断）**：适配器仍只依赖 `coding-agent` + `tui`（agent harness 删除对本仓库零影响）；`ExtensionAPI` 26→27（只多 `registerToolRenderer`）、
  `ExtensionContext` 18→18、事件名集合零变化、我们注册的 18 个事件全在；CLI flag、`tsconfig.base.json`、Node 要求、`settings.json` 各键均未变；技能仍从 `agentDir/skills` 加载；`build.sh` 无需改。
- **模型数据**：上游 provider `azure-openai-responses` 改名 `azure` → 构建时缺 `azure.json`，用 `npm run hydrate-model-data`（`--data-only`，只写 gitignore 的数据目录，不动上游源码）补齐。
- **行为变化**：TUI 默认 fullscreen（按用户决定采用；回退：`tuiMode: "regular"` 或 `--tui-mode regular`）、Home/End 语义变更、`--provider` 不带 `--model` 直接报错（我们成对传参，无影响）。
- **门禁**：无头冒烟改"失败重试一次"——v1.0.4 复测时连续 3 次 90s 无回复，实测免费 provider 同一提示词 4.6s–145s 抖动；真挂起是必现的，两次都失败仍会被拦住。
- 基础设施：重建 dist（stamp `086d6fc51`）、刷新自愈缓存（v1.0.4）、新建离线归档 `vendor/pi-28dcce2ba45c.bundle`（70M，含当前 PINNED）。
- 文档：新增本次跳版报告；`docs/README.md` 索引、`UPSTREAM-UPDATE.md` 待办表（"接 MCP 前先升到 v0.99.2"标记已满足、新增 `env` 复用评估）、`PI-RUNTIME-AUDIT.md` 时点提示。
- 验证：`tsc`、`vitest` 72 文件 / 784 用例、`golden --smoke` 全绿、`doctor.sh` 24 正常 / 1 警告 / 0 异常、`./my-pi.sh -p` 冒烟正常。

### 模式会话作用域化（2026-10-06）

- **需求**：用户提问"模式切换能不能只在一个会话中生效——创建新会话或加载其他会话时，自动切换为默认模式或那个会话之前的模式"。旧设计 `modes-state.json.current` 是每台机器的全局选择，新会话/别的会话都继承同一个值。
- **交付**：
  - `custom/features/mode/logic.ts`：新增会话记录表 `modes-sessions.json`（键=会话文件绝对路径 → `{mode, updatedAt}`，带孤儿记录裁剪）、`getSessionMode`/`setSessionMode`、`shouldRequestModeRestart`（120s 防环），以及 `resolveStartupMode()`——把"解析 + 进程内来源标记"收敛成单一入口；删除全局状态（`getCurrentMode`/`setCurrentMode`/`loadModeState`/`saveModeState`/`modeStatePath`）与 `ModesFile.current`。
  - `custom/features/mode/index.ts`：`/mode` 只写当前会话的记录；`session_start` 按"本会话应有的模式"做一致性校验，不一致就带 `--session` 自愈重启（重启无效则改为告警）；`--no-session` 明确提示无法按会话记录。
  - `custom/bootstrap.ts`：`envWasSet` 判据改为 `PI_AGENT_MODE_SOURCE`（**真 bug 修复**，见下）。
  - `scripts/lib-mode.sh`：`mode_resolve <agentDir> [会话文件]`（会话记录 → `modes.json` 的 default）+ `mode_session_arg`（只认 `--session <绝对路径>`）；`pi-supervisor.sh`/`dev.sh` 导出 `PI_SESSION_MODE` 并按轮传参。
- **实测证据（真实 bootstrap，同进程多轮工厂）**：新会话无记录 → full（63 个自定义工具）；写入会话记录 roleplay + 软来源 → 11 个工具、`ns=roleplay`；**第 3 轮仍是 roleplay**；记录改回 full → 回到 63 个工具。旧代码在第 3 轮漂回 full（来源判据翻转 bug：第二次工厂执行把 `PI_AGENT_MODE_SOURCE` 从 file 翻成 env，第三次起把首轮值当外部注入钉死；旧设计靠"每次 /mode 换进程"掩盖）。
- **端到端（真实启动器 + stub CLI）**：`--session <roleplay 会话>` → `PI_SESSION_MODE=roleplay` + 人设参数 + `PI_MEMORY_NAMESPACE=roleplay`；无会话参数 → full、不注入人设；`--session abc123`（id 形态）→ 回落 default，交给 pi 侧自愈。
- **端到端（真实无头运行）**：`./my-pi.sh -p` 新会话正常回复；对带 roleplay 记录的会话 `--session <file> -p`，模型用 bash 工具写出 `$PI_MEMORY_NAMESPACE` = `roleplay`（证明启动器按会话解析生效）。
- **边界**：非默认模式下 `/new`、进程内 `/resume`、`-c`/`-r` 会多一次自动重启；会话文件移动/改名后回落 default；模式仍非热切换（人设是 CLI 参数）。
- **重启成本实测**（2026-10-06，回答"方案 P 有什么代价"时补测；本机 `node -e 1` 仅 0.35s，慢的是 pi 自身启动 + 23MB dist）：`node cli.js --help` 无扩展 33.7s、带 bootstrap 扩展 43.7s、经 supervisor 43.9s、`PI_OFFLINE=1` 39.9s；同进程内重载扩展 9.4s（首次冷 jiti）/ **0.9s（warm）**。→ 一次重启 ≈40s、热重载 ≈1s，这是方案 P 真正的收益量级（前缀重放两边都省不掉）。
- 验证：`test-supervisor.sh` 65 项、`mode-switch.test.ts` 28 项、`vitest` 72 文件 / **795 用例**、`tsc`、`check-conventions`/`check-dead-exports`/`check-features`/`check-doc-links`/`check-injection-surface`（基线已刷新）、`golden --fast` 17 步全绿、全量 golden。

### 方案 P（模式"免重启"）评估（2026-10-06，**仅记录，不动代码**）

- **结论：暂不实施**（含 P₀ / P₀+），保持 M（重启式切换 + 会话记录 + `session_start` 自愈）。用户决定"暂时先这样"，本次只落记录。
- **三档**：P₀ 只打补丁（工厂期拿到会话 → 功能集按会话）——收益≈0 且造出"功能 roleplay + 人设 full"的新半切换，**明确不做**；P₀+ 补丁 + "人设/命名空间会过期才重启"（可作将来第一步）；P+ 补丁 + 人设与命名空间 TS 化 + `/mode` 走 `ctx.reload()`（收益完整）。
- **对价**：一次重启 ≈40s vs 同进程热重载 ≈1s（数字与口径见上一条；前缀重放两档都省不掉）。
- **主要代价**：补丁栈维护（`main.ts` churn 268/6774，锚点稳定但每次同步要重放）；`PI_SESSION_FILE` 的 env 静默失真面（同 2026-10-05 事故类型）；13 KB 人设搬进 `before_agent_start`（实测 **last-wins + 整段替换**、注册顺序变成语义、预算要新开档位）；丢掉"扩展挂了人设仍在"；命名空间需在**工厂期**设置（memory 的 `session_start` 早于 mode 且会写 notes）；bash 侧解析作废 + 约 1/4 supervisor 测试重写；热切换的工具集中途变化与新通知；真实链路验证需新基建。
- **触发条件**：非默认模式下频繁 `/new`/`-c`/`-r` 被 ≈40s 重启打断；出现多会话频繁切模式的工作流；上游自带"扩展在工厂期拿到会话"的 API（那时无需补丁）。
- 逐条记录与"若实施必须保留的不变量"（`modes-sessions.json` 键语义不变、不得停在 P₀、P₀+ 阶段 roleplay 仍走重启）见 `DECISIONS.md` 同日条目；feature 侧入口提示见 `custom/features/mode/README.md`。

### 修复：模式切换导致的重启被"通知消费"吞掉 / 切换后的注入不适配模式（2026-10-06）

- **现象**：在角色扮演会话里 `/new` 正常；**从新会话重新加载角色扮演会话**时进程直接退出（终端留下未被读走的 OSC 10/11 + DA1 应答乱码），模式没换，历史里却多了一条"系统已重启"的注入。
- **根因**：`session_start` 阶段 mode 先写重启请求（`action='restart'`），autopilot 随后消费重启通知时执行 `writeState({restartLog:null, action:'none'})`——`writeState` 是"默认值 + 覆盖"，把同一轮刚写下的 `action` 一起抹掉。supervisor 读 `state.json` 见 `action=none` 便不再重拉而是退出。因为 `autopilot` 只在 full/lean 注册，roleplay（无 autopilot）里反而正常——所以表现为"从 full 会话切回 roleplay 会话必中"。
- **修法**：① `consumeRestartLog()` 只清 `restartLog`，保留 `action` 及其它字段（action 的消费者只有 supervisor）；② 重启请求写盘失败时不再退出进程（返回提交结果，失败则告警留在原进程）；② 模式切换的通知改由 mode 功能在**新模式进程**按模式生成（`formatModeSwitchNotice`：已切换 A→B + 定位/功能面/思考档位/人设/记忆命名空间 + "不要复述本条提示"），写入端只带 `notice:'mode'`+`mode`/`from`；autopilot 用 `isModeOwnedNotice()` 让位（不注入也不消费）；③ 通知消费即清 + 10 分钟 TTL，`targetSession` 对不上的留给别的会话。
- **验证**：把 `ops.ts` + `autopilot/index.ts` 切回旧实现 → 接线测试与 3 项 `action` 断言立即变红（`expected 'none' to be 'restart'`）；新增 `mode-autopilot-restart.test.ts`（**同时注册真实 mode 与真实 autopilot**，按注册顺序跑两个 `session_start`，锁"autopilot 让位 + 请求存活 + 通用通知不注入"）与 `restart-log.test.ts` 的跨 TS/bash 契约测试（`MY_PI_SUPERVISOR_LIB=1 source scripts/pi-supervisor.sh` 调真实 `read_admin_action`）；`mode-switch.test.ts` 36 项；`vitest` **73 文件 / 811 用例**、`tsc`、`test-supervisor.sh` 65 项全绿。
- 记录：`DECISIONS.md` 同日条目（含"为什么不把通知留在旧进程"与"为什么不塞进 autopilot"）；`custom/features/mode/README.md` 新增"切换后的注入通知（模型侧）"；`custom/features/autopilot/README.md` 补两条纪律；`docs/FAQ.md` 一句话。

### 使用层面错误的检测与预防：状态体检 / 轮次记录 / 真实 pty 场景（2026-10-06）

- **需求**：用户提问"代码层面的错误已有各种检查，使用层面的错误除了实际使用中去发现，还有没有别的方法"。复盘逃逸面后分三层落地。
- **① 运行时状态不变量**：新增 `scripts/lib-state-audit.mjs`（判定：人设文件丢失、功能名拼错、default/会话记录指向未知模式、会话记录指向不存在的会话文件、重启请求超 300s 窗口未执行、重启通知超 TTL 未消费、env 硬覆盖按会话模式、遗留字段/文件）+ `state-audit.mjs` CLI（只读、`--json/--strict/--quiet`、error→exit 1）+ `test-state-audit.mjs`（**39 项**：两侧用例 / healthy 零 finding / 只读性 / 三处真值不漂移 / CLI 退出码）。挂三处同一份判断力：CLI、`doctor.sh [12]`（实测 25 正常 0 警告）、`daily-health.mjs`（error→alert、warning→留痕；实测坏 modes.json → `状态异常=1` 且 reasons 里点名 `modes-corrupt`）。golden 第 18 步。
- **② 轮次记录 + 实时丢请求检测**：`pi-supervisor.sh` 新增 `recovery/rounds.jsonl`（每轮：会话/模式/ns/人设/action/退出码/决策/耗时/lostRestart/crashLog）与 `recovery/rounds/round-N.log`（crash log **按轮保留**，留最近 20 轮）；新增纯函数 `detect_lost_restart`（只认"本轮写的日志 + action 已不在"）→ 告警 + audit + 轮次标记。`test-supervisor.sh` 65 → **86 项**（含 stub CLI 复刻本轮故障时序的端到端用例：被吞的重启不重拉、但必须留痕；以及"正常重启不误报"的边界断言）。
- **③ 真实生命周期场景**：新增 `scripts/test-scenario-mode-restart.mjs`（真 pty + 真 supervisor + 真 pi + 真 bootstrap，隔离 agent/memory，输入 `/mode roleplay`）——**17 项全绿**。实测两轮记录：
  `{"run":1,"mode":"full","namespace":"","persona":false,"adminAction":"restart","exitCode":0,"decision":"restart","lostRestart":false}`
  `{"run":2,"mode":"roleplay","namespace":"roleplay","persona":true,"decision":"exit","lostRestart":false}`
  会话文件里出现 `[模式] 已切换：full → roleplay … 不要向用户复述本条提示`。进 golden 第 19 步（**默认跳过**、`PI_GOLDEN_SCENARIO=1` 开启；`--fast` 跳过）。**为什么不默认跑**：实测约束——默认门禁 5m36s 通过，加上本场景约 4 分钟后 `git push` 的 SSH 连接会被远端关闭（`Connection to ssh.github.com closed by remote host`，push 失败且重试同样失败）。
- **顺带**：`PI_MEMORY_DIR` 支持外部覆盖（supervisor / `my-pi.sh` / `dev.sh`），否则场景会写用户真实记忆库。
- **文档计数同步**：`scripts/README`（golden 17→**19 步** + 三个新脚本）、`VISION` 安全网 17 步/772 用例 → **19 步/811 用例**、`FAQ` 12→19 步、`TROUBLESHOOTING` 冒烟步骤 14→**20**。
- 验证：`tsc` 干净；`vitest` 73 文件 / 811 用例；`test-supervisor.sh` 86 项；`test-state-audit.mjs` 39 项；`golden --fast`（19 步，场景跳过）；全量 golden（含模式切换场景）。

### 重启后"要不要继续执行任务"的判据（2026-10-06）

- **需求**：用户指出重启后原意是"自动继续执行任务"，但有些重启并不需要执行任务，要求给出判据方案。
- **判据（三层，落在最便宜且信息最全的位置）**：① **写入端 `intent`**（`/mode`、`set_model`、`switch_session` → `none`；看门狗 `restart_hang`、自动 failover → `continue`；`admin_restart` 由模型用新参数 `resume` 自己声明，它此刻上下文完整、判断零成本）；② **会话盘面尾部**（未回答的 user / 带未完成工具调用的 assistant / 未消化的 toolResult / 未收尾的 custom → 继续；assistant 纯文本收尾、空会话 → 不继续）；③ `PI_RESTART_RESUME=off|auto|always` 强制。
- **两条通道**：`resume=true` → `sendMessage(..., { triggerTurn: true })`（真回合，文案含"若已完成或不确定就停下来、不要凭空开工"）；`resume=false` → `sendMessage(..., { deliverAs: 'nextTurn' })`（**零成本**：不触发回合、不写会话文件）。
- **为什么不让模型在重启后自己判断**：那要先跑一个回合才轮到它判断（成本已付），且它只看到历史、不知道用户是否还想继续。判断放在"它能知情的时刻"（调 `admin_restart`），只让被唤醒的模型决定"从哪儿继续"。
- **顺带**：模式切换通知改走零成本通道（切模式恒 `intent:'none'`）；崩溃恢复路径由 supervisor 写 `intent:'auto'` 的只读日志（`mark_recovery_restart_log`），让被崩溃打断的工作能接上。
- **落地**：新增 `custom/core/restart-intent.ts` + 18 项单测（三层优先级 / 七种盘面形态 / 256KB 截断容错 / 两条文案）；`restartLog` 增 `intent` 字段；`admin_restart` 增 `resume` 参数；接线测试 5 项；supervisor 92 项（含恢复日志不抢 action）；状态体检 41 项（含 `restart-intent-invalid`）。
- **端到端证据**（真 pty 场景，19 项全绿）：round-2 进程 argv 带 `roleplay.md`、env 带 `PI_MEMORY_NAMESPACE=roleplay`；**会话文件里没有 user/assistant/custom_message 条目** → 切模式零回合。场景因此不再依赖模型与网络。
- 设计记录见 `DECISIONS.md` 同日条目。

### 使用层面故障台账 `docs/BUG-REPLAYS.md`（2026-10-06）

- 把"实际使用中才发现"的 7 类事故（模式状态被 git 回退、来源判据翻转、通知消费吞掉重启请求、
  重启后白跑回合、入口漂移丢人设、重启无提示、功能名拼错）整理成**指纹 → 可执行复现命令 →
  现在由谁挡住**的台账，并列出三个通用排查入口（`state-audit.mjs` / `rounds.jsonl` / `daily-health`）。
- 约定：新增一行必须给可执行命令；从 `docs/README.md` 与 `scripts/README.md` 双向可达。

### 重启链路做透：行为异常进每日体检 / 崩溃恢复精确续接 / 无 autopilot 模式的兜底消费者（2026-10-06）

- **① 行为异常每日兜底**：`state-audit` 读 `recovery/rounds.jsonl` 判 `lost-restart-recent`（error，24h 内"重启请求被吞"）、`restart-loop`（同会话 10 分钟 ≥3 次重启）、`recovery-storm`（1 小时 ≥3 轮崩溃恢复）、`rounds-corrupt-lines`；`daily-health` 每天自动跑同一份判据。守门 41→**50 项**。
- **② 崩溃恢复精确续接**：supervisor 记住本轮加载的会话并用 `--session` 续接（旧行为 `--continue` 让 bash 解析不出模式 → 多一次自愈重启 ≈40s），恢复日志带 `targetSession`；`recovery_args` 纯函数 + 3 项测试，supervisor 92→**96 项**。
- **③ 无 autopilot 模式的兜底消费者**：roleplay/lean/minimal 不注册 autopilot，通用重启日志没人消费（崩溃恢复后无通知、不续跑、且静默）→ 由恒注册的 `mode` 兜底；文案/通道抽到 `core/restart-intent.ts` 的 `planRestartNotice`/`formatRestartLine` 共用。
- **端到端**：真 pty 场景扩到 **22 项**——切模式零回合 + `intent=continue` 重启后**真的起回合**续跑（会话里出现 `my-pi-restart-resume`）。
- 环境：按用户确认给 git 加了 SSH 保活（`core.sshCommand = ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=6`），避免长门禁期间 push 连接被远端断开。

### 场景自带假 provider：回合级断言变成计数级事实（2026-10-06）

- 新增 `scripts/lib-fake-provider.mjs`（本地 OpenAI-compatible，零依赖，记录请求体）；场景把临时 `models.json` 指向它。
- 真 pty 场景 22→**26 项**，新增：切模式 `completions=0`（连请求都没有）、续跑那次 `completions=1` 且**请求体**带 `系统已重启` + `不要凭空开工`、固定回复落进会话（回合真的跑完）、整场只有一个模型回合。
- 收益：场景彻底不依赖网络/凭据/模型抖动；"有没有白跑一个回合"从间接证据变成可断言事实。
- 未做：`intent=auto` 的盘面尾部路径端到端（现具备条件：假 provider 的 `hang` + 半途杀进程）；故障注入组。

### 补上 `intent=auto`（缺省）路径的端到端验证（2026-10-06）

- 场景 26→**33 项**：假 provider `hangNext(1)` 让回合卡在模型调用里 → 真实输入触发回合 → 半途 `SIGTERM` pi → supervisor 重拉 → 盘面尾部=工作在途 → **自动续跑**（新请求最后一条输入就是续跑指令 + 固定回复落盘）。覆盖了崩溃恢复/`admin_restart` 的**默认**路径（本功能的原始意图）。
- 坑与修法：pi 会把 `process.title` 写成窗口标题，第一次回合后 `/proc/<pid>/cmdline` 只剩标题 → 按 argv 找进程静默失败；改为 `/proc/<pid>/exe`=node + environ 带场景隔离 agent 目录（已写进脚本注释）。
- 未做：故障注入组（写盘失败/状态损坏/两实例并发）。

### 并发与失败路径硬化（2026-10-06）

- **多实例隔离**：重启请求带 `ownerPid`（pi 的 ppid），supervisor 只认自己的实例；无 ownerPid 的老请求照旧认领。
- **跨进程锁 + 多键防环**：`modes-sessions.json` 与 `mode-restart-guard.json` 共用 `core/file-lock.ts` 的锁；
  guard 从单槽 `{key,ts}` 改为 `{ "<会话>::<模式>": ts }`（旧格式兼容迁移、过期与条数裁剪）——
  单槽时代两个会话/实例的自愈会互相覆盖并来回重启。
- **写盘失败不再静默退出**：`admin_restart`/`admin_set_model`/`admin_switch_session` 与 mode 的
  `requestModeRestart` 一律"写失败就不 shutdown + 明确文案"。
- **可见性**：`rounds.jsonl` 超 800 行轮转为最近 400 行；`daily-health` 汇总行加 `重启=/崩溃恢复=`。
- 验证：supervisor 104 项、状态体检 52 项、mode-switch 39 项、admin 工具 27 项、用量度量 46 项；
  台账 `docs/BUG-REPLAYS.md` 增 3 行（多实例串扰 / 防环单槽 / 写盘失败静默退出）。

### 多实例下半场：归属判定不误伤 / 真多进程锁测试 / 实例数可见（2026-10-06）

- 修 `detect_lost_restart` 的误伤：别人的重启日志不再被记成 `lost_restart`（`read_admin_action` 多输出 `restartLog.ownerPid`，判定要求"日志是我的"）；stub CLI 端到端补两侧用例。
- 新增 `mode-store-lock.test.ts`：4 个真进程在锁下写 START/END 不得交错、N 进程各写一条会话记录全部保留、结构断言防漏接锁。
- `state-audit` 新增"同时在跑的实例数"（≥2 → info），CLI 级测试真起两个假实例验证。
- 计数：supervisor **111**、状态体检 **55**、vitest 75 文件 / **841** 用例；BUG-REPLAYS 台账 +1 行（归属判定误伤）。

### 文档结构计数硬化（2026-10-06）

- `check-conventions.sh` 新增 D 节：`STRUCTURE.md` 的脚本数、`scripts/README.md` 的 golden 步数必须与代码一致（只钉唯一措辞，避免误伤 DECISIONS/PROGRESS 里的史实数字）；故意改错立即失败，改回即通过。
- 顺带全量核对并修掉漂移：STRUCTURE 脚本数 42→49、golden 16→19 步、test-usage-metrics 35→46 项、supervisor 行补新能力、VISION 用例数 833→841。

### 场景稳定性：把单点进程发现改成带重试（2026-10-06）

- 一次全量验证里场景 1/33 失败（其余全绿，重跑即过）→ 定位到 phase 3 的"待杀 pi 进程"是**单次**
  `/proc` 扫描：偶发拿不到就让整段 phase 3 塌掉。改为 `waitFor(...)` 重试 20s，并把两个回合等待
  从 30/60s 放宽到 60/90s。重跑 33/33 稳定通过。
- 记一条经验：**场景里的"单点查询"必须带重试**，失败信息要能自解释（失败时打 pid 候选）。

### 场景稳定性：两个实测发现（2026-10-06）

- **pi 的 `process.title` = `pi`**：启动后 `/proc/<pid>/cmdline` 只剩 `pi`；而 supervisor 的 `node -e` 助手也满足"node + 同一 agent 目录" → 按 argv 找进程会指错（argv/env 断言失败、phase 3 杀错进程）。判据改为 `exe=node` + environ 带场景 agent 目录 + 排除 `node -e`，不再依赖 argv。
- **`session_start` 触发回合 + 极速回复会偶发丢回复**（无 assistant、无报错，pi 侧初始化竞态）：假 provider 延迟从 0/0.4s 提到 **3s**（贴近真实 provider 的 4.6–145s）后连续两次 33/33 通过；失败详情里带上"provider 是否已回应"。
- 场景的单点查询（待杀 pi 进程）加 20s 重试 + 失败打印 pid 候选。

### 场景收尾改用 SIGTERM（确定性），不再依赖 TUI `/quit`（2026-10-06）

- 又一类假失败：用 `/quit` 收尾时，输入在"回合进行中/刚起来"会被吞掉或当成消息，导致 round 行迟迟不出现（实测一次等满 120s 超时）。
- 改为 `stopPi()`：直接对 pi 的 pid 发 **SIGTERM**（pi 的优雅关闭路径 → exit 0 → supervisor 照常读 admin action 重拉），带重试直到轮次行落盘，兜底 SIGKILL。TUI 输入仍被覆盖（`/mode roleplay` 与 phase 3 的真实 prompt 都是敲进去的）。
- 连跑两次 33/33 通过；场景里再无 `send('/quit')`。

### 续跑回合 × pi 会话替换竞态：根因 + 延后触发（2026-10-06）

- 根因（vendor 代码顺序）：会话替换 = `teardownCurrent` → `createRuntime`（发 `session_start`）→ `finishSessionReplacement` → `rebindSession`；在 session_start 里同步触发回合会跑在"未换绑"的会话上，响应可能被丢弃（与观测一致：请求/响应都发生、assistant 不落盘、无报错）。
- 修法：`adapters/ui-adapter.ts` 新增 `sendMessageAfterRebind()`（默认延后 600ms，`PI_RESTART_RESUME_DELAY_MS` 可覆盖），两个消费者（autopilot + mode 兜底）改用它；单测验证"延后而非同步发"，接线测试 8 项通过。
- 证据边界：场景仍偶发失败。**更正**：一度以为的"重启后档位错乱"实为假模型 `reasoning:false` 导致 pi 把思考档位设为 `off`，不是档位问题；失败归因于场景的 SIGTERM 催停编排时序。故场景对该条保持软提示；要彻底解决需 vendor 侧"换绑完成"事件。
- 新增守门：`docs/BUG-REPLAYS.md` 每行必须带可执行命令（`scripts/check-conventions.sh` D 节；故意改成"注意检查…"立即失败，改回即通过）。

### 角色扮演模式：6 张形象参考图入库 + 按需 `read`（2026-10-07）

- 从外部资料包的 54 张图里挑 6 张代表图，**按内容改名**后入库 `portable/agent/modes/assets/roleplay/`（3.3 MB）：常态立绘、官方画集三视图与舰装、誓约婚纱「幸福纯白」、改造后【强袭模式·EX】、料理便当换装、国际服官宣档案卡；配套 `README.md` 写明每张的判别依据与来源。整套立绘/语音仍不入库。
- 人设新增《形象参考图》一节：把每张图的**视觉常量写成文字**（黑蝴蝶结 + 金色小王冠、蓝紫水手领、紫格纹百褶裙、枪身 `F61` 徽记、四联装鱼雷 + 单装炮、婚纱蓝紫玫瑰花结…），并说明"需要细节时先 `find` 再 `read` 那一两张"。**纯文本模型因此立刻拿到更细的形象信息**；人设另有一句兜底（模型不支持图片时会拿到一行提示，退回文字）。
- 真实代码路径验证（直接调 vendor 构建产物里的 `read` 工具）：图片模型得到 `text: "Read image file [image/png]"` + `image(mimeType=image/png, base64=1 212 940 chars)`；纯文本模型得到那行 `Current model does not support images` 提示——与人设里的兜底写法一致。**诚实边界**：当前默认 provider 未声明图片输入，读图收益要换视觉模型才兑现（切换无需改配置）。
- 新增守门 `check-conventions.sh` **E 节**：模式资产必须"引用成对"——悬空引用（点名了不存在的图）、孤儿资产（加了图没人引用）、目录 8 MB 上限三类静默漂移；三种都实测拦得住（改名 / 加图 / 灌 9 MB 各自失败，还原即通过）。`check-features.sh` 的分发资源清单同步加入 `assets/roleplay/README.md`。

### 全量门禁暴露的真缺陷：重启日志归属判据（2026-10-07）

- 触发：`PI_GOLDEN_SCENARIO=1 bash scripts/golden-tasks.sh --smoke` 第 19 步真实 pty 场景 **17/33**（phase 1 全绿，phase 2 整段塌掉：`rounds.jsonl` 只有 2 轮、round-2 `decision=exit` 且 `adminAction` 为空、`completions=0`）。重跑 phase 2 过了但**续跑没注入**；80ms 轮询 `state.json` 抓到现场——场景写入后 <80ms `restartLog` 被清空，此刻只有 round-2 的 pi 活着。
- 根因：消费端只判"是不是 mode 归属"，**没判这条日志是不是写给我的**。本机 pi 启动 35–45s，外部写入端在进程**启动过程中**写请求时，即将被重启的那个进程会把"给下一个进程的"日志吃掉并注入到自己（马上要死的）会话里 → 新进程无续跑可注入；同根因的另一形态：消费端"整文件读-改-写"读早于写入、写晚于写入，把刚写下的 `action` 一起抹掉 → supervisor 读空 action 直接退出（连重启都没发生）。
- 修法：`core/restart-intent.ts` 新增 `logWrittenAfterStart()` / `logTargetsOtherSession()` / `processStartedAtMs()`，两个消费端（autopilot 通用通知、mode 兜底与模式通知）先判归属再消费；老请求（无时间戳）照旧消费。
- 证据：单测 8 → **11 例**（两条判据分别改恒 false → 3 例如期失败，改回即通过）；真链场景 **33/33**（含"round-3 出现 `my-pi-restart-resume`"与"整场只跑一个模型回合"）；台账新增第 12 行。
- 顺带更正：此前把"round-3 无续跑"归因于场景 SIGTERM 编排抖动，实为产品侧归属错误——判据补上后同样编排稳定通过。

### 角色扮演资产：补两张日常风格图（2026-10-07）

- 用户点名补 `1257px-BLHX_biaoqiang_7.webp`（皮肤「枕头大战」，居家/抱枕）与 `700px-标枪换装8.jpg`（「礼服」黑色小礼服，室内沙发）→ 入库为 `07-皮肤-枕头大战.webp` / `08-皮肤-黑色礼服.jpg`，人设表格与 assets README 清单同步更新（共 8 张 / 3.8 MB）。
- 格式结论：**webp 不转换**。pi 的 `read` 原生支持 png/jpg/webp/gif（实测返回 `image(image/webp, 426212 b64 chars)`），OpenAI 兼容传输把 `data:<mime>;base64,…` 原样放进 `image_url`、没有 mime 白名单；且该 webp 带透明背景（`VP8X + ALPH`），转 JPEG 会压成实色块、转 PNG 体积数倍。README 新增「格式」一节把这条规则写死。

### 两实例真 pty 场景 + pty 公共骨架（2026-10-07）

- 多实例此前只有 stub / 假进程证据：`test-supervisor.sh` 用 stub CLI 测 ownerPid 认领两侧，`test-state-audit.mjs` 用假 `cli.js` 进程测"实例数可见"。新增 `scripts/test-scenario-two-instances.mjs`（真 pty×2 + supervisor×2 + 真 pi×2 + 本地假 provider，**一个共享 agent 目录**，**32 项**），把"共享 `state.json` / `rounds.jsonl` / `modes-sessions.json`"的隔离放到真链上考。
- 覆盖：A 起于 full → 在 A 的 TUI 里 `/mode roleplay` → A 真重拉、新进程 argv/env 是 roleplay；B 起于 full、pid 全程不变、会话零注入（A 的重启不越界到 B）；真 pi 写的重启请求 `ownerPid` = A 的宿主 supervisor pid（且 ≠ B 的），B 的 supervisor 不会认领它；两实例同时在跑时 `state-audit` 报 `multiple-instances`（实例数=2）；B 仍可用（假 provider 收到请求、回复落 B 的会话）且 A/B 会话互不污染；收尾两实例 SIGTERM 干净退出、全程 `lostRestart=false`。
- **归属判据的真链验证**（`custom/core/restart-intent.ts` 的 `logWrittenAfterStart` / `logTargetsOtherSession`）：构造 B 先启动、A 后写日志，实测 B 的 `session_start` 晚于日志写入 **+44.2s**、又早于日志被消费 **9.5s**——即 B 真的读到了那条日志却**没有**消费它，随后 A 的新进程消费/清空（`restartLog` → 空）。时序用会话元数据（`model_change`）与 `state.json` 的 `restartLog` 清空点观测，两者都是落盘事实。
- 抽出 `scripts/lib-pty-harness.mjs`（pty spawn / `waitFor` / 按 `/proc/<pid>/exe|environ` 找 pi 与 supervisor（**支持实例环境标记**、排除 supervisor 的 `node -e` 助手）/ `stopPi` / JSONL 与会话读取 / 隔离目录与假 provider 接线）。`test-scenario-mode-restart.mjs` 重构为共用它：**33/33、输出文案不变**。重构中抓到一个 harness 自身的 bug（`for (frag) if(!includes) continue` 是内层 continue，实例标记形同虚设 → `supB()` 返回了 A 的 supervisor pid），已修并用真链复验。
- 顺带修 `state-audit.mjs` 的实例数探测：pi 启动后 `process.title = 'pi'` 把 `/proc/<pid>/cmdline` 覆盖成只剩 "pi"，旧判据 `argv.includes('cli.js')` **永远数不到真 pi**（"实例数可见"的承诺在真机上是空的）。改为认两种形态（`cli.js` 或标题 `pi`/`pi-rpc`，排除 `node -e` 助手 + 非 node 进程），`test-state-audit.mjs` 的 CLI 用例改用**真 pi 形态**（`process.title='pi'`）与 `cli.js` 形态各造进程；仍然 **55 项全过**。
- 门禁与文档：golden 新增**第 20 步**"两实例隔离场景"（`PI_GOLDEN_SCENARIO=1` 开启、默认 skip、`--fast` skip），`--smoke` 移到**第 21 步**；`scripts/README.md` / `STRUCTURE.md` / `README.md` / `docs/FAQ.md` / `docs/TROUBLESHOOTING.md` / `docs/design/VISION.md` 的步数与脚本数同步；`bash scripts/check-conventions.sh` 全绿。
- 实测原始结果：`node scripts/test-scenario-two-instances.mjs` → **32/32 exit 0**；`node scripts/test-scenario-mode-restart.mjs` → **33/33 exit 0**；`node scripts/test-state-audit.mjs` → **55/55**；`bash scripts/check-conventions.sh`、`node scripts/check-doc-links.mjs`、`bash scripts/check-features.sh`、`bash scripts/golden-tasks.sh --fast` 全绿。

### 两实例真实 pty 场景 + 两个多实例缺陷（2026-10-07）

- 新增 `scripts/lib-pty-harness.mjs`（真实 pty 场景公共骨架：pty spawn / 按 `/proc/<pid>/exe|environ` 找 pi 与 supervisor / waitFor / SIGTERM 收尾 / JSONL 与会话读取 / 隔离目录 + 假 provider 接线），并让单实例场景改用它（重构后仍 **33/33**）。
- 新增 `scripts/test-scenario-two-instances.mjs`：**两个 supervisor + 两个真 pi 共享一个 agent 目录**（各自会话、同一假 provider、测试专用 `PI_SCENARIO_INSTANCE=A|B` 标记沿 supervisor→pi 继承以便认进程），**33 项**检查。核心断言：只在 A 里 `/mode roleplay` → 只有 A 的会话出现 restart、A 的新进程是 roleplay；B 的 pid 全程不变、会话零注入、仍能正常跑一个回合；A 写的请求 `ownerPid == A 的宿主 supervisor pid ≠ B`；`state-audit` 报告 `multiple-instances` 且实例数 ≥2；两实例干净退出、`lostRestart` 全 false。并给出**归属判据的真链正面证据**：B 的 session_start 早于"日志被消费"约 10s（B 有充分机会消费但没消费）。
- 顺带修两个真缺陷：
  1. **`state-audit` 的"实例数可见"在真机上恒为空**：pi 启动后 `process.title='pi'` 把 `/proc/<pid>/cmdline` 覆盖成只剩 `pi`，旧判据 `argv.includes('cli.js')` 永远数不到真 pi（只有启动早期/假 CLI 才带 cli.js）。改为认两种形态（`cli.js` 或标题 `pi`/`pi-rpc`，且 `exe=node`、排除 `node -e` 助手），并在 CLI 级测试里用 `process.title='pi'` 的假进程锁住。
  2. **共享目录下 per-round crash log 同名覆盖**：两个 supervisor 的 `ROUND_INDEX` 都从 1 开始，`round-1.log` 互相覆盖，复盘时恰好丢掉要查的那一轮。改成 `round-<N>-<pid>.log`（轮转 glob 不变），场景里新增一条断言锁死"两实例的 crash log 互不重叠"。
- 接进 golden：新增**第 20 步**"两实例隔离场景"（与第 19 步同为 `PI_GOLDEN_SCENARIO=1`  opt-in、默认 skip、`--fast` skip），`--smoke` 移到**第 21 步**；README/STRUCTURE/FAQ/TROUBLESHOOTING/VISION 的步数同步。

### 一次被证伪的修法：vendor「换绑完成事件」替代重启延时（2026-10-07）

- 初衷：把"`session_start` 后延后 600ms 再触发续跑"换成正序事件。写了补丁 010（`session_rebound`
  事件 + `AgentSession.sessionStartEvent` getter，3 文件 / +42 行），`sendMessageAfterRebind()` 改成
  "事件优先、定时器兜底"；单测 12 例通过，默认延时下真实 pty 场景也 33/33。
- 判别性实验把它证伪：兜底延时设 `PI_RESTART_RESUME_DELAY_MS=120000` 再跑同一个真实 pty 场景 →
  **2/33**（续跑没发生）。原因：`finishSessionReplacement` 只被**进程内**替换调用，而 my-pi 的重启是
  **新进程 + `--session`**（`main.ts` 不调用它）→ 事件永不触发。
- 处置：**补丁与消费端改动全部回退**（无消费者的事件=死代码），保留 600ms 延时；把负结果与判别命令
  写进 `custom/adapters/ui-adapter.ts` 注释与 `DECISIONS.md`（含认知更正：真正的可安全注入时刻在新进程
  启动路径上，**位置未定位**；过去"读会话替换顺序"得出的 rebind 归因对重启路径不成立）。
- 唯一保留的副产物：`STRUCTURE.md` 补丁清单补齐此前漏列的 007/008/009。

### 相位实验：`session_start` 触发回合会被 pi 直接拒绝（2026-10-07）

- 搭了一个无头实验台（`--print` + 临时扩展按 `EXP_PHASE/EXP_DELAY_MS/EXP_DELIVER` 在指定相位注入，硬指标=会话文件里
  assistant 条数；脚本在会话的 `/tmp/my-pi-exp/`，不入库），每次约 45s，比真 pty 场景快且没有抖动。
- 硬证据：`session_start`+0ms 注入 `triggerTurn` → **rc=1、assistant=0**，stderr 明确报
  `Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.`；
  `session_start`+600ms → rc=0、assistant=2；`deliverAs:'followUp'` → 不报错、消息落盘，但不为它起回合。
- 顺带确认：真 pty 场景在 0ms/600ms 下今天都通过（它的"回复未落盘"只是软警告），所以这条链路**必须用无头硬指标判**，
  不能拿 pty 场景当判别工具。
- 未做：`steer` 与"纯空闲载体 + followUp"两组实验（决定 `sendMessageAfterRebind` 是否可以改成排队优先）。

### 相位实验第二组：排队不会起回合，"空闲才触发"才是正解（2026-10-07）

- `agent_settled` + `triggerTurn`（空闲）→ assistant=2 ✅；`agent_settled` + `followUp`/`steer` → assistant=1（**排队不起回合**）。
- `session_start` + `steer`（忙碌）→ 不报错但也不起回合；`session_start` 先 `triggerTurn` 再 catch 退化 `followUp` → **rc=1，catch 不住**。
- 结论：`triggerTurn` 只在空闲时合法、忙碌时是"catch 不住的致命错误"；`deliverAs` 三种排队语义都不触发回合。
  → 正解是"先判空闲（`ctx.isIdle()`），忙则等 `agent_settled` 再 `triggerTurn`"，定时器降级为兜底；实施方案与验证范围已写进 `DECISIONS.md`（本轮未动代码）。

### 空闲门落地：忙时不发 triggerTurn，等 agent_settled（2026-10-07）

- `sendMessageAfterRebind()` 增加 `{ isIdle }` 参数：忙（或 `isIdle()` 抛错，保守当忙）→ 不发，挂一次性
  `agent_settled` 再 `triggerTurn`（重订阅上限 3 次，事件不可用则退回定时器）；空闲 → 维持原"延后触发"。
  两个消费端都传 `{ isIdle: () => ctx.isIdle() }`。
- 新增单测"忙时不发、settled 后发"（mode-autopilot-restart 12 例），把"忙碌态不能发 triggerTurn"这条硬证据按在代码上。
- 验证：tsc / 全量 vitest / 单实例场景（默认延时与 0ms）/ 两实例场景 / golden --fast（见本轮提交说明）。

### G3 定案：压缩暖前缀不补 vendor（2026-10-07）

- 逐行核对：回放分支确实不可达（主循环的 `onPayload` 在 `core/sdk.ts:414`，压缩走 `agent-session.ts:2722`
  直连 `agent.streamFunction`，`buildRequestOptions` 没带 `onPayload`）；补丁点确实只有一行。
- 但实测压缩**几乎不发生**：`auto-compact` 事件全量 2 次（均 2026-09-24 早期小样本）、指纹日志压缩归因 0 次；
  一次 256K 压缩自身 ≈`$0.038`、回放省 ≈`$0.0007/请求` → 回本 ≈55 个请求 → 期望收益≈0。
- 结论：不补；写清一行复核命令 + 触发条件 + 届时三步走（见 `DECISIONS.md` 与
  `docs/development/CONTEXT-MANAGEMENT-COMPARISON.md` P1）。同模块的 `saveMainRequestPayload`/`recordFingerprint`
  是活的（929 条指纹、今天仍在写），所以不做"删死代码"。
- 至此迁移审计的开口项 G1–G7 全部闭环（G3 为"测量后不做 + 触发条件式"）。

### 进程内 system 漂移：定位到字节 + 补分段指纹 + daily-health 告警（2026-10-07）

- 真实会话核对（85 次调用）：累计命中 **96.97%**；但 **4 次调用 = 69.7% 的未命中**，其中两次是 system 翻转
  （14:11:25 未命中 **147,555 token**、14:25:34 未命中 10,308），合计 157,863 = **60.8%**。
- 字节级闭合：`7142B 原文 + 95 换行转义 + 2 引号 = 7239`；`772B 加固块 + 9 换行 = 781`；`7239 + 781 = 8020`。
  ⇒ 翻转 = **my-pi 的 system 加固块整块消失**（pi 的 `forceSystemPrompt` 投影没生效；`runner.ts:1455`
  会静默吞掉处理器异常），不是工具集/某段被改写。
- 改动：`prefix-fingerprint.ts` 新增 `systemAppend` / `systemSections` / `systemChangedSections`
  与 `system:append-lost`/`system:append-back` 标签；`systemTextOf()` 对字符串 content **原样返回**
  （原来 JSON.stringify 把换行转义、分段解析失效）；丢失时写独立台账 + 有 UI 时告警；
  `daily-health.mjs` 新增 `加固块缺失=N` 字段并一律 alert（不再混进"疑似整段重算"）。
- **第二步（同日追加）**：把 `before_agent_start` 按「关键路径 vs 可选增强」分层——拿 system 文本 +
  追加加固块只做纯字符串运算，其余（工具分层/顺序对齐/用量校准/提示）全部就地 try/catch。
  关键不变量不再走"会静默失败的通道"。并补掉一个检测盲区：只看 `system:append-lost` 转换标记会
  漏掉"某进程每轮都丢"（首条 `prev=null` → `changed` 恒为空），判据改为**逐条** `systemAppend===false`。
- 按用户口径**不做自动重启**：这类"终端层卡死/前缀漂移"的处置是关掉该终端会话（见 `BUG-REPLAYS.md` 第 14/15/16 行）。
- 验证：指纹单测 28 项、新增 `system-prompt-total.test.ts` **7 项**（抛错下 systemPrompt 逐字节不变 +
  次序锁）、`test-usage-metrics.mjs` **56 项**、注入面基线未变、`check-conventions.sh` 台账 16 行、`tsc` 干净。

### 体验优化：默认关闭重功能 + 工具面去误导 + 提示词重排 + tmux 通知空闲门（2026-10-07）

- **默认关闭 voice/link**：新增 `DEFAULT_OFF_FEATURES`，`'*'` 不再包含它们（显式列出即可启用）；
  修掉 `modeFeaturesLabel` 对 `'*'` 谎报"全部（12）"的问题。
- **删 `web_fetch`（工具 64 → 63）**：它名字像"抓 URL"却执行 `searchDirect(query)`，与 `fetch_url`
  撞语义、又与 `web_search` 的降级分支重复；连带清掉只剩它一个工具的 `web-fallback` 休眠组。
- **提示词重排**：`hard-rules.ts` 拆成 `HARD_RULES`（不变量）→ `WORK_PROTOCOL`（工作方式）→
  `DELIVERY_ADVICE`（交付与展示）→ `EFFICIENCY_ADVICE`（末尾哨兵）；`APPEND_SYSTEM.md` 回到用户偏好本位
  （1793 → 1426B）。"少打断"与"不盲开工"调和为：**开工前先复述理解（一两句），然后直接开工**——
  复述是纠偏窗口而非等批准；并删掉"同意后才能执行"、加"不问两遍/一次交付"。展示对齐 DSH：
  主结果写在回复里、按任务形状组织不套模板、文件引用用相对路径 + 行号、不重复已贴内容。
- **tmux 通知加严格空闲门**（前置修复）：原通知是无空闲门的 `triggerTurn`，此前靠"启动后台立即结束
  回合"侥幸避开忙碌态致命错误；抽纯函数 `createIdleGate`（忙入队、`agent_settled` 合并发），
  5 项单测锁"忙时一条都不发"。
- **放宽后台任务规则**：由"启动后立即结束回合"改为"不要空转等待，但等待期间有独立步骤就继续做"——
  这是"碎回合"（被中断会话 4 条用户消息 / 85 次调用）的直接来源。`AGENTS.md` 同步。
- 明确不做：改 `defaultProjectTrust`（当前无触发条件，属无操作）、拆 `admin_set_config` 的敏感键确认（真安全闸）。
- 验证：tsc 干净；vitest **77 文件 873 例**（+8）；check-features 通过（63 工具/12 命令/2 快捷键/48 钩子）；
  conventions 通过；注入面基线 `ebfa65e5…` → `8493be6d…`；supervisor 111 / state-audit 55 / usage-metrics 56。

### 技能目录移出 system prompt（2026-10-07）

- 起因：pi 原生把 `<skills>` 段渲染进 system prompt，实测 4 个技能 **2269B**（占 system 约 29%）；
  而技能文件在仓库历史里被改过 **14 次** → 每改一次就作废**整段**前缀。
- 做法（**零 vendor 补丁、零能力损失**）：在 `before_agent_start` 里清空 `systemPromptOptions.skills`
  （渲染即刻不含该段），目录改由**尾部 append-only 消息**注入（内容变化时才追加一份完整替换）。
  关键事实：pi 的 `/skill:<name>` 展开读的是 **resourceLoader**、不读 options，所以不受影响——
  这正是没选 `--no-skills`（会丢 `/skill:`）也没选 vendor 补丁的原因。
- 目录内容直接取自 `options.skills`，**不重新实现技能发现**（frontmatter/`+skills/...` 覆盖模式都不用碰）；
  同源技能只给一条根路径规则，异源时自动退化为逐条绝对路径。
- **契约**：技能处理器必须注册在主处理器**之前**（后者读惰性 getter 定稿 system 文本；
  顺序反了会出现"forced 带 `<skills>` / fallback 不带"的漂移）。清空放在关键路径，目录构造才是可选增强。
- 实测：system prompt **−2269B**；目录 1636B 转尾部；净上下文 **−633B**。
  配合同批改动，前缀每次冷启动少约 **4.3KB**（工具声明 37,136B → 约 35.1KB，工具 70 → 约 65）。
- 验证：`skills-catalog.test.ts` **10 项**（含"getter 被读到的每一刻都是 0 个技能"与"增强失败不影响清空"）；
  vitest **78 文件 883 例**；注入面基线未变（本次不动 system 注入文本）。

### 按实测分布把 browser 也默认关闭（2026-10-07）

- 拿到 30 天真实调用分布（1920 次 / 71 工具）后，browser 从"产品决策"变成"事实"：
  **28 次调用全挤在 1.0 天内，其中 15 个工具是同一分钟被逐个试了一遍，此后 10 天零调用**；
  voice 5 次 / link 3 次同样跨度 1 天。对照 autopilot 27 次跨 11.7 天、memory 26 次跨 13.7 天 = **真日常**。
- 判据因此写成**两维**（调用数 + 时间分布），并加反向断言"真日常功能不得被误关"。
- `DEFAULT_OFF_FEATURES` = `{voice, link, browser}`（23 个工具）→ 默认声明工具数 **70 → 47**
  （40 个 my-pi 工具 + 7 个 pi 内置），实测声明体积 37.1KB → 约 29KB。
- 连带修一处"指向不存在工具"的描述：`fetch_url` 原来让人"用 `browser_navigate`"，已改写。
- `mode/README.md` 新增"默认关闭的功能"一节，固化判据表与"关功能要扫描述引用"的教训。
- 验证：mode 单测扩展；vitest 全量 / check-features / conventions 见提交说明。

### autopilot 工具面合并（2026-10-07）

- autopilot 是默认面里最大的单组（16 工具 / 约 6.8KB），但**真日常**（27 次跨 11.7 天）→ 不能关，只能合并。
- 三个测量改变了方案：① `schedule_task` 1.7KB 是"12 个操作的结构成本"、字段描述已很精简，**不动**；
  ② 真冗余在只读诊断（10 个工具 ≤1 次调用）；③ `check-seeds-headless.mjs` 是不可用工具的 denylist，
  **不需要**改（删名字才是风险）。
- 决策：`autopilot_stats` + `autopilot_failover` 收进 `autopilot_status` 的 `section`（summary/stats/failover）
  → 16 → **14** 工具，−约 0.8KB。`autopilot_policy` 保留但**描述里点明**与 `autopilot_status`/`admin_status`
  的边界（描述是模型唯一的路由信号，这一句就消除了"猜哪个"）。
- 0 次的 `admin_set_model`/`admin_switch_session` **不删**——那是模型侧切换模型/会话的既定通道，删是砍能力。
- 注册面棘轮正确拦下变更（`tools/autopilot 已消失: …`），基线按流程刷新为 **61 工具**；
  休眠组 `autopilot` 5 → 3。
- 验证：tsc 干净；vitest 78 文件 883 例；check-features（61 工具）/ conventions / seeds-headless 全绿。

### 状态类工具描述去重（2026-10-07）

- 重复的**根源**：`admin_status` 的描述枚举"模型 / 会话文件 / 配置摘要"，而每一项都是**另一个工具的
  主管内容**——同一关键词出现在多个 description 里，模型只能猜（旁证：这几个工具 30 天各只有 1–3 次调用，
  `admin_set_model`/`admin_switch_session` 更是 0 次）。`autopilot_status` 的 summary 又重复一次"当前模型"。
- 三条纪律：① 每个工具只声明**自己独有的名词**；② **指针只加在名词会重叠处**（总览类必须点名，
  读/写、列/切这类成对工具靠动词区分、不复述对方职责）；③ 读/写成对的地方用 `**读**`/`**写**` 标出配对。
- **第②条是实测纠偏**：第一版给每一对都加指针，`tools-payload` 立刻报出 autopilot 组 6.8KB → **7.1KB**
  （指针污染关键词还变大）；收掉成对工具上的冗余指针后回落 6.9KB。
- 实测：九个状态类描述 **1442B → 1169B（−273B，−19%）**，其中 `autopilot_policy` 单条 −193B。
  真正的目标是**把路由从"猜"变成"确定"**，体积下降是顺带。
- 守门：`tools-payload.test.ts` 新增 2 项——每个工具必须含独占名词、**不得含别人的独占名词**、该有指针必须有；
  九个描述两两不同。守门表里写明"指针只在会重叠时加"，避免照抄再犯。
- 验证：tsc 干净；tools-payload 4 项全过（工具面 60 个 / 29.1KB）；vitest 全量 / check-features / conventions 全绿。

### 调研："重型工具只给子代理"与 `deferred` + `tool_search`（2026-10-07，**暂不采用**）

- 前提纠正：工具声明**存在不会导致未命中**，只有**中途改变工具数组**才会整段重算 →
  "减少工具"省的是**前缀体积**（browser 18 工具 = 6.3KB），不是命中率。
- 子代理这条路有硬阻碍：`subagent/core/runner.ts:88` 用 `--no-extensions` 起子代理 →
  **扩展根本不加载，browser 在子代理里不存在**；且 `env` 继承父进程、每子系统进程冷启 35–45s、
  `subagent` 同步阻塞、浏览器状态不共享。拆 `--no-extensions` 还会牵动 `check-seeds-headless` 的假设。
- pi 原生有更省的路子：`registerTool({ exposure: 'deferred' })`（不激活=不进声明=0 字节）+
  内置 `tool_search`（inactive，用 `+tool_search` 激活，BM25 检索后 `setActiveTools`）；
  `prepareLoadout` 还能"隐藏声明但保持 callable"，且被投影进 transcript → 静态隐藏=不破坏缓存。
- **决定性实测（否掉了方案）**：pi 的 `tokenize` 是 `split(/[^a-z0-9]+/)`，**中文全是分隔符** →
  5 个真实中文 query（截图/点击按钮/打开网页/抓取页面内容/浏览器截图）**全部 0 token、全部"无结果"**；
  英文 query 正常。而 my-pi 是中文优先环境，模型又不可能知道被隐藏的工具名 → 会得出"没有浏览器工具"的
  结论，**比现状更差**。
- 原型验证：给 `tokenize` 叠加 CJK 2 字 bigram（约 10 行）后 `browser_screenshot` 文档 token 6 → 25，
  7 个中文 query 中 6 个命中正确工具（"填写表单"失败是 `browser_type` 文案问题）。
- 结论：**保持 browser 走 `DEFAULT_OFF_FEATURES`**；将来先打 CJK 分词补丁、再上 deferred+tool_search
  （前缀净 −5.65KB，且不再需要重启）。详见 `DECISIONS.md` 同条（含复现命令与三条备选路线的代价）。

### browser 改走 `deferred`（注册但不声明）+ 补 patches/011 让 tool_search 认识中文（2026-10-07）

- 新增**第 11 个补丁** `011-tool-search-cjk.patch`：给 pi 的 `tokenize` 补 CJK 连续段 2 字 bigram
  （英文路径完全不变），带 `Patch (011-tool-search-cjk):` 自标记。实测 `browser_screenshot` 的检索文档
  token **6 → 25**，7 个真实中文 query **6 个命中正确工具**。dist 已重建。
- `tool-adapter.ts` 透传 `exposure`：原先只拷贝 5 个字段，漏转发会让 `deferred` **静默退化成默认声明**。
- browser 18 个工具全部 `deferred`（`BROWSER_EXPOSURE` 常量 + 机械插入）；`settings.json` 启用
  `+tool_search`；browser **移出 `DEFAULT_OFF_FEATURES`**——判据是它的**注册没有副作用**（浏览器进程
  首次调用才起），voice/link 注册即有副作用（whisper 服务 / 入站远控通道）故仍在名单里。
- **端到端实测（真实无头会话）**：`toolsBytes` **38 383 → 28 320（−26%）**；声明工具 **45 个**
  （= 注册 61 − 默认关闭 5 − browser 18 不声明 + 7 内置，与预测完全吻合）；请求里 `browser_*` **18 → 0**、
  `tool_search` **无 → 有**。
- 取舍：相对"默认关闭"是 **+0.65KB**（tool_search 自身）换"要用时不用重启"（代价是一次前缀重算）；
  相对"常年声明"是 **−5.65KB**。选它是因为它对齐"减少中断"这个更高优先级诉求。
- 守门：新增 `custom/adapters/__tests__/tool-exposure.test.ts` **7 项**，驱动 pi 的真实实现
  （补丁被上游冲掉即红）；`roleplay-surface.test.ts` 的 `defaultTools` 精确断言已同步。
- 验证：tsc 干净；vitest **79 文件 892 例**；check-features / conventions / check-patches-behavior（11 补丁）全绿。

### 接线 executionMode：工具并发语义（2026-10-07，编排优化第 1 项）

- 与 DSH 对比发现两边**默认相反**：DSH 默认独占（`isConcurrencySafe` 才进并发池），
  pi/my-pi 默认**并行**（`agent.ts`：`runtimeOptions.toolExecution ?? "parallel"`）。
- 问题是**两边都没用这个开关**：pi 自己的工具一个都没声明 `executionMode`；my-pi 的适配器连字段都
  没转发 → 61 个工具全被当作并行安全。实证：被中断那次会话 **115 轮里 52 轮有 ≥2 个工具调用**。
- 排除一个误报：`edit+edit` 不是风险——pi 有 `file-mutation-queue.ts` 按 realpath 排文件变更。
  危险的只有 my-pi 的**非文件共享状态**（browser 的同一个 page、autopilot 重启/配置状态、todo 列表），
  三处都无互斥（已核实无 queue/mutex/lock）。
- 改动：适配器透传 `executionMode`；browser 18 个 + `admin_restart`/`admin_set_model`/
  `admin_switch_session`/`admin_set_config` + `todo` 标 `sequential`。**不给 browser 留例外清单**
  （pi 按整批降级，例外收益为零且会漂移）。
- 刻意不标：`memory_*`/`ctx_*`/`link_*`/`voice_*`/`tmux_*`/`schedule_task` 的 mutator（部分有 file-lock /
  原子写保护，只剩顺序语义问题），**列为下一步审计项**。
- 守门：`custom/adapters/__tests__/tool-execution-mode.test.ts` **4 项**，含**反向断言**
  （独立只读工具不得标 sequential，防"一刀切"把并行整体关掉）。
- 验证：tsc 干净；vitest **80 文件 898 例**；check-features / conventions 全绿。

### bash 超时转后台（2026-10-07，编排优化第 2 项）

- 现状差距：my-pi 给未写 timeout 的 bash 注入 240s 上限，而 pi 超时是**杀掉整个进程树**
  （`core/tools/bash.ts`：`killProcessTree` + `throw new Error("timeout:<秒>")`）→ **工作直接丢失**。
  对照 DSH：超时提升为后台 job，结果可事后收。
- 处置：在 tmux 特性里接住"超时失败"的 bash 结果，把**原命令**用 tmux 重跑并交给完成 watcher
  （与 `tmux_run` 同一条路径，复用空闲门唤醒）。**不做 triggerTurn**——注入的说明是给当前这一轮看的。
- 关键约束：转后台**必须再加硬上限**（`timeout -k 10 3600 sh -c '<原命令>'`），否则死循环会从
  "240s 被杀"变成"永远占着机器"。上限 `PI_BASH_PROMOTE_CEIL_S` 默认 3600s，`<=0` 关闭（且说明里
  显式标注"未加上限"）；`PI_BASH_PROMOTE=off` 整体关闭。
- 纯逻辑落 `custom/features/tmux/promote.ts`（`parseTimeoutSeconds` / `wrapWithCeiling` /
  `promoteSessionName` / `promoteNotice`），守门 `__tests__/promote.test.ts` **9 项**。
- 验证：tsc 干净；check-features / conventions 全绿；vitest 见提交说明。

### 子代理常驻 RPC 池 S2（2026-10-07）

- 前提已在 S1 用**确定性判据**验证：`new_session` 真隔离 + 纯冷启动 **19.1s**（池每次省掉的部分）。
- 新增 `subagent/core/rpc-pool.ts`（协议 + worker 生命周期）；`runner.ts` 抽出共享的
  `applyAgentEvent`（依据：rpc-mode 用 `toJsonEvent`，与 `--mode json` 同一个序列化器）与
  `filteredSubagentEnv`（安全过滤不复制），新增 `buildPooledSpawnArgs` / `runPooledAgent`，
  并在 `runSubprocessAgent` 顶部加池化分支（`PI_SUBAGENT_POOL=off` 回退、失败开放且**留痕**）。
- 语义保持：`--append-system-prompt`/`--model` 是 worker 级参数 ⇒ 人设仍是 system prompt。
- S2 只覆盖非 fork（`new_session {parentSession}` 未验证的内容不混入）。
- 守门：`__tests__/rpc-pool.test.ts` **14 项**（含"池化参数绝不带任务文本/不含 --fork"的契约测试）。
- 验证：tsc 干净；subagent 测试 50 项全绿；其余见提交说明。

### 子代理池 S3（2026-10-07）：修"从未复用" + 租借语义 + 进程回收

- **修掉一个严重缺陷**：S2 的复用键用了每次新建的临时 prompt 文件路径 ⇒ **每个任务都是新 profile、
  池从未复用**（14 项纯协议测试全都抓不到"键选错了"）。改为 `pooledProfileKey` **按内容**寻址，
  补"同 agent 同 model ⇒ 同键"与"键里不得含路径"两条回归测试。
- **修掉一个正确性缺陷**：按 profileKey 取 worker ⇒ `parallel` 下同 profile 的并发任务会共用**同一个**
  worker，而 rpc 是单会话协议、并发发两个 prompt 必然互踩。改为**租借**（lease/release）。
  并发上限不在池里重复实现（上层 runWithConcurrency 已限流）。idle 池有上限，超出回收。
- **补进程回收**：`subagent/index.ts` 的 `session_shutdown` → `getRpcPool().shutdown()`（S2 漏了会泄漏）。
- 守门：`rpc-pool.test.ts` **23 项**（键稳定性 3 + 租借语义 6，用注入的假 worker 工厂）。
- **端到端验证通过**（`pool-e2e.test.ts`，`PI_SUBAGENT_POOL_E2E=1`，16.8s）：两次同 profile 任务
  **只起一个进程**（注入计数工厂 + 走真实调用链 + 假 provider），且复用时隔离成立（第二次请求不含
  第一次的暗号）。S1–S3 目标达成。
### 子代理优化收尾（2026-10-07）

- **S4 已完成**：`extensions` 逐次 opt-in、默认关闭；`pooledProfileKey` 纳入该旗标；定时任务派生的子代理
  天然不带扩展（`check-seeds-headless` 的前提不被破坏）。
- **fork 池化实测不成立**（负结果）：`new_session {parentSession}` 返回 `success:true` 但**分叉没发生**
  （请求里只有 `[system,user]`、无父会话暗号）。按预定退化方案：fork 继续走 spawn 路径，池化分支保留
  `!forkSession`，证据写进 `docs/design/SUBAGENT-POOL.md` 第十三节。
- 至此子代理优化（S1–S4）全部收口：S1 隔离与冷启动实测、S2 池实现、S3 键/租借/回收修正 + 端到端验证、
  S4 逐次 opt-in 扩展、fork 负结果归档。

### 目标级自动续跑 goal（2026-10-07，编排优化第 4 项）

- 差距：my-pi 只有"tmux 完成通知"与"定时任务"，**没有朝一个目标连续推进**；DSH 有 `goal`（256 轮、
  连续 3 轮受阻即停、resume/fork 后 disarm）。
- 落点 **autopilot**（它已注册 `agent_settled` = 唯一可安全 `triggerTurn` 的时刻），**会话态不落盘**
  （与 DSH 的 disarm 语义一致，也避开运行时状态入库的坑）。
- **上限按模式配置**：full 256、其余默认 16、`modes.json` 可覆盖（roleplay 已配 12）、`<=0` = 该模式禁用。
- **停止条件**：显式 complete/blocked/pause；达到上限；**连续 3 轮无工具调用**（计数排除 `goal` 自身，
  有推进则打断计数）。默认**显式开启**（只有 `goal set` 才生效），避免无人看管时自发生成成本。
- 守门：`autopilot/__tests__/goal.test.ts` **10 项**（逐个断言第 3 次才 blocked、上限 capped、
  三种结束状态不再推进、纯函数不改原对象）。
- 验证：tsc 干净；注册面刷新 **62 工具**；vitest 与其余守门见提交说明。

### 重复调用提醒 + 并发语义审计（2026-10-07，编排优化第 3 项）

- 判据定为**"工具名 + 参数（键序无关）都相同"**：只按名字计数在 my-pi 里是纯噪音——实测 `bash` 曾
  被**连续调用 1190 次**。（DSH 的具体判据未能核实，已在文档里诚实标注，按可辩护语义实现。）
- 纯逻辑 `budget/repeat-reminder.ts`：`stableKey`（键排序、循环引用不抛）/ `observeRepeat` /
  阈值 `{3,5,8}`；接在 `context` 的 `tool_call` 钩子，只在**恰好** 3/5/8 次提醒、`display:false`、
  **不 triggerTurn**，整段 try/catch 包裹（不得影响工具调用）。
- 并发审计（第 1 项遗留）：新增标 `sequential` 的有 tmux 3 个 / voice 3 个 / link_send /
  schedule_task（tasks.json 未加锁）/ plan_enter+plan_exit；**明确不标** memory/ctx 的 4 个
  （读-改-写整体在 `withFileLock` 内，且是热路径，标了代价大于收益——理由写进守门注释）。
- 守门：`repeat-reminder.test.ts` **8 项**；`tool-execution-mode.test.ts` 的两张清单同时扩展
  （必须标 + 必须不标，两个方向都锁）。
- 验证：tsc 干净；check-features / conventions 全绿；vitest 见提交说明。

### SoL-Pi 借鉴 P1：目标完成语义三态（2026-10-08）

- 做法见 `docs/design/SOL-PI-BORROW.md` 的 P1 节（含设计理由与验收证据）。
- 一句话：`verified` 只能来自**由 harness 实际跑通的检查命令**（新 `store/run-check.ts`），
  模型自封不了（三个构造器的结构约束 + 测试锁映射）；不带 `check` 一律 `declared` 并如实标注；
  `blocked`/`pause` 与 harness 自判停止标 `advisory`。**旧默认行为不变。**
- 守门：`goal.test.ts` 16 项 + `run-check.test.ts` 7 项；超时用例 1.32s 收口。

### SoL-Pi 借鉴 P2：压缩"回本"估算（2026-10-08）

- 新增 `context/budget/compact-payback.ts`（纯逻辑）+ 11 项测试；观察点挂在 `session_before_compact`
  最前面（自动压缩分支会提前 return，放后面会漏记）；日报新增字段 `压缩回本=p50=<轮数>/n=<条数>`。
- 客观数：默认参数**回本约 60 轮**，缓存溢价设为 0 只需 **2 轮** ⇒ 重写的贵几乎全来自缓存失效。
- **只观察不改默认**：接管压缩阈值属于改默认行为，留给用户点头。
- 测试抓到真实缺陷：`missPremium: NaN` 会污染 `paybackTurns`（合法值含 0，不能套通用正数守卫）。

### SoL-Pi 借鉴 P5：golden 留出集纪律（2026-10-08）

- 第 19/20 步本来就默认跳过 ⇒ "留出"性质已存在；本项给它命名并把纪律写死（权威定义在
  `scripts/README.md`，`STRUCTURE.md` / `docs/FAQ.md` 给指针，`golden-tasks.sh` 在真正开跑时 `echo`
  提醒——**用 echo 不用 step**，否则第 D 节的步数对账会红）。
- 可核对性质：`golden-tasks.sh --fast` 下 19/20 步均 skip、留出集提醒 0 次。
- 纪律核心：开发期间不看结果；**绝不为了让留出集通过而改留出集**（要改须在 DECISIONS 留档）。

### SoL-Pi 借鉴 P7：按错误指纹的修复预算（2026-10-08）

- 侦察发现 `tool-health.ts` 已有按**工具名**的连续失败熔断与错误脱水 ⇒ P7 做成**互补不替换**
  （既有熔断一字未改）：新增按**错误指纹**计数、**跨不同参数**累计，阈值 {3,5,8}、滑窗 15min，
  并记录"换过几组参数"（`distinctArgs`）——这才是"换参数还是同一个错"的直接证据。
- 归一化去 ANSI/路径/UUID/长十六进制/耗时/行号列号/数字；`argKey` 复用 `stableKey`（一份稳定键实现）。
- 接线在 `tool_result`（有错误文本处），与既有熔断同一通道追加提示、fail-open、**只提醒不阻塞**、
  不引入新消息类型。
- 守门：`error-fingerprint.test.ts` **15 项**，重点钉住归一化**两个方向**（易变部分同指纹 / 不同错误不合并）。

### SoL-Pi 借鉴 P9：子代理池复用度量（2026-10-08）

- `WorkerLease` 加 `reused` → 新 `core/pool-metrics.ts` 每次租借落一条 JSONL（fail-open）→
  `daily-health` 新字段 `子代理池=复用<率>%(<复用>/<总>)/起<N>次`（起进程次数 = 未复用次数）。
- 实测（真实代码路径）：2 条租借 / 1 次复用 / 1 次起进程。把一次性端到端断言升级为持续可观测指标。
- 顺带修正 `scripts/README.md` 的文档失真：`test-usage-metrics.mjs` 写 46 项、实际 56 项（本轮后 58）——
  项数没被守门钉住所以漂了 12。

### SoL-Pi 借鉴 P3：工具输出归档对照审计（2026-10-08）

- 产出 [docs/design/OBSERVATION-PACK-AUDIT.md](docs/design/OBSERVATION-PACK-AUDIT.md)（审计 + 四条提案），
  **纯审计、不改默认行为与阈值**。
- 核心发现：句柄已有（绝对路径 + 字符数）但**缺短摘录**；**0 次分页召回**且两次召回都走 `bash`；
  fail-open 写死且有测试；归档靠内容哈希去重（同一内容只占一份）；另外我们**比 SoL-Pi 多**脱敏与原子写。
- 实测：归档 **563 文件 / 3.4MB**（活跃）；召回 **2 次 / 4 会话 / 0 分页**。
- 提案：P3-A 摘录、P3-B 分页提示（均待用户点头）、**P3-C 明确不动阈值**、P3-D 召回计数（可自行实施，先 D 再 A/B）。

### SoL-Pi 借鉴 P4：休眠机制审计（2026-10-08）

- 产出 [docs/design/DORMANT-AUDIT.md](docs/design/DORMANT-AUDIT.md)：清单 + 逐条建议，**不删东西、不改默认**。
- 关键数字：白名单 A 段 18 条里 **10 条（56%）其实是"未决策"**，成组属于三个未迁移子系统
  （Best-of-N judge 5 / JSON 压缩 3 / 记忆合并 2）——审计把"有意保留"与"忘了处理"分开。
- 最高优先：`TOOL_LAYERING` 是"关着但留着"（最差状态），且有**历史消费证据**（`enable_tool` 8 次）；
  建议按 SoL-Pi C13 **二选一**（我倾向删；属削减能力，留给用户）。
- 口径纪律：`tool_search` 的 0 次**不能**当"没用"——它上一轮才启用；拿启用时间与统计窗口对齐是判休眠的前提。
- 顺带修正上轮我自己的分类错误：`__setPoolFactoryForTest` 从白名单 C 段移到 B 段。

### SoL-Pi 借鉴 P6：`edit_and_run` 融合工具（2026-10-08）

- 先量自己：my-pi 跨轮 编辑→运行 邻接 **6.4%（19/299）**（SoL-Pi 是 12.3%）⇒ 收益上限约 6% 回合数。
- 新工具 `edit_and_run`：参数与 pi 的 `edit` 同形；两半都走 `ctx.executeTool('edit'|'bash')`（无第二份编辑实现）；
  **编辑失败不跑命令**；结果分 `[edit]`/`[run]`；适配器新增 `executeTool` 透传；注册面基线 62→63。
- **探针抓到真实集成缺陷**：pi 的 edit 是 `{path, edits:[{oldText,newText}]}`，且**嵌套调用绕过
  `prepareArguments`**（旧参数名兼容只作用于模型直呼路径）⇒ 必须逐字转发规范 schema。改后通过。
- 端到端证据：真 pi + 自造 SSE tool_calls provider ⇒ 第二次请求含 `[edit] 成功`，且命令输出 **WORLD**
  而非 HELLO（**因果顺序**）；首次失败跑还验证了失败保护（`[run] 已跳过`）。

### SoL-Pi 借鉴 P6：`edit_and_run` 融合工具（2026-10-08）

- 先量自己：my-pi 跨轮 编辑→运行 邻接 **6.4%（19/299）**（SoL-Pi 12.3%）⇒ 收益上限约 6% 回合数。
- 新工具 `edit_and_run`：参数与 pi 的 `edit` 同形（`path`+`edits`）；两半都走 `ctx.executeTool('edit'|'bash')`；
  **编辑失败不跑命令**；输出分 `[edit]`/`[run]`；适配器新增 `executeTool` 透传；注册面基线 62→63。
- **探针抓到真实集成缺陷**：pi 的 edit 是 `{path, edits:[{oldText,newText}]}`，且**嵌套调用绕过
  `prepareArguments`**（旧参数名兼容只作用于模型直呼路径）⇒ 必须逐字转发规范 schema。改后通过。
- 端到端证据：真 pi + 自造 SSE tool_calls provider ⇒ 第二次请求含 `[edit] 成功`，命令输出 **WORLD**（非 HELLO，
  证明**因果顺序**）；首次失败跑验证了失败保护。
- 工具面预算：**守门红了就没放宽**（改预算 = 事后下调地板），改为精简声明；**声明面现几乎顶格
  ≈31979/32000B** ⇒ 下一个进声明面的工具必须先做预算决策。顺带量清口径：进前缀 43/24.5KB + 不进前缀 19/7.1KB。

### SoL-Pi 借鉴 P8：编辑类子代理的 verifier 契约（2026-10-08，纯提案）

- 产出 [docs/design/SUBAGENT-VERIFIER-CONTRACT.md](docs/design/SUBAGENT-VERIFIER-CONTRACT.md)。
- 证据：`subagent` 真实调用 **9 次**、agent 只用过 **scout（只读）**、从未派过编辑代理；`usage.jsonl`
  **没有"改了哪些文件"字段** ⇒ 风险尚未发生、口径也还没有 ⇒ **先测量再决定，不实施强制**。
- 提案：P8-A 加 `writeTools` 字段（可自行实施，建议先做）+ 返工代理指标；P8-B opt-in `verify:{command}`
  由 **harness 在父级执行**（不采信子代理自述）；P8-C 缺验收条件时**提醒不阻塞**；**P8-D 不推荐**
  （会诱使 `verify:{command:'true'}` 形式满足、实质失效）。
- 至此 **SoL-Pi 借鉴方案 P1–P9 九项全部完成**（见 SOL-PI-BORROW.md 的状态标记）。

### 用户批复第 1 项：工具面预算分桶（2026-10-08）

- 拆成 `PREFIX`(25_558B) / `NON_PREFIX`(6_446B) 两个**每桶上限**用于归因，而 **`TOTAL` 保持旧值 32_000**
  作为真正的绑定约束 ⇒ **严格程度一字节未放宽**。实测：进前缀 44 个/25_554B，不进前缀 18 个/6_442B，
  合计 31_996B。
- 守门日志新增**精确字节**输出（KB 取整会掩盖边界）。
- **信号**：声明面仅剩 4B 余量 ⇒ 往声明面加工具前必须先做预算决策。

### 用户批复第 5 项：临时探针处置（2026-10-08）

- `nested-probe.mjs`（`ctx.executeTool` 嵌套调用）→ **收进仓库**：`context/__tests__/nested-tools-e2e.test.ts`，
  显式 opt-in（`PI_NESTED_TOOLS_E2E=1`）、dist/bootstrap 缺失时自跳过；断言因果级（命令必须看到编辑后的内容）
  + 失败保护（编辑失败时命令绝不许跑，用 `echo SHOULD-NOT-RUN` 做探针）。实测 opt-in 下 **27.5s 通过**。
  **理由**：`edit_and_run` 依赖 pi 的嵌套调用契约，单元测试（假 ctx）**结构上抓不到**这类漂移。
- `fork-probe.mjs` → **清理**：结论已归档（SUBAGENT-POOL §13），无功能依赖；重建成本约 80 行、文档有确切配方。
- 移植时修掉一个索引错误：**tool 消息在后续请求里累积**，跨请求 flatMap 会得到 `[失败,失败,成功]`。

### 用户批复第 4 项：子代理 writeTools 可观测（2026-10-08 / P8-A）

- `usage-log.ts` 新增 `WRITE_TOOLS={write,edit,edit_and_run}` + `extractWriteTools()`（去重保序），
  `SubagentUsageRecord.writeTools` 落进 `portable/memory/subagent/usage.jsonl`。
- **口径边界写进类型注释并用测试显式钉住**：故意排除 `bash`/`ctx_exec`/`tmux_*`（catch-all 含进来会让
  字段恒为非空、信息量归零）⇒ 它是"用过编辑类工具"的**下界**，不是"文件变没变"的完备判据。
- 测试 `usage-write-tools.test.ts` **8 项**（含"WRITE_TOOLS 不得含 catch-all"的反向断言）。
- 两步中的第一步；第二步（返工代理指标）与 P8-B/P8-C 仍待定。**不改默认行为**。

### 用户批复第 2 项：删除 TOOL_LAYERING（2026-10-08，我拍板）

- **决定：删除**（用户授权）。最硬的一条依据来自被删代码自己的注释：一次中途 wake 约 $0.0375，
  而常驻成本 100 个请求约 $0.006 ⇒ **约 6 倍**，机制从设计上就亏；且其问题已由 pi 原生 `deferred`
  免费解决（browser 18 工具 0 前缀字节）；30 天 `enable_tool` 仅 8 次调用。
- 删除：`tool-groups.ts` / `tool-layering.ts` / `TOOL_LAYERING` / `enable_tool` / `/tools enable` 与补全 /
  `before_agent_start` 分层自愈 / 休眠组摘要 / `logic.ts` 再导出 / 3 个测试文件 / 白名单 `validateGroups`；
  注册面基线重生成（工具 63→**62**）。`/tools list` 保留并简化为报告活跃/已注册工具。
- 保留认知：盈亏平衡账 + "工具集变化 = 整段前缀失效"（改指向 `deferred` 激活这条现存断裂源）。
- 验证：vitest **87 文件 983 例 + 2 skipped**；门禁全绿；生产代码引用归零。

### 用户批复第 3 项：三个未迁移子系统都不迁移（2026-10-08）

- 报告：`docs/design/UNMIGRATED-SUBSYSTEMS-AUDIT.md`；理由逐条写进白名单对应行。
- ① JSON 压缩：被截断的 ≥2KB 输出 **99 个里 0 个**是 JSON ⇒ 没有服务对象。
- ② Best-of-N judge：`verify_*` 30 天 **3 次**且默认关闭 ⇒ 需求不成立；但记下**正确落点是
  `goal` 的第二校验来源**（P1 的后续项），阻塞是"从工具调模型"缺通道。
- ③ 记忆合并：**jaccard>0.7 零触发**（无重复问题）；0.4–0.7 的 47 对经查是**不同 CVE** ⇒
  相似度合并会合并掉不同条目。**我最初"来源样板"的解释被实测否掉**（剥前缀 47→46）。
