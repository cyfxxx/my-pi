# autopilot — 自主运行

定时任务调度 + 自主运行 + 失败自愈（模型 failover / 预算 / 看门狗 / 验证器 / 会话管理）。

## 注册面

- 工具：`autopilot_status`、`autopilot_stats`、`autopilot_failover`、`admin_list_sessions`、`admin_switch_session`、`admin_restart`
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

## 数据与配置

| 路径 | 内容 | 覆盖变量 |
|------|------|----------|
| `portable/agent/autopilot/` | 配置 `config.json`、`tasks.json`、`state.json` | `PI_AUTOPILOT_CONFIG`、`PI_ADMIN_STATE_FILE` |
| `portable/memory/scheduler/` | `telemetry.json`、`verifier.jsonl`+`verifier-summary.json`、执行日志、`results-<device>.jsonl` | `PI_DAILY_RESULTS_DIR`、`PI_NOTIFY_SEEN` |

环境变量：`PI_DEVICE_ID`、`PI_SESSION_FILE`、`PI_MEMORY_DIR`。

## 关键机制

- 调度：内置 5 字段 cron 解析（不引入第三方），`computeNextRun`/`parseIntervalToMs`/`parseRelativeTime`。
- 策略：`decide`/`checkBudget`/`planFailover`/`executeFailover`（模型 failover、预算上限、错误分类）。
- 自愈：看门狗 `watchdog.ts`（空闲/挂起判定 → 请求重启），supervisor 消费 `state.json`。
- admin 工具写 `state.json`，由 `scripts/pi-supervisor.sh` 在退出时执行重启/切会话。

## 相关

- store 子包：[store/README.md](store/README.md)
- run 子包：[run/README.md](run/README.md)
- 自愈外壳：[../../../scripts/README.md](../../../scripts/README.md)（`pi-supervisor.sh`）
