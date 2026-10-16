# 被否提案：[2026-10-16] ✗ 不采用：把 my-pi 的 subagent 工具改名保留（如 mypi_subagent）

**来源**：`docs/CHANGES.jsonl` 的 rejected 条目（2026-10-16；抽取自 `DECISIONS.md`）。

**是什么**
[2026-10-16] ✗ 不采用：把 my-pi 的 subagent 工具改名保留（如 mypi_subagent）

**根因（WHY）**
为什么被否：**理由（不采用）**：不采用：它在 DSH 底座上是跨运行时 spawn pi 子进程，且 context:fork 在 DSH 上已静默降级；宿主原生 subagent 是同进程 spawn/fork 且自带 steer/cancel/list ⇒ 让位更优，my-pi 独有 5 项登记为待重设计。

**确切命令序列**（复现/回归都靠它）
未记录（该提案**未被实施** ⇒ 没有可复现的命令序列；**不编造**）

**怎么发现它（指纹）**
由 `gen-changes-ledger.mjs` 从决策台账抽出的**负结果**条目（判据第 ② 条：成功与失败都记）。

**含确切语法的解法**
未记录（该提案被否、未实施，也没有留下证据指针）
