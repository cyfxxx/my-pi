# autopilot/tools — 工具组

`autopilot` 暴露给模型的工具实现。每个模块都是「纯逻辑 + 注册函数」：
解析/格式化/读写逻辑零 Pi 依赖（可单测），只有 `register*` 经 `adapters/tool-adapter` 接触 Pi API。

## `goal`：目标声明与**完成语义三态**（P1，2026-10-08）

`action: set/status/complete/blocked/pause/resume`；声明后每轮结束自动续跑，直到完成、受阻或达轮次上限。

**完成分三态**（`GoalCompletionMode`）——关键是 `verified` **不许模型自封**：

| 态 | 怎么产生 | 含义 |
|---|---|---|
| `verified` | ① `complete` 带 `check`（**只读**检查命令）且**由 my-pi 实际跑通**（exit 0）；或 ② `complete {verify:true}` 时由**独立上下文的评审子代理**判为达成（**第二来源**，见 `run/goal-verdict.ts`） | 有独立于模型叙述的判据。**优先级：命令 > 评审**；评审失败/超时/格式不符一律 fail-open 退回 `declared` |
| `declared` | `complete` 不带 `check`（可带 `evidence` 说明） | 只是**声称**完成，状态文案明写「未经校验」 |
| `advisory` | `blocked` / `pause`，以及 **harness 自判的停止**（达轮次上限、连续无进展） | 判断性结论，不是证明 |

- 带 `check` 但**没跑通**时：目标**不会被标记完成**，输出尾部回给模型（模型自己要求了判据，就按判据说话）。
- 结构约束：`store/goal.ts` 只暴露 `declaredCompletion` / `advisoryCompletion` / `verifiedCompletion`
  三个构造器，**只有第三个收得到「已跑通的检查结果」**——没有带 `mode` 参数的通用入口，故**不存在自封路径**。
- 检查命令由 `run/run-check.ts` 执行（见其表行）；默认行为不变：不带 `check` 时与以前完全一致。

## 文件

| 文件 | 工具 | 职责 | 主要导出 |
|------|------|------|----------|
| `admin-tools.ts` | `autopilot_policy`、`admin_status`、`admin_get_config`、`admin_set_config`、`admin_list_sessions`、`admin_switch_session`、`admin_restart`、`admin_list_models`、`admin_set_model` | 策略展示、运行状态、配置读写（敏感键掩码 + 可写键白名单）、会话列表/切换、重启请求（`admin_restart` 支持 `resume=continue|none|auto` 声明"重启后是否继续执行任务"）、模型列表/切换 | `listProviders`、`formatPolicyText`、`formatAdminStatus`、`formatModelsList`、`isSensitiveKey`、`maskSensitive`、`readConfigField`、`safeConfigKeys`、`parseConfigValue` |
| `schedule-tool.ts` | `schedule_task` | 定时任务增删改查/启停（`add/list/update/delete/enable/disable/pause/resume`） | `SCHEDULE_ACTIONS`、`parseScheduleAdd`、`collectScheduleUpdates`、`executeScheduleAction`、`registerScheduleTool` |
| `verify-tools.ts` | `verify_report`、`verify_config`、`verify_test` | LLM-as-a-Verifier：验证记录统计报告、验证配置读写、Best-of-N 试跑（候选生成/评审可注入） | `computeVerifierReport`、`formatVerifierReport`、`buildVerifierReport`、`currentVerifierConfig`、`applyVerifierConfigPatch`、`runVerifyTest`、`registerVerifyTools` |

## 约定

- **隔离**：不 `import` Pi 包类型，注册函数参数用 `Parameters<typeof registerTool>[0]` 推导
  （逻辑层零 Pi 依赖由 `scripts/check-isolation.sh` 守门）。
- **配置安全**：`admin_get_config` 对敏感键做掩码；`admin_set_config` 只接受白名单键（`safeConfigKeys`）。
- **验证器 fail-open**：`verify_test` 缺省用占位候选生成器，不实际调用 LLM
  （pi-tools 的 Best-of-N LLM 集成未迁移，见 `DECISIONS.md`）。

## 相关

- 上层：[../README.md](../README.md)
- 执行侧：[../run/README.md](../run/README.md)
- 存储与策略：[../store/README.md](../store/README.md)
