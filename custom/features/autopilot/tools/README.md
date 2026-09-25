# autopilot/tools — 工具组

`autopilot` 暴露给模型的工具实现。每个模块都是「纯逻辑 + 注册函数」：
解析/格式化/读写逻辑零 Pi 依赖（可单测），只有 `register*` 经 `adapters/tool-adapter` 接触 Pi API。

## 文件

| 文件 | 工具 | 职责 | 主要导出 |
|------|------|------|----------|
| `admin-tools.ts` | `autopilot_policy`、`admin_status`、`admin_get_config`、`admin_set_config`、`admin_list_sessions`、`admin_switch_session`、`admin_restart`、`admin_list_models`、`admin_set_model` | 策略展示、运行状态、配置读写（敏感键掩码 + 可写键白名单）、会话列表/切换、重启请求、模型列表/切换 | `listProviders`、`formatPolicyText`、`formatAdminStatus`、`formatModelsList`、`isSensitiveKey`、`maskSensitive`、`readConfigField`、`safeConfigKeys`、`parseConfigValue` |
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
