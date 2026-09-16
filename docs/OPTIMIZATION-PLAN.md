# my-pi 全面优化方案

> **当前进度**：架构基础阶段（Phase 1）已基本完成 — adapters 层、services 下沉、seams 定义均已就绪。详见 `custom/docs/IMPLEMENTATION-PLAN.md`。

## 决策记录

- **优化位置**：全部在 my-pi 中进行，pi-tools 保持轻量原型
- **优化策略**：全部 18 项并行推进
- **缝隙策略**：全部能力缝隙同时定义接口，再逐步实现 provider
- **预估工期**：8-12 周（并行执行）

## 总览

4 个并行轨道，18 个优化项：

| 轨道 | 内容 | 项数 |
|------|------|------|
| A. 架构重构 | 能力缝隙、事件系统、声明式配置、生命周期 | 4 |
| B. 功能补全 | Session log、缝隙基础设施、沙箱、凭证、交互、设置、标题、Webhook | 8 |
| C. 测试质量 | 100% 覆盖率、Snapshot 测试、E2E 测试 | 3 |
| D. 文档体验 | 双语文档、架构文档、Cookbook | 3 |

## 详细计划

### 轨道 A：架构重构

#### A1. 能力缝隙（Capability Seam）

**目标**：将工具注册与 provider 实现分离，实现可替换的能力接口。

**新增目录结构**：
```
custom/seams/
├── registry.ts              # 缝隙注册表（运行时）
├── types.ts                 # Service Definition / Provider / Consumer 接口
├── shell/
│   ├── types.ts             # Shell 缝隙接口
│   ├── local-provider.ts    # 本地 shell 实现
│   └── tool-consumer.ts     # bash 工具注册
├── fs/
│   ├── types.ts             # 文件系统缝隙接口
│   ├── local-provider.ts    # 本地 fs 实现
│   └── tool-consumer.ts     # read/write/edit/grep/find/ls 工具注册
├── search/
│   ├── types.ts             # 搜索缝隙接口
│   ├── local-provider.ts    # 本地 grep/find 实现
│   └── tool-consumer.ts     # grep/find/ls 工具注册
├── sandbox/
│   ├── types.ts             # 沙箱缝隙接口
│   ├── landlock-provider.ts # Linux Landlock 实现
│   ├── seatbelt-provider.ts # macOS Seatbelt 实现
│   ├── bwrap-provider.ts    # Bubblewrap 实现
│   └── null-provider.ts     # 无沙箱（开发环境）
├── llm/
│   ├── types.ts             # LLM 缝隙接口（已有 packages/ai）
│   └── adapter-bridge.ts    # 桥接到现有 packages/ai
├── subagent/
│   ├── types.ts             # 子代理缝隙接口
│   ├── local-provider.ts    # 本地 spawn 实现
│   └── remote-provider.ts   # 远程代理实现
├── credentials/
│   ├── types.ts             # 凭证缝隙接口
│   ├── env-provider.ts      # 环境变量（现有）
│   ├── file-provider.ts     # 文件（现有 auth.json）
│   └── keychain-provider.ts # 系统钥匙链
├── interaction/
│   ├── types.ts             # 交互缝隙接口
│   ├── approval-provider.ts # 工具执行前 approval
│   └── ask-user-consumer.ts # ask_user 工具
├── settings/
│   ├── types.ts             # 设置缝隙接口
│   ├── file-provider.ts     # 文件存储
│   └── hot-reload.ts        # 热重载支持
├── session-log/
│   ├── types.ts             # 会话日志缝隙接口
│   ├── jsonl-provider.ts    # JSONL 存储实现
│   └── projection-consumer.ts # 投影消费
├── webhook/
│   ├── types.ts             # Webhook 缝隙接口
│   ├── http-provider.ts     # HTTP 端点
│   └── rule-engine.ts       # 规则匹配
├── session-title/
│   ├── types.ts             # 会话标题缝隙接口
│   └── llm-provider.ts      # LLM 摘要实现
└── todo/
    ├── types.ts             # Todo 缝隙接口（已有 plan-mode）
    └── store-consumer.ts    # 存储消费
```

**每个缝隙的三角色设计**：

```typescript
// types.ts — Service Definition
interface ShellSeam {
  execute(command: string, options?: ExecOptions): Promise<ExecResult>
  available(): Promise<boolean>
}

// local-provider.ts — Service Provider
const localShellProvider: ShellSeam = {
  async execute(command, options) {
    return execAsync(command, options)
  },
  async available() { return true }
}

// tool-consumer.ts — Consumer
function registerShellTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'bash',
    seam: 'shell',  // 声明依赖的缝隙
    execute: async (id, params, signal) => {
      const shell = pi.seam.consume('shell')
      return shell.execute(params.command)
    }
  })
}
```

**框架修改**：
- `ExtensionAPI` 新增 `seam` 命名空间：`define()`, `provide()`, `consume()`
- `ExtensionRunner` 新增 `SeamRegistry` 管理所有缝隙
- 工具注册支持 `seam` 字段，运行时自动绑定当前 provider
- Provider 切换时自动通知所有依赖工具

