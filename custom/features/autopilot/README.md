# autopilot — 自主运行

定时任务调度 + 自主运行 + 失败自愈（模型 failover / 预算 / 看门狗 / 验证器 / 会话管理）。

## 注册面

- 工具：`autopilot_status`、`autopilot_stats`、`autopilot_failover`、`autopilot_policy`、`schedule_task`、`verify_report`、`verify_config`、`verify_test`、`admin_status`、`admin_get_config`、`admin_set_config`、`admin_list_sessions`、`admin_switch_session`、`admin_restart`、`admin_list_models`、`admin_set_model`（16 个，见 [tools/README.md](tools/README.md)）
- 命令：`/auto <status|stats|metrics|policy|failover|pause|resume|help>`、`/schedule <list|loop|remind|cron|edit|delete|enable|disable|preview|history|help>`
- 钩子：`session_start`、`session_shutdown`、`turn_start`、`turn_end`、`input`、`agent_settled`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令/钩子；命令输出与 pending 任务启动 |
| `logic.ts` | 纯逻辑 barrel |
| `types.ts` | 类型与默认配置（`defaultAutopilotConfig`） |
| `store/` | 任务存储/配置/策略/预算/遥测/会话/通知/种子，见 [store/README.md](store/README.md) |
| `run/` | 执行/看门狗/验证器，见 [run/README.md](run/README.md) |
| `tools/` | 工具组（策略/状态/配置/会话/模型、`schedule_task`、`verify_*`），见 [tools/README.md](tools/README.md) |

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

## 相关

- store 子包：[store/README.md](store/README.md)
- run 子包：[run/README.md](run/README.md)
- 工具组：[tools/README.md](tools/README.md)
- 自愈外壳：[../../../scripts/README.md](../../../scripts/README.md)（`pi-supervisor.sh`）
