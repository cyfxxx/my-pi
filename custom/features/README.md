# custom/features — 功能层

12 个功能扩展，每个功能是一个独立目录。从 pi-tools 迁移而来，按 my-pi 分层约束重组。

## 约定（硬规范）

- 每个功能根必须有 `index.ts`（通过 `adapters/` 注册到 Pi）与 `logic.ts`（纯逻辑出口/barrel）。
- 逻辑层（除 `index.ts` 与 `__tests__/`）**零 Pi 依赖**：不得 import `@earendil-works/*`、不得 import `adapters/`。
- 小功能直接把模块铺在功能根目录（如 `tmux/logic.ts`、`browser/impl.ts`）。
- 大功能在功能目录下按职责建**一层**子包（如 `store/`、`recall/`、`ui/`），子包内互相引用用相对路径，`logic.ts` 仅作 barrel。
- 跨功能引用只走对方的 `logic.ts`；当前仅有：`context → plan-mode/logic`（`getTodos`）、`memory/recall → context/logic`（`estimateTokens`/`truncateByTokens`）。
- 功能清单在 `custom/bootstrap.ts` 的 `FEATURES` 中维护。

## 功能清单

| 功能 | 类型 | 入口 | 说明 |
|------|------|------|------|
| [web-search](web-search/README.md) | 工具型 | 工具 | SearXNG 私密搜索 + 直连 HTTP 降级 + 网页抓取 |
| [context](context/README.md) | 钩子型 | 命令 + 钩子 | Token 优化中枢（预算/剪枝/压缩/工具分层/thinking/任务记录） |
| [link](link/README.md) | 工具型 | 工具 + 命令 | 多设备互联（SSH 通道 + 远程 RPC） |
| [memory](memory/README.md) | 工具型 | 工具 + 命令 | 跨会话持久记忆（存储/检索/注入/治理/教训挖掘） |
| [mode](mode/README.md) | 钩子型 | 命令 | 模式切换（full/minimal/roleplay） |
| [plan-mode](plan-mode/README.md) | 钩子型 | 工具 + 命令 + 快捷键 | 计划模式（只读探索 + 任务面板） |
| [intervention](intervention/README.md) | 钩子型 | 命令 | 干预捕获（中断快照 + 纠正关联） |
| [subagent](subagent/README.md) | 工具型 | 工具 | 子代理（delegate 给专门 agent） |
| [tmux](tmux/README.md) | 工具型 | 工具 | tmux 会话管理（后台/长任务） |
| [browser](browser/README.md) | 工具型 | 工具 | 浏览器自动化（playwright-core） |
| [voice](voice/README.md) | 工具型 | 工具 + 命令 + 快捷键 | 语音交流（录音转写 + TTS） |
| [autopilot](autopilot/README.md) | 钩子型 | 工具 + 命令 | 自主运行（定时任务 + 自管理 + 失败自愈） |

## 数据落点

功能自身只写 `portable/memory/`（经 `core/config.getMemoryDir`）；Pi 的配置/会话/技能在 `portable/agent/`。
运行时数据不入库（见根 `.gitignore`）。

## 校验

- `bash scripts/check-features.sh`：对照生成的注册面基线（`scripts/registration-baseline.json`）检查
  工具/命令/快捷键/钩子/补丁完整性；新增或删除工具后需 `node scripts/gen-registrations.mjs --update`。
- `bash scripts/check-isolation.sh`：逻辑层不得有 Pi runtime 依赖。
- `node scripts/check-dead-exports.mjs`：抓「写了没接线」的导出（白名单见 `scripts/dead-exports-allowlist.txt`）。
- `bash scripts/golden-tasks.sh`：上述守门 + 类型/单测/补丁行为/注入面/文档/定时任务提示词的整体基准。

## 相关

- 底座：[../core/README.md](../core/README.md)
- 适配层：[../adapters/README.md](../adapters/README.md)
- 入口：[../bootstrap.ts](../bootstrap.ts)
