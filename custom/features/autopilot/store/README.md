# autopilot/store — 任务存储与策略

`autopilot` 的状态与决策子包：任务存储/调度表达式、配置与策略、预算、遥测、会话、通知、种子同步。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `storage.ts` | 任务存储、cron/interval 解析、锁、会话锁 | `readTasks`/`writeTasks`、`createTask`/`addTask`/`updateTask`/`deleteTask`/`listTasks`、`computeNextRun`/`cronNextRun`/`parseRelativeTime`/`parseIntervalToMs`/`formatInterval`、`withStoreLock`、`acquireSessionLock`/`releaseSessionLock` |
| `ops.ts` | 配置/状态/遥测读取、策略/预算/failover/决策 | `readAutopilotConfig`/`writeAutopilotConfig`、`readState`/`writeState`/`writeRestartRequest`、`readTelemetry`/`appendRun`、`checkBudget`、`planFailover`/`executeFailover`、`decide`、`schedulerOverview` |
| `metrics.ts` | 度量仪表盘聚合 | `collectMetrics`、`formatMetrics` |
| `sessions.ts` | 会话列表格式化 | `sortByModified`、`formatSessionList` |
| `notifications.ts` | 离线任务执行报告（results JSONL + seen 标记） | `collectUnread`、`parseResults`、`formatSummary`、`readSeenTs`/`writeSeenTs` |
| `seeds.ts` | 种子任务同步（`scheduled-seeds.json`，**只补缺失、不覆盖**已存在任务） | `loadSeeds`、`diffSeedTask`、`syncSeedTasks` |

## 关键约定

- `withStoreLock` 是**进程内** Promise 队列（不跨进程）；跨进程会话锁用 `acquireSessionLock`（pid + TTL）。
- 种子对账是 add-only：修改 `scheduled-seeds.json` 的提示词**不会**传播到已注册任务（启动时只提示 drift），
  需 `node scripts/reseed-seeds.mjs --apply` 显式应用（默认预演；写入前备份 `tasks.json`，保留 id/enabled/lastRun/runCount/history）。
- 配置字段做类型校验（数值仅接受有限正数），防手改配置使策略静默失效。
- 轮转/追加日志走 `core/fs-json`，阈值各自保留（results 2MB、telemetry 等）。

## 相关

- 上层：[../README.md](../README.md)
- 执行侧：[../run/README.md](../run/README.md)
