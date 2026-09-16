# my-pi 项目架构

## 1. 设计哲学

### 1.1 核心原则

| 原则 | 说明 | 实施方式 |
|------|------|----------|
| **上游隔离** | packages/ 保持纯净，只从 pi 上游同步 | 只读同步 + 补丁管理 |
| **自定义分层** | custom/ 作为独立层，通过适配器与 pi 交互 | adapters/ 层隔离变化 |
| **依赖单向** | custom → adapter → packages（不反向） | 严格的导入规则 |
| **补丁管理** | 必须修改 packages/ 时，用补丁追踪 | patches/ 目录 + 版本控制 |

### 1.2 架构层次

```
┌─────────────────────────────────────────────────┐
│              .pi/extensions/                     │
│     (业务逻辑，频繁修改)                         │
│     - pi-context: 上下文管理                     │
│     - pi-memory: 记忆系统                        │
│     - pi-web-search: 网页搜索                    │
│     - pi-autopilot: 自动驾驶                     │
│     - pi-voice: 语音功能                         │
└──────────────────────┬──────────────────────────┘
                       │ 只依赖 adapters/
┌──────────────────────▼──────────────────────────┐
│              custom/src/adapters/                │
│     (适配层，中等频率修改)                        │
│     - 隔离 pi API 变化                           │
│     - 提供稳定的接口                             │
│     - 细粒度：每个功能一个 adapter                │
└──────────────────────┬──────────────────────────┘
                       │ 只依赖 services/
┌──────────────────────▼──────────────────────────┐
│              custom/src/services/                │
│     (可独立修改的纯函数)                          │
│     - tool-system: 工具系统服务                   │
│     - session: 会话管理服务                       │
│     - token-budget: Token 预算服务                │
└──────────────────────┬──────────────────────────┘
                       │ 不依赖（只重导出）
┌──────────────────────▼──────────────────────────┐
│              packages/ (只读)                    │
│     (上游同步，补丁管理)                          │
│     - ai: AI 核心库                              │
│     - agent: Agent 核心                          │
│     - coding-agent: 编码代理                     │
│     - protocol: 协议定义                         │
└─────────────────────────────────────────────────┘
```

## 2. 包依赖分析

### 2.1 pi 上游包依赖图

```
telemetry (叶子包)
├── ai (依赖 telemetry)
├── protocol (叶子包)
├── chord (叶子包)
├── tui (叶子包)
├── agent (依赖 ai, telemetry)
├── client (依赖 protocol, chord)
├── server (依赖 agent, protocol)
└── coding-agent (依赖 agent, ai, tui)
```

### 2.2 自定义层依赖规则

```
extensions/ → adapters/ → services/ → packages/
     ↑           ↑           ↑           ↑
     │           │           │           │
  业务逻辑    接口隔离    纯函数    上游实现
```

**禁止的依赖**：
- ❌ extensions/ 直接导入 packages/
- ❌ services/ 导入 adapters/
- ❌ adapters/ 导入 extensions/
- ❌ packages/ 导入 custom/

## 3. 适配器层设计

### 3.1 设计目标

- 隔离 pi API 变化
- 提供稳定的接口
- 支持细粒度适配（每个功能一个 adapter）

### 3.2 Adapter 分类

| Adapter | 职责 | 修改频率 |
|---------|------|----------|
| `api.ts` | ExtensionAPI 适配 | 低 |
| `tools/tool-adapter.ts` | 工具注册适配 | 中 |
| `tools/interceptor.ts` | 工具拦截适配 | 中 |
| `tools/layering.ts` | 工具分层适配 | 中 |
| `session/session-adapter.ts` | 会话管理适配 | 中 |
| `session/export-adapter.ts` | 会话导出适配 | 低 |

### 3.3 Adapter 接口规范

```typescript
// 每个 adapter 必须遵循的模式
export interface XxxAdapter {
  // 稳定的接口定义
}

export function createXxxAdapter(pi: ExtensionAPI): XxxAdapter {
  // 创建适配器实例
  return {
    // 实现接口
  }
}
```

## 4. 服务下沉设计

### 4.1 下沉原则

1. **纯函数优先**：只做数据转换，无副作用
2. **无外部依赖**：仅依赖 Node.js 原生 API
3. **可独立测试**：不依赖 pi 运行时
4. **接口稳定**：下沉后接口保持稳定

### 4.2 下沉清单

#### 工具系统服务

| 功能 | 源位置 | 目标位置 |
|------|--------|----------|
| 输出截断 | `core/tools/truncate.ts` | `services/tool-system/truncation.ts` |
| 路径解析 | `core/tools/path-utils.ts` | `services/tool-system/path-utils.ts` |
| 渲染工具 | `core/tools/render-utils.ts` | `services/tool-system/render-utils.ts` |
| Diff 工具 | `core/tools/edit-diff.ts` | `services/tool-system/edit-diff.ts` |
| 输出累积 | `core/tools/output-accumulator.ts` | `services/tool-system/output-accumulator.ts` |
| 文件变更队列 | `core/tools/file-mutation-queue.ts` | `services/tool-system/file-mutation-queue.ts` |
| 工具分层 | `pi-context/tool-groups.ts` | `services/tool-system/tool-layering.ts` |

#### 会话管理服务

| 功能 | 源位置 | 目标位置 |
|------|--------|----------|
| 会话统计 | `agent-session.ts` getSessionStats() | `services/session/session-stats.ts` |
| 上下文用量 | `agent-session.ts` getContextUsage() | `services/session/context-usage.ts` |
| 会话导出 | `agent-session.ts` exportToHtml/Jsonl() | `services/session/session-export.ts` |
| 会话发现 | `session-manager.ts` list/listAll() | `services/session/session-discovery.ts` |
| 日志桥接 | 新建 | `services/session/session-log-bridge.ts` |

