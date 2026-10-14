# 上游 pi 1.2 更新内容与 my-pi 同步分析

> 结论：**建议同步，但必须先干跑 + 对 3 处适配**。本文只做分析与建议，未改动任何代码。
> 数据来源：npm registry 的 1.2.0 包内 `CHANGELOG.md`（权威）+ 本仓库 `vendor/pi`、`patches/`、`scripts/sync-upstream.sh`。

## 0. 现状版本（附证据）

| 项 | 值 | 证据 |
|---|---|---|
| 我方钉住的 pi 基线 | **1.0.4** | `vendor/pi/packages/coding-agent/package.json` 的 version（14 个包同为 1.0.4） |
| 同步点 | `28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9` | `vendor/pi/LAST_SYNC_POINT` |
| 上游仓库 | `https://github.com/earendil-works/pi-mono.git` | `scripts/sync-upstream.sh` 的 `PI_UPSTREAM_URL` |
| 上游最新 | **1.2.0**（2026-10-12 发布） | npm dist-tags：`latest: 1.2.0`；另有 `legacy-node20: 0.74.2` |
| 中间版本 | **1.1.0**（2026-10-07） | npm 的 time 字段；1.0.4 为 2026-10-05 |
| 上游 node 要求 | `engines.node >= 22.19.0` | npm 1.2.0 元数据 |
| 上游依赖里与我们有关的 | **typebox 1.3.27** | npm 1.2.0 元数据（我们曾踩 `Type.Null` 那条线） |

⇒ **落后两个 minor（1.0.4 → 1.1.0 → 1.2.0）**。

## 1. 同步模型（照项目自带流程，不自创）

`scripts/sync-upstream.sh`：**`patches/` 是唯一真值**；vendor 分支 = 上游基线 + 每个补丁一个本地 commit；
同步时在**临时 worktree** 里把补丁重新应用到目标基线，**全部成功才移动 vendor 分支**（任一失配则 vendor 不变，绝不留半完成状态）；
成功后更新 `LAST_SYNC_POINT`、重建 dist、刷新"好 pi"缓存，并对 `custom/` 跑**类型检查**（上游 API 变更的第一道防线）。
关键开关：`PI_SYNC_DRY_RUN=1`（只读预演）、`PI_SKIP_REBUILD=1`、`PI_SYNC_RUN_GOLDEN=1`。

## 2. 我方与之耦合的面（实测）

| 面 | 数量 | 证据 |
|---|---|---|
| 补丁 | 11 个 | `patches/*.patch` |
| 其中打在同一文件上的 | **6 个补丁都在 `footer.ts`**（004–009） | `patches/004…009` 的 `+++` 行 |
| 其它补丁目标 | `package.json`(001 品牌)、`packages/README.md`(002)、`tui/…/editor.ts`(003)、`core/slash-commands.ts`(010 禁用 /share)、`extensions/tool-search/tool.ts`(011 CJK) | 同上 |
| 依赖 pi 扩展 API 的文件 | **35 个** | `grep -rl "@earendil-works/pi-coding-agent" custom/ --include=*.ts` |
| 注册面 | tool 65 / hook 55 / command 14 / shortcut 4 | 同口径 grep（含测试文件） |

## 3. 上游 1.1.0 与 1.2.0 内容（与我们相关的部分）

### 3.1 破坏性变更（**直击我们**）

- **`before_agent_start` 语义与类型都变了**：现在**也会为 `pi.sendMessage(..., { triggerTurn: true })` 触发的运行**而触发；
  `BeforeAgentStartEvent` **变成按 `messageType` 的联合类型**：`"user"` 携带 `prompt` 与 `images`，`"custom"` 携带起始 `message`
  **且没有 `prompt`**；只关心用户提示的处理器**必须检查 `event.messageType === "user"`**。
  ⇒ **我方有 6 个 `before_agent_start` 调用点**（见第 2 节实测），**必须逐个检查是否读 `event.prompt`**。
