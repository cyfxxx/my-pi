# my-pi 硬分叉完整方案

## 🔍 问题回顾与核心诊断

你当前 `my-pi` 仓库的核心问题在于：**`.pi/` 下是从 `pi-tools` 原样搬迁的扩展代码，`custom/` 下又有自己的适配层，同一套逻辑存在两份**。扩展运行在 Pi 的扩展运行时（`ctx` + 钩子 API）中，而直接集成需要面对 `AgentSession`、`SessionManager` 的真实生命周期——两者的 API 契约完全不同。AI 助手做的是“代码复制 + 路径修改”，没有完成从扩展 API 到核心 API 的语义转换，导致上游一更新就全面崩溃。

本方案的核心原则是：**上游代码零修改，自定义逻辑全部通过适配器层与 Pi 交互，所有数据收敛到项目目录以实现便携运行**。


## 🏗️ 一、分叉策略：Vendor + 适配器模式

参考 `oh-omp` 的“约束性分叉”策略和 `pi-regraft` 的语义化 vendoring 理念，推荐以下分叉架构：

```
my-pi/
├── vendor/pi/                        # 🔒 上游 vendored 代码（只读）
│   ├── packages/
│   │   ├── ai/                       # LLM provider 抽象
│   │   ├── agent/                    # Agent loop 和消息类型
│   │   ├── tui/                      # 终端 UI 组件
│   │   ├── coding-agent/             # CLI 和交互模式
│   │   └── ...
│   ├── package.json                  # piConfig 在此配置
│   └── LAST_SYNC_POINT               # 上次同步的上游 commit SHA
│
├── custom/                           # 🏠 你的代码（唯一需要维护的部分）
│   ├── adapters/                     # 🔌 适配器层：隔离 Pi API 变化
│   │   ├── pi-agent-adapter.ts       # 封装 AgentSession 调用
│   │   ├── pi-tool-adapter.ts        # 封装 registerTool 调用
│   │   ├── pi-hook-adapter.ts        # 封装 pi.on() 调用
│   │   └── pi-ai-adapter.ts          # 封装 provider 注册
│   │
│   ├── features/                     # 📦 功能模块（从 pi-tools 迁移）
│   │   ├── web-search/
│   │   │   ├── logic.ts              # 🔒 纯逻辑，零 Pi 依赖
│   │   │   ├── tool.ts               # 通过 adapter 注册为工具
│   │   │   └── index.ts
│   │   ├── autopilot/
│   │   │   ├── logic.ts
│   │   │   ├── hooks.ts              # 通过 adapter 注册钩子
│   │   │   └── index.ts
│   │   ├── memory/
│   │   │   ├── logic.ts
│   │   │   └── service.ts
│   │   └── ...
│   │
│   ├── core/                         # 🧱 核心服务
│   │   ├── config.ts                 # 便携化路径解析
│   │   ├── registry.ts               # 功能注册表
│   │   └── index.ts
│   │
│   └── index.ts                      # 🚀 入口：组装所有模块
│
├── portable/                         # 📁 运行时数据（便携核心）
│   ├── config/                       # 配置数据
│   │   ├── settings.json
│   │   └── auth.json
│   ├── sessions/                     # 会话数据
│   ├── extensions/                   # 扩展安装目录
│   ├── skills/                       # 技能目录
│   └── memory/                       # 记忆数据
│
├── patches/                          # 📝 上游补丁（可选）
│   ├── 001-branding.patch
│   └── 002-custom-provider.patch
│
├── scripts/
│   ├── sync-upstream.sh              # 上游同步脚本
│   ├── apply-patches.sh              # 补丁应用脚本
│   ├── build-portable.sh             # 便携版构建脚本
│   └── dev.sh                        # 开发运行脚本
│
├── package.json                      # 工作区配置
└── README.md
```

**关键设计原则**：

