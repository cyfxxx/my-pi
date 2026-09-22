# memory/store — 记忆存储

记忆条目/摘要/笔记的持久化与治理操作（落 `portable/memory/`）。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `types.ts` | 类型定义（条目/摘要/笔记/分类） | 类型 |
| `storage.ts` | 存储读写、条目操作、Token 化与相似度、统计 | `loadEntries`/`saveEntries`/`activeEntries`、`storeEntry`、`deleteEntry`、`pruneEntries`、`autoReclaim`、`getStats`、`computeContentHash`、`tokenize`、`jaccardSimilarity`、`mergeEnvironments`、`updateNotes`/`loadNotes`/`saveNotes` |
| `merge.ts` | 冲突检测与合并决策 | `detectContradiction`、`decideMerge`、`mergeCandidates`、`similarity`、`resolveAndApply` |
| `summary.ts` | 会话摘要构建 | `buildSummaryEntry`、`firstSummaryLine` |

## 数据落点

`entries.json`、`summaries.json`、`notes.json`（`PI_MEMORY_DIR` 覆盖根目录）；写入经 `core/atomic-write`。

## 约定

- 读损坏文件时按策略备份（`SyntaxError` 才 rename 备份），其余静默回退默认。
- 条目按环境可见性（`../env.ts` 的 `isEnvVisible`）过滤。

## 相关

- 上层：[../README.md](../README.md)
- 检索：[../recall/README.md](../recall/README.md)
- 治理/挖掘：[../mine/README.md](../mine/README.md)
