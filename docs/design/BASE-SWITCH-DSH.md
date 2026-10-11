# 换基座评估：把 my-pi 的基座从 pi 换成 DSH（**已记录，未排期**）

> 状态：**仅记录评估，不做改动、不排期** ✓（用户 2026-10-10 决定："先记录，后续再决定什么时候测试" ✓）。
> 本文把**已实测的事实**与**未验证的推断**严格分开 ✓ —— 后者一律标 ✗，不得当作依据。

## 一、结论先行

**这不是"换一个依赖"，而是"换一个平台"** ✓：
**可搬的资产很多**（技能/模板/文档/脚本/台账体系 ✓），但
**① 基座耦合层要重写**（11 个补丁 + 监督器 + 子代理池 ✗）、**② 所有与 pi 内部绑定的验证基线要重建** ✗✗。
最大未知是 **DSH 的"工具/钩子注册契约"** ✗ —— 一个 spike 就能量出来（见第五节 ✓）。

## 二、my-pi 对 pi 的耦合面（**本仓库实测** ✓）

| 面 | 实测数字 | 性质 |
|---|---|---|
| **补丁** | **11 个**（`patches/*.patch` ✓） | **绝大多数是 UI 层**：品牌、页脚（005–009 共五个）、Tab 补全、成本显示、回滚、`tool-search` 的 CJK、禁用 `/share` ⇒ **不是深层架构钩子** ✓（但目标 UI 形态不同 ⇒ 见第四节的"重做"✓） |
| **特性层** | **223 个 TS**（`custom/features/**` ✓） | 只用了 **4 个原语**：`registerTool` **57**、`registerHook` **64**、`registerCommand` **20**、`registerShortcut` **4** ✓（另有 37 处 pi 类型导入 ✓）⇒ **耦合"窄而深"** ✓ |
| **运行时绑定** | `scripts/pi-supervisor.sh`（自愈外壳 ✓）、子代理池走 **`pi --mode rpc`** ✗、模式/会话管线（`lib-mode.sh` 等 ✓） | 与 pi 的 **CLI 契约**绑定 ✓ |
| **其它资产** | `scripts` **66** 项、`docs` **80** 篇、`packs` **847** 个文件 ✓ | **多数与基座无关** ✓（纯 Node/bash/Markdown ✓） |
| **许可** | my-pi = **MIT** ✓ | 与 DSH 的 MIT **兼容** ✓（但注意：**移植是"重写"，不是复制代码** ✓） |

## 三、DSH 的扩展模型（**从它自己的 README 与 `lib/types/` 实测** ✓）

- **不是单一 CLI，而是"启动器 + profile"**：profile 由**多个插件组合包（bundles）按 patch 层顺序叠加** ✓；
- 插件管理：**`dsh plugin --profile <name> <pnpm args>`** ✓；profile 目录含 `package.json`（**`dsh.profile` manifest** + 有序 `bundles` 列表 ✓）+ **`cordis.patch.yml`**（用户 patch 层 ✓）；
- **扩展模型 = cordis 插件** ✓：有配置 schema、**peer 版本兼容检查**、`dsh-hmr` 热重载 ✓；
- 内置 bundle：`dsh-base` / `dsh-web-app` / **`dsh-headless`** / **`dsh-sdk-app`** / **`dsh-sdk-minimal`** / **`dsh-acp-app`** ✓；
- 版本/许可（实测）：`@deepseek-ai/dsh` **0.2.0-rc.2** ✓、**MIT** ✓；
- ⇒ **它自带可编程入口（SDK / ACP）** ✓✓ —— 这对 my-pi 的子代理池是**好消息**（比 pi 的 `--mode rpc` 更正式 ✓）。

**✗ 未验证（本记录的最大缺口，不得当依据）**：**DSH 的"工具/钩子注册契约"具体形态** ——
我只确认到它用 cordis 插件 + profile 组合 + 有 SDK/ACP profile ✓，**没有读 `lib/types/plugin.d.ts` 的内容** ✗。

