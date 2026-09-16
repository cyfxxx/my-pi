# my-pi 目录结构

## 顶层目录

```
my-pi/
├── .pi/                        # Pi 本地配置（扩展/服务/技能/运行时）
├── packages/                   # pi 上游包（只读同步）
├── custom/                     # 自定义层（适配器/服务/接缝/事件）
├── scripts/                    # 脚本工具（61 个脚本）
├── packs/                      # 外部技能包（13 个）
├── data/                       # 运行时数据（memory/logs/plans/circuit-breaker）
├── deploy/                     # 部署配置（systemd, tmux）
├── portable/                   # 便携配置（Windows 便携包）
├── searxng/                    # SearXNG 自托管搜索
├── patches/                    # 补丁管理
├── docs/                       # 文档
├── package.json                # monorepo 配置
├── tsconfig.base.json          # TypeScript 基础配置
├── biome.json                  # Biome linter/formatter 配置
├── README.md                   # 项目说明
├── AGENTS.md                   # 开发规范
├── CHANGELOG.md                # 版本记录
└── .github/workflows/ci.yml   # CI 配置
```

## .pi/ 目录

Pi 本地配置仓库，包含自定义扩展、共享库、技能和运行时脚本。

```
.pi/
├── core/                       # 基础层（Layer 0）
│   ├── config.ts               # 配置管理
│   ├── hook-registry.ts        # 钩子注册表
│   ├── registry.ts             # 服务注册表
│   ├── secrets.ts              # 密钥脱敏
│   └── index.ts                # 统一导出
├── services/                   # 服务层（Layer 1）
│   ├── token-budget/           # Token 预算服务
│   ├── diagnostics/            # 诊断工具
│   ├── atomic-write.ts         # 原子写入
│   ├── note-store.ts           # 笔记存储
│   ├── shadow-review.ts        # 影子审查
│   └── index.ts                # 统一导出
├── extensions/                 # 扩展层（Layer 2）
│   ├── pi-autopilot/           # 自主运行（定时任务 + 自管理 + 失败自愈）
│   ├── pi-browser/             # 浏览器自动化（CloakBrowser）
│   ├── pi-context/             # Token 优化中枢（路由/thinking 剪枝/compaction 去重/输出截断）
│   ├── pi-intervention/        # 干预捕获（abort 快照/corrective prompt）
│   ├── pi-link/                # 多设备互联（SSH 通道 + 远程 RPC）
│   ├── pi-memory/              # 跨会话持久记忆（自主学习闭环）
│   ├── pi-mode/                # 模式切换（full/light/quick）
│   ├── pi-tmux/                # tmux 会话管理（后台任务/长任务）
│   ├── pi-voice/               # 语音交流（Termux：录音转写 + TTS）
│   ├── pi-web-search/          # 网络搜索（SearXNG 私密搜索）
│   ├── plan-mode/              # 计划模式（TUI 计划/任务管理）
│   ├── subagent/               # 子代理（delegate 给专门 agent）
│   ├── tests/                  # 扩展测试
│   ├── types/                  # 共享类型
│   ├── tsconfig.json           # TypeScript 配置
│   └── tsconfig.local.json     # 本地 TypeScript 配置
├── skills/                     # 技能层（Layer 3）
│   ├── pi-backup/              # 备份技能
│   ├── pi-bug-diagnosis/       # Bug 诊断技能
│   ├── pi-full-audit/          # 全面审计技能
│   └── pi-translate-zh/        # 中文翻译技能
├── agent/                      # Agent 运行时配置
│   ├── settings.json           # 运行时设置
│   ├── auth.json               # API 凭证（gitignored）
│   ├── models-store.json       # 模型存储
│   ├── modes.json              # 模式配置
│   └── sessions/               # 会话数据（gitignored）
├── stats/                      # 统计数据（gitignored）
├── settings.json               # 主配置（provider/model/thinking）
├── models.json                 # 模型配置
├── keybindings.json            # TUI 快捷键绑定
├── AGENTS.md                   # 项目环境描述
├── APPEND_SYSTEM.md            # 系统提示追加内容
├── trust.json                  # 信任设置
├── notify.json                 # 通知配置
├── ntfy-relay.json             # Ntfy 中继配置
├── pi-link-active.json         # Pi-link 活跃状态
├── pi-link-state.json          # Pi-link 状态
├── pi-voice.json               # 语音配置
├── scheduled-seeds.json        # 定时种子
└── scheduled-tasks.json        # 定时任务
```