- **运行启动期间的"忙"语义改了**：运行一启动（**包括在 `before_agent_start` 处理器执行期间**）会话即算忙 ⇒
  `ctx.isIdle()` 为 false；`pi.sendMessage()` 会**排队进正在启动的那次运行**，而不再以 "Agent is already processing" 失败；
  **`pi.sendUserMessage()` 现在要求 `deliverAs`**；此间请求的 abort 会在运行开始后中止它。
  ⇒ **与我方的"中途注入（steer）"机制直接相关**：我们此前依赖的正是"忙时必须给 `streamingBehavior`"这条失败路径；
  上游改变了该处行为 ⇒ **注入路径需重新验证**（且若我们调用 `sendUserMessage` 则**必须补 `deliverAs`**）。
- **配置 schema 发布**：主题 schema 移到 `https://pi.dev/schemas/theme.schema.json`，**启动期加载的主题也走同样的校验** ⇒
  若我方有自带主题/设置，需更新 `$schema`、把可复用颜色放进 `vars`、清掉不支持的元数据。
- **`pi mcp list --json` 形状变更**（`resources: true` 取代计数）⇒ 我方若解析该输出需改（未见我方使用）。
- **移除**：未发布的 experimental server/client/plugin 栈（`src/experimental` 等）**及其依赖 `@earendil-works/chord`**，
  连同 `@earendil-works/pi-client` / `pi-protocol` / `pi-server` 三个包。
  ⇒ 需确认我方**没有** import 这些被移除的包（初步看 `custom/` 只依赖 `pi-coding-agent`，但**未逐个核对**）。

### 3.2 加法（兼容，但可用起来）

- `agent_settled` 新增 **`aborted`**（区分取消与正常结束）⇒ 我方该事件有 4 个调用点，属**加法**。
- `tool_execution_end` 与工具渲染上下文新增 **`durationMs`**；渲染上下文新增 `outputPad`（1.1.0）。
- 工具定义新增 **`reachesTools`**、工具命名空间新增 **`aliases`**，且 `searchTools()` 会匹配别名 ⇒
  **与我方 011（tool-search CJK）同文件相邻**，是最可能产生补丁上下文位移的点之一。
- `before_agent_start` 也覆盖扩展触发运行（见破坏性变更）。
- `PI_CLIPBOARD_OSC52=1`、OSC 7501 程序状态上报。

### 3.3 与我方补丁区（TUI）相邻的改动

- **`editor.ts` 邻域**：修复"按键绑定名带 shift 符号（如 `+`）在 Kitty 键盘协议/modifyOtherKeys 下不匹配"、
  修复"分片的终端颜色回复把十六进制值漏进提示符并打开外部编辑器"。
- **`footer.ts` 邻域**：修复 bash/PowerShell 结果重载后丢失 `Took`、`!` 命令头变暗色丢失、压缩状态指示器颜色。
- 另有"全屏文本选择在会话切换后残留"的修复（与我们会话切换的实验相关）。
⇒ **我方 6 个 footer 补丁 + 1 个 editor 补丁都打在活跃变动的文件上** ⇒ **补丁上下文位移是本次同步的主要风险**。

### 3.4 与"静默失效"同向的修复（值得同步）

- **print 模式（`-p`）在最终响应被输出上限截断时不再静默退出 0**：改为打印部分文本、向 stderr 写警告、**退出 1**。
  ⇒ 我方大量使用无头 `-p`（autopilot/定时任务）⇒ 这与我们今天修的"报成功却没做事"**同向**，是个**利好**，
  但**会改变任务成功/失败的判读口径**（以前会当成成功的情形，之后会是失败）。
- `~` 展开修复（`!pattern`/`+path`/`-path`）；MCP/Auth/OpenRouter/Mistral 等多处健壮性修复。

## 4. 影响面三档

| 档 | 项 | 说明 |
|---|---|---|
| **① 可无痛合并** | 绝大多数 providers/MCP/codemode/分类器修复与新增；`aborted`、`durationMs` 等加成 | 与我方补丁和扩展面不重叠 |
| **② 需改补丁或适配** | (a) `before_agent_start` 联合类型 ⇒ 6 个调用点逐个检查 `messageType`；(b) 忙语义与 `sendUserMessage(deliverAs)` ⇒ **中途注入路径须重验**；(c) **6 个 footer 补丁 + 1 个 editor 补丁**的上下文位移（`editor.ts`/`footer.ts` 都在 1.1/1.2 有改动）；(d) 011 tool-search 与 `reachesTools`/`aliases`/`searchTools` 相邻；(e) 主题/设置 schema（若有自带主题）；(f) `-p` 截断改为 exit 1 ⇒ 任务判读口径；(g) 确认未 import 被移除的包 | 逐项见第 2、3 节证据 |
| **③ 建议不同步** | 无 | 未发现必须留在 1.0.4 的理由 |