## 四、工程量分块

| 块 | 内容 | 量级 |
|---|---|---|
| **A. 几乎原样可搬** ✓ | `packs/**`（技能与模板 ✓）、`docs/**`、**大部分 `scripts/**`**（纯 Node/bash ✓）、知识库与台账体系 ✓ | **体积上占多数** ✓ |
| **B. 需写适配层**（最集中） | 把 **4 个原语**映射到 cordis：`registerTool` → 工具注册 ✓、`registerHook` → 事件 ✓、`registerCommand`/`registerShortcut` → 命令/快捷键 ✓ | **若映射干净，223 个特性文件大多不用改** ✓✓ |
| **C. 必须重做** ✗ | ① **11 个补丁**：目标是 pi 的**终端 UI**，而 DSH 是 **web/GUI + profile** ⇒ 多数属"**重新实现或直接不需要**" ✓；② **监督器/模式/会话管线**：pi CLI 专属 ✗，DSH **自带 boot/HMR/启动诊断** ⇒ 可能**被替代** ✓；③ **子代理池**：`--mode rpc` ✗ ⇒ 改用 **SDK/ACP profile** ✓（约 6 个核心文件重写 ✓） | **大头** ✗ |
| **D. 全部基线要重建** ✗✗ | **注入面基线哈希的是 pi 的系统提示** ✗、工具面字节预算 ✓、**真跑 pi 的场景测试**（模式切换/两实例隔离 ✗）、补丁可应用性检查 ✓ | **中到大，且最易被低估** ✗ |

> **D 为什么最危险**：它**不产生新功能**，却决定"**改完还能不能证明自己是好的**" ✓ ——
> 本会话反复证明：**没有守门的地方，错误不会被发现，只会被传播** ✓。

## 五、建议的 spike（**用户决定测试时，照此执行即可** ✓）

**目标**：把上面最大的未知（B 的契约）**量出来**，让估算从"拍脑袋"变成"有系数" ✓。**不碰 my-pi 仓库** ✓（零风险 ✓）。

1. 起一个 profile：`dsh --from-default-profile sdk-minimal base-spike`（或依 `dsh plugin --profile …` 的官方用法 ✓）；
2. 写一个**最小 cordis 插件**：注册**一个工具**（`registerTool` 的等价物 ✓）+ 订阅**一个事件**（`registerHook` 的等价物 ✓）；
   两件事分别**记录实际耗时与踩到的坑** ✓；
3. 用 **`dsh-sdk-minimal`** profile 跑起来 ✓，确认工具**能被调用**、事件**能收到** ✓；
4. 读 `lib/types/plugin.d.ts` 与对应 README，**把契约写成对照表**（pi 原语 → DSH 原语 ✓），
   并标出**无法一一对应**的原语 ✗（那部分决定 B 的真实大小 ✓）；
5. 产出：**一份"一个特性端到端"的实测工时** ✓ ⇒ 乘 223 文件的可复用比例 ✓ ⇒ **有系数的估算** ✓。

**判断门槛（建议）**：若 spike 显示"4 个原语都能干净映射" ✓ ⇒ B 小、整体可行的概率高 ✓；
若**有原语无等价物** ✗ ⇒ 受影响的特性数要先数清（`registerHook` 最多，**64 处** ✓），再决定是否继续 ✓。

## 六、风险与前提（如实）

1. **对标的是 RC 版本**（`0.2.0-rc.2` ✗）⇒ **接口可能变动** ✓；换基座前应锁定一个**稳定版**或接受跟随成本 ✗；
2. **UI 形态不同**（DSH 是 web/GUI + profile ✓；pi 是终端 TUI ✓）⇒ 11 个补丁里的 UI 部分不是"移植"而是"**重新决定要不要**"✓；
3. **验证体系重建**（D 块 ✓）必须计入工期，**否则会出现"功能搬过来了但无法证明它没坏"** ✗；
4. **不允许边搬边丢守门** ✗ —— 本项目既有纪律：**宁可显示缺口，也不显示虚假的绿色** ✓。