## packages/ 目录

pi 上游包，保持只读，从 pi 上游同步。

```
packages/
├── ai/                         # AI 核心库（LLM API 抽象）
├── agent/                      # Agent 核心（运行时）
├── chord/                      # 核心框架
├── client/                     # 客户端
├── coding-agent/               # 编码代理（主 CLI + 框架核心）
├── evals/                      # 评估
├── protocol/                   # 协议定义
├── server/                     # 服务器
├── session-backends/sqlite-node/ # SQLite 会话后端
├── telemetry/                  # 遥测
└── tui/                        # 终端 UI
```

## custom/ 目录

自定义层，通过适配器与 pi 交互。

```
custom/
├── src/
│   ├── adapters/               # 适配器层（隔离 pi API 变化）
│   │   ├── api.ts              # ExtensionAPI 适配
│   │   ├── tools/              # 工具系统适配
│   │   │   ├── tool-adapter.ts
│   │   │   ├── interceptor.ts
│   │   │   └── layering.ts
│   │   ├── session/            # 会话管理适配
│   │   │   ├── session-adapter.ts
│   │   │   └── export-adapter.ts
│   │   ├── index.ts            # 统一导出
│   │   └── types.ts            # 类型定义
│   ├── services/               # 下沉的服务（可独立修改的纯函数）
│   │   ├── tool-system/        # 工具系统服务
│   │   │   ├── truncation.ts
│   │   │   ├── path-utils.ts
│   │   │   ├── render-utils.ts
│   │   │   ├── edit-diff.ts
│   │   │   ├── output-accumulator.ts
│   │   │   ├── file-mutation-queue.ts
│   │   │   ├── tool-layering.ts
│   │   │   └── index.ts
│   │   ├── session/            # 会话管理服务
│   │   │   ├── session-stats.ts
│   │   │   ├── context-usage.ts
│   │   │   ├── session-export.ts
│   │   │   ├── session-discovery.ts
│   │   │   ├── session-log-bridge.ts
│   │   │   └── index.ts
│   │   └── token-budget/       # Token 预算服务
│   │       ├── prune.ts
│   │       ├── context-budget.ts
│   │       ├── auto-compact.ts
│   │       └── index.ts
│   └── index.ts                # 统一入口
├── seams/                      # 能力接缝定义
│   ├── types.ts                # 核心接口
│   ├── registry.ts             # 缝隙注册表
│   ├── index.ts                # 导出
│   ├── index-enhanced.ts       # 增强导出
│   ├── shell/                  # Shell 缝隙
│   ├── fs/                     # 文件系统缝隙
│   ├── search/                 # 搜索缝隙
│   ├── sandbox/                # 沙箱缝隙
│   ├── llm/                    # LLM 缝隙
│   ├── subagent/               # 子代理缝隙
│   ├── credentials/            # 凭证缝隙
│   ├── interaction/            # 交互缝隙
│   ├── settings/               # 设置缝隙
│   ├── session-log/            # 会话日志缝隙
│   ├── webhook/                # Webhook 缝隙
│   ├── session-title/          # 会话标题缝隙
│   └── todo/                   # Todo 缝隙
├── events/                     # 事件系统
│   ├── types.ts                # 事件类型定义
│   ├── bus.ts                  # 事件总线实现
│   └── index.ts                # 导出
├── session-log/                # Session Log 实现
│   ├── types.ts                # 日志类型定义
│   ├── jsonl-writer.ts         # JSONL 写入器
│   ├── projection.ts           # 投影查询
│   └── index.ts                # 入口
├── config/                     # 配置管理
│   ├── types.ts                # 配置类型
│   ├── manager.ts              # 配置管理器
│   └── index.ts                # 入口
├── bootstrap.ts                # 启动引导
├── extension-loader.ts         # 扩展加载器
├── integration.ts              # 集成层
├── cordis.yml                  # 声明式配置
├── tsconfig.json               # TypeScript 配置
├── docs/                       # 项目文档（本目录）
└── tests/                      # 测试文件
    ├── integration.test.ts     # 集成测试
    └── projection.test.ts      # 投影测试
```

