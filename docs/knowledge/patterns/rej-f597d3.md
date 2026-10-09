# 被否提案：[2026-09-22] 不迁移 auto-compact 控制器与 task-summarizer 流水线（口径）

**来源**：`docs/CHANGES.jsonl` 的 rejected 条目（2026-09-22；抽取自 `DECISIONS.md`）。

**是什么**
[2026-09-22] 不迁移 auto-compact 控制器与 task-summarizer 流水线（口径）

**根因（WHY）**
为什么被否：**背景**：pi-tools `pi-context/auto-compact-controller.ts` 与 `task-summarizer.mjs` 依赖 `.usage-diag.jsonl`、task-record、thinking-level、warm-prefix、prune-dump 等一整条未迁移的数据/编排链。

**确切命令序列**（复现/回归都靠它）
未记录（该提案**未被实施** ⇒ 没有可复现的命令序列；**不编造**）

**怎么发现它（指纹）**
由 `gen-changes-ledger.mjs` 从决策台账抽出的**负结果**条目（判据第 ② 条：成功与失败都记）。

**含确切语法的解法**
未记录（该提案被否、未实施，也没有留下证据指针）
