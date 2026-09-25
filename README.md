# my-pi: 私人 AI 助手

基于 pi 框架的私人 AI 助手，通过硬分叉实现完全受控的 AI 编程体验。

## 架构原则

- **上游隔离**：`vendor/pi/` 保持只读，从 pi 上游同步
- **逻辑隔离**：`custom/features/*/logic.ts` 零 Pi 依赖
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点
- **数据收敛**：所有运行时数据收敛到 `portable/` 目录，实现 U 盘便携

## 目录结构

```
my-pi/
├── vendor/pi/                        # 上游 vendored 代码（只读）
│   ├── packages/                     # pi 上游包
│   ├── package.json                  # 上游 monorepo 配置（保持 pristine）
│   └── LAST_SYNC_POINT               # 上游同步点
│
├── custom/                           # 你的代码（唯一需要维护的部分）
│   ├── adapters/                     # 适配器层：隔离 Pi API 变化
│   │   ├── tool-adapter.ts           # 工具注册适配
│   │   └── hook-adapter.ts           # 生命周期钩子适配
│   │
│   ├── features/                     # 功能模块（12 个扩展）
│   │   ├── autopilot/                # 自主运行
│   │   ├── browser/                  # 浏览器自动化
│   │   ├── context/                  # Token 优化
│   │   ├── intervention/             # 干预捕获
│   │   ├── link/                     # 多设备互联
│   │   ├── memory/                   # 跨会话记忆
│   │   ├── mode/                     # 模式切换
│   │   ├── plan-mode/                # 计划模式
│   │   ├── subagent/                 # 子代理
│   │   ├── tmux/                     # tmux 会话管理
│   │   ├── voice/                    # 语音交流
│   │   └── web-search/               # 网络搜索
│   │
│   ├── core/                         # 核心服务
│   │   ├── config.ts                 # 路径解析
│   │   ├── registry.ts               # 功能注册表
│   │   ├── secrets.ts                # 密钥脱敏
│   │   ├── atomic-write.ts           # 原子 JSON 写入
│   │   └── note-store.ts             # 笔记持久化（写时脱敏）
│   │
│   ├── bootstrap.ts                  # 唯一入口
│   ├── package.json                  # 工作区配置
│   └── tsconfig.json                 # TypeScript 配置
│
├── portable/                         # 运行时数据（便携核心）
│   ├── agent/                        # pi 的运行时根目录（PI_CODING_AGENT_DIR = agentDir）
│   │   ├── skills/                   # 技能目录（agentDir/skills，随仓库分发）
│   │   ├── sessions/                 # 会话历史（agentDir/sessions/<转义 cwd>/）
│   │   ├── extensions/               # 第三方扩展目录（自动发现）
│   │   ├── npm/ git/                 # pi install 装入的扩展包
│   │   └── auth.json models.json ... # 每环境独立配置（不入库）
│   └── memory/                       # 自定义功能数据（note-store 笔记 + 工具输出归档）
│
├── packs/                            # 外部技能包仓库（按需读取，不注入系统提示词）
├── docs/                             # 项目文档（使用/开发/运维）
│
├── scripts/
│   ├── build.sh                      # 一键重建/引导（新设备可复现）
│   ├── doctor.sh                     # 本地环境 vs 仓库体检（--fix 自动修复）
│   ├── sync-upstream.sh              # 上游同步 + 自动修复（重建/刷缓存/类型检查）
│   ├── lib-vendor.sh                 # build/sync/doctor 共享逻辑（补丁幂等）
│   ├── dev.sh                        # 开发模式脚本
│   ├── check-isolation.sh            # 隔离边界验证
│   ├── check-features.sh             # 功能完整性检查
│   ├── setup-external.sh             # 外部服务/依赖安装（可选）
│   ├── patch-playwright-core.mjs     # Termux playwright-core 补丁
│   ├── golden-tasks.sh               # 行为防退化基准
│   ├── check-injection-surface.sh    # 注入面基线守门
│   └── check-doc-links.mjs           # 文档链接一致性
│
├── patches/                          # 上游补丁
│   ├── 001-branding.patch            # 品牌化补丁
│   ├── 002-local-pi-mods.patch       # 本地 pi 源码改动
│   ├── 003-tab-completion-fix.patch  # Tab 命令参数补全
│   └── 004-footer-tweaks.patch       # TUI footer 调整
│
├── my-pi.sh                          # 便携启动脚本
├── PROGRESS.md                       # 进度追踪
├── DECISIONS.md                      # 架构决策记录
└── README.md
```