## scripts/ 目录

脚本工具，共 61 个脚本。

```
scripts/
├── core/                       # 核心脚本
│   ├── rebuild.sh              # 一键重建（幂等、并行、镜像加速）
│   ├── pi-wrapper.sh           # 进程外生命周期管理器（崩溃恢复/熔断器/快照）
│   ├── pi-source-build.sh      # 从源码构建 pi
│   └── pi-orig.sh              # 原始 pi 启动器
├── crash-recovery/             # 崩溃恢复
│   ├── pi-crash-analyzer.sh    # 崩溃分析器
│   ├── pi-recovery-audit.sh    # 恢复审计
│   └── pi-rescue.sh            # 紧急救援
├── maintenance/                # 日常维护
│   ├── daily-health.mjs        # 每日健康检查
│   ├── verify-patches.mjs      # 补丁版本匹配校验
│   ├── pi-bench.sh             # 性能基准测试
│   ├── doc-extract.mjs         # 文档提取
│   ├── lesson-miner.mjs        # 经验挖掘
│   └── packs-sync.mjs          # 技能包同步
├── deploy/                     # 部署脚本
│   ├── setup-new-device.sh     # 新设备部署
│   └── sync-config.sh          # 配置同步
├── install/                    # 安装脚本
│   ├── cron.sh                 # Cron 安装
│   ├── systemd.sh              # Systemd 安装
│   ├── tool-sync-hooks.sh      # 工具同步钩子
│   └── wrapper-install.sh      # Wrapper 安装
├── test/                       # 测试脚本
│   ├── smoke-test.sh           # 冒烟测试
│   ├── test-all.sh             # 全量测试
│   └── test-recovery.sh        # 恢复测试
├── environment/                # 环境脚本
│   └── termux-prereq.sh        # Termux 前置依赖
├── sync-upstream.sh            # 上游同步
├── create-patch.sh             # 补丁创建
├── apply-patches.sh            # 补丁应用
├── rebuild.sh                  # 重建脚本（根级入口）
├── pi-wrapper.sh               # Wrapper 脚本（根级入口）
├── pi-source-build.sh          # 源码构建（根级入口）
├── setup-config.sh             # 配置初始化
└── setup-env.sh                # 环境初始化
```

## packs/ 目录

外部技能包，共 13 个。

```
packs/
├── cangjie-skill/              # 书籍蒸馏
├── colab-bridge/               # Google Colab 远程 GPU
├── comfyui-agent/              # ComfyUI 图像生成
├── dg-piagent/                 # pi-agent SDK 开发
├── embedded-dev/               # 嵌入式开发
├── gamedev/                    # 游戏开发
├── knowledge-fetch/            # 知识订阅
├── media-toolkit/              # 图片/视频处理
├── novel-writing/              # 长篇小说
├── pcb-design/                 # PCB 硬件设计
├── pdf-toolkit/                # PDF 处理
├── reverse-skill/              # 安全技能路由
├── skill-integration/          # 技能包整合
├── INDEX.md                    # 技能包索引（触发词/用法）
└── README.md                   # 技能包说明
```

## data/ 目录

运行时数据，包含记忆、日志、计划和熔断器状态。

