# tmux — tmux 会话管理

在 tmux 里启动/驱动后台与长任务，读取输出、发送按键、等待完成。

## 注册面

- 工具：`tmux_run`、`tmux_status`、`tmux_read`、`tmux_send`、`tmux_stop`、`tmux_wait`
- 钩子：`session_shutdown`（清理本扩展启动的会话）

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具；输出截断标记 |
| `logic.ts` | 纯逻辑 barrel |
| `config.ts` | 配置/会话名/日志路径（`loadTmuxConfig`、`normalizeSessionName`） |
| `session.ts` | tmux CLI 封装：探测/启动/读取/发送/等待 |
| `registry.ts` | 会话注册表与 shutdown 清理 |

## 数据与配置（`portable/memory/`）

| 路径 | 内容 | 覆盖变量 |
|------|------|----------|
| `tmux/` | 会话日志目录（轮转 10MB） | `PI_TMUX_LOG_DIR` |
| `tmux-registry.json` | 本扩展管理的会话注册表 | `PI_TMUX_REGISTRY` |

环境变量：`PI_TMUX_BIN`、`PI_TMUX_PREFIX`、`PI_TMUX_LINES`、`PI_TMUX_TIMEOUT_SEC`、`PI_SESSION_ID`。

## 约定

- 只管理带 `SESSION_PREFIX` 前缀、且被登记为本 pi 会话（`isPiSession`）的 tmux 会话，不干扰用户手动会话。
- 日志超限时 `rotateLogIfLarge` 轮转，避免无限增长。

## 相关

- 背景任务判定：`context/budget` 的 `hasBackgroundTask` 会只读本功能的注册表文件。
- 终端配置（键位/状态栏）：`deploy/tmux/`，安装见 [../../../deploy/README.md](../../../deploy/README.md)。
- tmux 终端部署：[../../../docs/operations/alacritty-tmux-setup.md](../../../docs/operations/alacritty-tmux-setup.md)