- **`vendor/pi/` 永不修改**：上游代码以纯净状态存在，所有修改通过 `patches/` 管理。`pi-regraft` 的核心理念就是“将上游代码 vendor 为普通文件，用三方合并基进行更新”。
- **`custom/adapters/` 是唯一允许 import `vendor/pi/` 的地方**：适配器把 Pi 的不稳定 API 封装成你自己的稳定接口，上层逻辑只依赖你的接口。
- **`custom/features/*/logic.ts` 零 Pi 依赖**：纯逻辑不 import 任何 Pi 模块，不会与上游产生任何冲突。
- **`portable/` 是运行时数据的唯一归宿**：所有配置、会话、记忆都存放在项目目录下，实现完全便携。


## 📦 二、删减方案：注册而非删除

根据便携性和私人助手的目标，以下是对 Pi 的删减策略：

### 可以删减的包

| 包名 | 处置方式 | 理由 |
|---|---|---|
| `pi-pods` | **从 vendor 中移除** | 远程 GPU 部署工具，私人助手不需要 |
| `pi-server` | **不构建** | 多 Agent 编排和进程监督，单用户不需要 |
| `pi-storage-sqlite-node` | **不构建** | 会话存储用 JSONL 已足够，SQLite 是过度设计 |
| 非必要 provider | **注册而非删除** | 保留文件，仅在适配器层只注册你使用的 provider |

### 不建议删减的模块

- **`pi-agent-core` 的 Agent Loop**：Agent 的心脏，没有它就没有 Agent
- **四个核心工具**（`read`/`write`/`edit`/`bash`）：Pi 最精妙的设计，覆盖绝大多数操作
- **`SessionManager` 的会话持久化**：树形结构支持分叉与回溯，非常有价值

### Provider 删减的正确做法

不要删除 `vendor/pi/packages/ai/` 中的 provider 文件，而是在 `custom/adapters/pi-ai-adapter.ts` 中**只注册你实际使用的 provider**：

```typescript
// custom/adapters/pi-ai-adapter.ts
import { registerProvider } from '../../vendor/pi/packages/ai/src/index';

// 只注册你使用的 provider
export function registerMyProviders() {
  registerProvider('ollama', { /* 你的配置 */ });
  // 上游新增或修复其他 provider 时，合并不受影响
}
```

这样上游修复任何 provider 的 bug 时，你都能自动获得修复。


## 🔄 三、从 pi-tools 迁移：三步法

### 第一步：功能分类

将 `pi-tools` 的 12 个扩展按依赖类型分为三类：

| 类型 | 特征 | 迁移目标 |
|---|---|---|
| **纯逻辑型** | 不依赖 Pi API，只是数据处理/网络请求 | `custom/features/*/logic.ts` |
| **工具型** | 通过 `pi.registerTool()` 暴露工具 | 保留 `execute` 逻辑，改用 `pi-tool-adapter` 注册 |
| **钩子型** | 通过 `pi.on()` 监听生命周期事件 | 保留 handler 逻辑，改用 `pi-hook-adapter` 注册 |

### 第二步：编写适配器层

适配器是**唯一允许 import `vendor/pi/` 的地方**：

```typescript
// custom/adapters/pi-tool-adapter.ts
import type { ExtensionAPI } from '../../vendor/pi/packages/coding-agent/src/extension-api';

// 你自己的稳定接口
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown) => Promise<string>;
}

// 将你的接口桥接到 Pi 的 API
export function registerTool(pi: ExtensionAPI, def: ToolDefinition) {
  pi.registerTool({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    handler: async (args) => def.execute(args),
  });
}
```

**关键**：`ToolDefinition` 是你自己定义的接口，`logic.ts` 只依赖这个接口，不依赖 Pi 的任何类型。

### 第三步：逐个迁移并验证

以 `pi-web-search` 为例：

