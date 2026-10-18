# DSH 换基座 · 迁移结项与交接

> ⚠️ **本文件描述 DSH 分支（`feat/base-switch-dsh` / `v1.3.0-dsh`）的实现**；`main` 已回退到合并前，
> 现状与处置见 [DSH-ROLLBACK.md](DSH-ROLLBACK.md)。

**一句话**：my-pi 的底座已从 pi 扩到"pi + DSH 双底座"，并**已合并进 `main`**（快进合并，`dcdc3dfe2`；标签 **`v1.3.0-dsh`** 为回滚点）。DSH 定位为**实验性第二底座**：默认仍是 pi TUI，`./my-pi.sh web|headless|acp` 才走 DSH。
证据、缺口与"怎么复跑"都在本文；深入细节见
[`DSH-MIGRATION-PLAN.md`](DSH-MIGRATION-PLAN.md)（计划 + 实测 #18-a…18-ac）、
[`DSH-HOOK-MAPPING.md`](DSH-HOOK-MAPPING.md)（19 个事件档位）、
[`DSH-DUPLICATE-CAPABILITY-AUDIT.md`](DSH-DUPLICATE-CAPABILITY-AUDIT.md)（同名冲突审计 + 决策 + DR 清单）。

## 1. 状态

| 面 | 状态 | 证据（可复跑） |
|---|---|---|
| 适配层（工具/钩子/命令/快捷键） | ✓ 19 事件 ①9/②10/③0；工具 54 声明面 | `npx vitest run custom/adapters/dsh`（123 项） |
| 真实包 spike | ✓ **22/22**（A1–A22） | `bash scripts/dsh-spike.sh` |
| 产物（打包/安装/profile 组合） | ✓ 自包含、可从 tgz 安装后加载 | `bash scripts/dsh-build.sh`、`bash scripts/dsh-package.sh`、`bash scripts/dsh-smoke-profile.sh` |
| Host 级真跑 | ✓ 四类路径 + 三个场景 | `MY_PI_HOST_SMOKE=1 bash scripts/dsh-host-smoke.sh` 等（见 §2） |
| 守门 | ✓ A–L 段（含 DSH 双基线 J、`dsh/plugin` 类型 K、Markdown 表体 L） | `bash scripts/check-conventions.sh` |
| 留出集（pi 侧生命周期） | ✓ 3/3 | `PI_GOLDEN_SCENARIO=1 bash scripts/golden-tasks.sh` |

## 2. 怎么复跑全部验证（分层，从上到下由快到慢）

```bash
# ① 本地守门层（秒级～分钟级；含 DSH 双基线 J、dsh/plugin 类型 K、Markdown 表体 L）
bash scripts/check-conventions.sh
node scripts/check-doc-links.mjs && node scripts/check-md-tables.mjs && node scripts/check-dead-exports.mjs
node scripts/gen-registrations.mjs --check        # 注册面基线（59 工具 / 12 命令 / 2 快捷键）
bash scripts/check-portability.sh

# ② 类型与单测
npx tsc -p custom/ --noEmit && npx tsc -p dsh/ --noEmit
npx vitest run                                     # 期望 115 文件 / 1294 通过（6 跳过）

# ③ DSH 产物层（真实 @deepseek-ai/* 包）
bash scripts/dsh-spike.sh                          # 期望 22 通过 / 0 失败 / 0 跳过
bash scripts/dsh-build.sh                          # 构建 + 产物冒烟（**含自包含断言**）
bash scripts/dsh-package.sh                        # npm pack → 安装到独立目录 → 从那里加载（54 工具 / 0 失败）
bash scripts/dsh-smoke-profile.sh                  # 真实 launcher 接受插件进 profile（只 --dump-config，不启动 Host）

# ④ Host 层（用**你的凭据**调真实模型；默认 SKIP，需显式 opt-in；全程隔离 DSH_HOME、凭据拷 600 退出即删）
MY_PI_HOST_SMOKE=1 bash scripts/dsh-host-smoke.sh                    # 最小任务
MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-isolation.sh            # 两实例隔离（并发两实例）
MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-session-resume.sh       # 会话续接（--session-id 收养）
MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-mode.sh                 # 模式（启动期）生效

# ⑤ 全量 golden + 留出集（约 30 分钟；留出集**只在验收时看**，开发期不要拿它当"平时会变红"的守门）
PI_GOLDEN_SCENARIO=1 bash scripts/golden-tasks.sh
```

