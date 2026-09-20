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
│   │   ├── hook-adapter.ts           # 生命周期钩子适配
│   │   └── agent-adapter.ts          # 会话创建适配
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
│   ├── config/                       # Pi 运行时配置目录（PI_CODING_AGENT_DIR）
│   │   └── skills/                   # 技能目录（pi 的 agentDir/skills）
│   ├── sessions/                     # 会话数据（占位；pi 实际写入 config/sessions/）
│   ├── extensions/                   # 扩展安装目录（占位；功能经 bootstrap.ts 加载）
│   ├── skills/                       # 占位目录（pi 不读取）
│   └── memory/                       # 记忆数据（note-store 笔记 + 工具输出归档）
│
├── packs/                            # 外部技能包仓库（按需读取，不注入系统提示词）
├── docs/                             # 项目文档（使用/开发/运维）
│
├── scripts/
│   ├── check-isolation.sh            # 隔离边界验证
│   ├── sync-upstream.sh              # 上游同步脚本
│   ├── build.sh                      # 构建脚本
│   └── dev.sh                        # 开发模式脚本
│
├── patches/                          # 上游补丁
│   ├── 001-branding.patch            # 品牌化补丁
│   └── 002-local-pi-mods.patch       # 本地 pi 源码改动
│
├── my-pi.sh                          # 便携启动脚本
├── PROGRESS.md                       # 进度追踪
├── DECISIONS.md                      # 架构决策记录
└── README.md
```

## 快速开始

> fresh checkout 时 `vendor/pi/` 不存在（已 gitignore）。先运行 `bash scripts/build.sh`
> 会自动从上游 clone 并 checkout `vendor/PINNED_COMMIT`、应用 `patches/`。

```bash
# 1. 启动 my-pi（开发模式，使用 tsx 直接运行 TypeScript）
bash scripts/dev.sh

# 2. 构建生产版本
bash scripts/build.sh

# 3. 使用构建后的版本
./my-pi.sh

# 4. 查看版本
./my-pi.sh --version
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
| mode | 模式切换（full/light/quick） | 钩子型 |
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
| `~/.pi/agent/settings.json` | `portable/config/settings.json` | `PI_CODING_AGENT_DIR` 重定向（pi 识别） |
| `~/.pi/agent/skills/` | `portable/config/skills/` | 随 `PI_CODING_AGENT_DIR` 解析为 `agentDir/skills` |
| `~/.pi/agent/sessions/` | `portable/config/sessions/` | 随 `PI_CODING_AGENT_DIR` 解析（`PI_SESSION_DIR` 不被 pi 识别） |
| `~/.pi/agent/extensions/` | `custom/features/` + `custom/bootstrap.ts` | `--extension` 显式加载（`PI_EXTENSION_DIR` 不被 pi 识别） |
| 记忆/笔记数据 | `portable/memory/` | `PI_MEMORY_DIR`（由 `custom/core/note-store.ts` 等识别） |

> `PI_SESSION_DIR` / `PI_EXTENSION_DIR` / `PI_SKILLS_DIR` 会被 `my-pi.sh` 导出，但 pi v0.85.1 不读取；详见 [STRUCTURE.md](STRUCTURE.md) 的「已知偏离」。

## 开发

### 构建

```bash
# 构建 vendor/pi (coding-agent)
cd vendor/pi/packages/coding-agent && npm run build

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

# TypeScript 类型检查
npx tsc --noEmit -p custom/
```

## 文档

- [文档索引](docs/README.md)（FAQ / 故障排除 / 开发 / 运维）
- [外部技能包说明](packs/README.md)、[技能包索引](packs/INDEX.md)
- [目录结构说明](STRUCTURE.md)
- [架构修复进度](PROGRESS.md)
- [架构决策记录](DECISIONS.md)

## 许可证

私人项目，保留所有权利