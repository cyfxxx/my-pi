# .pi/services — Layer 1 服务层（仅依赖 core）

## 目录结构

```
services/
├── atomic-write.ts   — 原子文件写入（writeJSONAtomic）
├── note-store.ts     — ctx-lite 笔记持久化
├── shadow-review.ts  — 影子代码审查
├── index.ts          — 统一导出
├── diagnostics/      — 诊断服务（usage-diag, task-record）
└── token-budget/     — Token 预算管理
    ├── context-budget.ts
    ├── prune.ts
    ├── auto-compact.ts
    └── output-archive.ts
```

## 文件说明

| 文件/目录 | 用途 |
|-----------|------|
| `atomic-write.ts` | 原子文件写入（writeJSONAtomic） |
| `note-store.ts` | ctx-lite 笔记持久化 |
| `shadow-review.ts` | 影子代码审查 |
| `index.ts` | 统一导出 |
| `diagnostics/` | 诊断服务（usage-diag, task-record） |
| `token-budget/` | Token 预算管理（context-budget, prune, auto-compact, output-archive） |

## 相关链接

- [.pi/ 总览](../README.md)
- [core/](../core/README.md)
- [custom/src/services/](../../custom/src/services/README.md)