**改动时的最小门禁选择**（照 `WORKFLOW-INVARIANTS.md` 与 `scripts/README.md` 的纪律）：

| 你改了什么 | 至少跑 |
|---|---|
| `custom/adapters/dsh/**`、`dsh/**` | ③ 全部 + `npx tsc -p dsh/` |
| `custom/features/mode/**`、`custom/adapters/session-adapter.ts`、生命周期 | ⑤（**留出集必须跑**） |
| 工具名/描述（工具声明面） | `node dsh/spike/measure-surface.mjs --check`（或 `bash scripts/dsh-baseline.sh --check`） |
| `portable/agent/APPEND_SYSTEM.md`、`AGENTS.md`、注入面相关 | `bash scripts/check-injection-surface.sh` + `node dsh/spike/measure-prompt.mjs --check` |
| 任何文档/台账 | `node scripts/gen-doc-index.mjs --update`、`node scripts/knowledge-compile.mjs --update`、`node scripts/gen-changes-ledger.mjs --update`（**改的是源，不是派生物**——见 `CODING-TRAPS` #16） |

## 3. 部署与运行形态

**日常用就一条指令**（仓内便携，见 `DECISIONS.md` 2026-10-17）：

```bash
bash scripts/dsh-runtime.sh install --from-npx   # 只第一次：把 DSH 宿主装进 runtime/<平台>/ext/dsh/
./my-pi.sh                 # TUI（pi 基座，行为与主分支一致）
./my-pi.sh web             # Web UI（DSH 基座；默认 3099，避开 3080）
./my-pi.sh headless "任务"  # DSH 基座一次性执行
```

宿主**仓内优先**（否则退系统 `dsh`，最后才是 npx 并明确告警）；`DSH_HOME` 默认 `<repo>/portable/dsh`（gitignored，
**绝不碰 `~/.dsh`**）；凭据 600 拷进仓内 home；产物缺就现建；仓库根 `@deepseek-ai/*` 始终重指到当前宿主。
守门：`check-portability.sh` 的 **P6** 用行为证明"解析命中仓内 + `portable/dsh/` 不入库 + 版本单源"。


- **产物**：`bash scripts/dsh-build.sh` → `dsh/plugin/dist/my-pi-plugin.mjs`（gitignored，约 764 KB），
  由 `dsh/profile/my-pi.patch.yml` 以 `insert:` 挂进 profile（`id: my-pi`）。
- **自包含**：`@earendil-works/pi-*` 已在构建期被 `--alias` 改写并打进产物；
  `@deepseek-ai/*` 由**宿主**提供（本地跑由 `dsh-build.sh` 在仓库根建别名当等价物）。
- **启动**：`dsh --profile <名字> --patch <本仓 patch> "<任务>"`；隔离实验一律 `DSH_HOME=/tmp/...`。
- **诊断开关**：
  - `MY_PI_DSH_TRACE_EVENTS=1`：逐条打印 `session/event`（含 `agent/inbox/spliced` 的 target）+
    末尾一行**注册汇总**（工具/命令数、同名冲突跳过项、钩子清单）——"事件没到 / 到了没识别 / 识别了没处理器"靠它区分。
  - `PI_USAGE_DIAG_FILE=<路径>`：把回合用量台账写到别处（避免污染仓库默认那份）。
  - `PI_CODING_AGENT_DIR` / `PI_MEMORY_DIR`：**显式给就尊重**（插件只在未设置时才钉到仓库）⇒ 场景脚本靠它做隔离。
- **同名冲突现状**（真 Host 实测）：`工具 53 个、命令 10 个（… mypi-plan …）；同名冲突跳过 1 个（工具:subagent）；钩子 18 个`，
  `⚠️ 注册功能失败` 0 条。

## 4. 关键实测结论（每条都有可复跑证据）

