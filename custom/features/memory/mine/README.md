# memory/mine — 治理与教训挖掘

记忆生命周期分析（淘汰/升格/冲突候选）与从干预快照挖掘可沉淀的教训。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `lifecycle.ts` | 只读生命周期报告 | `analyzeLifecycle`、`formatLifecycleReport` |
| `lesson-miner.ts` | 从 `interventions.jsonl` 挖掘教训（只读；`--ingest` 才入库） | `mineLessons`、`candidateToEntry`、`formatLessonReport`、`readInterventionRecords` |

## 约定

- 默认**只读**：`mineLessons` 只产出候选，`/memory mine --ingest` 才经 `store/storeEntry` 入库（自动去重）。
- 教训内容做截断（`core/text.truncateChars`），并计算 `computeContentHash` 去重。

## 数据来源

只读 `portable/memory/interventions.jsonl`（`PI_INTERVENTIONS_FILE` 覆盖），与 `intervention` 功能按数据文件解耦。

## 相关

- 上层：[../README.md](../README.md)
- 存储：[../store/README.md](../store/README.md)