```typescript
// custom/features/web-search/logic.ts
// 🔒 纯逻辑：搜索、抓取、解析，完全不碰 Pi API
export async function webSearch(query: string, options: SearchOptions): Promise<SearchResult[]> {
  // 从 pi-tools 的 pi-web-search 原样复制搜索逻辑
}

// custom/features/web-search/tool.ts
// 🔌 适配层：把逻辑注册为 Pi 工具
import { registerTool } from '../../adapters/pi-tool-adapter';
import { webSearch } from './logic';

export function registerWebSearchTool(pi: ExtensionAPI) {
  registerTool(pi, {
    name: 'web_search',
    description: 'Search the web',
    parameters: { query: { type: 'string' } },
    execute: (args) => webSearch(args.query as string, {}),
  });
}
```

**迁移顺序建议**：从最简单的 `pi-web-search` 开始，验证整条链路（logic → adapter → 注册 → 运行）畅通后，再迁移 `autopilot` 等复杂功能。每迁移一个功能就做一次上游同步测试。


## 💾 四、便携化架构：数据全部收敛到项目目录

这是本方案的关键创新点——**通过配置重定向和符号链接桥接，将所有运行时数据收敛到项目目录下**，实现真正的“U盘即插即用”。

### Pi 的配置目录机制

Pi 通过根 `package.json` 的 `piConfig` 字段控制品牌化配置：

```json
{
  "piConfig": {
    "name": "my-pi",
    "configDir": ".my-pi"
  }
}
```

修改 `name` 和 `configDir` 后，CLI 横幅、配置路径、环境变量名都会随之改变。此外，`PI_CODING_AGENT_DIR` 环境变量可以在运行时覆盖配置目录。

### 便携化路径策略

**核心思路**：让 `my-pi` 的配置目录始终指向项目目录下的 `portable/` 文件夹，无论项目被复制到哪个路径。

#### 启动脚本（自动解析路径）

```bash
#!/bin/bash
# my-pi.sh — 便携启动脚本

# 解析脚本所在目录（无论从何处调用）
MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 所有数据目录指向项目内的 portable/
export MY_PI_CONFIG_DIR="$MY_PI_ROOT/portable/config"
export MY_PI_SESSION_DIR="$MY_PI_ROOT/portable/sessions"
export MY_PI_EXTENSION_DIR="$MY_PI_ROOT/portable/extensions"
export MY_PI_SKILLS_DIR="$MY_PI_ROOT/portable/skills"
export MY_PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"

# 覆盖 Pi 的配置目录环境变量
export PI_CODING_AGENT_DIR="$MY_PI_CONFIG_DIR"

# 启动
exec "$MY_PI_ROOT/vendor/pi/node_modules/.bin/pi" "$@"
```

#### 便携会话扩展集成

`@brglng/pi-portable-sessions` 是一个专门解决会话目录便携化问题的扩展。Pi 默认将会话存储在 `~/.pi/agent/sessions/--<encoded-cwd>--/` 下，目录名嵌入了绝对路径，导致在不同机器上路径不同。该扩展通过**符号链接桥接**，将会话物理存储重定向到便携目录：

```json
// portable/config/extensions/pi-portable-sessions/config.json
{
  "portableRoot": "../portable-sessions",
  "homeLabel": "HOME",
  "rootLabel": "ROOT"
}
```

Pi 仍然通过符号链接写入，但物理存储位于 `portable/` 下，实现跨机器可同步。

#### 符号链接桥接（初始化脚本）

首次运行时创建必要的符号链接：

```bash
#!/bin/bash
# scripts/init-portable.sh — 初始化便携环境

MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTABLE="$MY_PI_ROOT/portable"
PI_CONFIG_DIR="${PI_CODING_AGENT_DIR:-$HOME/.my-pi/agent}"

mkdir -p "$PORTABLE"/{config,sessions,extensions,skills,memory}

# 将 Pi 默认配置目录桥接到便携目录
if [ ! -L "$PI_CONFIG_DIR" ]; then
    mkdir -p "$(dirname "$PI_CONFIG_DIR")"
    ln -sf "$PORTABLE/config" "$PI_CONFIG_DIR"
fi

# 桥接会话目录
PI_SESSION_DIR="$PI_CONFIG_DIR/sessions"
if [ ! -L "$PI_SESSION_DIR" ]; then
    ln -sf "$PORTABLE/sessions" "$PI_SESSION_DIR"
fi

echo "✅ 便携环境初始化完成"
echo "   配置目录: $PORTABLE/config"
echo "   会话目录: $PORTABLE/sessions"
```

