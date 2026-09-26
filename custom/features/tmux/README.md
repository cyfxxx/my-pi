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
| `registry.ts` | 会话注册表与 shutdown 清理（跨进程文件锁串行化 RMW） |

## 数据与配置（`portable/memory/`）

| 路径 | 内容 | 覆盖变量 |
|------|------|----------|
| `tmux/` | 会话日志目录（轮转 10MB） | `PI_TMUX_LOG_DIR` |
| `tmux-registry.json` | 本扩展管理的会话注册表 | `PI_TMUX_REGISTRY` |
| `tmux-registry.json.lock` | 注册表写锁（`open('wx')`+陈旧判定，写入口持锁 RMW） | 随 `PI_TMUX_REGISTRY` |

环境变量：`PI_TMUX_BIN`、`PI_TMUX_PREFIX`、`PI_TMUX_LINES`、`PI_TMUX_TIMEOUT_SEC`、`PI_SESSION_ID`、
`PI_TMUX_LOCK_TIMEOUT_MS`（默认 2000）、`PI_TMUX_LOCK_STALE_MS`（默认 15000）。

## 完成自动唤醒

`tmux_run` 启动的会话由 `watcher.ts` 轮询监听（5s 间隔，定时器 `unref`）：会话结束后注入通知消息并触发新回合，
主会话据此 `tmux_read` 收尾，不必等用户下一条消息。要点：

- 同轮完成的多个会话在 5s 合并窗口内合成一条汇总通知（防积压）
- `tmux_read` 成功读取即 `ack`，该会话完成时不再通知；`tmux_stop` 丢弃待发通知
- `watcher.ts` 为纯逻辑（`hasSession`/`notify`/`onDone` 依赖注入），接线在 `index.ts`

## 约定

- 只管理带 `SESSION_PREFIX` 前缀、且被登记为本 pi 会话（`isPiSession`）的 tmux 会话，不干扰用户手动会话。
- 日志超限时 `rotateLogIfLarge` 轮转，避免无限增长。
- 注册表写入口在同一把文件锁内完成「读-改-写」并原子落盘；锁获取超时（默认 2s）会告警并降级为无锁写，
  绝不死等；持有者崩溃残留的锁按 pid/时间戳判定为陈旧后抢占（避免永久死锁）。

## 相关

- 背景任务判定：`context/budget` 的 `hasBackgroundTask` 会只读本功能的注册表文件。
- 终端配置（键位/状态栏）：`deploy/tmux/`，安装见 [../../../deploy/README.md](../../../deploy/README.md)。
- tmux 终端部署：[../../../docs/operations/alacritty-tmux-setup.md](../../../docs/operations/alacritty-tmux-setup.md)
