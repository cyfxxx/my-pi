# mypi-assistant（拼接式私人助手）

一个**前端 + 装配层**，不是一个新底座：宿主运行时负责会话/工具/权限/持久化，这里只放
「第二个前端」和「我们自己的插件」。设计论证见 [`docs/design/PRIVATE-ASSISTANT.md`](../docs/design/PRIVATE-ASSISTANT.md)，
现状与本地模型上下文预算见 [`docs/design/ASSISTANT-STATUS.md`](../docs/design/ASSISTANT-STATUS.md)。

## 一条指令

```bash
assistant/scripts/mypi.sh          # 终端界面（默认）
assistant/scripts/mypi.sh web      # 打印浏览器地址（同一宿主、同一会话）
assistant/scripts/mypi.sh status   # 宿主是否在跑
assistant/scripts/mypi.sh stop
```

宿主默认是**仓内 vendored DSH**（`runtime/<平台>/ext/dsh`，完全便携），home 在
`assistant/.run/home`，端口 `3099`（避开正在跑的 GUI `3080`）。可用 `MYPI_PORT` / `MYPI_HOME` 覆盖。

**我们自己的插件默认挂上**（`plugin/dist/plugin.mjs`，注册工具 `mypi_note`）。要跑"裸宿主"对比：
`MYPI_NO_PLUGIN=1 assistant/scripts/mypi.sh`。插件改了要先重建：

```bash
node_modules/.bin/esbuild assistant/plugin/entry.ts --bundle --format=esm \
  --platform=node --packages=external --outfile=assistant/plugin/dist/plugin.mjs
```

## 两种模型模式

| 模式 | 怎么走 | 改动量 |
|---|---|---|
| 在线 | 宿主自带 `dsh-llm-deepseek` + 凭据 | 0 行代码 |
| 本地 | `dsh-llm-pi-ai` 的一条 `providers` 路线指向本机 OpenAI 兼容端点（Ollama / vLLM / LM Studio / llama.cpp） | 一段 YAML |

按**会话**选择：`session/selectModel { provider, model }`。终端里也能用环境变量指定：

```bash
MYPI_PROVIDER=local MYPI_MODEL=mock-local assistant/scripts/mypi.sh
```

> ⚠️ 实测行为：`session/selectModel` 会把选择**同时写回 profile 的默认模型**
> （`<home>/profiles/mypi-web/cordis.patch.yml` 里的 `agent-default-model`）。
> 也就是说"给这个会话换模型"等于"把默认模型也换了"。`verify-m1.sh` 最后一步会把它复原成在线，
> 手工切过模型后若想回到在线，用同样的调用选回 `deepseek-official/deepseek-flash`。

`spike/local-provider.patch.yml` 是「本地路线」的样板（指向一个假的 OpenAI 兼容端点），
把 `baseURL` 换成 `http://127.0.0.1:11434/v1` 就是 Ollama。

## 可执行验收

```bash
assistant/scripts/verify-m1.sh
```

全部绿才算过：终端前端在**真实 pty** 里能对话、同一会话**两个客户端直播流逐字相同**、
本地路线**真的打到本机端点**（mock 日志计数 > 0）、**自写插件工具**在工具面可见且真被执行
（`tool/call` → `tool/result` → 笔记文件落盘）、Web 入口返回 200 且挂载 SPA。
不依赖额度、不依赖网络（模型侧用本机 mock 端点）。

## 结构

```
src/transport.mjs   /api 原生客户端：token 交换 → 一元 RPC → WebSocket 逻辑流
src/tui.mjs         pi-tui 渲染的终端前端（宿主运行时的第二个客户端）
bin/tui.mjs         入口
plugin/entry.ts     我们自己的插件：注册工具（A 类接缝的样板）
plugin/mount.patch.yml
plugin/dist/        构建产物（esbuild，宿主按路径加载）
scripts/mypi.sh     tui | web | status | stop（默认挂插件）
scripts/verify-m1.sh
spike/              本地模型路线样板 patch + mock OpenAI 端点（验收用）
test/              断言：pty 驱动 / 双客户端同步 / 本地路线 / 插件工具
```

**边界规则**（避免又变成修修补补）：

1. `src/transport.mjs` 是唯一知道 `/api` 线格式的地方；渲染层不许直接拼 RPC。
2. 功能以**插件**进宿主，不许在终端前端里再实现一遍。
3. 不 fork 上游：宿主是 vendored 依赖 + 我们的 profile/patch；上游升级只影响 pin 的版本号。
4. 不写冒充上游包名的 shim，不读别人内部数据结构。