| 结论 | 在哪里 |
|---|---|
| 工具定义**必须** `defineTool()` 编译（否则 provider 拒掉每个请求） | 计划 #18-t；spike A19 |
| cordis **未 inject 访问服务会抛**且插件不激活 | 计划 #18-t；spike A18 |
| 同名冲突**冒泡会连带丢掉该特性后面的注册**（含钩子） | 计划 #18-u；`BUG-REPLAYS` #41；spike A18/A21 |
| 回合用量：一条 `turn/end` 触发**多条**桥接 ⇒ 累积器必须"只读不销毁"、按**会话+回合**分桶 | 计划 #18-v；spike A20 |
| `input` 的 `streamingBehavior` 可从 `agent/inbox/spliced.target` 派生 | 计划 #18-z（真 Host 降级上报 3 条 → 0 条） |
| `commands.execute()` 真的会调用我们注册的处理器（**并在真 loop 下复验**：处理器看到的正是那个活会话） | 计划 #18-ac / #18-af；spike A22 / A26 |
| `sendUserMessage` 映射与 DSH 实现一致，**且运行时核实**：`steer` 落 `next-step`、在多步回合的**边界**被消费成独立 user 消息 | 计划 #18-ab（实现级：`dsh-agent-loop/lib/index.js:798-811`）+ #18-af（运行时：spike A25 的时间线） |
| 产物自包含 ⇒ 不再需要 profile 级 `pnpm.overrides` | 计划 #18-aa（搬走别名后真 Host 仍 0 解析失败） |
| **前缀缓存（第一成本杠杆）在 DSH 上成立**：每步只付增量、其余走 `cacheRead`，且**跨会话/跨 `--session-id` 续接**都命中 | 计划 #18-ad（真 Host 会话日志的 `usage` 逐条对比） |
| 移动端并发：宿主 `maxActiveSubagents` 是 `Volatile`（只有拥有者可写）⇒ 插件**读出来 + 超限报警 + 给部署片段** | 计划 #18-ae；spike A23；真 Host 两分支日志 |

## 5. 剩余缺口（**不假装已完成**）

| 项 | 分诊结论 | 依据 / 依赖 |
|---|---|---|
| **DR-1** chain 模式（`{previous}`） | ✅ **不需要移植**（真 Host 实测模型可见工具里含 `workflow`） | 宿主自带 `workflow`（模型写 JS **扇出** subagent，支持 phases/结构化结果/前后台）且在 headless profile 里**已启用** ⇒ 覆盖了"顺序链"；差别只是宿主建议小规模委派用普通 `subagent` 调用（`dsh-tool-workflow/README.zh.md`） |
| **DR-5** Termux 并发降级（8→2） | 🟡 **部分恢复**（读+报警+片段） | 契约核实 `Volatile<number>` **只有 `get()`**、值只由其拥有者更新 ⇒ 插件**改不动**；改为只读核对 + 移动端超限**明确报警**并给部署层覆盖片段。真 Host：桌面 `=8 保持默认`、`TERMUX_VERSION=1` 打出警告与片段。✗ 运行期自动压到 2 **做不到** |
| **DR-2** 目录扫描式 agent 定义 | ⏳ 待重设计（**已决定不做默认启用**） | 宿主支持**每实例 persona/工具权限**的 subagent 工具实例，`AgentPresetRegistry.register()` 也能编程注册预设；但 `subagent` 工具**没有 agent/preset 参数** ⇒ "这次委派用哪个具名 agent"表达不出来。**可行路径**：插件装载时按目录为每个具名 agent 加载一个宿主 subagent 工具实例（`toolName=<agent 名>` + persona + 工具权限），由**工具名**承载身份，顺带给 DR-4 提供可靠的映射键。**默认不做**：每个 agent 都变成模型可见工具 ⇒ 工具面/成本上升且改变模型行为 ⇒ 记为可选部署特性 |
| **DR-3** 逐任务 `cwd` | ⏳ 待重设计（宿主缺参数） | 已核实宿主 `subagent` 参数只有 `prompt/description/provider/model/reasoning_effort/run_in_background`；替代：任务里显式 `cd` |
| **DR-4** 进程外投递 CLI | 🟡 **部分恢复**（当前会话收件箱） | `scripts/dsh-inbox.mjs` + 插件桥 `session-inbox.ts`（`inbox.enabled`，默认关）：外部进程投递 → 活 agent（`steer`/`followup`），`seq`+state 幂等可重放；真 Host 实测 3 条全部送达。✗ 子代理中途投递仍缺宿主侧"子会话↔工具"关联 |
| 真 agent（loop 驱动）层语义 | ✅ **已验（运行时）** | 装置已搭成（spike A24–A26）：真 loop + 真 session/tools/commands/projections + **脚本化假模型**（`LlmAdapter` 抽象面只有 `stream()`）。A25 证明 `steer` 落 `next-step` 且在第 1 步结束后被消费成独立 user 消息；A26 证明真 agent 下 `commands.execute()` ⇒ `result.kind=success` 且处理器看到活会话。✗ 边界如实标注：模型是**脚本化假模型**（不是真 provider），所以"真 provider 的流式细节/重试"仍不在本装置覆盖范围内 |
| `input.transform` | 潜伏能力（**已测无消费者**） | 4 个 `input` 处理器全是观察者、无人返回改写（逐个读过） |
| `turn_end` 的 `toolResults` | 潜伏缺口（**已测无消费者**） | `grep -rn "toolResults" custom/features` 无命中 ⇒ 目前没人读它（哪天有 feature 读，再按会话日志合成） |
| 合成用量的 `cost` | 已知占位（**已测无消费者**） | DSH `TokenUsage` 不含定价；`grep` 确认无 feature 读 `usage.cost` |
| `appendEntry` | 明确不支持 | DSH 日志类型封闭声明（写进去污染投影/不变式） |
| 客户端层（快捷键/消息渲染器） | 明确不支持 | 属 DSH 客户端插件领域，非内核 |