**时间线**：
- 第 1 周：定义所有缝隙接口（types.ts）
- 第 2-3 周：实现核心 provider（shell, fs, sandbox）
- 第 4-5 周：迁移现有工具到 seams
- 第 6 周：实现剩余 provider（credentials, interaction, settings）

---

#### A2. 事件系统增强

**目标**：引入 DSH 的 5 种调度模式。

**当前事件 → 目标模式映射**：

| 事件 | 当前 | 目标 | 原因 |
|------|------|------|------|
| `tool_call` | 顺序短路 | waterfall | 中间件链，可短路可传递 |
| `tool_result` | 顺序链 | waterfall | 可链式修改结果 |
| `context` | 顺序链 | waterfall | 消息过滤是中间件模式 |
| `before_agent_start` | 并行 | serial | 需要顺序（pi-context 先于 pi-memory） |
| `session_start` | 并行 | parallel | 无依赖，可并发 |
| `session_shutdown` | 并行 | serial | 需要反序关闭 |
| `agent_end` | 并行 | emit | 仅通知，无返回值 |
| `agent_settled` | 并行 | emit | 仅通知 |
| `input` | 并行 | bail | 首个处理者消费 |
| `message_end` | 并行 | serial | 消息替换需顺序 |
| `turn_start` | 并行 | emit | 仅通知 |
| `turn_end` | 并行 | emit | 仅通知 |
| `tool_execution_start` | 并行 | emit | 仅通知 |
| `tool_execution_end` | 并行 | emit | 仅通知 |

**框架修改**：
- `ExtensionRunner.emit*()` 方法重构为统一的 `dispatch(event, mode)` 方法
- 事件声明中包含 dispatch mode 元数据
- waterfall 事件自动注入 `next()` 参数
- bail 事件第一个返回值即终止

**时间线**：
- 第 1 周：事件类型定义 + dispatch mode 声明
- 第 2 周：dispatch 方法实现（waterfall, bail, serial）
- 第 3 周：迁移现有事件处理器到新模式
- 第 4 周：测试验证

---

#### A3. 声明式配置

**目标**：引入 cordis.yml 风格的声明式插件组合。

**新增文件**：
```
custom/
├── cordis.yml                  # 主配置
├── cordis.production.yml       # 生产环境覆盖
└── cordis.development.yml      # 开发环境覆盖
```

**配置格式**：
```yaml
# cordis.yml
extensions:
  - id: pi-context
    enabled: true
    config:
      compression:
        strategy: aggressive
      toolLayering:
        enabled: true
  - id: pi-memory
    enabled: true
    config:
      autoExtract: true
  - id: plan-mode
    enabled: true
    config:
      enforcementLevel: strict

seams:
  shell:
    provider: local
  fs:
    provider: local
  sandbox:
    provider: null  # 开发环境无沙箱
```

**框架修改**：
- 新增 `ConfigManager` 读取 cordis.yml
- 扩展注册时自动注入配置：`pi.config` 对象
- 配置变更事件：`config_changed`
- 支持 patch 层覆盖

**时间线**：
- 第 1 周：配置格式设计
- 第 2 周：ConfigManager 实现
- 第 3 周：扩展配置注入
- 第 4 周：patch 层支持

---

#### A4. 插件生命周期管理

**目标**：效应模型，注册自动回滚。

**框架修改**：
- `ExtensionAPI` 新增 `effect()` 方法
- `ExtensionRunner` 跟踪每个扩展的 disposer
- `disable_extension` 命令：调用 disposer 回滚所有注册
- `reload_extension` 命令：dispose → 重新 load → commit

**时间线**：
- 第 1 周：effect() 方法实现
- 第 2 周：disposer 跟踪
- 第 3 周：disable/reload 命令
- 第 4 周：热重载支持

---

### 轨道 B：功能补全

#### B1. Session Log（耐久日志）

**核心原则**：Model-visible = logged

**新增目录**：
```
custom/session-log/
├── types.ts
├── log-writer.ts
├── log-reader.ts
├── derive-messages.ts
├── projections/
│   ├── tool-usage.ts
│   ├── token-usage.ts
│   ├── memory-extract.ts
│   └── plan-state.ts
└── migrations/
    ├── v0-to-v1.ts
    └── v1-to-v2.ts
```

**时间线**：
- 第 1 周：类型定义
- 第 2 周：log-writer 实现
- 第 3 周：derive-messages 实现
- 第 4 周：projections 实现
- 第 5 周：迁移脚本

---

#### B2-B8. 其他功能项

| 项 | 时间线 | 依赖 |
|----|--------|------|
| B2 缝隙基础设施 | 第 1-2 周 | A1 |
| B3 沙箱系统 | 第 2-4 周 | A1 |
| B4 凭证管理 | 第 2-3 周 | A1 |
| B5 交互 seam | 第 2-3 周 | A1 |
| B6 设置管理 | 第 3-4 周 | A3 |
| B7 会话标题 | 第 3-4 周 | B1 |
| B8 Webhook | 第 4-5 周 | A1 |

