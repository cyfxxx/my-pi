# my-pi 架构文档

## 概述

my-pi 是基于 [earendil-works/pi](https://github.com/earendil-works/pi) v0.85.1 的硬分叉版本，通过 vendor + 适配器模式实现完全受控的私人 AI 助手。

## 核心架构原则

### 三隔离一收敛

- **上游隔离**：`vendor/pi/` 永不修改，上游更新通过同步脚本自动合并
- **逻辑隔离**：`custom/features/*/logic.ts` 零 Pi 依赖
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点
- **数据收敛**：所有运行时数据收敛到 `portable/` 目录

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

## 架构分层

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

## 扩展加载流程

1. **发现**：扫描 `custom/features/` 目录
2. **加载**：通过 jiti 运行时加载 TypeScript
3. **初始化**：调用扩展 `init()` 函数，注册工具和事件
4. **激活**：扩展进入活跃状态，响应事件

## 事件流

```
用户输入
  │
  ▼
input (bail) ─── 首个处理者消费
  │
  ▼
before_agent_start (serial) ─── 顺序注入上下文
  │
  ├── context: 注入 system prompt
  ├── memory: 注入记忆
  └── plan-mode: 注入计划上下文
  │
  ▼
tool_call (waterfall) ─── 中间件链拦截
  │
  ├── plan-mode: 检查权限
  └── context: 记录耗时
  │
  ▼
tool_result (waterfall) ─── 链式修改结果
  │
  ├── context: 截断输出
  └── autopilot: 记录进度
  │
  ▼
agent_end (emit) ─── 通知所有监听器
```

## 能力缝隙详解

### Shell 缝隙

```typescript
// 定义
const SHELL_SEAM: ServiceDefinition<ShellService> = {
  name: 'shell',
  description: 'Shell 命令执行能力',
  defaultProvider: 'local',
}

// Provider 实现
const localShell: ShellProvider = {
  name: 'local',
  seam: 'shell',
  impl: {
    async execute(command) { return execAsync(command) },
    async available() { return true },
  }
}

// Consumer（工具）
pi.registerTool({
  name: 'bash',
  seam: 'shell',
  execute: async (id, params) => {
    const shell = pi.seam.consume<ShellService>('shell')
    return shell.execute(params.command)
  }
})
```

### 切换 Provider

```typescript
// 从本地切换到沙箱
await pi.seam.switchProvider('shell', 'sandboxed')

// 所有依赖 shell 的工具自动跟随
// bash 工具现在在沙箱中执行
```

## 配置管理

### 声明式配置

```yaml
# cordis.yml
extensions:
  - id: context
    config:
      compression:
        strategy: aggressive
  - id: memory
    config:
      autoExtract: true

seams:
  shell:
    provider: local
  sandbox:
    provider: landlock
```

### 环境覆盖

```yaml
# cordis.production.yml
seams:
  sandbox:
    provider: seatbelt  # macOS 生产环境
```

## 测试策略

### 单元测试

- 每个扩展独立测试
- 使用 vitest + mock
- 目标：100% 覆盖率

### E2E 测试

- 真实 API 端到端测试
- 需要 API key（可选）

## 开发指南

### 添加新功能

1. 在 `custom/features/` 下创建新目录
2. 创建 `types.ts` - 类型定义
3. 创建 `logic.ts` - 纯逻辑（零 Pi 依赖）
4. 创建 `tool.ts` - 工具注册（使用适配器）
5. 创建 `index.ts` - 入口（`init`/`destroy` 导出）

### 添加新能力缝隙

1. 在 `custom/seams/` 下创建目录
2. 定义 Service Definition
3. 实现 Service Provider
4. 创建 Consumer（通常是工具）

### 添加新事件

1. 在 `custom/events/types.ts` 中声明事件
2. 在 `FrameworkEventMap` 中添加定义
3. 在 `bus.ts` 中实现调度逻辑
