# 上游清单（只记来源，不复制内容）

> 策略见 [`POLICIES.md`](POLICIES.md) §3：有明确上游的东西**不进仓库**，只记录"是什么、钉在哪、怎么查新版"。

## 怎么查更新

```bash
node assistant/scripts/check-upstreams.mjs          # 人读表格
node assistant/scripts/check-upstreams.mjs --json   # 机读
```

脚本直接查 npm registry（公开、无需凭据），输出"当前钉 vs 最新 vs 跟踪轨道"。

## 上游表

| 组件 | 用途 | 钉在哪 | 跟踪轨道 | 升级方式 |
|---|---|---|---|---|
| `@deepseek-ai/dsh` | 宿主运行时（会话/工具/权限/压缩/Web） | `assistant/scripts/vendor-dsh.sh` 的 `DSH_VERSION` | `next`（预发布期） | `vendor-dsh.sh install` → `build.sh` → `verify` |
| `@deepseek-harness-tui/dsh-tui` | 社区 TUI（可选） | `assistant/scripts/setup-tui.sh` 的 `MYPI_TUI_VERSION` | `latest` | 重跑 `setup-tui.sh` |
| `@earendil-works/pi-ai` | 本地/任意 OpenAI 兼容模型层（`dsh-llm-pi-ai` 依赖） | 由 DSH 组合决定（不直接钉） | `latest` | 随宿主升级 |
| `@earendil-works/pi-tui` | 自带终端前端渲染库 | `assistant/package.json`？（如无则随 DSH） | `latest` | 随宿主升级 |
| SearXNG | 搜索后端（可选，本机跑） | `SEARXNG_URL`（默认 `http://127.0.0.1:8889`） | 外部服务 | 用户自行更新实例 |

## 规则

1. 新增上游 = 在 `check-upstreams.mjs` 的 `UPSTREAMS` 里加一行 + 在本表加一行；
2. **不把上游内容复制进仓库**（运行时/依赖/工具链都走安装脚本）；
3. 升级前先跑 `check-upstreams.mjs`，再按对应 ops 文档执行。