## 快速开始

> fresh checkout 时 `vendor/pi/` 不存在（已 gitignore）。新设备只需一条命令：
> `bash scripts/build.sh` —— 自动安装根依赖、从上游 clone、checkout `vendor/PINNED_COMMIT`、
> 幂等应用 `patches/` 并构建。之后 `./my-pi.sh` 即可启动。

```bash
# 1. 新设备一键重建（安装根依赖 + 引导 vendor + 构建）
bash scripts/build.sh

# 2. 体检并自动修复缺口（依赖/vendor/补丁/dist/自愈缓存/shim）
bash scripts/doctor.sh --fix

# 3. 使用构建后的版本
./my-pi.sh

# 4. 查看版本
./my-pi.sh --version

# 开发模式（直接跑 TypeScript 源码，无需构建）
bash scripts/dev.sh
```

## 核心功能

### 12 个扩展

| 扩展 | 功能 | 类型 |
|------|------|------|
| autopilot | 自主运行（定时任务 + 自管理 + 失败自愈） | 钩子型 |
| browser | 浏览器自动化 | 工具型 |
| context | Token 优化中枢（路由/thinking 剪枝/compaction 去重/输出截断） | 钩子型 |
| intervention | 干预捕获 | 钩子型 |
| link | 多设备互联（SSH 通道 + 远程 RPC） | 工具型 |
| memory | 跨会话持久记忆 | 工具型 |
| mode | 模式切换（full/minimal/roleplay） | 钩子型 |
| plan-mode | 计划模式（TUI 计划/任务管理） | 钩子型 |
| subagent | 子代理（delegate 给专门 agent） | 工具型 |
| tmux | tmux 会话管理（后台任务/长任务） | 工具型 |
| voice | 语音交流（录音转写 + TTS） | 工具型 |
| web-search | 网络搜索（SearXNG 私密搜索） | 工具型 |

### 架构分层

```
Layer 3 ─ 功能层 ───────────── custom/features/ (12 个扩展)
    ↑
Layer 2 ─ 适配器层 ─────────── custom/adapters/ (隔离 Pi API)
    ↑
Layer 1 ─ 服务层 ───────────── custom/core/ (路径解析/注册表)
    ↑
Layer 0 ─ 基础层 ───────────── vendor/pi/ (上游代码)
```

## 度量与治理（VISION P1–P3）

| 目标 | 入口 | 说明 |
|------|------|------|
| 干预率 | `/intervention stats` | abort 快照 + corrective 关联，落 `portable/memory/interventions.jsonl` |
| token/缓存 | `/context usage`、`/auto stats` | `usage-stats` 持久化工具 token 与缓存命中率 |
| 任务成功率 | `/auto stats`、`/auto metrics` | autopilot telemetry（按模型/任务） |
| 记忆治理 | `/memory lifecycle` | 只读报告：淘汰/升格/冲突/规模 |
| 教训闭环 | `/memory mine [--ingest]` | 从纠正意图挖掘教训并入库（自动去重） |
| 防退化 | `npm run golden` | 隔离/注册面/类型/单测/补丁/注入面基线 |

## 上游同步

```bash
# 同步到最新上游
bash scripts/sync-upstream.sh

# 同步到指定 commit
bash scripts/sync-upstream.sh <commit-sha>
```

## 便携化

### U 盘使用流程

```bash
# 1. 复制项目到 U 盘
cp -r /path/to/my-pi /Volumes/USB/my-pi

# 2. 在 U 盘上运行
cd /Volumes/USB/my-pi
./my-pi.sh
```

