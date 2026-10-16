# dsh/ —— my-pi 在 DSH 上的落点（插件打包 + profile 接线）

底座从 pi 换到 DSH 分两层：

| 层 | 位置 | 作用 |
|---|---|---|
| **适配层**（机制） | [`custom/adapters/dsh/`](../custom/adapters/dsh/README.md) | 把 DSH 的 `Context` 包装成 pi 形状 API（工具/钩子/命令/快捷键），features 一行不改 |
| **交付层**（本目录） | `dsh/plugin/`、`dsh/profile/` | 把适配层 + 全部特性打成**可安装产物**，并给出能被真实 `dsh` launcher 接受的 profile 覆盖层 |

## 目录

```
dsh/
  baseline/
    tool-surface.json # ★ DSH 侧**工具声明面基线**（54 工具 / 25,761 B；由 --update 生成）
  plugin/
    entry.ts         # 产品入口：把 custom/bootstrap.ts 的全量特性固定进来（机制在 custom/adapters/dsh/plugin.ts）
    package.json     # 产物包元信息 + 依赖声明（typebox/ws/tinyglobby + 可选 playwright/@xterm）
    dist/            # ★ 构建产物（gitignored，由 scripts/dsh-build.sh 生成）
  profile/
    my-pi.patch.yml  # 插进 DSH profile 的覆盖层（`insert:` 语义；相对路径以本文件为锚点）
  spike/
    package.json     # spike 用的 DSH 依赖（gitignored node_modules）
    spike.ts         # 源码级端到端（A1–A17，含真实搜索/拦截/全量 bootstrap/命令服务/会话生命周期/动态上下文/会话事件桥/工具结果替换/消息投递/会话枚举/流帧翻译）
    smoke-built.mjs  # **产物级**冒烟（纯 node，无 tsx）
```

## 怎么跑（三条命令，都不启动 Host）

```bash
bash scripts/dsh-build.sh            # 打包 + 产物冒烟（纯 node 加载 dist，断言 54 工具 / 0 失败）
bash scripts/dsh-spike.sh            # 源码级 spike（A1–A17，真实 @deepseek-ai 包 + pi shim）
bash scripts/dsh-smoke-profile.sh    # 真实 launcher 的 profile 组合干跑（隔离 DSH_HOME，--dump-config）
bash scripts/dsh-package.sh          # **正式发布形态**：npm pack → 安装到独立目录 → 从 node_modules 加载
bash scripts/dsh-baseline.sh --check # 工具声明面漂移守门（P6 第一块；漂移 ⇒ exit 1）
```

## P6 第一块：工具声明面基线（已重建）

换底座后**旧的字节账不能继承**（声明格式不同）⇒ 重新量并留守门：

| 口径 | 值 |
|---|---|
| 单个声明 | `{ name, description, parameters: parameterSchemaSpecToJsonSchema(spec), deferLoading? }` 的 UTF-8 字节 |
| 合计 | **54 工具 / 25,761 B（25.2 KB）**，sha256 存于基线 |
| 最大 5 | `subagent=1860B`、`goal=1442B`、`schedule_task=1426B`、`memory_search=1040B`、`todo=1003B` |

```bash
bash scripts/dsh-baseline.sh                  # 两块都测量并打印
bash scripts/dsh-baseline.sh --check          # 任一漂移 ⇒ exit 1（开关可组合：--prompt --check / --tools --update）
bash scripts/dsh-baseline.sh --update         # 更新基线（需人工确认后提交；纪律：不擅自抬预算）
```

✗ 与 pi 侧 `TOOL-BUDGET-DECISION.md` 的 **24,785 B 不是同一口径**（那是 system prompt + 声明的整段前缀），
所以只各自守各自漂移，**不做减法**。

## P6 第二块：注入面接线 + 基线（已重建）

pi 的 `APPEND_SYSTEM.md` 在 DSH 上**没有等价约定** —— 它只有 `SystemPrompt.section()` 服务。
不接线的话，那段指令在 DSH 上根本不会进提示词，**而且不会报错**（静默失效）。

