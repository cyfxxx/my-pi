# link — 多设备互联

通过 SSH 通道在多台设备间收发消息与执行远程 RPC（含 LAN/Tailscale/WSL 寻址、卡片导入导出）。

## 注册面

- 工具：`link_send`、`link_status`
- 命令：`/link <send|status|watch|inbox|attach|export-card|import-card|help>`
- 钩子：`agent_end`、`agent_settled`、`input`、`turn_start`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令；状态展示 |
| `logic.ts` | 纯逻辑 barrel |
| `types.ts` | 类型定义 |
| `config.ts` | 设备清单读写、地址校验、`describeDevice` |
| `net.ts` | 网络探测（LAN IPv4 / WSL / Tailscale 检测） |
| `card.ts` | 互联卡片构建/校验/导入 |
| `guards.ts` | 并发/去重防抖（`checkConcurrentAndDedup`、send guard） |
| `state.ts` | 本地状态/active/outbox 的读取与跨进程文件锁 `withStateLock` |
| `display.ts` | 结果/设备列表/帮助文本 |
| `protocol.ts` | SSH 传输层：远程命令构造、`sendToDevice`、`probeDevice`、`watchRemote`、`readRemoteOutbox`、`attachToRemote` |

## 数据与配置（`portable/agent/`，每环境独立）

| 路径 | 内容 | 覆盖变量 |
|------|------|----------|
| `pi-link-config.json` | 设备清单（名称/地址/密钥） | `PI_LINK_CONFIG` |
| `pi-link-state.json` / `pi-link-active.json` / `pi-link-outbox.json` | 运行时状态 | `PI_LINK_STATE_DIR` |
| `PI_UNATTENDED` | 无人值守标记（影响主动发送） | — |

## 相关

- 跨设备互联的终端/SSH 运维经验：`docs/operations/`