## 5. 结论与理由

**建议同步**，理由：① 上游修了多处与我们痛点同向的问题（`-p` 截断静默成功、颜色泄漏、按键匹配、会话切换残留）；
② 落后两个 minor 会持续累积补丁上下文位移风险（越晚越痛）；③ 破坏性变更只有两处直击我们，**都是可定位、可测试的**。

**工作量（粗估，需干跑证实）**：干跑 10 分钟；补丁重放与新基线提交 10–30 分钟；`custom/` 类型检查与修复 0.5–2 小时
（以 `before_agent_start` 与忙语义两处为主）；全量 golden（含两个 pty 场景）约 20–30 分钟；合计**半天量级**。

**风险**：① footer/editor 补丁重放失败（最可能，且失败是**显式**的，不会留半完成状态）；② `before_agent_start` 的 `prompt`
在 custom 运行下变成 undefined 而导致静默行为变化；③ 忙语义变化改动我们注入路径的行为；④ `-p` 语义变化影响定时任务判读。
**注入面基线哈希**（`8493be6d…`）与**补丁行为自标记**这两道闸门会最先报警，属**预期**。

## 6. 回滚方案

1. `vendor/pi` 是**独立 git 仓库**，补丁栈是**本地提交** ⇒ 回到旧顶：`git -C vendor/pi reset --hard <旧补丁栈顶>`；
2. 恢复 `vendor/pi/LAST_SYNC_POINT` 到 `28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9`；
3. 重建 dist 与"好 pi"缓存（`sync-upstream.sh` 第 5 步；或 `PI_SKIP_REBUILD=1` 的反面）；
4. **注入面基线哈希必须有意更新**（若上游改了 system prompt/hard rules）——**更新必须附理由**，不能为了变绿而改；
5. 回到旧标签/旧提交即可让 my-pi 的其余部分不受影响。

## 7. 仍未核实

- **补丁能否重放未验证**：npm 发布的 tarball **只有 `dist/` 与 `bundle/`，没有 `src/`**，因此**无法在本地对补丁目标文件做逐行比对**；
  唯一可信手段是项目自带的 **`PI_SYNC_DRY_RUN=1 bash scripts/sync-upstream.sh`**（干跑），而它**需要访问 github** ✗ ——
  本机 `git ls-remote https://github.com/…` 两次探测**均失败**（无输出，疑似超时/受限）；**一次失败不等于不可达**，需另择时机复测。
- `web_search` 工具在本会话**不可用**（其 endpoint 配置失败），因此**未能取到 release notes 之外的第三方解读**；本文全部内容来自
  npm 包内的 `CHANGELOG.md`（权威一手）与本仓库文件。
- 未逐个核对 `custom/` 是否 import 被移除的 `pi-client` / `pi-protocol` / `pi-server` / `chord`。
- 未核对上游 `docs/extensions.md` 与 1.0.4 的逐字差异（只读到 1.2.0 版本）。
- 未评估 `typebox 1.3.27` 与我方适配器的兼容性（我方曾因 typebox 1.3.x 缺 `Type.Null` 而修过 `tool-adapter.ts`）。

---

## 附：复核轮 —— 一处说法被证伪 + 补丁重放实测（2026-10-11）

**★ 被证伪的说法** ✗✓（保留原文作对照）：本文上文说"**唯一可信手段是 `PI_SYNC_DRY_RUN=1` 干跑**" ✗ ——
**实测：干跑只打印计划、不重放** ✗。它只输出 `[dry-run] … 目标 6374c2baf…（未改动任何内容）` +
"将在此基线上重新应用 patches/：11 个" ⇒ **它不回答"补丁能否重放"** ✗。