---

### 轨道 C：测试质量

#### C1. 100% 覆盖率

**补全优先级**：

| 扩展 | 当前测试数 | 需补全 | 时间 |
|------|-----------|--------|------|
| pi-browser | 3 | 边界情况 | 第 1-2 周 |
| pi-intervention | 1 | 完整测试 | 第 1-2 周 |
| subagent | 1 | 完整测试 | 第 1-2 周 |
| pi-context | 14 | 并发场景 | 第 2-3 周 |
| plan-mode | 12 | overlay 交互 | 第 2-3 周 |
| pi-memory | 8 | 并发场景 | 第 2-3 周 |
| pi-autopilot | 13 | watchdog 竞态 | 第 3-4 周 |

**CI 门槛**：
```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    lines: 100,
    functions: 100,
    branches: 100,
    statements: 100
  }
}
```

---

#### C2. Session Snapshot 测试

**新增目录**：
```
custom/tests/
├── snapshots/
│   ├── plan-mode-basic.jsonl
│   ├── memory-extract.jsonl
│   └── ...
└── replay-harness.ts
```

**时间线**：
- 第 3 周：回放框架实现
- 第 4-5 周：录制关键会话
- 第 6 周：CI 集成

---

#### C3. E2E 测试

**新增目录**：
```
e2e/
├── full-interaction.test.ts
├── tool-pipeline.test.ts
└── extension-lifecycle.test.ts
```

**时间线**：
- 第 4 周：E2E 框架搭建
- 第 5-6 周：测试用例编写

---

### 轨道 D：文档体验

#### D1. 双语文档

**新增目录**：
```
docs/
├── architecture.zh.md
├── architecture.en.md
├── capability-seams.zh.md
├── capability-seams.en.md
├── event-system.zh.md
├── event-system.en.md
├── extension-guide.zh.md
├── extension-guide.en.md
├── testing-guide.zh.md
├── testing-guide.en.md
├── sync-workflow.zh.md
├── sync-workflow.en.md
└── api-reference/
    ├── extension-api.zh.md
    ├── extension-api.en.md
    ├── seam-api.zh.md
    ├── seam-api.en.md
    ├── event-api.zh.md
    └── event-api.en.md
```

---

#### D2. 架构文档

参考 DSH 的 `docs/architecture.md`，包含：
- 整体架构图
- 能力缝隙图
- 事件流图
- 扩展加载流程图

---

#### D3. 开发者 Cookbook

参考 DSH 的 `docs/cookbook/`：
- 如何添加新扩展
- 如何添加新工具
- 如何添加新能力缝隙
- 如何添加新事件
- 如何写测试
- 如何录制/回放会话

---

## 并行执行甘特图

```
周次  轨道A        轨道B        轨道C        轨道D
────────────────────────────────────────────────────
1    A1接口定义    B1类型定义    C1补全测试    D1架构初稿
     A2事件声明    B2基础设施    C1补全测试    D2架构文档
     A3配置设计    B3沙箱接口
     A4effect

2    A1核心实现    B1日志写入    C1补全测试    D1双语补全
     A2dispatch    B4凭证接口    C1补全测试    D3cookbook
     A3ConfigMgr   B5交互接口
     A4disposer

3    A1工具迁移    B1推导器     C1覆盖率CI   D1 API文档
     A2模式迁移    B3沙箱实现    C2回放框架    D2完善
     A3配置注入    B4凭证实现
     A4热重载      B5交互实现

4    A1完成验证    B1投影器     C2录制会话    D1完善
     A2完成验证    B3沙箱完成    C3 E2E框架
     A3 patch层    B6设置实现
     A4完成        B7标题实现

5    全面测试      B1完成       C2录制会话    D1定稿
                  B8 webhook    C3 E2E用例    D2定稿
                                C1覆盖率门    D3定稿

6    修复迭代      集成测试     C3 E2E完成    最终审核
                  最终验证     最终验证
```

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 框架核心修改导致兼容性问题 | 高 | 每个阶段后运行完整测试 |
| 能力缝隙接口设计不合理 | 高 | 先定义接口，实现前充分评审 |
| 测试补全工作量超预期 | 中 | 优先补全覆盖率最低的扩展 |
| 事件模式迁移引入 bug | 中 | 逐个事件迁移，每次迁移后验证 |
| 文档滞后于代码 | 中 | 代码变更时同步更新文档 |

## 成功标准

- [ ] 12 个扩展全部迁移到 seams 架构
- [ ] 事件系统支持 5 种调度模式
- [ ] cordis.yml 声明式配置可用
- [ ] Session log 记录所有模型可见事件
- [ ] 测试覆盖率达到 100%
- [ ] 双语文档完整
- [ ] 所有现有功能正常工作
- [ ] 构建和类型检查通过
