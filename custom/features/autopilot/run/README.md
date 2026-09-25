# autopilot/run — 执行 / 看门狗 / 验证器

`autopilot` 的运行时子包：以子进程方式运行任务、空闲/挂起看门狗、以及 Best-of-N 的验证器与记录。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `runner.ts` | 子进程运行单个任务、构造 pi 参数、提取输出 | `runTaskOnce`、`buildRunArgs`、`extractRunOutput`、`taskTmpDir` |
| `watchdog.ts` | 忙闲标记、活动时间、挂起判定与触发恢复 | `setTurnBusy`/`isTurnBusy`、`setBackgroundBusy`/`isBackgroundBusy`、`touchActivity`、`isHanging`、`triggerHangRecovery` |
| `verifier.ts` | Best-of-N 评分与选择（纯逻辑，外部编排未迁移） | `parseJudgeScores`、`selectBest`、`shouldVerify`、`bestOfN`、`recordVerification` |
| `verifier-logger.ts` | 验证记录与聚合落盘 | `logVerification`、`readVerifications`、`summarize` |

## 说明

- 任务以**子进程**方式运行（`runner.ts`），不是主会话注入模型；因此 `Task` 没有 `pendingInject` 之类字段。
- `buildRunArgs` 固定传 `--mode json -p --no-session --no-extensions`：任务运行**不加载扩展**，
  提示词只能用 bash/read/write 与 `scripts/` 下的脚本（该约束由 `scripts/check-seeds-headless.mjs` 守门）。
  原因：带 `--extension` 的 `-p` 一次性运行在本环境**产出回复后不退出**（实测 60s 超时被 kill，无扩展 25s 干净退出 exit 0）。
- `verifier.bestOfN` 的 LLM 编排未迁移（原项目为随机占位）；纯评分/选择逻辑已迁移并被单测覆盖。
- 看门狗通过写 admin state 请求重启，由 `scripts/pi-supervisor.sh` 消费。

## 相关

- 上层：[../README.md](../README.md)
- 存储/策略：[../store/README.md](../store/README.md)
