# 私人助手：拼接式架构（分支 `feat/private-assistant`）

> 目标不是再换一个底座，而是**把「换底座」这件事本身变成配置**：能力从哪来由接缝决定，
> 不由 fork 决定。本文记录为什么这么拼、每条接缝的证据、以及明确不做什么。

## 1. 结论先说

**能拼，但只能拼在「声明过的接缝」上，并且脊柱必须唯一。**

「选一个底座以后还要修修补补」这句判断是对的，但它诊断的是**修补的位置**，不是「有没有底座」。
修修补补的真正来源是：**改别人的内部结构来维持兼容**。观察本仓现状就能看到这一点——
`node_modules/@earendil-works/pi-coding-agent` 与 `pi-tui` 其实是本仓写的 shim
（`my-pi-dsh-shim-*`），另外还有注入面基线哈希、`session-key` 补丁。上游一动，这些都要跟着动。

所以本设计把「拼接」限制在三类接缝，其余一律不进门：

| 接缝 | 定义 | 上游升级时你要改什么 |
|---|---|---|
| **A. 插件 API** | 目标运行时自己声明的扩展点（注册服务、工具、事件钩子） | 改配置或改插件，不碰宿主源码 |
| **B. 线上协议** | 进程/网络边界上的文档化协议（`/api`、WebSocket 逻辑流、SDK JSON-RPC、ACP、MCP） | 改客户端的一个文件 |
| **C. 独立库** | 无运行时假设的纯库（渲染、模型调用） | 改版本号 |

规则外的一切——读别人内部结构、复制别人的状态机、改上游源码维持兼容——都不算拼接，
一律算回退到「修修补补」。

## 2. 为什么脊柱必须唯一

`agent loop ↔ session log ↔ tools ↔ permissions` 是一个**不可分单元**：循环的每一步都要把
模型可见的事实写进会话日志，工具调用与审批又反过来约束循环。两份日志 = 两个事实源，
两个事实源 = 每条功能都要写两遍一致性逻辑。这就是「拼接」最常见的死法。

因此：**脊柱只选一个**（本分支选 DSH 运行时），其它一切只能以 A/B/C 三类接缝挂上去。
「多底座并存」被明确否决——那不是拼接，那是把两套事实源缝在一起。

## 3. 拼装表

| 能力 | 来源 | 接缝 | 已验证据（本分支实测） |
|---|---|---|---|
| 会话 / 工具 / 权限 / 持久化 / 压缩 / 子代理 | DSH 运行时（venv 内 vendored，钉 `0.2.0-rc.2`） | 宿主本身 | 宿主在 3099 起，`session/create`、`session/follow`、`session/prompt` 全通 |
| 在线模型 | `dsh-llm-deepseek` + 凭据 | **A**（上游自带插件） | 真实模型流式返回（探针拿到「好」） |
| 本地模型 | `dsh-llm-pi-ai` → `@earendil-works/pi-ai` `0.87.1` | **A + C** | mock 端点收到 6 次请求，回复进入会话流 |
| 多协议 / 多 provider | pi-ai（50+ provider，含 OpenAI 兼容：Ollama / vLLM / LM Studio） | **C** | 同上；`api: openai-completions` + `baseURL` |
| 终端界面 | `@earendil-works/pi-tui` `1.3.0` | **C** | 真实 pty 里创建会话、发问、流式出字、退出 |
| Web 界面 | DSH 自带 React GUI（`dsh web`） | 上游自带 | 打印带 `?token=` 的地址；`/api` 需签名 cookie |
| 两端数据同步 | 同一宿主的两个 `/api` 客户端 | **B** | 两客户端对同一会话的直播流**逐字相同** |
| 我们自己的工具/功能 | 本仓插件（下一步） | **A** | 规划中 |

### 为什么这不叫「又包了一层」

- **pi-ai 不是我们粘上去的**：DSH 上游的 `dsh-llm-pi-ai` 自己就依赖 `@earendil-works/pi-ai ^0.87.1`。
  我们只是给它一条 `providers` 配置。这是上游**已经认可**的拼接点。
- **pi-tui 是纯库**：`dependencies` 只有 `marked` 与 `get-east-asian-width`，不假设宿主是谁。
- **Web 端一行没改**：它就是 DSH 的 GUI；我们的终端前端是**同一个运行时的第二个客户端**，
  走的是浏览器同样的 `/api` + `/api/remote.mux`。同步因此是结构事实，不是镜像投屏。

