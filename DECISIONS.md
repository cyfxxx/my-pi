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

### [2026-09-20] 删除 .pi/，配置收敛到 portable/config（方案 B）
**背景**：第一轮方案的目标结构不含 `.pi/`，核心原则是"所有运行时数据收敛到 `portable/`"；但实际配置仍在 `.pi/`，而 `my-pi.sh` 已把 `PI_CODING_AGENT_DIR` 指向空的 `portable/config`，导致启动器读不到 provider/model 配置。
**选项**：
1. 保留 `.pi/` 作为配置目录，改回启动器指向 `.pi`
2. 把 `.pi/` 全部迁入 `portable/config/`，删除 `.pi/`
**决策**：选项 2
**理由**：与文档/脚本已声明的设计一致；pi 的 `AGENTS.md` 全局加载和 `APPEND_SYSTEM.md` 回退路径都能落到 `agentDir`（= `portable/config`），因此无需改 vendor、无需符号链接即可彻底去掉 `.pi/`。`models.json`（含 apiKey）此前被误跟踪，迁移时一并停止跟踪并 gitignore；`settings.json`/`keybindings.json`/`AGENTS.md`/`APPEND_SYSTEM.md` 仍跟踪，其余每环境独立/状态文件忽略。