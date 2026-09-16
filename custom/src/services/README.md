# custom/src/services/ — 下沉服务

从 pi 上游下沉的纯函数服务，可独立修改和测试。

## 文件结构

| 文件/目录 | 用途 |
|-----------|------|
| index.ts | 统一导出 |

### tool-system/ — 工具系统服务

| 文件 | 用途 |
|------|------|
| truncate.ts | 输出截断 |
| path-utils.ts | 路径解析 |
| render-utils.ts | 渲染工具 |
| edit-diff.ts | Diff 工具 |
| output-accumulator.ts | 输出累积 |
| file-mutation-queue.ts | 文件变更队列 |
| tool-layering.ts | 工具分层 |

### session/ — 会话管理服务

| 文件 | 用途 |
|------|------|
| session-stats.ts | 会话统计 |
| context-usage.ts | 上下文用量 |
| session-export.ts | 会话导出 |
| session-discovery.ts | 会话发现 |
| session-log-bridge.ts | 日志桥接 |

### token-budget/ — Token 预算服务

| 文件 | 用途 |
|------|------|
| prune.ts | 输出擦除 |
| context-budget.ts | 上下文预算 |
| auto-compact.ts | 自动压缩 |

## Related

- [adapters/](../adapters/README.md)
- [.pi/services/](../../.pi/services/README.md)
- [SESSION-MANAGEMENT-SINKING](../../custom/docs/SESSION-MANAGEMENT-SINKING.md)