### 数据目录映射总览

| Pi 默认路径 | 便携化路径 | 机制 |
|---|---|---|
| `~/.my-pi/agent/settings.json` | `portable/config/settings.json` | 符号链接 |
| `~/.my-pi/agent/sessions/` | `portable/sessions/` | pi-portable-sessions 扩展 |
| `~/.my-pi/agent/extensions/` | `portable/extensions/` | 符号链接 |
| `~/.my-pi/agent/skills/` | `portable/skills/` | 符号链接 |
| `~/.my-pi/agent/memory/` | `portable/memory/` | 符号链接 |

### U 盘使用流程

```bash
# 1. 在 U 盘上克隆项目
cd /Volumes/USB/my-pi

# 2. 初始化便携环境（首次运行）
bash scripts/init-portable.sh

# 3. 安装依赖并构建
npm install
npm run build

# 4. 使用
./my-pi.sh
```

当需要在另一台机器上使用时，**直接复制整个项目目录到新机器的 U 盘或本地路径**，运行 `init-portable.sh` 重新建立符号链接即可。所有配置、会话历史、记忆数据都在 `portable/` 下，完全跟随项目移动。


## 🔨 五、构建便携版可执行文件

为了在 U 盘中获得最佳体验，可以使用 Bun 将 my-pi 编译为**单文件可执行程序**。Bun 的 `--compile` 标志会将代码、Bun 运行时和所有依赖打包成一个独立二进制文件：

```bash
# 在 vendor/pi/packages/coding-agent/ 下
bun build --compile ./src/cli.ts --outfile my-pi
```

产物是一个自包含的二进制文件，可以在没有安装 Node.js 或 Bun 的机器上直接运行。如果需要在不同平台（Windows/Linux/macOS）上运行，可以用 `--target` 交叉编译：

```bash
# Linux x64
bun build --compile --target=bun-linux-x64 ./src/cli.ts --outfile my-pi-linux

# Windows x64
bun build --compile --target=bun-windows-x64 ./src/cli.ts --outfile my-pi.exe

# macOS ARM64
bun build --compile --target=bun-darwin-arm64 ./src/cli.ts --outfile my-pi-mac
```

不过需要注意：编译后的二进制中，`getPackageDir()` 等路径解析函数需要指向 portable 目录，需要在 `custom/core/config.ts` 中覆盖这些函数。


## 🔄 六、上游同步策略

`oh-omp` 的架构决策文档明确指出：“**上游同步是制度，而非尽力而为**”，目标是每周同步一次，并保持一个“小而明确的补丁队列”。

### 推荐使用 pi-regraft 作为同步工具

`pi-regraft` 是一个专门为 Pi 生态设计的 vendoring 工具。它将上游代码以**纯净的普通文件**存储在分支的正常提交中，在更新时使用这些纯净副本作为**三方合并基**。更新时只拉取新的上游 commit，然后合并。

核心优势：
- **保持代码为普通项目文件**，不引入额外的仓库或 submodule 管理
- **自动三方合并**，解决大部分冲突
- **冲突解决代理**：Regrafter 会为每次更新保持一个 Pi 会话和仓库租约，可以暂停和恢复
- **本地修改注释**：通过 `/regraft note` 记录“为什么这里改过”，后续更新时 Pi 代理会读取注释辅助冲突解决

### 手动同步流程（备选）

如果不想引入 pi-regraft，可以手动同步：