## 6. 经验与陷阱（本次新增）

| 编号 | 一句话 | 在哪 |
|---|---|---|
| #39 | 守门脚本的开关组合会把它变成"只测量"（虚假绿） | `BUG-REPLAYS` |
| #40 | 共享状态"取走即销毁" ⇒ 多订阅者只有第一个拿到（静默丢数据） | `BUG-REPLAYS`；`CODING-TRAPS` #11 |
| #41 | 上游"注册冲突"错误冒泡 ⇒ 连带丢掉该特性后面的一切注册 | `BUG-REPLAYS`；`CODING-TRAPS` #12 |
| #42 | `local a="$1" b="x-$a"` 在 `set -u` 下报 unbound（词先展开再赋值） | `BUG-REPLAYS`；`CODING-TRAPS` #13 |
| #43 | 打包冒烟自新增宿主 import 起**静默失效**（它不在自动门禁里） | `BUG-REPLAYS`；`CODING-TRAPS` #14（`ln -sfn` 目录语义） |
| #44 | 把依赖 `this` 的方法解绑调用 ⇒ 静默 `undefined`，打穿模式重启链（**留出集**抓到） | `BUG-REPLAYS`；`CODING-TRAPS` #15（箭头函数 fake 会保护这类 bug） |
| #45 | 把**派生产物**当事实来源写 ⇒ 记录被生成器静默覆盖 | `BUG-REPLAYS`；`CODING-TRAPS` #16 |

## 7. 交接提示

- 合并状态：**已并入 `main`**（快进，合并点 `dcdc3dfe2`，标签 `v1.3.0-dsh`）；原分支 `feat/base-switch-dsh`
  保留作二次回滚保险（确认稳定后可删）。DSH 是实验性第二底座，默认行为仍是 pi。
- **纪律**：不 force-push；不改 `main`；不绕守门（禁 `--no-verify`）；不降阈值/不抬预算；
  留出集**只在验收时看**（开发期不要用它做"平时会变红"的守门）。
- **最容易踩的两处**：
  ① 改 `mode`/`session-adapter`/生命周期 ⇒ **必须**跑 `PI_GOLDEN_SCENARIO=1`（本次就是这样抓到 #44 的）；
  ② 记录类操作（台账/知识库/索引）⇒ **只改源文件**，改完跑生成器（`CODING-TRAPS` #16）。
