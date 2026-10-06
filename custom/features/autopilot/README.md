# autopilot — 自主运行

定时任务调度 + 自主运行 + 失败自愈（模型 failover / 预算 / 看门狗 / 验证器 / 会话管理）。

## 注册面

- 工具：`autopilot_status`、`autopilot_stats`、`autopilot_failover`、`autopilot_policy`、`schedule_task`、`verify_report`、`verify_config`、`verify_test`、`admin_status`、`admin_get_config`、`admin_set_config`、`admin_list_sessions`、`admin_switch_session`、`admin_restart`、`admin_list_models`、`admin_set_model`（16 个，见 [tools/README.md](tools/README.md)）
- 命令：`/auto <status|stats|metrics|policy|failover|pause|resume|help>`、`/schedule <list|run|loop|remind|cron|edit|delete|enable|disable|preview|history|help>`、`/daily <list|run|show|on|off|help>`（默认概览）
- 钩子：`session_start`、`session_shutdown`、`turn_start`、`turn_end`、`input`、`agent_settled`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令/钩子；命令输出与 pending 任务启动 |
| `logic.ts` | 纯逻辑 barrel |
| `types.ts` | 类型与默认配置（`defaultAutopilotConfig`） |
| `daily.ts` | `/daily` 的纯渲染逻辑（筛选/概览/详情，零 Pi 依赖），见下方「每日任务视图」 |
| `completions.ts` | 命令参数补全纯逻辑（任务名前缀、`edit` 字段），单测见 `__tests__/completions.test.ts` |
| `store/` | 任务存储/配置/策略/预算/遥测/会话/通知/种子，见 [store/README.md](store/README.md) |
| `run/` | 执行/看门狗/验证器，见 [run/README.md](run/README.md) |
| `tools/` | 工具组（策略/状态/配置/会话/模型、`schedule_task`、`verify_*`），见 [tools/README.md](tools/README.md) |

## 每日任务视图（`/daily`）

「每日任务」= `tasks.json` 中 `tags` 含 `daily` 的任务（种子在 `portable/agent/scheduled-seeds.json`
里统一打标；跨设备对账后本地 tasks.json 保留该标签）。一个 daily 标签都没有时**降级显示全部调度任务**
并在标题里写明——否则用户自建的 cron 任务会在 `/daily` 里凭空消失。

| 命令 | 输出 |
|------|------|
| `/daily` | 概览：任务数/启停 + 今日完成·待跑·失败 + 每条一行（时间/上次结果与耗时/下次/成败计数），末尾附「上次失败的任务」提示 |
| `/daily list` | 只逐条列出，不折叠 |
| `/daily run <名\|all>` | 立即执行（后台，完成后通知；忽略调度时间、`enabled` 与每日预算，仍记账） |
| `/daily show <名>` | 详情：调度与下次（含相对时间）、统计（成功/连续失败/重试/超时/标签）、最近 5 次执行、提示词摘要 |
| `/daily on\|off <名\|all>` | 启停（`all` = 全部每日任务） |
| `/daily help` | 用法 |

口径与约定：

- 「今日完成/失败」按 `lastRun` 的**本地日期**判定，与 cron 的自然日语义一致；昨天的成功不计入今天。
- cron 只在形如 `M H * * *` 时显示为 `HH:MM`，含步进/区间/星期限定时**原样显示表达式**
  （`cronClock` 返回 null 而非硬猜）。
- `on` 只改 `enabled`，**不重算 `nextRun`**：已错过的触发点会在下一个调度轮次立即补跑
  （与 `/schedule enable` 一致；重算会静默吞掉一次本应补上的执行）。
- `run` 与调度轮次走**同一条**执行/落账/失败策略路径（`runTaskWithPolicy`），差别只有两点：
  忽略调度时间与 `enabled`（显式动作）、跳过每日预算（仍写遥测，计入当日用量）。
  它**不阻塞命令**：后台串行跑完后逐条通知结果与输出预览，结束时给一行汇总。
  手动与定时共用调度锁（`acquireSessionLock`），同一时刻只有一个执行者，正在跑时再触发会提示稍后再试。
