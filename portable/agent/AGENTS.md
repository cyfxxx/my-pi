# my-pi 项目环境描述

my-pi 是基于 pi 框架的私人 AI 助手（硬分叉）。本目录 `portable/agent/` 是 **pi 的运行时根目录（agentDir，由 `PI_CODING_AGENT_DIR` 指向）**。按 pi 的 agentDir 约定，这里除配置外还承载**技能（`skills/`）、会话（`sessions/`），以及第三方扩展安装位（`extensions/`、`npm/`、`git/`——当前未安装任何第三方扩展，故这三个目录不存在，安装时由 pi 自动创建）**。

边界是：**my-pi 自身的代码不放此处**（代码在 `custom/`，改动经 `adapters/` 接入），此处也不放任何符号链接。

## 目录结构

```
portable/agent/           # pi 的运行时根目录（agentDir）：配置 + 技能 + 会话 + 扩展
portable/agent/skills/    # 技能目录（pi 从 agentDir/skills 发现，随仓库分发）
portable/memory/           # 自定义功能数据（记忆笔记、工具输出归档）
vendor/pi/                 # 上游 Pi 代码（独立 clone，只读）
custom/                    # 自定义层（adapters/core/features/bootstrap.ts）
packs/                     # 外部技能包（按需读取，不注入系统提示词）
docs/                      # 项目文档
deploy/                    # 可选系统级部署产物（systemd 等）
scripts/                   # 32 个运维脚本
patches/                   # 上游补丁
```

## 分层架构

```
Layer 3 ─ 功能层 ───────────── custom/features/（12 个扩展，logic.ts 为纯逻辑出口；大功能按职责分子包）
    ↑
Layer 2 ─ 适配器层 ─────────── custom/adapters/（唯一允许 import vendor/pi）
    ↑
Layer 1 ─ 服务层 ───────────── custom/core/（config 路径解析、registry 注册表）
    ↑
Layer 0 ─ 基础层 ───────────── vendor/pi/（上游代码，永不修改）
```

**依赖规则**：`features/` 的逻辑层（`index.ts` 与 `__tests__/` 除外）零 Pi 依赖；仅 `adapters/` 可 runtime import `vendor/pi`（`import type` 除外）。
大功能的实现按职责分组（`memory/{store,recall,mine}`、`voice/{audio,stt,tts}`、`autopilot/{store,run}`、`subagent/{core,ui}`、`plan-mode/{core,ui}`、`context/budget`、`web-search/{config,search,fetch,concurrency}`、`link/{types,config,net,card,guards,state,display,protocol}`）；`logic.ts` 是对外出口（多数为 barrel，`context/logic.ts` 另含少量共享逻辑）。

## 关键配置

### PI_CODING_AGENT_DIR

pi 通过此环境变量定位运行时根目录（agentDir），默认 `~/.pi/agent`。my-pi 由 `my-pi.sh` / `scripts/dev.sh` 指向 `portable/agent`：

```bash
export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/agent"   # pi 识别（agentDir）
export PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"         # custom/ 记忆存储识别
```

**运行时数据布局**：pi 以 `PI_CODING_AGENT_DIR` 为运行时根目录（另有 `PI_PACKAGE_DIR`；`PI_CODING_AGENT_SESSION_DIR` 可单独重定向会话目录，本项目未使用），技能/会话/扩展都挂在 agentDir 下，因此：

- 技能：`portable/agent/skills/`（= `agentDir/skills`，随仓库分发）；`settings.json` 的 `"skills"` 数组是相对 `agentDir` 的覆盖模式（如 `+skills/pi-backup/SKILL.md`）
- 会话：`portable/agent/sessions/<转义 cwd>/*.jsonl`
- 第三方扩展：`portable/agent/extensions/`（自动发现）或 `./my-pi.sh install` 装入 `portable/agent/{npm,git}/`；三者均为按需目录，未安装扩展时不出现
- 自定义功能数据：`portable/memory/`（`PI_MEMORY_DIR`；工具输出归档走 `PI_OUTPUT_ARCHIVE_DIR`，默认 `portable/memory/tool-outputs/`）

运行时数据全部收敛到 `portable/`，实现便携（U 盘即插即用，无符号链接）。

## 网络搜索（三级通路）

- `web_search`：走可配置的 SearXNG 端点（`SEARXNG_URL`/`PI_WEB_TOOLKIT_SEARXNG_URL` > `settings.json` 的 `pi-web-search.searxng_url` > 本地 `http://127.0.0.1:8889`）；不可达/无结果时自动降级 `searchDirect`（Bing）。
- `web_fetch`：免 SearXNG 的 Bing 直搜（休眠组 `web-fallback`，需 `enable_tool("web-fallback")`）。
- `fetch_url`：轻量 HTTP GET（仅公网 http/https，拒绝内网/回环）。
- **SearXNG 引擎配置是常见坑**：默认启用 google/duckduckgo/brave/wikipedia 等被封锁引擎会全部 timeout 并拖垮整次搜索。用 `bash scripts/searxng-config.sh --force` 生成只启可达引擎（baidu/bing/sogou/360search/bilibili/yandex/stackoverflow/github）且 bing 指向 `cn.bing.com` 的配置。
- 超时默认 30s（`pi-web-search.search_timeout`），因本地多引擎聚合常需 10s+。

