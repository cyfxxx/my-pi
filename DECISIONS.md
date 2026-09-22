# 架构决策记录

## 格式
### [日期] [决策标题]
**背景**：
**选项**：
**决策**：
**理由**：

---

### [2026-09-20] 允许 import type 作为隔离边界例外
**背景**：修复方案 F-03 禁止在 adapters/ 之外 import vendor/pi。但 feature 的 index.ts 需要 ExtensionAPI 类型来注册工具/钩子。
**选项**：
1. 完全禁止 import，在 index.ts 中使用 any 类型
2. 允许 import type { ExtensionAPI }（编译后擦除，无运行时依赖）
3. 创建本地 ExtensionAPI 类型定义
**决策**：选项 2，允许 import type 作为唯一例外
**理由**：import type 在编译后完全擦除，不产生运行时依赖，符合逻辑隔离原则；使用本地类型定义会导致类型与上游不一致，维护成本高。

---

### [2026-09-20] tsconfig paths 映射到 vendor/pi/dist 而非 src
**背景**：TypeScript 编译 custom/ 时，如果 paths 指向 vendor/pi/src，会把整个 vendor/pi 源码纳入编译，导致大量 TS6059 错误。
**选项**：
1. 在 tsconfig 中 exclude vendor/pi
2. paths 映射到 vendor/pi/dist/*.d.ts（仅类型声明）
3. 不使用 paths，直接用相对路径 import
**决策**：选项 2，paths 映射到 dist 目录
**理由**：dist 目录只有 .d.ts 声明文件，不会引入源码编译错误；且符合上游发布的类型包结构。

---

### [2026-09-20] 适配器层使用动态 import 且指向 dist
**背景**：agent-adapter.ts 需要调用 createAgentSession，原代码 import src/index，导致编译错误。
**选项**：
1. 静态 import vendor/pi 源码
2. 动态 import vendor/pi/dist/index
3. 在 adapter 中定义本地接口，运行时再转换
**决策**：选项 2，动态 import dist
**理由**：避免顶层 import 副作用；dist 是稳定的编译产物，不受源码变动影响；动态 import 便于延迟加载。

---

### [2026-09-20] check-isolation.sh 允许 import type
**背景**：原 check-isolation.sh 检查 F-03 时会误报 features/index.ts 中的 import type。
**选项**：
1. 修改 features 不使用 ExtensionAPI 类型
2. 修改 check-isolation.sh 识别 import type 并放行
3. 删除 check-isolation.sh 中的 F-03 检查
**决策**：选项 2，修改脚本识别 import type
**理由**：import type 符合方案允许的例外；删除检查会降低验证效力；使用 any 类型失去类型安全。

---

### [2026-09-20] tool-adapter.ts 适配新版 ToolDefinition 接口
**背景**：vendor/pi 新版 ToolDefinition 要求 execute 函数签名包含 toolCallId、signal、onUpdate 等参数。
**选项**：
1. 完全照搬上游接口，logic.ts 返回标准格式
2. 在 adapter 中做适配转换，logic.ts 保持简单 Promise<string>
**决策**：选项 2，adapter 做转换
**理由**：logic.ts 保持零 Pi 依赖、简单纯函数；adapter 层吸收上游 API 变化，符合接口隔离原则。

---

### [2026-09-20] hook-adapter.ts 扩展 HookEvent 类型覆盖所有使用的事件
**背景**：各 feature 使用不同的钩子事件（session_start, before_agent_start, context 等），原 adapter 只定义了 5 个。
**选项**：
1. 每个 feature 自己定义 HookEvent
2. 在 hook-adapter.ts 中集中定义所有项目用到的事件
**决策**：选项 2，集中定义
**理由**：统一管理，避免重复；新增事件只需在一处添加；类型安全。

---

### [2026-09-20] web-search logic.ts 直接返回格式化字符串
**背景**：原 web-search logic 返回 SearchResult[]，再由 formatResponse 格式化。上游工具 execute 要求返回字符串。
**选项**：
1. logic 返回结构化数据，index.ts 中格式化
2. logic 直接返回格式化后的字符串
**决策**：选项 1，保持结构化数据，index.ts 负责格式化
**理由**：logic.ts 复用性更强，可被其他功能调用；格式化属于表现层逻辑，属于 index.ts。

---

### [2026-09-20] 删除 custom/config/ 和 custom/prompts/ 目录
**背景**：方案目标结构中 custom/ 仅包含 adapters、features、core、bootstrap.ts。
**选项**：
1. 保留作为共享工具
2. 按方案删除
**决策**：选项 2，删除
**理由**：custom/core/config.ts 已提供路径解析；prompts 未被使用；遵循方案最小化原则。

---

### [2026-09-20] my-pi.sh 使用构建产物而非 tsx
**背景**：方案阶段五要求便携启动脚本使用 node dist/cli.js。
**选项**：
1. 优先 tsx（开发便利）
2. 仅 node dist/cli.js（生产标准）
**决策**：选项 2，仅使用构建产物
**理由**：方案明确要求便携版运行编译后的 JS；tsx 依赖额外工具，不符合便携性要求。

> **已被取代（2026-09-20）**：该决策的前提不成立——`vendor/pi` 只构建 coding-agent 自身，my-pi 的自定义层以 **pi 扩展**方式运行，pi 的扩展加载器内置 jiti，可直接加载 `custom/bootstrap.ts`（TypeScript），无需 tsx 也无需预先编译。因此 `custom/dist` 已删除、`scripts/build.sh` 不再编译 custom/。见下方「删除 custom 构建产物」。合并本文件时保留此条以记录决策演进。

---

### [2026-09-20] vendor/pi 保留由主仓库追踪（偏离独立 clone）
**背景**：第三轮方案要求 vendor/pi 作为独立 git clone 并由主仓库 .gitignore 排除。但当前环境 GitHub clone 超时（仅 ls-remote 元数据可用），且项目需在 Termux/Android、WSL2、Linux 多设备间同步。
**选项**：
1. 严格按方案：git init vendor/pi + .gitignore 排除，移除 1689 个已追踪文件
2. 保留 vendor/pi 由主仓库追踪，修正补丁/脚本/文档并记录偏离
**决策**：选项 2，保留主仓库追踪
**理由**：独立 clone 离线不可行；移除追踪会导致新克隆的仓库缺少 vendor/pi 而无法构建/运行；多设备同步会因此失效。`sync-upstream.sh` 已增加保护：vendor/pi 非独立仓库时拒绝执行，避免误操作主仓库。待网络支持完整 clone 时可再切换。

---

### [2026-09-20] 品牌化仅保留在 patches/，vendor/pi/package.json 保持 pristine
**背景**：001-branding.patch 已应用于 vendor/pi/package.json（name=my-pi、piConfig），导致 `git apply --check` 失败；且运行时 piConfig 实际读取的是 `vendor/pi/packages/coding-agent/package.json`（configDir=.pi，无 name），vendor/pi/package.json 的 piConfig 不被使用。
**选项**：
1. 保持 vendor 已品牌化，删除补丁
2. 将 vendor/pi/package.json 恢复为上游 pristine，重生成并仅保留最小品牌化补丁
**决策**：选项 2
**理由**：符合「vendor 只读、改动经 patches 管理」的原则；补丁可被 `git apply --check` 验证；恢复 pristine 不影响运行时（配置目录由 `PI_CODING_AGENT_DIR` 重定向，品牌名对运行时无影响）。

---

### [2026-09-20] vendor/pi 转为独立 git clone（取代前一决策）
**背景**：先前因 GitHub clone 超时选择保留 vendor/pi 由主仓库追踪。后确认网络可用（SSH 认证成功、clone 成功），且主仓库 `main` 就是 pi 源码（提交作者 Armin Ronacher），canonical 上游 `earendil-works/pi-mono` 亦可达。
**选项**：
1. 继续由主仓库追踪
2. 转为独立 clone，上游指向 `earendil-works/pi-mono`，锁定 `71dca871b`（= 原 vendored 基线对应的 canonical upstream），本地改动抽为 patches
**决策**：选项 2
**理由**：恢复 `sync-upstream.sh` 自动同步能力；上游使用官方 pi 源而非自身快照；`71dca871b` 为 canonical SHA，便于后续 fetch/merge。代价：fresh checkout 需引导 vendor（已由 `scripts/build.sh` + `vendor/PINNED_COMMIT` 自动化）；已在稳定分支 `fix/vendor-independent` 上完成并验证。

---

### [2026-09-20] 删除 .pi/，配置收敛到 portable/agent（方案 B）
**背景**：第一轮方案的目标结构不含 `.pi/`，核心原则是"所有运行时数据收敛到 `portable/`"；但实际配置仍在 `.pi/`，而 `my-pi.sh` 已把 `PI_CODING_AGENT_DIR` 指向空的 `portable/agent`，导致启动器读不到 provider/model 配置。
**选项**：
1. 保留 `.pi/` 作为配置目录，改回启动器指向 `.pi`
2. 把 `.pi/` 全部迁入 `portable/agent/`，删除 `.pi/`
**决策**：选项 2
**理由**：与文档/脚本已声明的设计一致；pi 的 `AGENTS.md` 全局加载和 `APPEND_SYSTEM.md` 回退路径都能落到 `agentDir`（= `portable/agent`），因此无需改 vendor、无需符号链接即可彻底去掉 `.pi/`。`models.json`（含 apiKey）此前被误跟踪，迁移时一并停止跟踪并 gitignore；`settings.json`/`keybindings.json`/`AGENTS.md`/`APPEND_SYSTEM.md` 仍跟踪，其余每环境独立/状态文件忽略。

---

### [2026-09-20] pi-tools 迁移策略：优先纯逻辑 + 可测试模块，不整体搬运
**背景**：pi-tools 的 12 个扩展实现约 4 万行，多数依赖旧扩展 API 与私有 services/lib；一次性整体移植无法逐个验证，违背原方案"逐个迁移、每步验证"的纪律，且有破坏当前可用项目的风险。
**选项**：
1. 整体移植全部扩展实现
2. 按依赖与可验证性分批：先移植纯逻辑、可单测、且契合当前架构的模块
**决策**：选项 2
**理由**：当前项目目标是"可维护的私人助手硬分叉"，不是一次性快照。批次顺序：先无 Pi 依赖的纯逻辑（token 预算、note-store、脱敏、原子写、子代理角色），它们能直接落到 `logic.ts`/`custom/core` 并用 vitest 验证；涉及 Pi API 编排（autopilot/browser/link/voice/tmux 等）留待后续逐个按 adapter 迁移并验证。

---

### [2026-09-20] 技能放到 portable/agent/skills/（而非 portable/skills/）
**背景**：迁移 pi-tools 的 `agent/skills/` 时需确定目标目录。my-pi 文档与 `my-pi.sh` 声明技能目录为 `portable/skills/`（`PI_SKILLS_DIR`），但需要确认 pi 是否识别该变量。
**选项**：
1. `portable/skills/`：与现有文档/`PI_SKILLS_DIR` 声明一致，但需验证 pi 是否读取
2. `portable/agent/skills/`：pi 的 `agentDir/skills` 路径（`agentDir` = `PI_CODING_AGENT_DIR` = `portable/agent`），与 `settings.json` 中 `+skills/<name>/SKILL.md` 覆盖模式一致
3. 顶层 `skills/`：独立技能仓库，需启动器 `--skill` 显式加载
**决策**：选项 2
**理由**：核对 vendor/pi 源码后确认 pi v0.85.1 只识别 `PI_CODING_AGENT_DIR` 与 `PI_PACKAGE_DIR`，**不存在 `PI_SKILLS_DIR`**；技能由 `agentDir/skills` 自动发现，`settings.json` 的 `skills` 数组是相对 `agentDir` 的匹配模式（`package-manager.ts` 以 `globalBaseDir = agentDir` 做 pattern match）。因此只有 `portable/agent/skills/` 会真正被加载；`portable/skills/` 当时暂留为占位目录。（该占位目录已于同日「删除 portable 下三个占位目录」决策中移除。）

---

### [2026-09-20] packs 整目录迁移，skills/docs 精选改写后迁移
**背景**：pi-tools 的 `packs/`（外部技能包）、`agent/skills/`（4 个内置技能）、`docs/`（18 篇）内容形态不同：packs 是自包含的按需技能包；skills 与 docs 大量引用 pi-tools 专有结构（`agent/extensions`、`agent/services`、`scripts/rebuild.sh`、`searxng`、wrapper/systemd、92/106 等 pi-tools 用例数），整体搬运会引入失效路径与错误描述。
**选项**：
1. 三类内容一律原样复制
2. packs 原样迁移；skills 与 docs 逐篇检查、按 my-pi 结构改写后迁移（丢弃 pi-tools 专有内容）
**决策**：选项 2
**理由**：packs 与仓库结构耦合弱且内含本地经验沉淀（`EXPERIENCE.md`），原样保留并用 `diff -r` 校验；skills/docs 与项目结构强耦合，原样迁移会产生误导性文档。docs 精选 8 篇保留可迁移价值（pi 扩展/SDK 开发、技能维护、多环境/Termux/终端运维），丢弃 10 篇 pi-tools 专有报告与路线图，清单记录在 `docs/README.md`。技能仅更新路径/命令/子系统引用，保留原有方法论与纪律，frontmatter `name` 不变。

---

### [2026-09-20] 根目录文档收敛为 6 个，项目愿景置于 docs/design/VISION.md
**背景**：作为个人项目，根目录 9 个文档中混有上游/历史遗留：`CHANGELOG.md` 记录的是 pi-tools 迁移期日志（条目指向 my-pi 已不存在的 rebuild.sh/pi-wrapper.sh/setup-*.sh）、`CONTRIBUTING.md` 面向不存在的协作者且内容与 AGENTS 重复、`SECURITY.md` 是上游 pi 模板（报告入口指向 earendil 安全邮箱）。同时用户指出 pi-tools 的 `VISION.md` 即其开发目标，需迁移并按现状更新。
**选项**：
1. 全部保留，仅更新内容
2. 移除三个不适用文档；VISION 放根目录
3. 移除三个不适用文档；VISION 放 `docs/design/VISION.md`
**决策**：选项 3
**理由**：`CHANGELOG.md`/`CONTRIBUTING.md`/`SECURITY.md` 对个人项目无实际作用且会误导（脚本清单、报告入口均不成立），删除后根目录只保留 README/AGENTS/STRUCTURE/DECISIONS/PROGRESS/LICENSE。VISION 是设计类文档而非入口文档，放 `docs/design/` 并在 README 与 `docs/README.md` 显著链接，既保持根目录精简又便于发现；其原 §4「度量体系」在 pi-tools 记为全部落地，在 my-pi 实为整体缺失，改写为现状差距表并把执行跟踪并入 §6 落地路线（不再单设 ROADMAP，避免与 PROGRESS 重复）。§1–§3、§5 属用户确认范围，迁移时只做落点映射与状态标注，不改愿景本身。

---

### [2026-09-20] 删除 portable 下三个占位目录，运行时数据统一收敛到 agentDir
**背景**：`portable/{skills,extensions,sessions}/` 是骨架期创建的占位目录。核对 vendor/pi 源码后确认：pi 只识别 `PI_CODING_AGENT_DIR` 与 `PI_PACKAGE_DIR`，技能来自 `agentDir/skills`、会话来自 `agentDir/sessions`（可用 `PI_CODING_AGENT_SESSION_DIR`/`--session-dir` 覆盖）、扩展来自 `agentDir/extensions`，三者都不读 `portable/{skills,extensions,sessions}`。启动器导出的 `PI_SKILLS_DIR`/`PI_EXTENSION_DIR`/`PI_SESSION_DIR` 全部无效，会话此前实际写在 `portable/agent/sessions/`。
**选项**：
1. 保留目录，会话改用 `--session-dir` 指向 `portable/sessions`，把运行时数据与配置分离
2. 删除三个占位目录；运行时数据统一由 agentDir（`portable/agent/`）承载，启动器只导出有效变量
**决策**：选项 2
**理由**：选项 1 的收益只是目录语义更整齐——两种布局都在 `portable/` 下，便携性保证同样成立，却要额外迁移现有会话并引入一个启动参数；用户明确表示会话目录无移动必要。选项 2 只删除零引用的空目录、去掉误导性的无效变量导出，改动面小且无需迁移数据。收敛后的规则更简单：**agent 的配置/技能/会话/扩展都在 `portable/agent/`（agentDir）下，`portable/memory/` 只放 my-pi 自定义功能的数据**（`PI_MEMORY_DIR` 由 `custom/core/note-store.ts` 读取）。若将来确需分离会话，再按选项 1 加 `--session-dir` 即可。

---

### [2026-09-20] agentDir 改名为 portable/agent，并修复 custom 层接线
**背景**：上一决策把技能/会话/扩展统一收敛到 `agentDir` 后，目录名 `portable/config` 与实际内容（配置 + 技能 + 会话 + 扩展）不符，文档中"config 只放配置"的表述自相矛盾。同时在核对改动面时发现 custom 层存在更深的问题：实测 `./my-pi.sh` 报 `Extension does not export a valid factory function` 并退出码 1，即 12 个功能一个都没有真正加载。
**选项**：
1. 只改文档措辞，保留 `portable/config` 名字
2. 物理分离：sessions/skills/extensions 移出 agentDir，用 `--session-dir`/`--skill`/`--extension` 加载
3. 把 agentDir 改名为 `portable/agent`，内容与加载方式不变，同时修复接线缺陷
**决策**：选项 3
**理由**：
- 选项 2 做不到彻底分离——pi 的 `pi install` 安装路径硬编码在 agentDir 下（`getManagedNpmInstallPath()` = `agentDir/npm/node_modules/<name>`，`getGitInstallRoot()` = `agentDir/git`），扩展必然分裂在两处，还要长期维护 2-3 个上游 CLI 契约。
- 选项 1 无法消除命名与内容的冲突；改名对 pi 零语义代价（`PI_CODING_AGENT_DIR` 指向任意目录均可），且项目尚小（28 个跟踪文件、2 个会话文件），是成本最低的时机。
- 接线缺陷必须一并修：`bootstrap.ts` 需按 pi 约定**默认导出**工厂函数；`config.ts` 不得再引用已删除目录；以扩展方式运行时 session 由 pi 创建，`agent-adapter.ts` 属旧设计遗留且实现有误（`cwd` 误用会话目录），故删除；`tool-adapter` 的 `parameters` 需编译为 TypeBox schema。
结果：`portable/agent/`（pi 运行时根）+ `portable/memory/`（my-pi 自定义数据），`./my-pi.sh` 可实际启动并注册全部 12 个功能。

---

### [2026-09-20] 删除 custom 构建产物，custom/ 一律以 TypeScript 源码加载
**背景**：`custom/dist/` 由 `scripts/build.sh` 编译产生，但运行路径从不使用它——`my-pi.sh` 与 `dev.sh` 都以 `--extension custom/bootstrap.ts` 加载，pi 的扩展加载器内置 jiti，原生支持 TypeScript（实测 12 个功能注册、工具被调用，全程无 dist 参与）。该产物反而造成误导：其中残留已删除的 `agent-adapter.js`；其编译命令还与 `custom/tsconfig.json` 的 `noEmit: true` 自相矛盾（命令行强行 `--outDir custom/dist --noEmit false`）。
**选项**：
1. 删除 `custom/dist`，`build.sh` 不再编译 custom/，运行统一加载 `.ts`
2. 保留产物，改 `my-pi.sh` 加载 `custom/dist/bootstrap.js`（运行前必须先 build）
3. 保留产物但不使用（现状）
**决策**：选项 1
**理由**：选项 2 会引入"源码/产物两份、必然漂移"的经典问题（本次踩到的就是它），并要求每次运行前构建、fresh checkout 更繁琐，收益仅是省去启动时的即时编译；选项 3 是自相矛盾的状态。选项 1 收敛为单一事实来源：`vendor/pi` 需要构建（独立 clone，我们消费其 dist），`custom/` 只需 `tsc --noEmit` 类型检查。可行性上无损失——TS 支持来自 pi 自带的 jiti，不引入 tsx 等额外工具，与便携性要求一致。旧决策「my-pi.sh 使用构建产物而非 tsx」的前提（运行 TS 需要额外工具）对扩展路径不成立，已在该条下标注取代。
---

### [2026-09-21] 度量/防退化/记忆治理的落点（VISION P1–P3）
**背景**：12 个功能迁移完成后，VISION §4 指出的最大缺口是度量层：干预率、token 成本、缓存命中率均无法测量；记忆治理只停留在目标设计；结构性改动缺少行为级回归网。pi-tools 以 `usage-stats`/`task-metrics`/`golden-tasks`/`memory-lifecycle` 分散承载这些能力。
**选项**：
1. 新建一个 `metrics`/`observability` feature 集中承载
2. 就近落点：度量入各功能现有文件（context 存用量、autopilot 汇仪表盘、memory 出治理报告），防退化入 `scripts/`
3. 只做文档，不落地程序
**决策**：选项 2
**理由**：
- 选项 1 会打破"12 个扩展"的清晰身份，且指标天然属于对应功能（干预属 intervention、用量属 context、任务属 autopilot）。
- 选项 2 的耦合以**数据文件**为边界（`interventions.jsonl`/`usage.jsonl`/`telemetry.json` 都在 `portable/memory/` 下），不引入 feature 间代码依赖；`/auto metrics` 只做只读聚合，符合 §3.4「执行-知识分离」——度量用于观察，不进入生产解题路径。
- 防退化用 `scripts/golden-tasks.sh` + `scripts/check-injection-surface.sh` + `scripts/check-doc-links.mjs` 承载，`npm run golden` 一键守门；`check-injection-surface` 以 system prompt 前缀指纹防缓存回归（§3.2 硬优先）。
- 记忆治理报告（`/memory lifecycle`）与教训闭环（`/memory mine [--ingest]`）只读幂等；写入须用户显式 `--ingest`，符合 §5「任何写操作先报告/确认」。
结果：VISION §2 三项判据均可测量（`/auto metrics`），P1/P2/P3 达成，测试 208 用例 + golden 七项守门。

---

### [2026-09-21] 功能迁移的完成口径与 N.A. 边界
**背景**：逐批迁移 pi-tools 12 个扩展时，部分能力与 my-pi 架构前提冲突，需要明确"完成"的口径，避免为对齐而引入不必要复杂度。
**决策**：按"逻辑可移植则移植、平台/编排依赖则替代或标注 N.A."处理：
- **N.A.（不迁移）**：`pi-wrapper.sh`/crash-recovery/L4 源码缓存——my-pi 直启（`my-pi.sh`）无 wrapper 层；离线 cron 由 autopilot 会话内 tick 承担；Windows 原生 tmux 模拟不迁移（目标平台 Linux/Termux）。
- **替代**：TUI 补丁由 `patches/*.patch`（源码级）替代 dist 级 `patch-*.mjs`；外部服务安装由 `scripts/setup-external.sh` 文档化。
- **逻辑移植并补测试**：其余一律进入 `custom/features/*/{logic}.ts`，保持零 Pi 依赖。
结果：12/12 功能核心与运行编排层落地；N.A./替代项在各 feature 头注释与 PROGRESS 记录，避免"看似缺漏"的误解。

---

### [2026-09-21] 钩子事件名从 Pi 类型派生，杜绝手写清单漂移
**背景**：全面审查发现 `custom/adapters/hook-adapter.ts` 的 `HookEvent` 是手写清单，含 `before_tool_call`/`after_tool_call` 两个 Pi 并不派发的事件（Pi 实际为 `tool_call`/`tool_result`）。后果是 context 的工具用量计时与 plan-mode 的只读强制从未触发，而 `check-features.sh` 又用同一错误清单"校验"，无法发现；`pi.on` 经 `as unknown` 双重断言，`tsc` 也拦不住。
**选项**：
1. 维持手写清单，靠人工同步 Pi 事件
2. 从 Pi 的 `ExtensionEvent` 派生 `HookEvent = ExtensionEvent['type']`，并让适配器按该联合收窄 `on`
3. 适配器直接暴露 Pi 的 `on` 原始类型，features 各自 import 事件类型
**决策**：选项 2
**理由**：
- 选项 1 已被证明会漂移，且守门脚本会继承错误清单，失去防护意义。
- 选项 3 会让 feature 层接触 Pi 类型细节，违背"接口隔离"（features 只依赖适配器稳定接口）。
- 选项 2 让事件名成为编译期契约：写入不存在的事件名直接 `tsc` 报错；事件名由上游类型自动更新。同时把 `plan-mode`/`context` 的事件与字段（`input`/`content`）修正到真实契约。
结果：`check-features.sh` 现在既校验事件被 feature 注册，又反向校验事件名存在于 vendor 类型中；隔离脚本改按包名 `@earendil-works/*` 校验，真正约束 runtime import。

---

### [2026-09-21] 功能目录两层化：根层放 index/logic，实现按职责下沉子包
**背景**：功能迁移完成后，部分功能目录堆积 10+ 个平铺文件（memory/voice/autopilot），可读性下降；但项目既有约定要求每个功能根目录必须有 `index.ts` 与 `logic.ts`（守门脚本 `check-features.sh` 依赖），且"数据收敛到 `portable/`"。
**选项**：
1. 保持全平铺，仅靠命名区分
2. 允许功能根下按职责建一层子包，`logic.ts` 作 barrel 保持对外出口不变
3. 把功能内的代码再拆成独立顶层包
**决策**：选项 2
**理由**：
- 选项 1 在 10+ 文件时阅读成本高，无法表达 `storage/retrieval/inject` 这类职责分组。
- 选项 3 会破坏"一个扩展一个目录"的迁移映射，且增加跨包依赖。
- 选项 2 保留 `index.ts`（注册）与 `logic.ts`（纯逻辑出口）在根层，守门脚本与跨功能引用不受影响；仅多一层目录，符合"同功能文件放一起、嵌套不深"。子包内互引用用相对路径，跨功能只走对方 `logic.ts`，维持分层。
- 数据仍在 `portable/` 收敛（项目硬约束优先于"代码/配置/数据同目录"的个人偏好）；仅将 autopilot 的配置/状态从 agentDir 根收拢到 `portable/agent/autopilot/`，并保留旧路径读取回退。

### [2026-09-22] 崩溃自愈重新引入 supervisor（推翻此前 N.A.）
**背景**：此前以"my-pi 直启无 wrapper"为由把 crash-recovery 标为 N.A.。用户澄清：最新 pi-tools 已改为「用 pi 修复 pi」，轻度崩溃（external）用屏蔽扩展/技能的当前 pi 自修复，重度（pi_self）用源码编译的 pi 修复损坏的 pi，且 `/tmp` 有最新 clone。
**决策**：按该设计重新引入轻量 supervisor（`scripts/pi-supervisor.sh`），`my-pi.sh` 默认经它启动。
**理由**：崩溃时只有外部进程能重启/救援，直启无法自愈；my-pi 的 vendor 即源码，`pi-source-build.sh` 构建并缓存 dist 作为"好 pi"，无需再 clone 上游。保留熔断/最大轮数/健康检查/审计，避免"越修越坏"。

### [2026-09-22] 长期记忆只做精选迁移，不整库导入
**背景**：pi-tools 记忆库 982 条含 PAT 泄露记录、Tailscale/SSH 主机信息与大量旧路径。
**决策**：过滤敏感/旧路径/设备专属/新闻/测试垃圾后迁移 139 条，不迁移 summaries/notes/interventions/extract-sessions。
**理由**：长期记忆价值在可移植的经验，而非旧项目运行日志与安全敏感清单；整库导入会把误导与泄露一并带入。

### [2026-09-22] 命令面去冗余与"少手动、多自动"
**背景**：顶层描述内联长 usage，子命令无说明；`/autopilot` 整体重复 `/auto`+`/schedule`，`/usage-diag` 重复 `/context`。
**决策**：删冗余命令，顶层短描述 + 子命令补全说明；砍掉与自动行为重复的手动子命令（`/context reset`、`/voice on|off`、`/plan on|off|toggle`），自动切换交由 hook/快捷键（Ctrl+Alt+R / Ctrl+Alt+P）。
**理由**：命令是低频入口，手动开关不符合"智能化"，且每多一个命令都增加认知与维护成本。

### [2026-09-22] web_search 端点解析与无 SearXNG 降级
**背景**：web-search 迁移后仅认 `SEARXNG_URL`，而 my-pi 运行环境无该变量、且本机未装 SearXNG，导致 web_search 恒不可用。
**决策**：端点按 `SEARXNG_URL` → `PI_WEB_TOOLKIT_SEARXNG_URL`（pi-tools 兼容名）解析；两者皆无时自动降级为免配置 HTTP 搜索（`web_fetch` 同源 Bing 直连）并在结果前注明。
**理由**：搜索是高频能力，不应因可选外部服务缺失而不可用；显式配置仍优先，降级不隐藏（结果首行说明）。

### [2026-09-22] 不迁移 auto-compact 控制器与 task-summarizer 流水线（口径）
**背景**：pi-tools `pi-context/auto-compact-controller.ts` 与 `task-summarizer.mjs` 依赖 `.usage-diag.jsonl`、task-record、thinking-level、warm-prefix、prune-dump 等一整条未迁移的数据/编排链。
**决策**：本轮只保留已迁移的阈值判定器；快照/任务门控/思考档切换/暖前缀回放与技能草稿流水线暂不迁，在 PROGRESS 记录依赖缺口。
**理由**：为对齐而引入整条数据链会使改动面远超收益，且与"逻辑可移植则移植、编排依赖则替代或标注"的既有口径一致。

### [2026-09-22] web_search 三层端点解析 + 失败降级
**背景**：本机无 docker，SearXNG 需原生部署；且所在网络对部分搜索引擎直连受限，SearXNG 可能返回空结果。
**决策**：端点按 `SEARXNG_URL` → `PI_WEB_TOOLKIT_SEARXNG_URL` → 本地 `127.0.0.1:8889` 解析；当 SearXNG 返回失败/超时/未找到结果时，自动降级为 `web_fetch` 同源 HTTP 搜索（Bing），结果首行注明降级。
**理由**：搜索是高频能力，本地实例是首选但不应成为单点；降级对用户可见，不静默改变语义。

### [2026-09-22] 外部服务安装位置：SearXNG 用 /opt 而非 portable/
**背景**：`check-isolation` 规定 `portable/` 不放运行时依赖（node/chromium/ffmpeg 等），且 `portable/` 禁符号链接。
**决策**：SearXNG 原生装到 `/opt/searxng`（可用 `SEARXNG_HOME` 覆盖），由 `scripts/setup-external.sh web` 管理启动；工具 shim 写入 `portable/agent/bin` 用 exec 脚本而非 `ln -s`。
**理由**：保持"portable/ 仅运行时数据"的边界与无符号链接约束，同时外部服务可复现安装。

### [2026-09-22] 压缩前快照落点迁移到 portable/memory/checkpoints
**背景**：pi-tools 快照写 `~/.pi/logs/compact-snapshots`；my-pi 已有 `portable/memory/checkpoints/`（memory 功能使用）且无 `portable/agent/logs`。
**决策**：`snapshotBeforeCompact` 统一写 `portable/memory/checkpoints/`，保留最近 8 份/7 天。
**理由**：运行时检查点数据集中一处，便于 memory 治理与清理；避免为日志再开一个目录。

### [2026-09-22] task-record/task-summarizer 改为适配迁移（取代同日"不迁移"口径）
**背景**：先前以"依赖整条未迁移数据链"为由暂缓；实际 `task-record` 生产者可确定性重建（agent_settled 写结构化记录），总结层可去掉 spawn 强依赖。
**决策**：迁移为 `context/budget/task-record.ts`（写 `portable/memory/task-records.jsonl`）+ `scripts/task-summarizer.mjs`（游标聚合 → digest 写 `portable/memory/daily-results/`；`--dry-run` 列表；`--spawn` 才调用 `my-pi.sh -p` 并行入库/起草 SKILL）。默认不 spawn，避免无 provider/管道场景挂起。
**理由**：保留"即时记录 + 批量总结"的自主学习闭环，同时把编排依赖降为可选。

### [2026-09-22] 网络搜索可用性修复（对齐 pi-tools 注意事项）
**背景**：本机 SearXNG 用默认引擎集，google/duckduckgo/brave/wikipedia 等全部 timeout 拖垮整次搜索（空结果）；`web_fetch`（Bing 直搜）因 HTML 结构变化（`<h2 class=...><a target=... href=...>`，属性在 href 前）旧正则匹配不到，恒返回"无结果"；`fetch_url` 在受限出口仅部分主机可达。
**决策**：(1) 迁移 `scripts/searxng-config.sh`，只启可达引擎并令 bing 走 `cn.bing.com`；(2) `searchDirect` 放宽为"h2 内任意属性顺序的 a[href]"，加实体解码与 `/ck/a` 跳转还原；(3) `resolveSearxngUrl`/`resolveSearchTimeout` 增加 `settings.json`（`pi-web-search`）读取，默认超时 30s（原项目口径）。
**理由**：这三项是原项目 README/CHANGELOG 明确记录的网络搜索注意事项；修复后本地 SearXNG 与 Bing 直搜均可用。

### [2026-09-22] 工具分层"常驻配置"同步 pi-tools，并按已注册工具过滤
**背景**：需将 pi-tools `tool-groups.ts` 的常驻（CORE_TOOLS）与休眠组名单同步到 my-pi，但其中 `plan_*`/`ctx_*`/`admin_*`/`verify_*`/`ask_user`/`thinking_level`/`autopilot_policy`/`schedule_task` 对应功能尚未迁移。
**决策**：完整同步原项目名单以保持一致；新增 `groupsWithTools(presentTools)`，`buildSleepingSummary(present)`、`/tools` 补全与报告、`enableGroup` 均只暴露"当前已注册工具"所属的组，未迁移组不注入 system prompt、不可启用。
**理由**：既保持与上游常驻配置同源、后续迁移自动生效，又避免向模型宣传不可用工具导致无效调用。

### [2026-09-22] 迁移 thinking 档位自适应切档（含模型建议 tool）
**背景**：pi-tools `thinking-level.ts` 是 auto-compact 控制器的一环：按真实窗口比例在 low/medium/high 间自动升降档（critical→降档省 token、回落→升回基准），并提供 `thinking_level` 工具让模型"建议"、规则审批（死区/压力方向）。
**决策**：迁移为 `context/budget/thinking-level.ts`（纯逻辑 + 审计 JSONL 落 `portable/memory/logs/level-changes.jsonl`），在 `agent_settled` 依据 `getContextUsage()` 的 tokens/window 驱动，注册 `thinking_level` 工具；用 `PI_CONTEXT_THINKING_AUTO=off` 关闭自动切档，`PI_LEVEL_CHANGE_FILE`/`PI_DISABLE_LEVEL_AUDIT` 控制审计。
**理由**：上下文压力与思考预算争抢是剪枝/缓存断裂主因，自适应档位收益明确；比例分母用真实窗口（非 256K 压缩阈值），压缩后自然回落可升回。副作用：内核会持久化 `settings.defaultThinkingLevel`（合法值 off/low/medium/high，无 max），属预期。

### [2026-09-22] 迁移工具失败熔断与错误脱水（tool-health）
**背景**：NEW 已有 token 预算截断（`budget.pruneToolOutput`），但缺 pi-tools `tool-truncation.ts` 的两项确定性健康逻辑：同一工具连续失败 3 次的熔断提示，以及错误输出的重复行折叠/超长行截断；且 `tool_result` 钩子此前截断后只返回单个 text 块，会丢弃图片等非文本块。
**决策**：新增 `context/budget/tool-health.ts`（`updateFailStreak`/`dehydrateErrorOutput`/`rebuildTextContent`），在 `tool_result` 钩子接线：失败计数→熔断提示、错误脱水、`rebuildTextContent` 原位回写文本并保留非文本块。不迁移 ORIG 的字节级 `truncateToolContent`（与 token 预算截断重复）。
**理由**：逐工具 `pruneToolOutput` 与中心钩子互补；熔断/脱水是低成本的无效重试抑制与 token 收敛；修复丢块是明确缺陷。

### [2026-09-22] 迁移 autopilot 会话列表/切换与 admin 重启
**背景**：pi-tools `pi-autopilot/sessions.ts` + `admin_*` 工具（列表/切换会话/重启）未迁移；NEW 的 admin state（`writeRestartRequest`）此前只写无人消费，且 `tool-adapter` 不向工具透传 ctx，无法做 UI 确认/主动关机。
**决策**：① `tool-adapter` 增加 `ToolExecuteContext`（hasUI/confirm/notify/shutdown）并从 Pi ctx 提取；② 新增 `adapters/session-adapter.ts` 封装 vendor `SessionManager.list/listAll`（替代 ORIG 手写文件扫描，拿到 cwd/messageCount 等结构化字段）；③ `autopilot/store/sessions.ts` 纯格式化；④ autopilot 注册 `admin_list_sessions`/`admin_switch_session`/`admin_restart`（名称与 ORIG 一致，落入 admin 休眠组/核心）；⑤ `pi-supervisor.sh` 正常退出时消费 admin state，`restart` 重拉、`switch_session` 以 `--session <path>` 重拉并清理请求。
**理由**：会话编排是 autopilot 运维核心；用 vendor 结构化 API 比手写扫描更稳；supervisor 消费请求是让 admin 工具真正生效的最后一环。

### [2026-09-22] 补全 auto-compact 门控（背景任务/环境阈值/上下文回退/重启提示）
**背景**：NEW 的自动压缩仅在 turn_end 按阈值 + 计划任务门判定；缺 pi-tools 控制器的背景任务门、环境比例/绝对阈值、真实 usage 缺失时的上下文回退与重启提示阈值。
**决策**：新增 `context/budget/task-gate.ts`（`ABSOLUTE_TOKENS`/`RESTART_TOKENS`/`COMPACT_COOLDOWN_MS`/`TASK_GATE`、`readEnvRatio`、`resolveContext`、`hasBackgroundTask`）。turn_end 改用 `resolveContext`（真实 usage → provider token 回退），加背景任务门；`compactDecider` 注入环境比例/绝对阈值/冷却；`before_agent_start` 在 tokens > `RESTART_TOKENS` 时注入"先 /compact 再重启"提示。
**理由**：三重门（阈值/任务/后台）避免压缩打断进行中的多步/后台任务；回退保证真实 usage 缺失时仍能判定；重启提示减少重启后首轮全量重发。`hasBackgroundTask` 仅在 `PI_SESSION_ID` 可归属且 tmux 会话存活时生效（否则门惰性安全）。

### [2026-09-22] 自动化整理：子包化 web-search/link + 系统提示补全 + knowledge-ingest 可移植
**背景**：用户授权持续迁移并按便携化/模块化要求整理目录；同时修掉此前引入的缓存不友好注入。
**决策**：
1. `web-search` 拆分 `config/search/fetch/concurrency`、`link` 拆分 `types/config/net/card/guards/state/display` 并把 `link.ts` 更名 `protocol.ts`，两侧 `logic.ts` 改为 barrel（跨功能引用仍只走 `logic.ts`）。
2. `context` 的 `before_agent_start` 补全压力分档（75%/90%）+ 委派/效率建议；重启提示改为**静态文本**（移除精确 token 数值，遵守"注入禁止精确数值"的缓存纪律）。
3. `scripts/knowledge-ingest.mjs` 改为基于 `import.meta.url` 解析 ROOT 的可移植实现，条目 `environments:['all']` 跨设备可见；正式入库（脚本总数 18）。
4. 新增 `deploy/systemd/pi-searxng.service`（原生 venv 托管）；`deploy/tmux`（终端配置）与 `pi-whisper.service` 按每环境独立/语音暂缓的既有口径不迁移。
5. Best-of-N 的 LLM 集成不迁移：原项目 `judgeCandidates` 为随机占位、`bestOfN` 依赖外部编排；纯评分逻辑（parseJudgeScores/selectBest/shouldVerify）已在 `autopilot/run/verifier` 迁移。
6. `docs-check.mjs`/`docs-freshness.mjs` 不迁移：与本仓库 `check-doc-links.mjs` 重叠，且其"元信息表/目录导航"模板与本项目文档风格不符，会产生大量误报。
**理由**：在不引入 vendor 核心补丁风险的前提下完成目录模块化与闭环；未能闭环或属环境专属的项以决策记录明确边界。

### [2026-09-22] 深度检查：死代码清理、运行时数据归位、packs 索引补全
**背景**：自主深度检查发现若干不一致：未用导入/死代码、`portable/memory/daily-results` 单文件被 force-add 与 `.gitignore`（运行时数据不入库）冲突、`packs/INDEX.md` 漏 `reverse-skill`、`packs/drafts` 目录缺失。
**决策**：
1. 删除 `context/logic.ts` 死代码（暖前缀/未用状态与函数）与各文件未用导入；`custom/tsconfig.json` 开启 `noUnusedLocals`/`noUnusedParameters` 防回归。
2. 运行时产物归位：`git rm --cached portable/memory/daily-results/...`，遵守 `portable/memory/*` 忽略策略（文件保留在磁盘）。
3. 补全 `packs/INDEX.md` 的 `reverse-skill`（入口 `skills/SKILL.md`）；新增 `packs/drafts/.gitkeep` 并在 `.gitignore` 忽略草稿内容，闭合 task-summarizer 起草落点。
**理由**：深度检查的目标是消除死代码、文档/策略不一致与运行时数据入库，保证便携与可维护。

### [2026-09-22] 重建脚本优化与 pi 更新自动修复
**背景**：用户要求对比本地环境与远程仓库，确保新设备能顺利重建、更新 pi 后能自动修复。审查发现多处“本地可用但新设备不可复现”的缺口：根依赖从未安装、补丁模型自相矛盾（本地为 commit，脚本按未提交处理，而 check-isolation 要求 vendor 干净）、同步后不重建/刷缓存、dev.sh 依赖未安装的根 tsx、check-features 把每环境独立的 auth.json 当必检项。
**决策**：
1. 新增 `scripts/lib-vendor.sh` 作为 build/sync/doctor 的共享逻辑：补丁**幂等**应用（reverse-check 跳过已应用，新应用提交为本地 commit 使 vendor 保持干净），依赖一致性用 `node_modules/.package-lock.json` 的 mtime 判断（逐字节比较会因 npm 精简隐藏锁而误报）。
2. `build.sh` 重写为“一键重建”：Node 检查 → 根 `npm ci`（不改 lock）→ vendor 引导（clone/checkout/幂等提交补丁）→ vendor 根 `npm ci` + 构建 → 可选 shim/自愈缓存；用 `PI_SKIP_*`、`PI_CN_MIRROR`、`PI_CLONE_TIMEOUT` 控制。
3. `sync-upstream.sh` 升级为“更新即修复”：fetch 超时保护 → merge（冲突 abort 回滚并列出文件，不留半完成态）→ 幂等补齐补丁 → 重建 dist → 刷新自愈缓存 → 类型检查；`PI_SYNC_DRY_RUN=1` 只读预演。
4. 新增 `scripts/doctor.sh`（本地 vs 仓库体检 + `--fix`），作为“对比本地环境与远程仓库”的常驻工具；`pi-source-build.sh` 增 `--no-build` 以免递归构建。
5. 修正可复现性阻碍：`dev.sh` 用 vendor 内置 tsx；`check-features` 的每环境独立文件降级为警告；golden 补丁标签改为动态计数。
**理由**：把“重建”和“更新”都收敛为幂等、可重复、无锁污染的单一入口；补丁以 commit 形式与本地一致，使 merge 自然工作且满足隔离检查；doctor 让缺口可见且可一键修复。

### [2026-09-22] 更新 pi 上游至 v0.87.0 + sync/build 自愈式重建
**背景**：用户要求“更新项目中的 pi”。基线为 v0.85.1（`71dca871b`），上游最新 `d201760ff`（v0.87.0，+134 commits）。旧 `sync-upstream.sh` 采用“merge 后再 apply 补丁”，在补丁改动与上游改动重叠时会产生语义错误（实测 002 的 `google-shared.ts` hunk 与上游新增的 `TOO_MANY_TOOL_CALLS` case 合并成重复 case）；旧 `build.sh` 只构建 coding-agent，而 v0.87.0 的 coding-agent 依赖工作区其它包与 `packages/ai` 联网生成的模型数据。
**决策**：
1. **补丁栈重建语义**：`patches/` 为唯一真值，vendor 分支 = 上游基线 + 每补丁一个 commit。`sync-upstream.sh` 在临时 worktree 中 checkout 目标基线 → 幂等应用并提交全部补丁 → 成功才移动 `main` 并写 `LAST_SYNC_POINT`；失败则 vendor 完全不变。避免依赖 git merge 对补丁漂移作隐式判断。
2. **补丁随上游维护**：移除 002 中上游已修复的 hunk；按 biome 重新生成 004。补丁现对新基线 plain-apply。
3. **构建全工作区**：`build.sh` 改用 `npm run build:offline` 按依赖顺序构建（含 `durable`/`session-backends`），并仅在模型数据缺失时联网 `generate-models`。
4. **规避 Node IPv6 超时**：构建/生成默认注入 `--dns-result-order=ipv4first --no-network-family-autoselection`（本机 undici 对双栈域名超时，curl 正常）。
5. **本地维护提交绕过上游钩子**：补丁 commit 加 `--no-verify`，并把 `LAST_SYNC_POINT` 加入 vendor `.git/info/exclude`。
**理由**：上游更新必须可复现、可回滚、语义正确；确定性重建比隐式 merge 更安全，且与 fresh bootstrap 完全一致。
