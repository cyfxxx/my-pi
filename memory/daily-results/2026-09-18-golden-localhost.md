# golden-tasks --fast 失败记录

**日期**: 2026-09-18
**主机**: localhost
**档位**: --fast（F1-F5 本地脚本断言）

## 结果

✗ F1 task-metrics 管线异常
✓ F2a lesson-miner 可运行
✗ F2b usage-stats 异常
✓ F3 entries.json 完整性与脱敏
✓ F4 干预快照结构
✓ F5 干预快照写路径

## 失败项详情

### F1 task-metrics 管线异常
- 脚本：`agent/extensions/pi-autopilot/scripts/task-metrics.mjs --json`
- 断言：`ok === true`
- 状态：脚本可执行但返回的 JSON 中 `ok` 不为 `true`，遥测管线健康检查未通过

### F2b usage-stats 异常
- 脚本：`agent/extensions/pi-context/scripts/usage-stats.mjs`
- 断言：脚本以 0 退出码运行
- 状态：脚本执行异常（退出码非 0 或输出被抑制）

## golden 输出尾部

```
✗ F1 task-metrics 管线异常
✓ F2a lesson-miner 可运行
✗ F2b usage-stats 异常
F3 entries.json 完整: 940 条有效 / 无明文密钥
✓ F3 entries.json 完整性与脱敏
F4 interventions.jsonl 结构完整: 5 条
✓ F4 干预快照结构
F5 写→读→删校验通过（原有 5 条不受影响）
✓ F5 干预快照写路径

══ golden-tasks [fast] 失败 2 项 ══
```
