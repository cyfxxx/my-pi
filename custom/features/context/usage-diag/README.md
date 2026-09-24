# usage-diag

会话用量诊断与工具事件台账模块（纯逻辑，零 Pi 依赖）。

## 职责

- 记录每次 LLM 调用的 token 用量与上下文 token 到 `<memoryDir>/context/.usage-diag.jsonl`
- 记录自动压缩、分层擦除、provider 缺 usage 等诊断事件
- 记录 thinking 思考量与档位切换事件
- 记录工具启用与调用事件到 `<memoryDir>/stats/tool-events.jsonl` 与 `<memoryDir>/stats/tool-usage.json`
- 提供汇总与格式化函数，供 CLI 与诊断工具展示

## 路径规范

- 使用 `getMemoryDir()` 解析路径，支持 `PI_MEMORY_DIR` 环境变量
- 所有文件落盘到 `portable/memory/` 目录，实现便携与 git 友好

## 导出 API

见 `diag.ts` 注释。

## 与现有模块关系

- 替代原 `custom/features/context/usage-stats.ts` 的部分度量功能（保留向后兼容）
- 与 `budget/` 子包的 token 统计形成互补：usage-diag 记录原始事件，budget 提供实时预算与压力提示
- 与 `plan-mode`、`web-search` 等功能的工具事件可通过本模块统一追踪

## 迁移说明

原 `/tmp/pi-tools/agent/services/diagnostics/usage-diag.ts` 的硬编码路径已替换为动态解析，并将数据目录从 `~/.pi/agent` 改为 `PI_MEMORY_DIR`，符合 my-pi 的“数据收敛”原则。

## 注意事项

- 所有路径均使用 `getMemoryDir()` 解析，运行时可通过 `PI_MEMORY_DIR` 重定向
- 诊断文件会自动截断超上限内容（默认 20,000 行）
- 工具事件台账默认保留 30 天，可通过 `pruneToolEvents` 清理