```
data/
├── memory/                     # pi-memory 长期记忆（entries.json）
├── logs/                       # 运行时日志（scheduler/crash-logs）
├── plans/                      # plan-mode 计划存档
└── circuit-breaker.json        # 熔断器状态（pi-wrapper 崩溃恢复）
```

> 注意：data/logs/ 和 data/plans/ 被 .gitignore 排除，不入库。data/memory/ 和 data/circuit-breaker.json 入库。

## deploy/ 目录

部署配置。

```
deploy/
├── systemd/                    # Systemd 服务配置
│   ├── pi-searxng.service      # SearXNG 服务
│   └── pi-whisper.service      # Whisper 服务
└── tmux/                       # tmux 配置
    ├── tmux.conf               # tmux 配置
    ├── tmux-status.sh          # 状态栏
    └── status-loop.sh          # 状态循环
```

## patches/ 目录

补丁管理，追踪对 packages/ 的修改。

```
patches/
└── README.md                   # 补丁管理说明
```

> 注意：补丁管理机制已就绪，当前尚无实际补丁文件。补丁脚本 `create-patch.sh` 和 `apply-patches.sh` 位于 `scripts/` 目录。

## docs/ 目录

项目文档。

```
docs/
├── architecture.md             # 架构文档
├── DEPLOYMENT-GUIDE.md         # 新设备部署指南
├── OPTIMIZATION-PLAN.md        # 优化计划
├── FIX-REPORT.md               # 修复报告
├── PI-TOOLS-README.md          # pi-tools 完整说明
├── design/                     # 设计文档
│   ├── VISION.md               # 项目愿景
│   ├── SELF-OPTIMIZING-BASELINE.md
│   └── SELF-OPTIMIZING-ROADMAP.md
├── development/                # 开发文档
│   ├── AGENTS-DETAILS.md       # Agent 详细说明
│   ├── PI-EXT-DEV-NOTES.md     # 扩展开发笔记
│   ├── PI-SDK-EXTENSION.md     # SDK 扩展指南
│   └── SKILLS-MAINTENANCE.md   # 技能维护
├── operations/                 # 运维文档
│   ├── ENVIRONMENTS.md         # 环境配置
│   ├── TERMUX-DEV-NOTES.md     # Termux 开发笔记
│   └── alacritty-tmux-setup.md # Alacritty + tmux 配置
└── maintenance/                # 维护文档
    ├── OPTIMIZATION-LOG.md     # 优化日志
    ├── MODULARIZATION-PLAN.md  # 模块化计划
    └── GIT-HISTORY-REWRITE.md  # Git 历史重写
```

## 文件说明

### 核心文件

| 文件 | 职责 | 修改频率 |
|------|------|----------|
| `custom/bootstrap.ts` | 启动流程 | 低 |
| `custom/extension-loader.ts` | 扩展加载器 | 低 |
| `custom/integration.ts` | 集成层 | 中 |
| `custom/cordis.yml` | 声明式配置 | 中 |

### 适配器文件

| 文件 | 职责 | 修改频率 |
|------|------|----------|
| `custom/src/adapters/api.ts` | ExtensionAPI 适配 | 低 |
| `custom/src/adapters/tools/tool-adapter.ts` | 工具注册适配 | 中 |
| `custom/src/adapters/tools/interceptor.ts` | 工具拦截适配 | 中 |
| `custom/src/adapters/tools/layering.ts` | 工具分层适配 | 中 |
| `custom/src/adapters/session/session-adapter.ts` | 会话管理适配 | 中 |
| `custom/src/adapters/session/export-adapter.ts` | 会话导出适配 | 低 |

### 服务文件

