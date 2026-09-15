# 工具系统下沉方案

## 1. 概述

本文档详细描述如何将 pi 的工具系统纯函数逻辑下沉到 `custom/services/tool-system/`，实现：
- 独立修改工具系统功能
- 隔离 pi API 变化
- 保持向后兼容

## 2. 下沉清单

### 2.1 输出截断 (truncation.ts)

**源位置**: `packages/coding-agent/src/core/tools/truncate.ts`

**目标位置**: `custom/src/services/tool-system/truncation.ts`

**功能**:
- `truncateHead(text, maxLines, maxBytes)` - 保留前 N 行/字节
- `truncateTail(text, maxLines, maxBytes)` - 保留后 N 行/字节
- `truncateLine(text, maxChars)` - 单行截断

**依赖分析**:
- 纯函数，无外部依赖
- 仅使用字符串操作

**下沉步骤**:
```bash
# 1. 复制文件
cp packages/coding-agent/src/core/tools/truncate.ts \
   custom/src/services/tool-system/truncation.ts

# 2. 更新原始位置的兼容导入
# packages/coding-agent/src/core/tools/truncate.ts 改为：
export { truncateHead, truncateTail, truncateLine } from '@my-pi/custom/services/tool-system'
```

### 2.2 路径解析 (path-utils.ts)

**源位置**: `packages/coding-agent/src/core/tools/path-utils.ts`

**目标位置**: `custom/src/services/tool-system/path-utils.ts`

**功能**:
- `expandTilde(path)` - 展开 `~`
- `resolveRelative(base, relative)` - 解析相对路径
- `matchMacOSVariant(filename, pattern)` - macOS 文件名变体匹配

**依赖分析**:
- 仅依赖 Node.js 原生 API (`path`, `os`)
- 纯函数

**下沉步骤**:
```bash
# 1. 复制文件
cp packages/coding-agent/src/core/tools/path-utils.ts \
   custom/src/services/tool-system/path-utils.ts

# 2. 更新原始位置的兼容导入
```

### 2.3 渲染工具 (render-utils.ts)

**源位置**: `packages/coding-agent/src/core/tools/render-utils.ts`

**目标位置**: `custom/src/services/tool-system/render-utils.ts`

**功能**:
- `shortenPath(path, cwd)` - 路径缩写
- `replaceTabs(text)` - Tab 替换
- `getTextOutput(content)` - 文本输出提取

**依赖分析**:
- 纯函数，无外部依赖

**下沉步骤**:
```bash
# 1. 复制文件
cp packages/coding-agent/src/core/tools/render-utils.ts \
   custom/src/services/tool-system/render-utils.ts

# 2. 更新原始位置的兼容导入
```

### 2.4 Diff 工具 (edit-diff.ts)

**源位置**: `packages/coding-agent/src/core/tools/edit-diff.ts`

**目标位置**: `custom/src/services/tool-system/edit-diff.ts`

**功能**:
- `fuzzyFindText(text, target)` - 模糊文本查找
- `applyEdits(text, edits)` - 应用编辑
- `generateDiff(original, modified)` - 生成 diff

**依赖分析**:
- 纯函数，无外部依赖

**下沉步骤**:
```bash
# 1. 复制文件
cp packages/coding-agent/src/core/tools/edit-diff.ts \
   custom/src/services/tool-system/edit-diff.ts

# 2. 更新原始位置的兼容导入
```

### 2.5 输出累积 (output-accumulator.ts)

**源位置**: `packages/coding-agent/src/core/tools/output-accumulator.ts`

**目标位置**: `custom/src/services/tool-system/output-accumulator.ts`

**功能**:
- `OutputAccumulator` 类 - 流式输出累积
- 增量追加 buffer
- 滑动窗口尾部保留
- 超限自动落盘

**依赖分析**:
- 依赖 Node.js `fs` 和 `path`
- 无外部依赖

**下沉步骤**:
```bash
# 1. 复制文件
cp packages/coding-agent/src/core/tools/output-accumulator.ts \
   custom/src/services/tool-system/output-accumulator.ts

# 2. 更新原始位置的兼容导入
```

### 2.6 文件变更队列 (file-mutation-queue.ts)

**源位置**: `packages/coding-agent/src/core/tools/file-mutation-queue.ts`

**目标位置**: `custom/src/services/tool-system/file-mutation-queue.ts`

**功能**:
- `FileMutationQueue` 类 - 文件变更串行化
- 同一文件的写/编辑操作串行执行
- 不同文件并行执行

**依赖分析**:
- 纯并发控制逻辑
- 无外部依赖

**下沉步骤**:
```bash
# 1. 复制文件
cp packages/coding-agent/src/core/tools/file-mutation-queue.ts \
   custom/src/services/tool-system/file-mutation-queue.ts

# 2. 更新原始位置的兼容导入
```

### 2.7 工具分层 (tool-layering.ts)

**源位置**: 
- `custom/extensions/pi-context/tool-groups.ts`
- `custom/extensions/pi-context/tool-registrations.ts`

**目标位置**: `custom/src/services/tool-system/tool-layering.ts`