- `custom/adapters/dsh/system-prompt.ts`：把 `portable/agent/APPEND_SYSTEM.md` 注册为
  `my-pi:append-system`（`order` = 已知工具段最大值 2400 + 100 = **2500**；`interpolate:false`
  保留 `{{...}}` 字面量）；服务缺失或文件不存在都**上报**，不静默。
- `dsh/plugin/entry.ts`：`apply()` 里接线，disposer 交给 facade 统一回收。
- 基线 `dsh/baseline/system-prompt.json`：哈希 `renderPrompt(await ctx.systemPrompt.assemble())`
  （最小 harness 口径：1324 B / 4 段），并记录"我们的段就是渲染结果的**结尾**"——用
  `isSuffix` **直接判**，不靠 order 推断（组装结果里的 section 不带 order）。
- 反证：改一行 `APPEND_SYSTEM.md` ⇒ `--prompt --check` exit 1 并点名三条漂移（渲染 sha、源文件、
  段内容）；`git checkout` 复原 ⇒ exit 0。另有"开关组合"的坑记在 `docs/BUG-REPLAYS.md` 第 39 条。

## profile 接线的实测结论（**踩过再写下来**）

| 尝试 | 结果 |
|---|---|
| `- id: my-pi` + `name: …` | ❌ `patch: entry "my-pi" not found` —— `id` 是**覆盖已有条目**的语义 |
| `- insert: [{ id: my-pi, name: … }]` | ✅ 组合树打印 `- id: my-pi / name: file:///…/my-pi-plugin.mjs` |

`--dump-config` 是**只组合、不启动**的干跑，所以能在不打扰正在运行的 `dsh web`、
也不碰凭据/内存的前提下，证明"插件被真实 launcher 接受"。实测（dsh 0.2.0-rc.2）：模板
`headless` 基线条目 96 条，叠加后出现我们的条目 ✓。

## ✗ 尚未做（如实）

1. **Host 级真正启动未验证**：需要有凭据的 `DSH_HOME` + 内存（本机约 1.8–2.5 GB 可用）+
   不能打扰正在运行的 GUI ⇒ 单列为下一步，不在这里硬跑。
2. **形式化发布**：目前 profile 通过**相对路径**引用产物；正式做法应把 `my-pi-dsh-plugin`
   作为 profile 依赖 install（`dsh plugin --profile …` 走 pnpm），并处理它的依赖树。
3. **基线重建（P6）**：注入面基线 / 工具面预算 / 场景测试 / 补丁检查都还是 pi 侧的，
   DSH 侧必须重算（见 [DSH-MIGRATION-PLAN](../docs/design/DSH-MIGRATION-PLAN.md) 第 4 节 D 块）。
4. **行为等价**：目前证到"能加载、能注册、工具能被真实注册表调用、拦截语义生效"；
   逐特性的行为差异（尤其会话生命周期与压缩干预那 7 个 ② 档事件）仍需逐条迁移。

## 相关

- 迁移执行计划与进度：[`docs/design/DSH-MIGRATION-PLAN.md`](../docs/design/DSH-MIGRATION-PLAN.md)
- 可行性评估（含 2026-10-10 spike 原始输出）：[`docs/design/BASE-SWITCH-DSH.md`](../docs/design/BASE-SWITCH-DSH.md)
- 钩子逐类映射（18→19 条）：[`docs/design/DSH-HOOK-MAPPING.md`](../docs/design/DSH-HOOK-MAPPING.md)

## 正式发布形态：打包 → 安装 → 从 node_modules 加载（已验通）

`bash scripts/dsh-package.sh` 做四件事（每步都有自检）：

1. 构建产物（`dist/my-pi-plugin.mjs`）→ `npm pack` 出 tgz；
   **tgz 自检**：必须含 `dist/` 产物、不得夹带源码/测试（`files` 白名单）；
