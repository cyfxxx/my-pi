# my-pi 目录结构

## 顶层目录

```
my-pi/
├── packages/              # pi 上游包（只读同步）
├── custom/                # 自定义层（主要工作区）
├── patches/               # 补丁管理
├── scripts/               # 脚本工具
├── package.json           # monorepo 配置
├── tsconfig.base.json     # TypeScript 基础配置
└── README.md              # 项目说明
```

## packages/ 目录

pi 上游包，保持只读，从 pi 上游同步。

```
packages/
├── ai/                    # AI 核心库
│   ├── src/
│   │   ├── api/           # API 实现（openai, anthropic, google 等）
│   │   ├── auth/          # 认证逻辑
│   │   ├── models/        # 模型管理
│   │   └── index.ts       # 入口
│   └── package.json
│
├── agent/                 # Agent 核心
│   ├── src/
│   │   ├── core/          # 核心逻辑
│   │   └── index.ts       # 入口
│   └── package.json
│
├── coding-agent/          # 编码代理
│   ├── src/
│   │   ├── core/
│   │   │   ├── tools/     # 工具系统
│   │   │   ├── extensions/ # 扩展系统
│   │   │   ├── session/   # 会话管理
│   │   │   └── ...
│   │   ├── services/      # 服务层
│   │   └── index.ts       # 入口
│   └── package.json
│
├── protocol/              # 协议定义
├── chord/                 # 核心框架
├── tui/                   # 终端 UI
├── server/                # 服务器
├── client/                # 客户端
├── telemetry/             # 遥测
└── evals/                 # 评估
```

## custom/ 目录

自定义层，主要工作区。

```
custom/
├── src/                   # 源代码
│   ├── adapters/          # 适配器层
│   │   ├── api.ts         # ExtensionAPI 适配
│   │   ├── tools/         # 工具系统适配
│   │   │   ├── tool-adapter.ts
│   │   │   ├── interceptor.ts
│   │   │   └── layering.ts
│   │   ├── session/       # 会话管理适配
│   │   │   ├── session-adapter.ts
│   │   │   └── export-adapter.ts
│   │   ├── index.ts       # 统一导出
│   │   └── types.ts       # 类型定义
│   │
│   ├── services/          # 下沉的服务
│   │   ├── tool-system/   # 工具系统服务
│   │   │   ├── truncation.ts
│   │   │   ├── path-utils.ts
│   │   │   ├── render-utils.ts
│   │   │   ├── edit-diff.ts
│   │   │   ├── output-accumulator.ts
│   │   │   ├── file-mutation-queue.ts
│   │   │   ├── tool-layering.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── session/       # 会话管理服务
│   │   │   ├── session-stats.ts
│   │   │   ├── context-usage.ts
│   │   │   ├── session-export.ts
│   │   │   ├── session-discovery.ts
│   │   │   ├── session-log-bridge.ts
│   │   │   └── index.ts
│   │   │
│   │   └── token-budget/  # Token 预算服务
│   │       ├── prune.ts
│   │       ├── context-budget.ts
│   │       ├── auto-compact.ts
│   │       └── index.ts
│   │
│   ├── extensions/        # 扩展模块
│   │   ├── pi-context/    # 上下文管理
│   │   ├── pi-memory/     # 记忆系统
│   │   ├── pi-web-search/ # 网页搜索
│   │   ├── pi-autopilot/  # 自动驾驶
│   │   ├── pi-voice/      # 语音功能
│   │   └── ...
│   │
│   ├── seams/             # 能力接缝
│   │   ├── shell/         # Shell 接口
│   │   │   ├── types.ts
│   │   │   ├── tool-consumer.ts
│   │   │   └── ...
│   │   ├── fs/            # 文件系统接口
│   │   ├── search/        # 搜索接口
│   │   ├── sandbox/       # 沙箱接口
│   │   ├── llm/           # LLM 接口
│   │   └── registry.ts    # 接缝注册表
│   │
│   ├── events/            # 事件系统
│   │   ├── bus.ts         # 事件总线
│   │   ├── types.ts       # 事件类型
│   │   └── adapter.ts     # 适配器
│   │
│   ├── session-log/       # 会话日志
│   │   ├── types.ts       # 日志类型
│   │   ├── jsonl-writer.ts # JSONL 写入器
│   │   ├── projection.ts  # 投影查询
│   │   └── index.ts       # 入口
│   │
│   └── config/            # 配置管理
│       ├── types.ts       # 配置类型
│       ├── manager.ts     # 配置管理器
│       └── index.ts       # 入口
│
├── docs/                  # 项目文档
│   ├── ARCHITECTURE.md    # 架构文档
│   ├── IMPLEMENTATION-PLAN.md # 实施计划
│   ├── DIRECTORY-STRUCTURE.md # 目录结构（本文档）
│   ├── TOOL-SYSTEM-SINKING.md # 工具系统下沉方案
│   ├── SESSION-MANAGEMENT-SINKING.md # 会话管理下沉方案
│   ├── PATCH-MANAGEMENT.md # 补丁管理
│   └── UPSTREAM-SYNC.md   # 上游同步
│
├── tests/                 # 测试文件
│   ├── unit/              # 单元测试
│   │   ├── tool-system/   # 工具系统测试
│   │   └── session/       # 会话管理测试
│   ├── integration/       # 集成测试
│   │   ├── adapters/      # 适配器测试
│   │   └── seams/         # 接缝测试
│   └── e2e/               # 端到端测试
│
├── bootstrap.ts           # 启动流程
├── extension-loader.ts    # 扩展加载器
├── integration.ts         # 集成层
├── cordis.yml             # 声明式配置
└── tsconfig.json          # TypeScript 配置
```

## patches/ 目录

补丁管理，追踪对 packages/ 的修改。

```
patches/
├── 001-ai-tool-extend.patch
├── 002-session-stats.patch
├── 003-coding-agent-api.patch
└── README.md              # 补丁说明
```

## scripts/ 目录

脚本工具。

```
scripts/
├── mypi                   # 启动脚本
└── sync-upstream.sh       # 上游同步脚本
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

| 文件 | 职责 | 修改频率 |
|------|------|----------|
| `custom/extensions/pi-context/` | 上下文管理 | 高 |
| `custom/extensions/pi-memory/` | 记忆系统 | 高 |
| `custom/extensions/pi-web-search/` | 网页搜索 | 高 |
| `custom/extensions/pi-autopilot/` | 自动驾驶 | 高 |
| `custom/extensions/pi-voice/` | 语音功能 | 高 |

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
| `custom/docs/DIRECTORY-STRUCTURE.md` | 目录结构 | 低 |
| `custom/docs/TOOL-SYSTEM-SINKING.md` | 工具系统下沉方案 | 低 |
| `custom/docs/SESSION-MANAGEMENT-SINKING.md` | 会话管理下沉方案 | 低 |
| `custom/docs/PATCH-MANAGEMENT.md` | 补丁管理 | 低 |
| `custom/docs/UPSTREAM-SYNC.md` | 上游同步 | 低 |