## 4. 结构

```
assistant/
  src/transport.mjs              # 唯一知道 /api 线格式的地方：
                                 #   GET /?token=… → Set-Cookie
                                 #   POST /api/<endpoint> {type:'client-request',rpcId,method,payload:{args}}
                                 #   WS  /api/remote.mux {type:'open'|'item'|'end'|'cancel'}
  src/tui.mjs                    # pi-tui 渲染层（第二个前端），只调 transport + 画
  bin/tui.mjs
  scripts/mypi.sh                # tui | web | status | stop（宿主进程管理）
  scripts/verify-m1.sh           # 四项可执行验收
  spike/local-provider.patch.yml # 本地模型路线（配置）
  spike/mock-openai.mjs          # 本机 OpenAI 兼容端点（验收用）
  test/                          # pty 驱动 / 双客户端同步 / 本地路线
```

三条边界规则：

1. `/api` 线格式只出现在 `transport.mjs`；渲染层不许直接拼 RPC。
2. 功能以**插件**形式进宿主（工具、命令、persona、模型路线），终端前端不再实现一遍。
3. 宿主是**依赖 + profile/patch**，不是 fork；上游升级只改 pin。

## 5. M1 验收（可重复执行）

`assistant/scripts/verify-m1.sh` 在干净状态下的实测输出：

```
=== ① 本机模型端点（mock OpenAI 兼容） ===
✓ 端点就绪
=== ② 宿主 ===
✓ 宿主就绪（3099）
=== ③ 终端前端（真实 pty） ===
TUI 退出码检查：回复含「我是本地模型」= True
=== ④ 两端同步 ===
{"a":"我是本地模型，在你机器上跑。","b":"我是本地模型，在你机器上跑。","same":true}
=== ⑤ 本地模型路线 ===
{"reply":"我是本地模型，在你机器上跑。","mockHits":6,"ok":true}
=== 结果 ===
🎉 M1 四项全过
```

四项各自证明什么：

| 项 | 证明 | 不是什么 |
|---|---|---|
| ③ pty | 终端界面在**真实终端**里可用（不是函数返回值对） | 没做工具调用可视化/审批 |
| ④ 同步 | 两个独立客户端对同一会话的直播流逐字一致 | 没做浏览器自动化截图 |
| ⑤ 本地路线 | 请求**真的**打到本机端点（服务端日志计数） | 没有真跑 Ollama（用等价协议端点） |
| 在线 | 早前探针用真实凭据拿到流式回复 | 只跑过一次小请求（额度） |

## 6. 明确不做

1. **不把别的产品的 agent loop 拉进同一进程**（opencode / pi 的 loop）：两个事实源。
2. **不写冒充上游包名的 shim**，不读别人内部数据结构维持兼容。
3. **不用 PTY 投屏冒充「Web 界面」**：那就没有第二个客户端，也就没有真同步。
4. **不为兼容上游内部结构写补丁**：上游变了就改配置或换接缝。
5. **不引入第二套工具注册表**：工具只在宿主注册一次，两端自动共享。

## 7. opencode / pi 各自怎么用

- **pi**：`pi-ai` 已经是模型层（经 `dsh-llm-pi-ai`）；`pi-tui` 是终端渲染层。两个都是**库级**使用，
  不启动 pi 的 agent loop，因此不存在「两个助手」。
- **opencode**：作为**外部 agent**接入（ACP / MCP 进程边界），而不是作为代码被 import。
  这样它怎么升级都与我无关。默认关闭（它会扩大工具面与成本），排在 M1 之后。

## 8. 已知边界

- 只验过：Linux arm64 / Node 22 / DSH `0.2.0-rc.2` / pi-tui `1.3.0`。
- 终端前端目前只有：会话、流式文本、tokens 计数、`/new`、`/quit`、环境变量选模型。
  缺：工具调用卡片、审批、命令面板、历史滚动、附件。
- `session/modelCatalog` 的参数形状还没摸对（`_request` vs `request`），当前不用它。
- 宿主 home 在 `assistant/.run/home`（隔离），与 `portable/dsh` 的既有数据不共享；
  要共享得显式设 `MYPI_HOME`。