2. `npm install <tgz>` 到 `/tmp/my-pi-plugin-install`（依赖一并装好）；
3. **部署侧别名**：`node_modules/@earendil-works/{pi-tui,pi-coding-agent}` → 本仓 `pi-shims/*`
   ★ **这一步是真实部署必须做的**（等价于 profile 的 pnpm overrides）。缺它会在**加载期**报
   `ERR_MODULE_NOT_FOUND: Cannot find package '@earendil-works/pi-tui'` —— 本脚本首次运行时就撞上了这条；
4. 纯 node 从**已安装位置**加载并 apply ⇒ 实测 **54 个工具 / 0 个特性失败 / `getAllTools()` 一致** ✓。

✗ profile 级 overrides 的写法（`pnpm.overrides` 指向 shim 包）尚未在真实 profile 里跑过（Host 级）。

## Host 级验证（2026-10-18，已跑通）

```bash
MY_PI_HOST_SMOKE=1 bash scripts/dsh-host-smoke.sh   # 默认 SKIP：会用凭据/额度/内存，需显式 opt-in
```

隔离 `DSH_HOME`（凭据只临时拷一份 600，退出即删）→ 从内置 `headless` 模板建 profile → 叠加本仓 patch
→ 真实启动一次最小任务。**实测结果：退出码 0、插件日志 28 行、钩子在真 Host 里触发、模型回了「收到」** ✓。

★ 这一跑抓出并修掉了两个**本地 19 项 spike 全绿也没抓到**的致命问题（详见
[`../docs/design/DSH-MIGRATION-PLAN.md`](../docs/design/DSH-MIGRATION-PLAN.md) 实测 #18-t）：

1. **`inject` 约束**：未 `inject` 就访问 `ctx.commands` 会抛错且插件**不激活** ⇒ 服务统一经
   `getDshService()`（先 `ctx.get()` 再属性读，两路都 try/catch）取；
2. **工具定义必须 `defineTool()` 编译**：直接注册原始 spec ⇒ provider 拒掉**每一个请求**
   （`got 'type: null'`）⇒ 新增 `DshFacadeOptions.compileTool` 注入点（插件入口注入 `defineTool`）。

回归守门：spike **A18**（按 cordis loader 装载产物）＋ **A19**（`schemas()` 里每个工具的
`parameters.type === 'object'`）。

### 可复跑的四种路径 + 三个开关

| 想验的东西 | 怎么跑 | 已验到的证据（2026-10-18） |
|---|---|---|
| 插件加载 / 钩子触发 | 默认 prompt | 退出码 0、插件日志 28 行、模型回「收到」 |
| **工具调用**路径（模型→注册表→特性处理器→模型） | `MY_PI_HOST_PROMPT="请调用 memory_stats 工具…"` | DSH 会话日志 `tool/call name=memory_stats`、`tool/result` 内容正是 my-pi 的输出，模型据此作答（128 行插件日志） |
| **改名后的 `searxng`**（模型可见性 + 可执行） | `MY_PI_HOST_PROMPT="请调用 searxng 工具搜索…"` | `tool/call name=searxng arguments={"query":"deepseek harness","maxResults":5}`；结果即本工具的 SearXNG 降级输出 |
| **回合用量**路径（`assistant/message.usage` → pi `turn_end`） | 加 `MY_PI_DSH_TRACE_EVENTS=1 PI_USAGE_DIAG_FILE=/tmp/x.jsonl` | 三条桥接全部 `用量补丁=yes`；未被改动的特性写出 `{"input":213,"cacheRead":10368,"output":2,"total":10583}`（见实测 #18-v） |
| 会话事件**到没到**（静默失效排查） | `MY_PI_DSH_TRACE_EVENTS=1` | 每收到一条会话事件打一行 ⇒ 区分"没到 / 到了没识别 / 识别了没处理器" |

