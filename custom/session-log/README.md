# custom/session-log/ — Session Log 实现

会话日志系统，负责记录和查询会话数据。

## 文件

| 文件 | 用途 |
|------|------|
| types.ts | 日志类型定义 |
| jsonl-writer.ts | JSONL 写入器（追加写入，支持原子操作） |
| projection.ts | 投影查询（从日志重建上下文） |
| index.ts | 统一导出 |

## 相关文档

- [.pi/sessions/](../../.pi/sessions/)
- [session-log 缝隙](../seams/session-log/)
- [architecture](../../docs/architecture.md)
