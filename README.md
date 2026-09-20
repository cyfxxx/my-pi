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
│   │   ├── agent/                    # Agent loop
│   │   ├── ai/                       # LLM provider
│   │   ├── coding-agent/             # CLI 和交互模式
│   │   ├── tui/                      # 终端 UI
│   │   └── ...
│   ├── package.json                  # piConfig (name: my-pi)
│   ├── LAST_SYNC_POINT               # 上游同步点
│   └── theme/                        # 主题文件
│
├── custom/                           # 你的代码（唯一需要维护的部分）
│   ├── adapters/                     # 适配器层：隔离 Pi API 变化
│   │   ├── api.ts                    # ExtensionAPI 适配
│   │   ├── types.ts                  # 适配器类型定义
│   │   ├── tools/                    # 工具适配器
│   │   └── session/                  # 会话适配器
│   │
│   ├── features/                     # 功能模块（从 pi-tools 迁移）
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
│   │   ├── config.ts                 # 便携化路径解析
│   │   ├── registry.ts               # 功能注册表
│   │   └── index.ts
│   │
│   ├── src/                          # 共享服务
│   │   ├── adapters/                 # 适配器实现
│   │   └── services/                 # 下沉服务
│   │
│   ├── bootstrap.ts                  # 启动引导
│   ├── extension-loader.ts           # 扩展加载器
│   └── tsconfig.json                 # TypeScript 配置
│
├── portable/                         # 运行时数据（便携核心）
│   ├── bin/                          # 便携版二进制
│   │   └── my-pi                     # Bun 编译的可执行文件
│   ├── config/                       # 配置数据
│   ├── sessions/                     # 会话数据
│   ├── extensions/                   # 扩展安装目录
│   ├── skills/                       # 技能目录
│   └── memory/                       # 记忆数据
│
├── scripts/
│   ├── sync-upstream.sh              # 上游同步脚本
│   └── init-portable.sh              # 便携环境初始化
│
├── patches/                          # 上游补丁（可选）
├── my-pi.sh                          # 便携启动脚本
├── package.json                      # 工作区配置
└── README.md
```

## 快速开始

```bash
# 1. 初始化便携环境
bash scripts/init-portable.sh

# 2. 启动 my-pi
./my-pi.sh

# 3. 或直接使用便携版二进制
PI_CODING_AGENT_DIR=/root/my-pi/portable/config ./portable/bin/my-pi

# 4. 查看可用模型
PI_CODING_AGENT_DIR=/root/my-pi/portable/config ./portable/bin/my-pi --list-models
```

## 核心功能

### 12 个扩展

| 扩展 | 功能 | 类型 |
|------|------|------|
| autopilot | 自主运行（定时任务 + 自管理 + 失败自愈） | 钩子型 |
| browser | 浏览器自动化（CloakBrowser） | 工具型 |
| context | Token 优化中枢（路由/thinking 剪枝/compaction 去重/输出截断） | 钩子型 |
| intervention | 干预捕获（abort 快照/corrective prompt） | 钩子型 |
| link | 多设备互联（SSH 通道 + 远程 RPC） | 工具型 |
| memory | 跨会话持久记忆（自主学习闭环） | 工具型 |
| mode | 模式切换（full/light/quick） | 钩子型 |
| plan-mode | 计划模式（TUI 计划/任务管理） | 钩子型 |
| subagent | 子代理（delegate 给专门 agent） | 工具型 |
| tmux | tmux 会话管理（后台任务/长任务） | 工具型 |
| voice | 语音交流（Termux：录音转写 + TTS） | 工具型 |
| web-search | 网络搜索（SearXNG 私密搜索） | 工具型 |

### 架构分层

```
Layer 4 ─ Agent 编排层 ─────── (由 pi 内置调度)
    ↑
Layer 3 ─ 功能层 ───────────── custom/features/ (12 个扩展)
    ↑
Layer 2 ─ 适配器层 ─────────── custom/adapters/ (隔离 Pi API)
    ↑
Layer 1 ─ 服务层 ───────────── custom/src/services/ (共享服务)
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
# 1. 在 U 盘上克隆项目
cd /Volumes/USB/my-pi

# 2. 初始化便携环境
bash scripts/init-portable.sh

# 3. 安装依赖并构建
npm install
cd vendor/pi && npm run build:offline

# 4. 构建便携版二进制
~/.bun/bin/bun build --compile ./packages/coding-agent/src/cli.ts --outfile ../portable/bin/my-pi

# 5. 使用
./my-pi.sh
```

### 数据目录映射

| Pi 默认路径 | 便携化路径 | 机制 |
|---|---|---|
| `~/.my-pi/agent/settings.json` | `portable/config/settings.json` | 符号链接 |
| `~/.my-pi/agent/sessions/` | `portable/sessions/` | 符号链接 |
| `~/.my-pi/agent/extensions/` | `portable/extensions/` | 符号链接 |
| `~/.my-pi/agent/skills/` | `portable/skills/` | 符号链接 |
| `~/.my-pi/agent/memory/` | `portable/memory/` | 符号链接 |

## 开发

### 构建

```bash
# 构建 vendor/pi
cd vendor/pi && npm run build:offline

# 检查 custom/ 类型
cd custom && npx tsc --noEmit
```

### 添加新功能

1. 在 `custom/features/` 下创建新目录
2. 创建 `types.ts` - 类型定义
3. 创建 `logic.ts` - 纯逻辑（零 Pi 依赖）
4. 创建 `tool.ts` - 工具注册（使用适配器）
5. 创建 `index.ts` - 入口（`init`/`destroy` 导出）

## 文档

- [修改计划](/storage/emulated/0/Documents/修改计划.md)
- [变更日志](CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)

## 许可证

私人项目，保留所有权利