其余可调：`MY_PI_HOST_PROMPT`（换任务）、`MY_PI_HOST_HOME`（换隔离 home）、`MY_PI_HOST_LOG_DIR`、
`MY_PI_HOST_CREDENTIALS`（换凭据文件）、`PI_USAGE_DIAG_FILE`（用量落盘位置，避免写进仓库记忆库）。

### 真 Host 实测的"注册汇总"（`MY_PI_DSH_TRACE_EVENTS=1`）

```
[my-pi-dsh] trace 注册汇总：工具 53 个、命令 10 个
             （usage-diag, context, tools, memory, mode, mypi-plan, …）；同名冲突跳过 1 个
             （工具:subagent）；钩子 18 个（…）
```

★ 这一行是**必需**的，不是锦上添花：DSH 原生占用了工具 `subagent` 与命令 `plan`（原先还有工具 `web_search`，已于 2026-10-18 **改名 `searxng`** 以保留自家后端），
而"同名冲突"原先会**冒泡**，被 `registerAll` 的"每特性 try/catch"接住 ⇒ **该特性排在后面的注册
全部被跳过**（实测：`web-search` 丢了 `fetch_url`，`subagent`/`plan-mode` 丢了钩子 —— 而 plan-mode
的只读护栏很可能就在钩子里，从工具数量上看不出来）。现在冲突**就地隔离**（只跳过冲突项并点名上报），
"到底少了什么"由这一行列清（口径见 `custom/adapters/dsh/facade.ts` 的 `registrationSummary()`）。

### 场景测试（P6③）：两实例隔离已有 DSH 版

```bash
MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-isolation.sh   # 默认 SKIP（跑两次真实模型）
```

换底座后**旧的绿色不能继承**：pi 侧 `scripts/test-scenario-*.mjs` 断言的是 pi 的进程/状态语义，
DSH 的 Host/Session 语义不同 ⇒ 场景必须**重写**。已重写的第一个（两实例隔离）问的是仍然成立的问题：
两实例各自隔离 `DSH_HOME`、但**共用同一个仓库状态**（`portable/`）会不会串。实测：两实例并发退出码 0、
各 28 行插件日志、A 答「甲」/B 答「乙」（各自服务自己的 prompt）、会话 id 不同、用量各写各的且
**仓库默认台账行数未变**、无脏目录。模式切换与会话切换仍待重写（前者依赖命令执行、后者在 DSH 上
"切换前否决"本就没有落点）。

### 类型守门：`dsh/` 有自己的 tsconfig

官方 `tsc -p custom/` **不收 `dsh/**`** ⇒ 这里长期只过 esbuild/tsx（**不做类型检查**），错误会一直积累。
`dsh/tsconfig.json` + `scripts/check-conventions.sh` 的 **K 段**（条件：装了 spike 依赖才跑）补上这一环 ——
它当场抓到 `dsh/plugin/entry.ts` 里两处既有类型错（`facade.disposers.push(...)` 与
`readonly DshDisposer[]` 冲突），而那两行**每次插件启动都要跑**。spike.ts 刻意**不**纳入：它是类型探针，
故意往真实 API 传裸值，补一堆 `as` 换不到安全性。

✓ **同名冲突已决策（2026-10-18）**：工具 `subagent` 让位宿主；命令 `plan` **换名注册为 `mypi-plan`**
（不再让位 ⇒ 子命令面与落盘/续跑路径保住，见 `DshFacadeOptions.commandNameMap`）；工具 `web_search`
改名 `searxng` 保留；my-pi 的只读护栏钩子与 `plan_enter`/`plan_exit` **保留**。让位的代价
（chain、目录扫描式 agent 定义、逐任务 `cwd`、进程外投递、Termux 并发降级、plan 命令面与落盘）
逐条登记为 **DR-1…DR-7**，见
[`../docs/design/DSH-DUPLICATE-CAPABILITY-AUDIT.md`](../docs/design/DSH-DUPLICATE-CAPABILITY-AUDIT.md) §6/§7。