- 任务名补全：`/daily show|on|off|run` 与 `/schedule delete|enable|disable|history|run` 在第二段
  按 `tasks.json` 的任务名/ID 前缀补全（已禁用任务标注 `[已禁用]`），`/schedule edit` 在名字后再补字段。
  补全项由纯逻辑 `completions.ts` 生成，单测见 `__tests__/completions.test.ts`。
- 渲染是纯函数（`daily.ts`），单测见 `__tests__/daily.test.ts`；命令层只做筛选与派发。

## 数据与配置

| 路径 | 内容 | 覆盖变量 |
|------|------|----------|
| `portable/agent/autopilot/` | 配置 `config.json`、`tasks.json`、`state.json` | `PI_AUTOPILOT_CONFIG`、`PI_ADMIN_STATE_FILE` |
| `portable/memory/scheduler/` | `telemetry.json`、`verifier.jsonl`+`verifier-summary.json`、执行日志、`results-<device>.jsonl` | `PI_DAILY_RESULTS_DIR`、`PI_NOTIFY_SEEN` |

环境变量：`PI_DEVICE_ID`、`PI_SESSION_FILE`、`PI_MEMORY_DIR`。

## 关键机制

- 调度：内置 5 字段 cron 解析（不引入第三方），`computeNextRun`/`parseIntervalToMs`/`parseRelativeTime`。
- 执行环境边界（重要）：任务由 `run/runner.ts` 的 `buildRunArgs` 以 `--mode json -p --no-session --no-extensions` 运行
  ——**不加载任何扩展**，因此任务提示词里不能引用扩展工具或斜杠命令（`memory_store`、`/memory`、`tmux_*` …），
  只能调 `scripts/` 下的脚本。此约束由 `scripts/check-seeds-headless.mjs` 守门（golden 步骤 11）。
  原因：带扩展的 `-p` 一次性运行在本环境产出回复后不退出（实测 60s 超时 vs 无扩展 25s 干净退出）。
- 提示词入口：headless 写入记忆用 `bash scripts/run-ts.sh scripts/memory-store.mjs`（`custom/` 用无扩展名导入，需 tsx 解析）。
- 种子对账是**只补缺失、不覆盖**：改 `scheduled-seeds.json` 的提示词后，已注册任务需
  `node scripts/reseed-seeds.mjs --apply` 显式应用（保留 id/enabled/lastRun/runCount/history）。
- 策略：`decide`/`checkBudget`/`planFailover`/`executeFailover`（模型 failover、预算上限、错误分类）。
- 自愈：看门狗 `watchdog.ts`（空闲/挂起判定 → 请求重启），supervisor 消费 `state.json`。
- admin 工具写 `state.json`，由 `scripts/pi-supervisor.sh` 在退出时执行重启/切会话；
  重启参数经 `PENDING_ARGS` 跨轮传递（每轮开头的 `EXTRA_ARGS` 重置会吞掉直接写入的值），
  映射逻辑是纯函数 `build_admin_args`（`scripts/test-supervisor.sh` 有单测 + stub CLI 端到端回归）。
- 重启通知：`session_start` 消费 `consumeRestartLog()` 并以 `ctx.ui.notify` + `sendUserMessage`
  注入"系统已重启。操作/原因"，仅交互会话消费（headless `-p` 子进程会先吃掉 restartLog）。
  写入端保留在 `restartLog` 字段，supervisor 只清 `action`——两边都不可省。
  - **消费只清 `restartLog`，绝不动 `action`**（2026-10-06 修）：`action` 的消费者只有 supervisor
    （`clear_admin_action`）。旧实现顺手把 `action` 清成 `none`，于是同一轮 `session_start` 里
    mode 刚写下的自愈重启请求被通知消费取消 → supervisor 直接退出（用户看到"注入了系统已重启、
    进程却退出、模式没换"）。
  - **`notice:'mode'` 的日志让位**：模式切换的通知由 mode 功能在**新模式进程**里按模式生成
    （要说清人设/功能面/记忆命名空间），这里 `isModeOwnedNotice()` 命中时既不注入也不消费。

## 相关

- store 子包：[store/README.md](store/README.md)
- run 子包：[run/README.md](run/README.md)
- 工具组：[tools/README.md](tools/README.md)
- 自愈外壳：[../../../scripts/README.md](../../../scripts/README.md)（`pi-supervisor.sh`）