**功能**:
- `CORE_TOOLS` - 核心常驻工具列表
- `SLEEPING_GROUPS` - 休眠组配置
- `computeActiveTools()` - 计算活跃工具集

**依赖分析**:
- 纯配置和计算逻辑
- 无外部依赖

**下沉步骤**:
```bash
# 1. 提取纯逻辑
# 从 tool-groups.ts 提取 CORE_TOOLS 和 SLEEPING_GROUPS
# 从 tool-registrations.ts 提取 computeActiveTools

# 2. 创建 tool-layering.ts
# 合并上述逻辑

# 3. 更新 pi-context 的导入路径
```

## 3. 实施流程

### 3.1 Phase 2.1-2.7: 复制文件

```bash
# 创建目录
mkdir -p custom/src/services/tool-system

# 复制文件
cp packages/coding-agent/src/core/tools/truncate.ts \
   custom/src/services/tool-system/

cp packages/coding-agent/src/core/tools/path-utils.ts \
   custom/src/services/tool-system/

cp packages/coding-agent/src/core/tools/render-utils.ts \
   custom/src/services/tool-system/

cp packages/coding-agent/src/core/tools/edit-diff.ts \
   custom/src/services/tool-system/

cp packages/coding-agent/src/core/tools/output-accumulator.ts \
   custom/src/services/tool-system/

cp packages/coding-agent/src/core/tools/file-mutation-queue.ts \
   custom/src/services/tool-system/
```

### 3.2 Phase 2.8: 提取工具分层

```bash
# 从 pi-context 提取工具分层逻辑
# 1. 分析 tool-groups.ts 和 tool-registrations.ts
# 2. 提取纯逻辑到 tool-layering.ts
# 3. 更新 pi-context 的导入路径
```

### 3.3 Phase 2.9: 创建索引文件

```typescript
// custom/src/services/tool-system/index.ts
export { truncateHead, truncateTail, truncateLine } from './truncation'
export { expandTilde, resolveRelative, matchMacOSVariant } from './path-utils'
export { shortenPath, replaceTabs, getTextOutput } from './render-utils'
export { fuzzyFindText, applyEdits, generateDiff } from './edit-diff'
export { OutputAccumulator } from './output-accumulator'
export { FileMutationQueue } from './file-mutation-queue'
export { CORE_TOOLS, SLEEPING_GROUPS, computeActiveTools } from './tool-layering'
```

### 3.4 Phase 2.10: 更新兼容导入

```typescript
// packages/coding-agent/src/core/tools/truncate.ts
// 兼容导入：转发到下沉的服务
export { truncateHead, truncateTail, truncateLine } from '@my-pi/custom/services/tool-system'

// packages/coding-agent/src/core/tools/path-utils.ts
export { expandTilde, resolveRelative, matchMacOSVariant } from '@my-pi/custom/services/tool-system'

// ... 其他文件类似
```

### 3.5 Phase 2.11: 更新扩展导入路径

```typescript
// custom/extensions/pi-context/tool-lifecycle.ts
// 修改前：
import { truncateHead } from '../../core/tools/truncate'

// 修改后：
import { truncateHead } from '../../services/tool-system/truncation'
```

## 4. 测试策略

### 4.1 单元测试

```typescript
// custom/tests/unit/tool-system/truncation.test.ts
import { describe, it, expect } from 'vitest'
import { truncateHead, truncateTail, truncateLine } from '../../../src/services/tool-system/truncation'

describe('truncation', () => {
  it('truncateHead', () => {
    const text = 'line1\nline2\nline3\nline4\nline5'
    expect(truncateHead(text, 3)).toBe('line1\nline2\nline3')
  })

  it('truncateTail', () => {
    const text = 'line1\nline2\nline3\nline4\nline5'
    expect(truncateTail(text, 3)).toBe('line3\nline4\nline5')
  })

  it('truncateLine', () => {
    const text = 'a'.repeat(1000)
    expect(truncateLine(text, 100).length).toBeLessThanOrEqual(100)
  })
})
```

### 4.2 集成测试

```typescript
// custom/tests/integration/adapters/tool-adapter.test.ts
import { describe, it, expect } from 'vitest'
import { createToolAdapter } from '../../../src/adapters/tools/tool-adapter'

describe('tool-adapter', () => {
  it('createToolAdapter', () => {
    const mockPi = { tool: vi.fn() }
    const adapter = createToolAdapter(mockPi)
    expect(adapter).toBeDefined()
  })
})
```

## 5. 风险与缓解

### 5.1 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 下沉文件依赖其他模块 | 中 | 检查依赖，必要时一并下沉 |
| 兼容导入路径错误 | 低 | 逐步测试，确保向后兼容 |
| 扩展导入路径更新遗漏 | 中 | 使用 grep 搜索所有导入 |

### 5.2 回滚方案

如果下沉失败：
1. 恢复原始文件
2. 删除下沉的服务文件
3. 更新导入路径回原始位置

## 6. 完成标准

- [ ] 所有工具系统服务下沉完成
- [ ] 原始位置的兼容导入正常工作
- [ ] 扩展导入路径更新完成
- [ ] TypeScript 编译通过
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 文档编写完成
