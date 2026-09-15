# 会话管理下沉方案

## 1. 概述

本文档详细描述如何将会话管理的纯计算逻辑下沉到 `custom/src/services/session/`，实现：
- 独立修改会话管理功能
- 隔离 pi API 变化
- 保持向后兼容

## 2. 下沉清单

### 2.1 会话统计 (session-stats.ts)

**源位置**: `packages/coding-agent/src/core/agent-session.ts` (getSessionStats 方法)

**目标位置**: `custom/src/services/session/session-stats.ts`

**功能**:
- `computeSessionStats(entries)` - 计算会话统计
- 统计 userMessages、assistantMessages、toolCalls、toolResults
- 聚合 usage totals

**依赖分析**:
- 纯数据计算，不依赖 Agent 实例
- 可独立测试

**下沉步骤**:
```typescript
// 1. 从 agent-session.ts 提取 getSessionStats 方法
// 2. 创建 session-stats.ts
export function computeSessionStats(entries: SessionEntry[]): SessionStats {
  // 遍历 entries 聚合统计
}

// 3. 更新 agent-session.ts 使用下沉的服务
import { computeSessionStats } from '@my-pi/custom/services/session'
```

### 2.2 上下文用量 (context-usage.ts)

**源位置**: `packages/coding-agent/src/core/agent-session.ts` (getContextUsage 方法)

**目标位置**: `custom/src/services/session/context-usage.ts`

**功能**:
- `computeContextUsage(messages, model, branchEntries)` - 计算上下文用量
- 包含 compaction boundary 检查逻辑
- 返回 `{ tokens, contextWindow, percent }`

**依赖分析**:
- 纯计算，不依赖运行时状态
- 与 `context-budget.ts` 模式一致

**下沉步骤**:
```typescript
// 1. 从 agent-session.ts 提取 getContextUsage 方法
// 2. 创建 context-usage.ts
export function computeContextUsage(
  messages: AgentMessage[],
  model: { contextWindow: number } | undefined,
  branchEntries: SessionEntry[],
): ContextUsage | undefined {
  // 计算上下文用量
}

// 3. 更新 agent-session.ts 使用下沉的服务
```

### 2.3 会话导出 (session-export.ts)

**源位置**: `packages/coding-agent/src/core/agent-session.ts` (exportToHtml, exportToJsonl 方法)

**目标位置**: `custom/src/services/session/session-export.ts`

**功能**:
- `exportSessionToHtml(sm, state, options)` - 导出为 HTML
- `exportSessionToJsonl(sm, outputPath)` - 导出为 JSONL

**依赖分析**:
- 纯 I/O 操作，只需 SessionManager 和 AgentState 输入
- 不依赖运行时状态

**下沉步骤**:
```typescript
// 1. 从 agent-session.ts 提取导出方法
// 2. 创建 session-export.ts
export async function exportSessionToHtml(
  sm: SessionManager,
  state: AgentState,
  options: ExportOptions
): Promise<string> {
  // 导出 HTML
}

export function exportSessionToJsonl(
  sm: SessionManager,
  outputPath?: string
): string {
  // 导出 JSONL
}

// 3. 更新 agent-session.ts 使用下沉的服务
```

### 2.4 会话发现 (session-discovery.ts)

**源位置**: `packages/coding-agent/src/core/session-manager.ts` (list, listAll 静态方法)

**目标位置**: `custom/src/services/session/session-discovery.ts`

**功能**:
- `discoverSessions(sessionDir, options)` - 发现会话列表
- 支持按 cwd 过滤
- 支持进度回调

**依赖分析**:
- 纯文件系统扫描 + 解析
- 不依赖运行时状态

**下沉步骤**:
```typescript
// 1. 从 session-manager.ts 提取 list/listAll 方法
// 2. 创建 session-discovery.ts
export async function discoverSessions(
  sessionDir: string,
  options?: { cwd?: string; onProgress?: SessionListProgress }
): Promise<SessionInfo[]> {
  // 发现会话
}

// 3. 更新 session-manager.ts 使用下沉的服务
```

### 2.5 日志桥接 (session-log-bridge.ts)

**源位置**: 新建

**目标位置**: `custom/src/services/session/session-log-bridge.ts`

**功能**:
- `sessionEntryToLogEvent(entry)` - SessionEntry 映射到 SessionEvent
- `attachSessionLog(sm, log)` - 桥接 SessionManager 和 SessionLog

**依赖分析**:
- 解决 session-log/ 与 SessionManager 的断层
- 事件映射逻辑