所有运行时数据自动收敛到 `portable/` 目录，无需额外配置。

### 数据目录映射

| Pi 默认路径 | 便携化路径 | 机制 |
|---|---|---|
| `~/.pi/agent/settings.json` | `portable/agent/settings.json` | `PI_CODING_AGENT_DIR` 重定向（pi 识别） |
| `~/.pi/agent/skills/` | `portable/agent/skills/` | 随 `PI_CODING_AGENT_DIR` 解析为 `agentDir/skills` |
| `~/.pi/agent/sessions/` | `portable/agent/sessions/` | 随 `PI_CODING_AGENT_DIR` 解析为 `agentDir/sessions` |
| `~/.pi/agent/extensions/` | `portable/agent/extensions/` | `agentDir/extensions` 自动发现；my-pi 自身功能另经 `custom/bootstrap.ts` 加载 |
| 记忆/笔记数据 | `portable/memory/` | `PI_MEMORY_DIR`（由 `custom/core/note-store.ts` 等识别） |

> pi v0.87.0 只识别 `PI_CODING_AGENT_DIR` 与 `PI_PACKAGE_DIR`（无 `PI_SKILLS_DIR`/`PI_EXTENSION_DIR`）；会话可用 `PI_CODING_AGENT_SESSION_DIR` 或 `--session-dir` 覆盖。详见 [STRUCTURE.md](STRUCTURE.md) 的「已知偏离」。

## 开发

### 构建

```bash
# 一键重建（根依赖 + vendor 引导/补丁 + 工作区构建；模型数据缺失时联网生成）
bash scripts/build.sh

# 仅构建 vendor 工作区（依赖顺序；模型数据已就绪时用 offline）
cd vendor/pi && npm run build:offline

# 检查 custom/ 类型
npx tsc --noEmit -p custom/
```

### 添加新功能

1. 在 `custom/features/` 下创建新目录
2. 创建 `logic.ts` - 纯逻辑（零 Pi 依赖）
3. 创建 `index.ts` - 通过 adapters 注册
4. 在 `custom/bootstrap.ts` 中注册功能

## 验证

```bash
# 隔离边界验证
bash scripts/check-isolation.sh

# 功能完整性检查
bash scripts/check-features.sh

# 行为防退化基准（聚合上述检查）
npm run golden

# TypeScript 类型检查
npx tsc --noEmit -p custom/
```

## 外部服务安装

某些功能依赖外部服务，需要手动安装。可先用 `bash scripts/setup-external.sh status` 查看状态，或用其子命令 `fd-rg` / `tmux` / `searxng` 快速安装：

### SearXNG（web-search 功能）

web-search 功能需要 SearXNG 实例提供搜索服务。

```bash
# 使用 Docker 安装 SearXNG
docker run -d --name searxng -p 8889:8080 searxng/searxng

# 或使用 Podman
podman run -d --name searxng -p 8889:8080 searxng/searxng
```

安装后，在 `portable/agent/settings.json` 中配置 SearXNG 地址：

```json
{
  "pi-web-search": {
    "searxng_url": "http://127.0.0.1:8889",
    "search_timeout": 30000
  }
}
```

### tmux（tmux 功能）

tmux 功能需要系统安装 tmux：

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt update && sudo apt install tmux

# CentOS/RHEL
sudo yum install tmux
```

### 其他依赖

- **Node.js**: >= 22.19.0
- **npm**: 用于安装依赖

## 文档

- [项目愿景](docs/design/VISION.md)（开发目标、方法论、落地路线）
- [文档索引](docs/README.md)（FAQ / 故障排除 / 开发 / 运维）
- [外部技能包说明](packs/README.md)、[技能包索引](packs/INDEX.md)
- [目录结构说明](STRUCTURE.md)
- [架构修复进度](PROGRESS.md)
- [架构决策记录](DECISIONS.md)

## 许可证

私人项目，保留所有权利