**★ 可达性也被更正** ✗✓：上轮记"`git ls-remote` 两次探测均失败 ⇒ 疑似不可达" ✗ —— **实测是通的** ✓：
`git ls-remote https://github.com/earendil-works/pi-mono.git` **两次 rc=0、约 2.3 s** ✓；`codeload` tarball **200** ✓；
npm 通道通 ✓（`1.2.0`，走本机镜像 `registry.npmmirror.com` ✓）；`ssh:443` 报 `Permission denied (publickey)` ⇒
**那是凭据问题、不是可达性** ✓。⇒ **又一次"一次失败 ≠ 不可达"** ✓✓。

**★ 目标不是 tag** ✗：干跑把上游拉到 `28dcce2ba..6374c2baf main -> upstream/main` ✓（含 tags `v1.1.0` / `v1.2.0` ✓），
**目标 = `6374c2baf432419ccb4541a99ce4958ecd03dae0` = `v1.2.0-37-g6374c2baf`** ✓ ⇒
**upstream/main 比 `v1.2.0` tag 多 37 笔** ⇒ **决策时须明确选哪个** ✓。

**★ 干跑确实只读（已验证 ✓✓）**：`vendor/pi` HEAD 未变（`db03484e20f1bf5b6ad7f3f64e3e271652040404` = `local: 011-tool-search-cjk` ✓）、
`LAST_SYNC_POINT` 仍 `28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9` ✓、无残留 worktree ✓、主仓干净 ✓。

**★★ 补丁重放实测（真正只读的方法 ✓）**：`git clone --shared vendor/pi /tmp/pi-sync-probe`（**9.7 s、仓库本体不动** ✓）→
`checkout 6374c2baf` → 按 `patches/*.patch` **顺序**逐个 `git apply --check` + `git apply`（**累计** ✓）⇒
**成功 8 / 失败 3（共 11）** ✗✓：
| 结果 | 补丁 | 失败位置与含义 |
|---|---|---|
| ✅ **干净重放 8 个** | **003–009 + 011** ✓ | ★ **上文判断"风险最高"的 6 个 footer 补丁 + `editor.ts` 补丁实际全部通过** ✗✓；011（tool-search CJK）亦通过 ✓ |
| ✗ 失败 | **001-branding** | `patch failed: package.json:1` ⇒ **根 manifest 变了** ✓ |
| ✗ 失败 | **002-local-pi-mods** | `patch failed: packages/coding-agent/tsconfig.build.json:16` ⇒ **构建 tsconfig 变了** ✓ |
| ✗ 失败 | **010-disable-share-bug** | `patch failed: packages/coding-agent/src/core/slash-commands.ts:24` ⇒ **斜杠命令表那一片变了** ✓（与上游 1.1/1.2 的命令/事件改动一致 ✓） |

**结论修正** ✓：**不能"整体同步"** ✗，但**失败都是小的、局部的**（**一个根 manifest + 一个构建 tsconfig + 一处斜杠命令表** ✓），
**且未级联** ✓（001/002 失败后 003+ 仍成功 ⇒ TUI 族不依赖它们 ✓；010 失败后 011 成功 ⇒ 也不依赖 010 ✓）
⇒ **人工重做这 3 个补丁 = 可预期的工作量** ✓✓。**风险排序也随之更正** ✓：真正的失败点在 **001/002/010** ✓，
**不是** TUI/footer 族 ✗✓。

**证据（可复核 ✓）**：`/tmp/sync-dryrun.log` ✓；**可复跑的重放克隆 `/tmp/pi-sync-probe`** ✓（可进内直接 `git apply --check` ✓）；
`/tmp/vendor-head-before.txt` ✓。

**本轮仍未核实（✗）**：① 我用的是 `git apply`（含 `--check` ✓），而 `sync-upstream.sh` 在 worktree 里的**具体应用命令
（是否 `git am` 提交）只见 worktree 建立那段、未见应用循环**（在 125 行之后 ✓）⇒ **内容等价、命令未逐字核对** ✓；
② 3 个失败补丁的**修复难度未评估** ✓；③ **非干跑路径未跑**（会移动 vendor 分支 ✗ ⇒ **需授权** ✓）；
④ 被移除的 `pi-client` / `pi-protocol` / `pi-server` / `chord` **是否被 `custom/` import 未核对** ✗。