**下沉步骤**:
```typescript
// 1. 创建 session-log-bridge.ts
import { type SessionEntry } from '@earendil-works/pi-coding-agent'
import { type SessionEvent } from '../../session-log/types'

export function sessionEntryToLogEvent(entry: SessionEntry): SessionEvent | null {
  switch (entry.type) {
    case 'message':
      return { type: entry.role === 'user' ? 'user_message' : 'assistant_message', ... }
    case 'toolResult':
      return { type: 'tool_result', ... }
    // ...
  }
}

export function attachSessionLog(sm: SessionManager, log: SessionLog): void {
  sm.on('entry', (entry) => {
    const event = sessionEntryToLogEvent(entry)
    if (event) log.write(event)
  })
}

// 2. 在 bootstrap.ts 中集成
import { attachSessionLog } from './services/session/session-log-bridge'
```

## 3. 实施流程

### 3.1 Phase 3.1-3.5: 提取纯函数

```bash
# 创建目录
mkdir -p custom/src/services/session

# 1. 提取 session-stats
# 从 agent-session.ts 提取 getSessionStats 方法

# 2. 提取 context-usage
# 从 agent-session.ts 提取 getContextUsage 方法

# 3. 提取 session-export
# 从 agent-session.ts 提取 exportToHtml/exportToJsonl 方法

# 4. 提取 session-discovery
# 从 session-manager.ts 提取 list/listAll 方法

# 5. 创建 session-log-bridge
# 新建桥接逻辑
```

### 3.2 Phase 3.6: 创建索引文件

```typescript
// custom/src/services/session/index.ts
export { computeSessionStats } from './session-stats'
export { computeContextUsage } from './context-usage'
export { exportSessionToHtml, exportSessionToJsonl } from './session-export'
export { discoverSessions } from './session-discovery'
export { sessionEntryToLogEvent, attachSessionLog } from './session-log-bridge'
```

### 3.3 Phase 3.7-3.8: 更新兼容导入

```typescript
// packages/coding-agent/src/core/agent-session.ts
import { computeSessionStats, computeContextUsage, exportSessionToHtml, exportSessionToJsonl } from '@my-pi/custom/services/session'

// 原始方法改为调用下沉的服务
getSessionStats() {
  return computeSessionStats(this.sessionManager.getEntries())
}

getContextUsage() {
  return computeContextUsage(this.messages, this.model, this.branchEntries)
}
```

### 3.4 Phase 3.9: 更新扩展导入路径

```typescript
// custom/extensions/pi-context/auto-compact-controller.ts
// 修改前：
import { setContextWindow } from '../../services/context-budget'

// 修改后：
import { setContextWindow } from '../../services/token-budget/context-budget'
```

## 4. 测试策略

### 4.1 单元测试

```typescript
// custom/tests/unit/session/session-stats.test.ts
import { describe, it, expect } from 'vitest'
import { computeSessionStats } from '../../../src/services/session/session-stats'

describe('session-stats', () => {
  it('computeSessionStats', () => {
    const entries = [
      { type: 'message', role: 'user', content: 'hello' },
      { type: 'message', role: 'assistant', content: 'hi' },
      { type: 'toolResult', toolName: 'bash', content: 'output' },
    ]
    const stats = computeSessionStats(entries)
    expect(stats.userMessages).toBe(1)
    expect(stats.assistantMessages).toBe(1)
    expect(stats.toolCalls).toBe(1)
  })
})
```

### 4.2 集成测试

```typescript
// custom/tests/integration/session/session-log-bridge.test.ts
import { describe, it, expect } from 'vitest'
import { sessionEntryToLogEvent, attachSessionLog } from '../../../src/services/session/session-log-bridge'

describe('session-log-bridge', () => {
  it('sessionEntryToLogEvent', () => {
    const entry = { type: 'message', role: 'user', content: 'hello' }
    const event = sessionEntryToLogEvent(entry)
    expect(event).toBeDefined()
    expect(event.type).toBe('user_message')
  })
})
```

## 5. 风险与缓解

### 5.1 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 下沉文件依赖其他模块 | 中 | 检查依赖，必要时一并下沉 |
| 兼容导入路径错误 | 低 | 逐步测试，确保向后兼容 |
| session-log 桥接不完整 | 中 | 完善事件映射，覆盖所有类型 |

### 5.2 回滚方案

如果下沉失败：
1. 恢复原始文件
2. 删除下沉的服务文件
3. 更新导入路径回原始位置

## 6. 完成标准

- [ ] 所有会话管理服务下沉完成
- [ ] session-log 桥接正常工作
- [ ] 原始位置的兼容导入正常工作
- [ ] 扩展导入路径更新完成
- [ ] TypeScript 编译通过
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 文档编写完成