```bash
#!/bin/bash
# scripts/sync-upstream.sh

cd vendor/pi
LAST_SYNC=$(cat ../LAST_SYNC_POINT)

# 拉取上游更新
git fetch upstream
NEW_UPSTREAM=$(git rev-parse upstream/main)

# 生成上游变更补丁
git format-patch "$LAST_SYNC".."$NEW_UPSTREAM" --stdout > /tmp/upstream-changes.patch

# 应用补丁（三方合并）
git apply --3way /tmp/upstream-changes.patch

# 解决冲突后
echo "$NEW_UPSTREAM" > ../LAST_SYNC_POINT
```

### 冲突处理原则

- **逐个文件判断**，不要全局接受“对方的”或“我的”
- `vendor/pi/` 内的冲突：优先接受上游变更，除非你确定需要保留本地修改
- `custom/adapters/` 内的冲突：这是你的战场，需要仔细处理
- 如果上游修改了某个被适配器封装的 API，更新适配器层即可


## 📋 七、完整实施路线图

### 阶段一：基础设施搭建（第 1 周）

1. 创建新的 `my-pi` 仓库，建立 `vendor/`、`custom/`、`portable/`、`patches/`、`scripts/` 目录结构
2. 克隆 Pi monorepo 到 `vendor/pi/`，锁定一个稳定版本 tag
3. 配置 `vendor/pi/package.json` 的 `piConfig`（`name: "my-pi"`, `configDir: ".my-pi"`）
4. 编写 `scripts/init-portable.sh` 和 `my-pi.sh` 启动脚本
5. 验证最小编码助手可用（`npm run build` + `./my-pi.sh`）

### 阶段二：适配器层实现（第 2 周）

1. 实现 `custom/adapters/` 下的四个适配器
2. 实现 `custom/core/config.ts` 路径解析逻辑
3. 在 `custom/index.ts` 中编写 `bootstrap()` 入口
4. 测试适配器层与 Pi 核心的通信

### 阶段三：功能迁移（第 3-4 周）

按迁移顺序逐个处理：
1. `pi-web-search`（最简单，验证链路）
2. `pi-browser`（工具型）
3. `pi-autopilot`（钩子型）
4. 其余扩展
5. 每迁移一个就做一次上游同步测试

### 阶段四：便携化与打包（第 5 周）

1. 集成 `pi-portable-sessions` 扩展
2. 配置 `portable/` 下的所有数据目录
3. 使用 Bun 编译便携版可执行文件
4. 在 U 盘上测试完整流程

### 阶段五：持续维护（持续）

1. 建立每周上游同步节奏
2. 维护 `LAST_SYNC_POINT` 和补丁队列
3. 定期在 U 盘上验证便携性


## ⚠️ 八、关键风险与规避

| 风险 | 规避策略 |
|---|---|
| 上游 API 变更导致适配器失效 | 适配器层是唯一接触 Pi API 的地方，只需更新适配器 |
| 便携化后路径解析错误 | 所有路径通过 `custom/core/config.ts` 统一解析，不使用硬编码路径 |
| 上游同步产生大规模冲突 | 使用 pi-regraft 的三方合并，保持补丁队列小而明确 |
| U 盘在不同机器上路径不同 | 启动脚本动态解析脚本所在目录，符号链接自动重建 |
| 编译后的二进制找不到资源文件 | 在 `custom/core/config.ts` 中覆盖 `getPackageDir()` 等函数 |


## 💎 总结

这个方案的核心哲学是**三隔离一收敛**：

- **上游隔离**：`vendor/pi/` 永不修改，上游更新通过 pi-regraft 的三方合并自动同步
- **逻辑隔离**：`custom/features/*/logic.ts` 零 Pi 依赖，纯逻辑永远不会因上游变更而崩溃
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点，上游 API 变更只需修改适配器
- **数据收敛**：所有运行时数据通过配置重定向和符号链接收敛到 `portable/` 目录，实现 U 盘便携

从最简单的 `pi-web-search` 开始迁移，每步都验证上游同步不受影响，逐步扩展到全部功能。这样你获得的是一个**可持续维护的私人 AI 助手**，而非一次性的“快照式分叉”。