#### Token 预算服务

| 功能 | 状态 | 位置 |
|------|------|------|
| 自动压缩 | ✅ 已下沉 | `services/token-budget/auto-compact.ts` |
| 上下文预算 | ✅ 已下沉 | `services/token-budget/context-budget.ts` |
| 输出擦除 | ✅ 已下沉 | `services/token-budget/prune.ts` |

### 4.3 兼容导入机制

下沉后，在原始位置保留兼容导入：

```typescript
// packages/coding-agent/src/core/tools/truncate.ts
// 兼容导入：转发到下沉的服务
export { truncateHead, truncateTail, truncateLine } from '@my-pi/custom/services/tool-system'
```

## 5. 补丁管理设计

### 5.1 补丁目录结构

```
patches/
└── README.md              # 补丁管理说明
```

> 注意：补丁管理机制已就绪，当前尚无实际补丁文件。

### 5.2 补丁命名规范

```
{序号}-{模块}-{功能描述}.patch
```

示例：
- `001-ai-tool-extend.patch`
- `002-session-stats.patch`
- `003-coding-agent-api.patch`

### 5.3 补丁生成流程

```bash
# 1. 修改 packages/ 中的文件
# 2. 生成补丁
git diff packages/ai > patches/001-ai-tool-extend.patch

# 3. 记录原因
cat > patches/001-ai-tool-extend.patch.description << EOF
日期: 2026-09-15
原因: 扩展工具系统，添加自定义工具拦截器
影响: ai/src/auth/helpers.ts
上游状态: 不打算提 PR
EOF
```

### 5.4 补丁应用流程

```bash
# 应用单个补丁
git apply patches/001-ai-tool-extend.patch

# 应用所有补丁
for patch in patches/*.patch; do
    git apply "$patch"
done
```

## 6. 上游同步设计

### 6.1 同步策略

1. **定期同步**：每月检查一次 pi 上游更新
2. **选择性同步**：只同步 packages/ 目录
3. **补丁重放**：同步后重新应用补丁
4. **冲突解决**：手动解决冲突

### 6.2 同步流程

```bash
# scripts/sync-upstream.sh
#!/bin/bash
set -e

echo "=== 从 pi 上游同步 ==="

# 1. 拉取上游
git fetch upstream

# 2. 备份当前 packages/
git stash push -m "backup packages before sync"

# 3. 同步 packages/
git checkout upstream/main -- packages/

# 4. 应用补丁
for patch in patches/*.patch; do
    if [ -f "$patch" ]; then
        echo "应用: $patch"
        git apply --check "$patch" 2>/dev/null && git apply "$patch" || {
            echo "补丁冲突: $patch"
            echo "需要手动解决"
            exit 1
        }
    fi
done

# 5. 重新构建
npm run build:offline

echo "=== 同步完成 ==="
```

## 7. 扩展系统设计

### 7.1 扩展分类

| 类型 | 说明 | 示例 |
|------|------|------|
| **核心扩展** | 必须加载，提供基础功能 | pi-context |
| **可选扩展** | 按需加载，提供增强功能 | pi-memory, pi-web-search |
| **实验扩展** | 测试阶段，可能不稳定 | pi-autopilot |

### 7.2 扩展加载流程

```
1. bootstrap.ts 启动
   ↓
2. 加载配置 (config/)
   ↓
3. 初始化 SeamRegistry (seams/)
   ↓
4. 切换 provider (ai/)
   ↓
5. 增强 API (integration.ts)
   ↓
6. 发现并加载扩展 (extension-loader.ts)
```

### 7.3 扩展接口规范

```typescript
// 每个扩展必须遵循的模式
export default function (pi: AdaptedExtensionAPI): void {
  // 注册工具
  pi.tool({ ... })
  
  // 注册命令
  pi.command({ ... })
  
  // 监听事件
  pi.on('tool_call', handler)
}
```

## 8. 测试策略

### 8.1 测试层次

| 层次 | 说明 | 工具 |
|------|------|------|
| **单元测试** | 测试纯函数 | Vitest |
| **集成测试** | 测试 adapter 和服务 | Vitest |
| **端到端测试** | 测试完整流程 | 手动测试 |

### 8.2 测试目录

```
custom/tests/
├── integration.test.ts     # 集成测试
└── projection.test.ts      # 投影测试
```

## 9. 版本管理

### 9.1 版本号规范

```
{major}.{minor}.{patch}
```

- **major**: 架构重大变更
- **minor**: 功能新增
- **patch**: Bug 修复

### 9.2 变更日志

每个重要变更必须记录在 `CHANGELOG.md` 中：

```markdown
## [0.2.0] - 2026-09-15

### Added
- 添加 adapters/ 适配器层
- 下沉工具系统纯函数到 services/

### Changed
- 更新扩展导入路径

### Fixed
- 修复工具截断逻辑
```

## 10. 长远计划

### 10.1 Phase 1: 架构基础（当前）
- [x] 创建 adapters/ 层
- [ ] 下沉工具系统纯函数
- [ ] 下沉会话管理纯函数

### 10.2 Phase 2: 功能整合
- [ ] 整合 pi-tools 扩展
- [ ] 增强 seams/ 工具消费者
- [ ] 完善测试覆盖

### 10.3 Phase 3: 上游同步
- [ ] 建立补丁管理机制
- [ ] 编写同步脚本
- [ ] 文档化同步流程

### 10.4 Phase 4: 扩展生态
- [ ] 开发更多自定义扩展
- [ ] 建立扩展市场（可选）
- [ ] 社区贡献指南