| 文件 | 职责 | 修改频率 |
|------|------|----------|
| `custom/src/services/tool-system/truncation.ts` | 输出截断 | 低 |
| `custom/src/services/tool-system/path-utils.ts` | 路径解析 | 低 |
| `custom/src/services/tool-system/render-utils.ts` | 渲染工具 | 低 |
| `custom/src/services/tool-system/edit-diff.ts` | Diff 工具 | 低 |
| `custom/src/services/tool-system/output-accumulator.ts` | 输出累积 | 低 |
| `custom/src/services/tool-system/file-mutation-queue.ts` | 文件变更队列 | 低 |
| `custom/src/services/tool-system/tool-layering.ts` | 工具分层 | 中 |
| `custom/src/services/session/session-stats.ts` | 会话统计 | 低 |
| `custom/src/services/session/context-usage.ts` | 上下文用量 | 低 |
| `custom/src/services/session/session-export.ts` | 会话导出 | 低 |
| `custom/src/services/session/session-discovery.ts` | 会话发现 | 低 |
| `custom/src/services/session/session-log-bridge.ts` | 日志桥接 | 中 |
| `custom/src/services/token-budget/prune.ts` | 输出擦除 | 中 |
| `custom/src/services/token-budget/context-budget.ts` | 上下文预算 | 中 |
| `custom/src/services/token-budget/auto-compact.ts` | 自动压缩 | 中 |

### 扩展文件

| 扩展 | 职责 | 修改频率 |
|------|------|----------|
| `.pi/extensions/pi-context/` | Token 优化中枢 | 高 |
| `.pi/extensions/pi-memory/` | 跨会话记忆 | 高 |
| `.pi/extensions/pi-web-search/` | 网页搜索 | 高 |
| `.pi/extensions/pi-autopilot/` | 自主运行 | 高 |
| `.pi/extensions/pi-voice/` | 语音通信 | 高 |
| `.pi/extensions/pi-browser/` | 浏览器自动化 | 中 |
| `.pi/extensions/pi-intervention/` | 干预捕获 | 中 |
| `.pi/extensions/pi-link/` | 多设备互联 | 中 |
| `.pi/extensions/pi-tmux/` | tmux 管理 | 中 |
| `.pi/extensions/pi-mode/` | 模式切换 | 中 |
| `.pi/extensions/plan-mode/` | 计划模式 | 中 |
| `.pi/extensions/subagent/` | 子代理调度 | 中 |

### 接缝文件

| 文件 | 职责 | 修改频率 |
|------|------|----------|
| `custom/seams/registry.ts` | 接缝注册表 | 低 |
| `custom/seams/shell/types.ts` | Shell 接口定义 | 低 |
| `custom/seams/shell/tool-consumer.ts` | Shell 工具消费者 | 中 |
| `custom/seams/fs/types.ts` | 文件系统接口定义 | 低 |
| `custom/seams/fs/tool-consumer.ts` | 文件系统工具消费者 | 中 |
| `custom/seams/search/types.ts` | 搜索接口定义 | 低 |
| `custom/seams/search/tool-consumer.ts` | 搜索工具消费者 | 中 |

### 文档文件

| 文件 | 职责 | 修改频率 |
|------|------|----------|
| `custom/docs/ARCHITECTURE.md` | 架构文档 | 低 |
| `custom/docs/IMPLEMENTATION-PLAN.md` | 实施计划 | 中 |
| `custom/docs/DIRECTORY-STRUCTURE.md` | 目录结构（本文档） | 低 |
| `custom/docs/TOOL-SYSTEM-SINKING.md` | 工具系统下沉方案 | 低 |
| `custom/docs/SESSION-MANAGEMENT-SINKING.md` | 会话管理下沉方案 | 低 |
| `custom/docs/PATCH-MANAGEMENT.md` | 补丁管理 | 低 |
| `custom/docs/UPSTREAM-SYNC.md` | 上游同步 | 低 |
| `custom/docs/MIGRATION-PLAN-PI-TOOLS.md` | 迁移计划 | 低 |
| `custom/docs/MIGRATION-GUIDE.md` | 迁移指南 | 低 |
| `custom/docs/FINAL-COMPLETION-REPORT.md` | 完成报告 | 低 |
| `custom/docs/COMPLETION-REPORT.md` | 阶段完成报告 | 低 |