---

# 附：spike 实测结果（2026-10-10）—— **最大未知已量出** ✓

> 本节是第五节的 spike **实际执行结果** ✓（隔离 `HOME=/tmp/dsh-spike` ✓，**未动 my-pi 仓库、未改 DSH 安装、无 git 写操作** ✓）。
> **先纠正上一版的一个错误指向** ✗✓：本文原先说"最大未知在 `lib/types/plugin.d.ts`" —— 实际**那只是 `dsh plugin`
> 包管理命令的类型** ✗，**不是**工具/钩子契约 ✓。真正的契约在下文（有文件:行号 ✓）。

## 1. 契约实况（实证 ✓）

| 原语 | DSH 的形态 | 证据 |
|---|---|---|
| **注册工具** | **`ctx.tools.register(defineTool({ … }))`** ✓ | `@deepseek-ai/dsh-tool-cordis/lib/index.js:39`（另见 `:55`）✓ |
| **工具定义** | `defineTool({ name, description, parameters, **output: { schema（canonical）, render(args,value) }, execute(args,exec), deferLoading?, timeoutMs?, isConcurrencySafe? }`）✓ | `@deepseek-ai/dsh-tools/lib/types/schema.d.ts:178-248` ✓ |
| **钩子/事件** | **cordis 事件** ✓（`declare module '@deepseek-ai/cordis' { interface Events {…} }`）；例：**`'tools/pre-execute'(this, exec, next)`**，**waterfall 模式** ✓ | `@deepseek-ai/dsh-tools/lib/types/index.d.ts:32-47` ✓ |
| 生态规模 | `@deepseek-ai/*` 下约 **250 个包** ✓（含 `dsh-tools` / `dsh-tool-*` / `dsh-commands` / `dsh-hook-protocol` / `dsh-session*` / `dsh-subagent*` / `dsh-client-ui-*` / `cordis-plugin-*` ✓） | 包目录实测 ✓ |

## 2. 最小 spike 跑通（原始输出 ✓）

```
[① 工具] defineTool 返回： object | name= spike_echo | 有 execute= function          ✓ 工具定义原语可用
[② 事件] ctx.on 订阅后 emit：handler 收到 = {"hello":"dsh"}                          ✓ cordis 事件（=钩子）可用
[③ 注册入口] root.tools.register 可用 = false   ← 裸 Context 没有 tools 服务（该服务由工具插件在真实 profile 里注入 ✗）
[耗时] 导入 358 ms | 总计 406 ms
```
⇒ **① 工具定义 ✓ 与 ② 事件订阅 ✓ 两原语可用**；③ 需**完整 profile** 才验证（**未跑** ✗）。
可复跑脚本留存：`/tmp/dsh-spike/spike.mjs` ✓（约 1 KB ✓）。

## 3. 对照表：**pi 原语 → DSH 原语**（★ = 无等价物或形态差异大 ✗）

