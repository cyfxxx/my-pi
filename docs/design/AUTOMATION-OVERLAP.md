# 自动化：DSH 原生能力 vs 原项目 autopilot（重叠与缺口）

> 结论：**autopilot 的调度与自主运行两段，DSH 已经原生存了**（`dsh-schedule`、`dsh-goal`），
> 不需要移植；autopilot 真正独有的只剩"失败自愈"那一组（failover / 看门狗 / 验证器 / 预算 / 会话重启），
> 而实测这些工具几乎没被用过（唯一例外是 `admin_restart` 6 次）。所以**不移植 autopilot**，
> 用 DSH 原生 + 我们已有的 launcher/探针兜底。

## 1. DSH 有什么（读代码/README 核实）

| 包 | 能力 | 关键事实 |
|---|---|---|
| `dsh-schedule` | 定时任务：一次性 / 固定间隔 / 每日 / 每周 / **cron** | 工具 `schedule_create/list/update/delete`；到点作为**后续消息投递回原 Session**；Host 重启后仍在；错过只补**最近一次**；删除会连投递记录一起删 |
| `dsh-goal` + `dsh-goal-round-driver` | 长目标跨轮推进 | 目标持久化、跨 turn/resume/fork/进程重启；`pause/resume/complete/block`；**自动续跑轮数上限默认 256**；阻塞带稳定 policy code |
| `dsh-llm-retry` | 失败重试 | 在 agent-step 边界按 `retryPolicy` 做有界/无限重试；**不是换模型**（failover） |
| `dsh-experimental-schedule-bundle` | 把上面三行（time-context/schedule/ui-schedule）插进 Web 组合 | 官方实验 bundle，默认不启 |

## 2. autopilot 有什么（原项目）

- 调度：`schedule_task` + `/schedule`（含 cron/loop/remind/历史）+ `/daily`（**每日任务**视图：标签、种子、今日完成/失败）
- 自主运行：`goal` 工具 + 自动续跑
- 失败自愈：`autopilot_status/policy`（failover、预算、遥测、看门狗、验证器）、`admin_*`（restart/switch/config/set_model/list_sessions）
- 钩子：`session_start/shutdown`、`turn_start/end`、`input`、`agent_settled`

## 3. 重叠矩阵

| 能力 | autopilot | DSH 原生 | 结论 |
|---|---|---|---|
| 一次性/间隔/每日/每周/cron 提醒 | `schedule_task` + `/schedule` | **`schedule_create`** 等 4 个工具 | **完全重叠**，用 DSH |
| 投递到原会话 / 重启后仍在 / 补最近一次 | 有 | **有** | 重叠 |
| 自主推进（长目标续跑） | `goal` | **`dsh-goal` + round-driver**（上限 256） | **完全重叠**，用 DSH |
| 失败重试 | 有（failover 链） | `dsh-llm-retry`（只重试） | 部分重叠；**换模型没有** |
| 每日任务视图（tags/种子/今日统计） | `/daily` | 无（只有任务行 + 投递记录） | 差异，非核心 |
| 模型 failover（换 provider/model） | 有 | **无** | 缺口 |
| 看门狗（卡住检测 + 自动重启） | 有 | **无** | 缺口 |
| 验证器（对结果做校验） | 有 | **无** | 缺口 |
| 每日预算（token/花费上限） | 有 | 无（token-meter 只统计；配额在服务端） | 缺口 |
| 会话管理（restart/switch/set_model/list） | `admin_*` 11 个工具 | 无 agent 面工具（会话管理器是 UI） | 缺口 |

## 4. 实测使用频率（32 会话 / 1512 次工具调用）

| 工具 | 调用 |
|---|---|
| `admin_restart` | **6**（4 个会话） |
| `autopilot_status` / `autopilot_policy` | 0 / 0 |
| `schedule_task` | 0 |
| `admin_status/get_config/set_config/list_sessions/switch_session/list_models/set_model` | 0（全部） |
| `goal`（原项目） | 0 |
| 对照：`todo` 100、`subagent` 11、`tmux_*` 15 | — |

⇒ "失败自愈"这一组**没有使用证据**；唯一的真实需求是**会话重启**（`admin_restart` 6 次），
它在 DSH 里等价于"重启宿主 + 用 `--resume` 接回会话"，我们已经能用 launcher 的 `stop/start` 做到。

## 5. 决定

1. **不移植 autopilot**。调度用 `dsh-schedule`，自主运行用 `dsh-goal`（本轮开发就是 goal 驱动的活例子）。
2. 把 schedule 做成**可选叠加**：`assistant/profile/schedule.patch.yml` + `MYPI_SCHEDULE=1`（默认关，避免工具面膨胀）。
3. 缺口里**只留一个兜底**：`probe-termux.sh` + `host/launch.mjs status/stop/start` 已经能覆盖"卡住/挂了就重启"的运维动作；
   真出现卡住问题再写 watchdog（检测指标明确后再写，别提前造）。
4. `maintain.sh` 继续作为本地 cron 维护；如需**定时执行**，用 `MYPI_SCHEDULE=1` 起的宿主里建一条 schedule 任务即可。

## 6. 怎么验证

```bash
# 组合断言（不需要起宿主）：三行出现在组合里
bash assistant/test/schedule-compose.sh

# 实际用：带自动化启动
MYPI_SCHEDULE=1 assistant/scripts/mypi.sh web
# 然后在会话里让模型建任务（或任务页里建）：schedule_create{...}
```

主验收 `verify-m1.sh` 第⑳步会跑组合断言（未启用时也只是"组合可挂载"，不影响默认路径）。
