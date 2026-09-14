# my-pi 架构文档

## 概述

my-pi 是基于 [earendil-works/pi](https://github.com/earendil-works/pi) v0.85.1 的定制分支，将 pi-tools 中的 12 个自定义扩展融入框架底层代码，并引入了从 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 借鉴的架构模式。

## 核心架构原则

### 1. 万物皆插件（Everything is a Plugin）

每个功能模块都是独立的插件，通过声明式接口与其他模块通信。没有特权核心，所有行为都可通过配置替换。

### 2. 能力缝隙（Capability Seam）

每个能力由三角色组成：

```
Service Definition  →  Service Provider  →  Consumer
（接口声明）            （实现）              （消费，如工具）
```

替换一个 Provider 即可改变整个产品的行为。

### 3. 事件驱动（Event-Driven）

模块间通过类型化事件通信，支持 5 种调度模式：

| 模式 | 行为 | 用途 |
|------|------|------|
| `emit` | 通知型，无返回值 | 观察者 |
| `waterfall` | 中间件链，可短路 | 请求拦截/策略 |
| `parallel` | 并发执行 | 多 provider 竞争 |
| `serial` | 顺序执行，有返回值 | 管道式处理 |
| `bail` | 首个成功即返回 | 短路求值 |

### 4. Model-visible = logged

所有模型可见的输入必须记录在耐久日志中，可以从日志重建任意时间点的上下文。

## 目录结构

```
my-pi/
├── custom/                     # 自定义扩展和服务
│   ├── extensions/             # 12 个扩展
│   │   ├── pi-context/         # Token 优化中枢
│   │   ├── plan-mode/          # 计划模式
│   │   ├── pi-memory/          # 跨会话记忆
│   │   ├── pi-autopilot/       # 自治操作
│   │   ├── pi-web-search/      # 网页搜索
│   │   ├── pi-browser/         # 浏览器自动化
│   │   ├── pi-intervention/    # 干预捕获
│   │   ├── pi-link/            # 多设备互联
│   │   ├── pi-tmux/            # tmux 管理
│   │   ├── pi-mode/            # 模式切换
│   │   ├── pi-voice/           # 语音通信
│   │   └── subagent/           # 子代理调度
│   ├── services/               # 共享服务模块
│   │   ├── token-budget/       # token 预算管理
│   │   ├── diagnostics/        # 诊断工具
│   │   ├── note-store.ts       # 笔记存储
│   │   ├── atomic-write.ts     # 原子写入
│   │   └── secrets.ts          # 密钥脱敏
│   ├── seams/                  # 能力缝隙定义
│   │   ├── types.ts            # 核心接口
│   │   ├── registry.ts         # 缝隙注册表
│   │   ├── shell/              # Shell 缝隙
│   │   ├── fs/                 # 文件系统缝隙
│   │   ├── search/             # 搜索缝隙
│   │   ├── sandbox/            # 沙箱缝隙
│   │   ├── llm/                # LLM 缝隙
│   │   ├── subagent/           # 子代理缝隙
│   │   ├── credentials/        # 凭证缝隙
│   │   ├── interaction/        # 交互缝隙
│   │   ├── settings/           # 设置缝隙
│   │   ├── session-log/        # 会话日志缝隙
│   │   ├── webhook/            # Webhook 缝隙
│   │   ├── session-title/      # 会话标题缝隙
│   │   └── todo/               # Todo 缝隙
│   ├── events/                 # 事件系统
│   │   ├── types.ts            # 事件类型定义
│   │   ├── bus.ts              # 事件总线实现
│   │   └── index.ts            # 导出
│   ├── session-log/            # Session Log 实现
│   │   ├── types.ts            # 日志类型定义
│   │   ├── projections/        # 投影器
│   │   └── migrations/         # 格式迁移
│   ├── tsconfig.json           # 独立类型检查
│   └── cordis.yml              # 声明式配置（规划中）
├── packages/                   # 官方框架包
│   ├── coding-agent/           # 主 CLI（含框架核心）
│   ├── ai/                     # LLM API 抽象
│   ├── agent/                  # Agent 运行时
│   ├── tui/                    # 终端 UI
│   └── ...
└── docs/                       # 文档
    ├── architecture.md         # 本文档
    ├── capability-seams.md     # 能力缝隙详解
    └── event-system.md         # 事件系统详解
```

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    用户输入                              │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  事件总线（EventBus）                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │  emit   │ │waterfall│ │parallel │ │ serial  │      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
└─────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  pi-context  │  │  pi-memory   │  │  plan-mode   │
│  (Token优化) │  │  (记忆注入)   │  │  (计划模式)   │
└──────────────┘  └──────────────┘  └──────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────┐
│                 能力缝隙注册表（SeamRegistry）            │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │
│  │shell│ │ fs  │ │sandbox│ │ llm │ │creds│ │ ... │    │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘    │
└─────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  local-shell │  │  landlock    │  │  google-llm  │
│  (本地实现)   │  │  (Linux沙箱) │  │  (Google API)│
└──────────────┘  └──────────────┘  └──────────────┘
```

## 扩展加载流程

1. **发现**：扫描 `custom/extensions/` 目录
2. **加载**：通过 jiti 运行时加载 TypeScript
3. **初始化**：调用扩展工厂函数，注册工具和事件
4. **绑定**：`ExtensionRunner.bindCore()` 替换 stub 方法
5. **激活**：扩展进入活跃状态，响应事件

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
  ├── pi-context: 注入 system prompt
  ├── pi-memory: 注入记忆
  └── plan-mode: 注入计划上下文
  │
  ▼
tool_call (waterfall) ─── 中间件链拦截
  │
  ├── plan-mode: 检查权限
  └── pi-context: 记录耗时
  │
  ▼
tool_result (waterfall) ─── 链式修改结果
  │
  ├── pi-context: 截断输出
  └── pi-autopilot: 记录进度
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

### 声明式配置（规划中）

```yaml
# cordis.yml
extensions:
  - id: pi-context
    config:
      compression:
        strategy: aggressive
  - id: pi-memory
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

### Snapshot 测试

- 录制会话 → 回放验证
- 无 API 消耗
- 命令：`npm run test:snapshot`

### E2E 测试

- 真实 API 端到端测试
- 需要 API key（可选）
- 命令：`npm run test:e2e`

## 开发指南

### 添加新扩展

1. 在 `custom/extensions/` 下创建目录
2. 导出默认工厂函数
3. 使用 `pi.registerTool()` 注册工具
4. 使用 `pi.on()` 监听事件

### 添加新能力缝隙

1. 在 `custom/seams/` 下创建目录
2. 定义 Service Definition
3. 实现 Service Provider
4. 创建 Consumer（通常是工具）

### 添加新事件

1. 在 `custom/events/types.ts` 中声明事件
2. 在 `FrameworkEventMap` 中添加定义
3. 在 `bus.ts` 中实现调度逻辑