| pi 原语（my-pi 用量 ✓） | DSH 对应 | 差异 / 风险 |
|---|---|---|
| `registerTool`（**57**） | `ctx.tools.register(defineTool({…}))` ✓ | ★**差异大**：pi 用 typebox `Type.*`；DSH 用**按属性 schema** 且**必填 `output`（canonical schema + `render` 投影）** ⇒ **每个工具要额外写输出 schema 与渲染** ✗ |
| `registerHook`（**64**） | cordis 事件 `ctx.on('<event>', …)` ✓（**waterfall + `next()`**） | ★**事件名与语义完全不同** ⇒ **必须逐个人工映射** pi 的 `tool_call`/`tool_result`/`session_shutdown` 等 ✗；DSH 还多一层"**事件模式**"概念 ✓ ⇒ **这是最大不确定项** ✗ |
| `registerCommand`（**20**） | 有 **`@deepseek-ai/dsh-commands`** ✓ | ✗**契约未读**（只确认"有这一层" ✓） |
| `registerShortcut`（**4**） | `dsh-client-shortcuts` / `dsh-client-ui-shortcuts` ✓ | ★**在客户端层、不在内核** ✗（pi 的在核心 ✓）⇒ 属"另一层的事" |
| 会话/模式/监督器 | `dsh-session*`（含 format **v0→v4 迁移** ✓）、`dsh-schedule`、`dsh-jobs`、`dsh-hmr`、`dsh-plugin-manager` ✓ | ★多半**被 DSH 自带能力替代** ✓（不是移植 ✓） |
| 子代理池（`pi --mode rpc` ✗） | **`dsh-subagent` + `dsh-tool-subagent` + `dsh-subagent-in-process-driver` / `-spawn-in-process`** ✓ | ★**实现完全不同** ⇒ **要重写** ✓，但**有官方包可依赖** ✓✓ |

## 4. 成本与换算（**明确不给"假装精确的工期"** ✗）

- **实测**：工具定义 + 事件订阅的**运行时代价可忽略**（**406 ms**，其中导入 **358 ms** ✓）。
  ⇒ **真正的代价是"读契约"**：本次用 **3 轮探查**（agent 小时级 ✓）才定位到 `ctx.tools.register` + `defineTool` ✗。
- **换算假设（显式列出 ✓）**：① 223 个特性**不重写**、走 **shim**（`registerTool`→`ctx.tools.register` ✓、`registerHook`→`ctx.on` ✓）；
  ② DSH 的事件集**覆盖**所需生命周期点（**我只确认了 `tools/pre-execute` 一个** ✗）；③ `0.2.0-rc.2` 接口**接近稳定** ✗（未验证 ✓）。
- **在这些假设下**：shim 的杠杆最大（4 个原语 ⇒ 一层适配 ✓）；但成本集中在两处 ✗：
  **① 57 个工具**各补 `output.schema` + `render`（机械但逐个要写 ✓）；**② 64 个钩子**要**人工映射事件名与语义** ✗（**最大不确定项** ✓）。
- **下一步（真正的降不确定办法，比拍工期有用 ✓）**：先把 my-pi 的 **64 处 hook 按事件名归类**（去重后剩几类 ✓），
  再对 DSH **现已声明的 `Events`** 逐类找对应 ⇒ 产出"**可映射 / 需改语义 / 无对应**"**三档清单** ✓
  ⇒ **那才是能用来换算的输入** ✓。

## 5. 本次未验证（如实 ✗）

1. **未跑完整 profile** ⇒ `ctx.tools.register` 在**真实服务里未验证** ✗（`dsh plugin` 需 pnpm/网络，未跑 ✗）；
2. **DSH 的完整事件清单未读** ✗（只读了 `dsh-tools` 的 `Events` 块 ✓）；
3. **`dsh-commands` 契约未读** ✗；
4. **DSH 是否有终端 UI**（关系到那 **11 个 UI 补丁**的去留）**未查** ✗；
5. 受内存约束（本机可用约 1.8–2.5 GB），**未起完整 profile 或任何重进程** ✓（只跑了一个 406 ms 的 node 进程 ✓）。

## 6. 结论（相对上一版的变化）

**从"最大未知 ✗"变成"契约已知、两原语可用 ✓，成本集中在 57 工具的输出 schema 与 64 钩子的事件映射"** ✓✓。
⇒ 换基座**可行性上升**（有官方 `dsh-subagent` 等包可依赖 ✓），但**工作量仍未可精确估计** ✗ ——
因为**最大不确定项（64 钩子的语义映射）尚未分类** ✓；建议先做第 4 节末尾那份"三档清单"再谈工期 ✓。

