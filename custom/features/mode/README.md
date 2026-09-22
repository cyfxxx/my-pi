# mode — 模式切换

在 full / light / quick 三种模式间切换，改变激活的扩展、技能与思考档位。

## 注册面

- 命令：`/mode <list|help|模式名>`
- 钩子：`session_start`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册命令；`/mode` 处理与提示 |
| `logic.ts` | 模式读写与应用：`loadModes`/`saveModes`、`getCurrentMode`/`setCurrentMode`、`getModeConfig`、`listModeNames`、`applyModeRuntime`、`needsRestart` |

## 数据与配置

- `portable/agent/modes.json`：模式定义与当前模式（随仓库分发）。
- `PI_AGENT_MODE`：当前模式的环境覆盖。

## 约定

- 切模式通过 `applyModeRuntime` 调整运行时激活面；部分改动需重启，由 `needsRestart` 判定并提示。
