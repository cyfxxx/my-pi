# 每日任务标准 prompt（my-pi 现状 + pi-tools 原文归档）

> **my-pi 现状（权威）**：每日任务的提示词定义在 **`portable/agent/scheduled-seeds.json`**
> （任务 `knowledge-subscribe` 与 `daily-review`），随仓库分发出厂；本文件不再作为分发入口。
> 下节「历史原文」是 pi-tools 时代的 v3 文本，**路径与工具面已过时**，仅作追溯，勿直接套用。

## my-pi 现状要点

- **执行环境**：autopilot 任务以 `--mode json -p --no-session --no-extensions` 运行，
  **不加载扩展** → 提示词只能调 `bash`/`read`/`write` 与 `scripts/` 下的脚本，不能用 `memory_store`、
  `memory_search`、`memory_forget`、`/memory` 等扩展工具与命令（守门：`scripts/check-seeds-headless.mjs`）。
- **入库**：`bash scripts/run-ts.sh scripts/memory-store.mjs --json '<条目JSON数组>'`（零 LLM，内置去重）；
  知识订阅走 `bash scripts/run-ts.sh scripts/knowledge-ingest.mjs <md> 5 --keywords <关键词>`。
- **路径**：仓库根即 `my-pi/`（不再有 `~/.pi`）；知识落 `portable/memory/knowledge/`，
  任务结果落 `portable/memory/daily-results/`，记忆落 `portable/memory/`（`entries.json`/`summaries.json`）。
- **下发方式**：改种子后需显式应用 —— `node scripts/reseed-seeds.mjs --apply`（保留 id/enabled/lastRun/runCount/history）。
  各设备的 `portable/memory/scheduler/tasks.json` 是运行时状态，不入库。

## 历史原文（pi-tools v3，2026-08-28，路径为 pi-tools 布局）

多设备竞态容忍架构：各设备同时执行也无害。主流程靠查重防"先后重复"；竞态产生的"同时重复"由 daily-review 交叉比对兜底清理（冗余措施），最终一致。

### daily-task（cron 0 8 * * *，原 knowledge-subscribe 更名）

```text
执行每日统一任务（拉取→检查→订阅→报告）：1) cd ~/.pi && git pull --rebase 拉取远程更新；entries.json 冲突按三方比对流程处理（比对条目数/recurrence/时间戳，验证本地为远端真子集才放行）。2) 日常检查（只读快速）：df -h /、free -m、uptime、pi 进程数、memory_stats 记忆库条目总数。3) 跨设备查重：entries.json 当天({{date}})已有 tags 含 knowledge+订阅 的条目→说明其他设备已完成订阅，跳过步骤4，报告注明。4) 知识订阅：python3 scripts/knowledge-fetch.py；有新增筛 3-5 条高价值条目 memory_store，写 ~/.pi/logs/knowledge/summary-{{date}}.md；无新增如实说明。渠道维护/触发排查用 packs/knowledge-fetch 技能。5) 汇总报告：写 memory/daily-results/{{date}}-<本机hostname>.md（检查结果+订阅执行/跳过+要点，200字内），git add 该文件与 entries.json 后 commit+push；推送冲突→git pull --rebase 三方比对后重试，仍失败则在报告注明即可（重复条目由 daily-review 兜底清理）。
```

### daily-review（cron 5 9 * * *）

```text
执行每日回顾（含交叉比对兜底）：1) cd ~/.pi && git pull --rebase 同步远端（entries.json 冲突按三方比对流程处理）。2) 读 memory/daily-results/ 全部设备当日结果，对比各设备执行情况，识别遗漏与信息不对称。3) 冗余兜底——交叉比对当日订阅条目：entries.json 中同主题/同事件/同 URL 出现多设备重复入库时，保留信息更完整的一条，多余条目 memory_forget 删除。4) 回顾过去 24h 会话摘要有价值经验，提炼 1-3 条 memory_store。5) 回顾结论（200字内，含兜底清理结果）写入 memory/daily-results/{{date}}-<本机hostname>.md，git add+commit+push（冲突先 pull --rebase）；其他设备长期未跑需明确指出。
```

### 历史下发方式（pi-tools）

编辑 `agent/extensions/pi-autopilot/scheduled-tasks.json`：改名 + 替换 prompt；改后无需重启，scheduler 下轮读取生效。
