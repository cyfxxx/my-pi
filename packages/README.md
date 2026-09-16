# packages — 上游 pi 包（只读同步）

此目录包含上游 pi 框架包。这些包从 earendil-works/pi 同步，**不应直接修改**。

当需要修改时：
1. 使用 `patches/` 目录跟踪变更
2. 使用 `scripts/sync-upstream.sh` 从上游同步
3. 使用 `scripts/create-patch.sh` 和 `scripts/apply-patches.sh` 管理补丁

## 目录结构

```
packages/
├── ai/                    — AI 核心库（LLM API 抽象，provider 实现）
├── agent/                 — Agent 核心（运行时，session 管理）
├── chord/                 — 核心框架（context, delta, facets, node）
├── client/                — 客户端库
├── coding-agent/          — 编码代理（主 CLI + 框架核心 + 工具系统）
├── evals/                 — 评估框架
├── protocol/              — 协议定义（CBOR 序列化）
├── server/                — 服务器（transport 层）
├── session-backends/
│   └── sqlite-node/       — SQLite 会话后端
├── telemetry/             — 遥测收集
└── tui/                   — 终端 UI 组件（native bindings）
```

## 包说明

| 目录 | 用途 |
|------|------|
| `ai/` | AI 核心库（LLM API 抽象，provider 实现） |
| `agent/` | Agent 核心（运行时，session 管理） |
| `chord/` | 核心框架（context, delta, facets, node） |
| `client/` | 客户端库 |
| `coding-agent/` | 编码代理（主 CLI + 框架核心 + 工具系统） |
| `evals/` | 评估框架 |
| `protocol/` | 协议定义（CBOR 序列化） |
| `server/` | 服务器（transport 层） |
| `session-backends/sqlite-node/` | SQLite 会话后端 |
| `telemetry/` | 遥测收集 |
| `tui/` | 终端 UI 组件（native bindings） |

## 相关链接

- [自定义层](../custom/README.md)
- [补丁管理](../patches/README.md)
- [上游同步文档](../custom/docs/UPSTREAM-SYNC.md)
