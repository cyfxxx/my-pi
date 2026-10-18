# 被否提案：[2026-10-16] ✗ 不采用：部署方案：用 profile 级 pnpm.overrides 把 pi 包 specifier 别名到本仓 shim

**来源**：`docs/CHANGES.jsonl` 的 rejected 条目（2026-10-16；抽取自 `DECISIONS.md`）。

**是什么**
[2026-10-16] ✗ 不采用：部署方案：用 profile 级 pnpm.overrides 把 pi 包 specifier 别名到本仓 shim

**根因（WHY）**
为什么被否：**理由（不采用）**：dsh/plugin/package.json 的 files 只发 dist+README，shim 根本不在分发包里 ⇒ 真 profile 装出来解析不到；改为构建期 esbuild --alias 把 shim 打进产物（自包含）。

**确切命令序列**（复现/回归都靠它）
未记录（该提案**未被实施** ⇒ 没有可复现的命令序列；**不编造**）

**怎么发现它（指纹）**
由 `gen-changes-ledger.mjs` 从决策台账抽出的**负结果**条目（判据第 ② 条：成功与失败都记）。

**含确切语法的解法**
未记录（该提案被否、未实施，也没有留下证据指针）
