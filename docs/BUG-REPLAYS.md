# BUG-REPLAYS — 事故 → 复现 → 守门台账

本文件是**使用层面故障**（"代码检查全绿、用起来才炸"）的台账：每条事故记录
**指纹**（怎么发现它）、**复现方式**（可执行的命令/场景）、以及**现在由谁挡住**。
目的是把"实际使用中发现"的一次性成本沉淀成可重复执行的检查——下次同类问题应当由自动化先报，
而不是再靠运气撞上。

约定：新增一行时，**必须**给出可执行命令（不能是"注意一下"）。
`scripts/test-scenario-mode-restart.mjs` 这类慢检查默认不进 pre-push（见
[`scripts/README.md`](../scripts/README.md) 的说明），需要时显式开启。

## 通用排查入口（先看这三处）

| 入口 | 命令 | 看什么 |
|------|------|--------|
| 状态体检 | `node scripts/state-audit.mjs`（或 `bash scripts/doctor.sh`，第 [12] 节） | 配置与运行时状态自相矛盾：人设文件丢失、功能名拼错、会话记录指向不存在的会话、重启请求没落地、通知没被消费、env 硬覆盖按会话模式 |
| 轮次记录 | `portable/agent/recovery/rounds.jsonl`（每轮一行）+ `portable/agent/recovery/rounds/round-N.log` | 上一次/上几次进程为什么退出、读到什么 admin action、用什么参数重启、是否 `lostRestart` |
| 每日体检 | `node scripts/daily-health.mjs --print` | 成本退化与状态异常（每天由 autopilot 种子自动跑；`结论=alert` 说明有 error 级状态问题） |

## 台账

| # | 事故（现象） | 指纹（怎么认出来） | 复现（可执行） | 现在由谁挡住 |
|---|---|---|---|---|
| 1 | 切了模式、重启后没生效：`modes.json` 里的全局 `current` 被任何 git 操作（checkout/stash/pull）静默退回 `full` | `git status` 后模式变了；`modes.json` 里出现 `current` 字段 | `node scripts/state-audit.mjs` → `modes-legacy-current`（info）；`bash scripts/check-conventions.sh`（运行时状态不入库） | `check-conventions`（状态不入库）+ 状态体检 `modes-legacy-current`；模式状态已迁到 gitignored 的 `modes-sessions.json` |
| 2 | 模式解析"第 3 轮工厂执行后漂回 full"：`PI_AGENT_MODE_SOURCE` 从 `file` 被翻成 `env`，此后把首轮值当外部注入钉死 | 同一进程内多轮工厂执行（/reload、/new、会话切换）后模式与磁盘不一致 | `npx vitest run custom/features/mode/__tests__/mode-switch.test.ts -t '多轮工厂执行不漂移'` | `mode-switch.test.ts` 的三轮回归 + `resolveStartupMode()` 单一写入点 |
| 3 | 切模式/切回角色扮演会话时**进程直接退出**、模式没换、还注入了一条"系统已重启"（重启其实没发生） | 会话文件里有 `系统已重启` 注入但**后面没有 assistant 回复**；`rounds.jsonl` 里 `lostRestart: true`；终端留下未读的 OSC/DA1 应答乱码 | `bash scripts/test-supervisor.sh`（含 stub CLI 复刻该时序的端到端用例）；`PI_SCENARIO_KEEP=1 node scripts/test-scenario-mode-restart.mjs` | ① `consumeRestartLog()` 只清 `restartLog` 不动 `action`（跨 TS/bash 契约测试）；② supervisor 的 `lost_restart` 实时检测 + `rounds.jsonl`；③ 真 pty 场景；④ 状态体检 `restart-request-stale` / `notice-undelivered` |
| 4 | 重启后**白跑一个模型回合**：没有在途任务（切模式/换模型/切会话）也被"请继续"唤醒，实测还会让模型凭空开工 | 会话文件在重启后多出 user/assistant 条目；`daily-health` 里冷启动与未命中异常 | `npx vitest run custom/core/__tests__/restart-intent.test.ts`；真 pty 场景的"切模式零回合"断言（`PI_GOLDEN_SCENARIO=1 node scripts/test-scenario-mode-restart.mjs`） | `custom/core/restart-intent.ts`（意图 → 盘面尾部 → `PI_RESTART_RESUME`）+ 两条注入通道 + 接线测试 + 场景断言 |
| 5 | 入口漂移：`dev.sh` 不注入人设（supervisor 注入了），人设文件缺失时**静默**不注入 | 同一模式在 dev 与 my-pi.sh 下行为不同；人设文件被改名/删除 | `node scripts/state-audit.mjs` → `mode-persona-missing`（error）；`bash scripts/test-supervisor.sh` 的人设注入用例 | 状态体检 `mode-persona-missing`（error，daily-health 会 alert）+ `lib-mode.sh` 共用解析 |
| 6 | 重启后**没有任何提示**：`restartLog` 写了但没人读（消费端缺失） | 重启后模型完全不知道环境变了，继续用旧工具/旧假设 | `npx vitest run custom/features/autopilot/__tests__/restart-log.test.ts` | 消费端契约测试 + `rounds.jsonl` 的 `decision`/`adminAction` 字段 |
| 7 | 功能名拼错（如 `websearch`）→ 该功能静默不注册，模式看起来"没生效" | 该模式下少了预期工具，但没有任何报错 | `node scripts/state-audit.mjs` → `mode-feature-unknown`（error） | 状态体检 `mode-feature-unknown` + 三处真值不漂移守门（功能名 ↔ `ALL_FEATURES` ↔ 注册面基线） |

## 相关

- 设计与取舍：[`DECISIONS.md`](../DECISIONS.md) 的"使用层面错误的检测与预防"与"重启后要不要继续执行任务"两条
- 脚本索引与运行成本：[`scripts/README.md`](../scripts/README.md)
- 系统化排障流程：[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