## 关键约定

- **上游隔离**：`vendor/pi/` 不直接修改，改动通过 `patches/` 记录。
- **接口隔离**：Pi API 只出现在 `custom/adapters/`。
- **缓存友好**：system prompt 注入禁止时间戳/精确数值；压力提示按档位固定文案（<75% 不注入、≥75%/≥90% 用固定文本）；token 估算统一用 `features/context/budget/budget.ts` 的 `estimateTokens`。
- **后台任务（禁止阻塞前台）**：长任务用 `tmux_run` 启动，**启动后立即结束回合**，不同轮内不等待；同轮内禁止 `tmux_wait`，确需等待只用 `pattern=` 匹配且 `timeout≤60s`。会话结束后由 `features/tmux/watcher.ts` 自动注入通知并触发新回合（不必等用户下一条消息）。子代理（`subagent`）是同步阻塞的，只适合必须立即拿到结果的短任务。
- **git 提交**：暂存显式路径，只提交本次会话更改的文件；不提交 `auth.json` 等敏感配置。

## 验证与命令

```bash
npm run check                      # 隔离边界验证（scripts/check-isolation.sh）
npx tsc --noEmit -p custom/        # 自定义层类型检查
bash scripts/golden-tasks.sh       # 行为防退化基准（--fast 仅结构守门，跳过 tsc/vitest）
bash scripts/install-hooks.sh      # 启用 git 钩子（pre-commit 快检 / pre-push 全量；本地无 CI）
bash scripts/dev.sh                # 开发模式（tsx 直接运行 TS）
bash scripts/build.sh              # 构建 vendor/pi(coding-agent)；vendor 缺失时自动引导（custom/ 不编译）
./my-pi.sh                         # 便携启动
bash scripts/sync-upstream.sh      # 上游同步（vendor/pi 为独立 git clone，上游 earendil-works/pi-mono）
```

修订代码后运行 `npm run check`；类型检查用 `npx tsc --noEmit -p custom/`。
新增/删除工具或命令后运行 `node scripts/gen-registrations.mjs --update` 刷新注册面基线（否则守门会失败）。

## 开发规范

- **对话风格**：回答简短精炼，不使用 emoji；只使用技术性语言，直接了当；用户提问时先回答再进行编辑。
- **代码质量**：大范围更改前完整阅读文件；不使用 `any`，检查 `node_modules` 获取外部 API 类型；禁止内联导入，只使用顶层导入。
- **Git 规范**：只提交本次会话更改的文件；暂存显式路径，永远不要 `git add -A`；提交消息格式 `{feat,fix,docs}: <消息>`。
- **命令**：代码更改后运行 `npm run check`；除非用户要求，不运行 `npm run build` 或 `npm test`。

## 架构原则：三隔离一收敛

- **上游隔离**：`vendor/pi/` 是独立 git clone（上游 `earendil-works/pi-mono`），永不直接修改，改动经 `patches/` 管理；上游更新通过 `scripts/sync-upstream.sh` 合并。
- **逻辑隔离**：`custom/features/` 的逻辑层（`index.ts` 与 `__tests__/` 除外）零 Pi 依赖，纯逻辑永远不会因上游变更而崩溃。
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点，上游 API 变更只需修改适配器。
- **数据收敛**：所有运行时数据通过环境变量重定向收敛到 `portable/` 目录（无符号链接）。

### 目录职责

| 目录 | 职责 | 可修改 |
|------|------|--------|
| `vendor/pi/` | 上游 vendored 代码 | 只读 |
| `custom/adapters/` | 适配器层（隔离 Pi API） | 唯一允许 import vendor/pi |
| `custom/features/` | 功能模块（从 pi-tools 迁移） | 零 Pi 依赖 |
| `custom/core/` | 核心服务（路径解析/注册表） | 允许 |
| `portable/` | 运行时数据 | 允许 |

### 添加新功能

1. 在 `custom/features/` 下创建新目录
2. 创建 `logic.ts` — 纯逻辑出口（零 Pi 依赖）；小功能直接放实现，大功能作 barrel
3. 创建 `index.ts` — 入口，通过 `custom/adapters/` 注册工具/钩子
4. `types.ts` — 类型定义（可选）
5. 模块较多时在功能目录下按职责建一层子包（如 `store/`、`recall/`、`ui/`），子包内互引用用相对路径；跨功能引用只走对方 `logic.ts`
6. 在 `custom/bootstrap.ts` 中注册该功能

### vendor 引导与上游同步

`vendor/pi/` 不随主仓库分发（已 gitignore）。fresh checkout 后由 `scripts/build.sh` 自动 clone 上游并 checkout `vendor/PINNED_COMMIT`、应用 `patches/`。

```bash
bash scripts/sync-upstream.sh              # 同步到最新上游
bash scripts/sync-upstream.sh <commit-sha> # 同步到指定 commit
```

## 深度文档

| 主题 | 文档 |
|------|------|
| 文档索引 | `docs/README.md` |
| 目录结构说明 | `STRUCTURE.md` |
| 架构进度 | `PROGRESS.md` |
| 架构决策 | `DECISIONS.md` |
| 项目总览 | `README.md` |
| 外部技能包 | `packs/README.md` |
| Pi 官方文档 | https://pi.dev/docs/latest |
