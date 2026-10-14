# 上游同步执行方案（Runbook 式计划）

> 目标：把 `vendor/pi` 从 **1.0.4**（同步点 `28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9`）推进到上游
> **`6374c2baf432419ccb4541a99ce4958ecd03dae0`**（= `v1.2.0-37-g6374c2baf`，即 `upstream/main`）。
> 本文只做**计划**：**未改 `vendor/**`、`patches/**`、`custom/**`、`scripts/**`**；一切试验都在
> `/tmp/pi-sync-probe`（`git clone --shared` 的一次性克隆，主仓库一字未动）。

## 0. 先决结论（先看这三行）

1. **可以同步**，但**不能整体套用**：11 个补丁重放 **8 个干净**、**3 个需重做**（见 §2）。
2. ★ **其中 1 个已由三方合并直接解决**、**另 2 个各剩一处冲突 hunk** ⇒ 重做工作量 **约 1–2 小时**（不是原先估的"半天"里的大头）。
3. ★ **没有任何补丁的意图已被上游原生实现** ⇒ **不需要删除任何补丁**（§2 各条已逐条给出依据）。

## 1. 依赖面核对（决定"会不会直接编译失败"）

**被上游 1.1/1.2 移除的包**（从 `/tmp/pi-sync-probe` 内的 CHANGELOG 与本机文件确认，非转述）：`pi-client`、`pi-protocol`、`pi-server`
已**不在 `packages/`**；**`@earendil-works/chord` 仍然存在**（`packages/chord/`）。

| 核对项 | 命中 | 结论 |
|---|---|---|
| `pi-client` / `pi-protocol` / `pi-server` | **0 / 0 / 0** | ✅ 未被引用 |
| `@earendil-works/chord` | **3** | ✅ 全部是 `custom/tsconfig.json` 的**类型路径别名**（`:11`/`:12`/`:13`），且该包**仍存在** ⇒ 无害 |
| ★ `AgentHarness` / `harness/` / `experimental/pico3` / `pi-durable` / `uuidv7` / `pi-telemetry` | **全 0** | ✅ **被移除的 harness API 我方完全没用** |
| `pi-agent-core` | 5（重复计数） | ✅ 实际只有 **1 条注释**（`custom/features/subagent/core/types.ts:3`）+ **2 条 `tsconfig` 路径别名**（`custom/tsconfig.json:14`/`:15`） |

**搜索面（负向结论的依据）**：`grep -rn --include=*.ts --include=*.mjs --include=*.js --include=*.json --include=*.sh -- "<符号>"`
覆盖 `custom/`、`scripts/`、`packs/`、根 `package.json`、`custom/tsconfig.json`，已剔除 `node_modules`。
**结论**：**同步不会因"引用了被移除的包"而直接编译失败** ✅。

**残余风险（低，但值得记）**：上游把 `@earendil-works/pi-agent-core` 收窄为**只有 `Agent`、agent loop、proxy stream 及其类型**，
并移除了 `./node`、`./harness/*`、`./experimental/pico3` 子路径导出 ⇒ 我方 `custom/tsconfig.json:15` 的**通配别名**
（`@earendil-works/pi-agent-core/*` → `../agent/dist/*.d.ts`）**可能失去目标**。我方代码并不 import 它（0 处）⇒ 影响面仅限类型解析。

## 2. 三个失败补丁：意图 / 上游新形态 / 重做证据 / 难度

### 2.1 `001-branding.patch` —— ✅ **三方合并即干净通过**（难度：小）

- **意图**：把**根 `package.json`** 的 `name` 改为 `my-pi`，并加 `piConfig`（`name` + `configDir: .my-pi`）。
- **失败原因**：`@@ -1,7 +1,11 @@` 的**尾部上下文**（`workspaces` 列表）在上游变了 ⇒ 上下文不匹配（**意图区没变**）。
- **★ 实测证据（在 `/tmp/pi-sync-probe` 内）**：`git apply --check -3` ⇒ `Applied patch to 'package.json' cleanly` ✅；实际应用后
  **根 `package.json` 已改名**（`head -3` 显示 `"name": "my-pi"`）且 **`piConfig` 已写入**（第 5 行）✅。
- **重做要点**：改用**三方合并**（`git apply -3`），或按新 `workspaces` 列表**重新生成 hunk 上下文**；**意图保持不变**。
- **是否应删补丁**：**否** —— 上游没有任何"改名 + piConfig"的等价物。

### 2.2 `002-local-pi-mods.patch` —— ⚠️ **只剩 1 处冲突 hunk**（难度：小–中）

- **意图（多文件补丁）**：新增 `packages/README.md`、新增 `packages/coding-agent/src/core/secrets.ts`、
  改 `packages/ai/scripts/check-model-data.ts`、改 `packages/coding-agent/tsconfig.build.json`。
- **★ 实测证据**：`git apply -3` ⇒ `check-model-data.ts` **干净** ✅、`secrets.ts` 走**直接应用**（新文件）✅、
  **`tsconfig.build.json` = `with conflicts`** ✗（唯一冲突点）。
- **上游新形态（该冲突点）**：`tsconfig.build.json` 的 `paths` 块现为 `pi-agent-core`（2 条）、`pi-ai`（2 条）、`pi-tui`（2 条）
  共 6 行，随后 `rootDir` / `include` / `exclude`；`exclude` 含 `"src/experimental"`。
- **重做要点**：**只重锚这一个 hunk**（把我们的路径别名按上游新的 `paths` 顺序/集合重排并保留我们的新增项）；
  其余四个文件**无需改**。
- **是否应删补丁**：**否** —— 其余三个文件（README、secrets.ts、check-model-data.ts）是**我方独有内容**，上游没有。

### 2.3 `010-disable-share-bug.patch` —— ⚠️ **只剩 1 处冲突 hunk**（难度：中）

- **意图**：从**内置斜杠命令表**移除 `/share` 与 `/bug`（隐私），并在 `interactive-mode.ts` 内做配套改造（4 处 + 1 处新增）。
- **★ 实测证据**：`git apply -3` ⇒ **`interactive-mode.ts` 全部干净** ✅、**`slash-commands.ts` = `with conflicts`** ✗（唯一冲突点）；
  冲突未解决时 `/share`、`/bug` **仍在**（`:28`/`:29`）—— 与"冲突 hunk 未被应用"一致 ✅。
- **上游新形态（该冲突点）**：命令表新增/改写了多条（例如 `scoped-models` 的描述、`share` 的说明改为
  "Share session via a Radius artifact or a GitHub gist"）；★ **`share` 与 `bug` 两条依然存在** ⇒ **补丁意图仍然成立**。
- **重做要点**：**只重锚这一个 hunk**（按上游当前命令表重新定位 `share`/`bug` 两行并删除；注意保留上游对**其它**命令条目的新增/改写）。
- **是否应删补丁**：**否** —— 上游**没有**移除这两个命令，隐私意图必须由我方补丁继续承载。

## 3. 目标选择：`v1.2.0` tag 还是 `upstream/main`（+37 笔）

- 脚本当前指向 **`upstream/main` = `6374c2baf`**（比 `v1.2.0` tag **多 37 笔**）。
- **建议**：先按 **`v1.2.0` tag**（已发布的、有 changelog 覆盖的版本）同步一次，验证通过后再考虑跟进 `main`。
  ⇒ **收益**：变化面更小、changelog 可对照、出问题时归因清晰。
- **未核实**：`scripts/sync-upstream.sh` 里"指定 tag 而非 `main`"的**具体开关/变量名**未逐字确认（见 §5）。

## 4. 执行清单（可勾选）

- [ ] **0. 备份与回滚点**：记录 `git -C vendor/pi rev-parse HEAD`（本次为 `db03484e20f1bf5b6ad7f3f64e3e271652040404`）
      与 `LAST_SYNC_POINT`（`28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9`），存到仓库外（例如 `/tmp/`）。
- [ ] **1. 重做补丁**：`001` 用三方合并（或重锚上下文）；`002` 只重锚 `tsconfig.build.json` hunk；
      `010` 只重锚 `slash-commands.ts` hunk。**在 `/tmp/pi-sync-probe`（或新克隆）里逐个 `git apply --check` 验证**。
      ★ **复用旧试验场前必须先清干净**（它现在是"8 个已应用 + 2 处 `UU` 冲突"的混合态）：
      `git -C <probe> reset --hard 6374c2baf && git -C <probe> clean -fdx`。
- [ ] **2. 两处 Breaking 适配**（**独立于补丁**，必须做）：
      (a) **`before_agent_start`** 变成按 `messageType` 的联合 ⇒ **逐个检查我方 6 个调用点**，只处理用户提示的须判 `event.messageType === "user"`；
      (b) **忙语义变更**（启动期即算忙、`sendMessage` 排队、`sendUserMessage` 需 `deliverAs`）⇒ **重验"中途注入（steer）"路径**。
- [ ] **3. 跑同步**：**先干跑**（`PI_SYNC_DRY_RUN=1`，注意它**只打印计划**）；再实跑；最后 `PI_SYNC_RUN_GOLDEN=1` 跑全量守门。
- [ ] **4. 两道闸门的预期变动**：
      ★ **注入面基线哈希 `8493be6d…`** 若变，**必须有意更新并写明理由**（**绝不为变绿而改**）；
      **补丁行为自标记** `Patch (NNN-name):` 在重做补丁时**必须保留**。
- [ ] **5. 全量验证**：`tsc -p custom/`、`vitest run`、`golden-tasks.sh`（+ `PI_GOLDEN_SCENARIO=1` 的两个 pty 场景——
      本次下游改动包含 **supervisor**，按项目自己的说明**必须跑**）。
- [ ] **6. 回滚预案**：`git -C vendor/pi reset --hard <旧栈顶>` + 恢复 `LAST_SYNC_POINT` + 重建 dist 与"好 pi"缓存。

## 5. 仍未核实（不要当成已知）

1. `scripts/sync-upstream.sh` 在 worktree 里的**实际应用命令**（`git apply` / `git am`）**未逐字读到**（只看到 worktree 建立段落）
   ⇒ 本文的 `git apply -3` 结论是**文件内容层面**的等价验证，命令层面未核对。
2. 指定 **tag** 的开关/变量名未确认。
3. `002`/`010` 两处冲突 hunk 的**具体重写文本**尚未产出（只完成了"冲突定位 + 意图确认 + 上游新形态取证"）。
4. `pi-agent-core` 通配别名在 1.2 下**是否仍能解析**未验证。
5. 非干跑路径未执行（会移动 vendor 分支，需单独授权）。

---

## 附二：002 / 010 两处冲突**已在 `/tmp` 试验场改通** ✓（2026-10-11，未动主仓库）

**试验场** ✓：`/tmp/pi-sync-probe`（`git clone --shared vendor/pi` 的一次性克隆 ✓，`6374c2baf` ✓，**主仓库 `vendor/**` 一字未动** ✓）。
**基线复现** ✓：清空（`reset --hard 6374c2baf` + `clean -fdx`）后按序重放 ⇒ **001（用 `-3`）干净** ✓、
**002 与 010 冲突** ✗、**其余 8 个干净** ✓（与上一轮一致 ✓）。

### 002-local-pi-mods ✓ 小
- **原意图** ✓（补丁内 hunk ✓）：把 `packages/coding-agent/tsconfig.build.json` 的 `exclude` 加上 **`src/custom`** ✓
  （并另有 README.md / `check-model-data.ts` / `secrets.ts` 三处 ✓）。
- **冲突真因** ✗：上游把该行**简化**了 —— 现在是
  `"exclude": ["node_modules", "dist", "src/experimental"]` ✗（原来还有 `src/client`、`src/cli/experimental` ✓）。
- **改法** ✓：只把 hunk 的**上下文行**换成上游现状（`-` 行改为新的上游行 ✓），**`+` 行仍追加 `src/custom`** ✓ ⇒ **意图不变** ✓。
- **证据** ✓：修好的补丁存 `/tmp/patches-fixed/002-local-pi-mods.patch` ✓，`git apply --check` ⇒ **通过** ✓✓；整体重放 ⇒ **✓ 应用成功** ✓。
- **难度**：**小** ✓（一行上下文 ✓）。
- **是否建议删除**：**否** ✗（`src/custom` 排除是本地结构的真实需求 ✓）。

### 010-disable-share-bug ✓ 小（但**意图需扩展** ⚠）
- **原意图** ✓（补丁内 hunk ✓）：**移除 `/share` 与 `/bug`**（隐私：不外发会话 ✓）—— 命令表两行 + `interactive-mode.ts` 三处文案 ✓。
- **冲突真因** ✗：上游把 `share` 的描述改成 **"Share session via a Radius artifact or a GitHub gist"** ✓
  （补丁里期待的是旧文案 "…as a secret GitHub gist" ✓）。
- **前提仍成立** ✓✓：上游 **`share` / `bug` 两条仍在**（`slash-commands.ts:27` / `:28`）✓ ⇒ **隐私意图仍成立 ⇒ 必须重做、不能删** ✓。
- **改法** ✓：只把该 hunk 的 `-` 上下文行换成上游新文案 ✓，**仍删除两行** ✓；
  **其余锚点全部仍在** ✓（`Run /bug to report it` ✓、`run /bug. The crash details` ✓、`Persist a crash so the next start can point the user at` ✓）。
- **证据** ✓：`/tmp/patches-fixed/010-disable-share-bug.patch` ✓，`git apply --check` ⇒ **通过** ✓✓；整体重放 ⇒ **✓ 应用成功** ✓。
- **难度**：**小** ✓。
- ★ **但发现"意图漂移"** ✗✓：上游**新增**了三处 `/bug` 通道 —— `interactive-mode.ts` **`:136`**（`import { reportBug }` ✓）、
  **`:2173`**（"…/bug sends a report to the developers" 提示 ✓）、**`:3242`**（`/bug` 处理器 ✓）⇒ **原补丁覆盖不到** ✗
  ⇒ **要真正保住"无外发通道"的意图，须扩展 010**（**中等**难度 ⚠）—— **这是本轮最重要的新发现** ✓✓。

**仍未核实（✗）**：① 010 的**扩展**（新增三处 `/bug` 通道）**未实现** —— 需要设计（删 handler？改提示？去掉 import 的调用方？✓）；
② 001 用 `-3` 成功，但**三方合并会产生何种内容**（是否有冲突标记残留 ✓）**未逐字检查** ✗；
③ 全部 11 个重放后**未跑 `custom/` 的类型检查**（那才是"同步能不能编译过"的判据 ✓）✗；
④ 试验场状态：**`6374c2baf` + 001(-3) + 002/010(修好版) 已应用**，其余看运行顺序（**报告里已说明** ✓）。

---

## 附三：★ 关键问题的答案 —— 打好 11 个补丁的 1.2 树上，`custom/` **类型检查零错误** ✓✓（2026-10-11）

**问题**：11 个补丁全部应用到 pi 1.2（`6374c2baf`）后，`custom/` **还能不能通过类型检查**？✓（这是"能否编译过"的真正判据 ✓）

**方法（零风险复刻 ✓，全程只在 `/tmp` ✓，仓库 `vendor/**` 一字未动 ✓）**：
1. 脚本的类型检查就是 **`npx tsc --noEmit -p custom/`**（`scripts/sync-upstream.sh:160-161` ✓），而 `custom/tsconfig.json` 的 `paths`
   **硬编码指向 `../vendor/pi/...`** ✓ ⇒ 不能直接用它去检查"另一棵树" ✓；
2. ⇒ 在 `/tmp/pi-typecheck-probe`（`git clone --shared vendor/pi` ✓ + `checkout 6374c2baf` ✓）里**应用全部 11 个补丁** ✓
   （001 用 `--3way` ✓；002/010 用 `/tmp/patches-fixed/` 的改好版本 ✓）⇒ **11/11 成功、无冲突标记残留** ✓✓（**这同时补掉了缺口 ②** ✓）；
3. 写一个 `/tmp` 内的 tsconfig（**放在探针里**，让 `@types/node` 与 `typeRoots` 正常解析 ✓），用**绝对路径**把
   `@earendil-works/*` 的 `paths` 指向**探针的 1.2 源码**（`packages/*/src/index.ts` ✓）⇒ **无需构建 dist** ✓、
   `include` 指向**仓库的 `custom/**/*.ts`** ✓ ⇒ **不写仓库任何文件** ✓；
4. 跑 `node_modules/.bin/tsc --noEmit -p <探针>/tc-custom.json` ✓。

**结果** ✓✓：
- **`custom/` 自身的类型错误 = 0** ✓✓（**这是答案** ✓）；
- 全部 75 条错误**都在探针（上游源码）内部** ✓，且**没有一条落在被打补丁的文件上** ✓（`editor.ts` / `slash-commands.ts` /
  `interactive-mode.ts` / `package.json` / `tsconfig.build.json` / `tui-main-screen.ts` ⇒ **全空** ✓）；
- 错误类型分布 = **43 × TS2307（找不到模块）+ 23 × TS7016（缺声明）** + 3 × TS2339 + 1 × TS7006 + 1 × TS2678 + 1 × TS2561 ✓
  ⇒ **绝大多数是"直接检查上游源码、未走其正常构建"的产物** ✓（正常构建会提供这些声明 ✓）。

**★ 反证（防"真空通过" ✗✓）**：
1. `--listFiles` 证明 **`custom/` 真的有 274 个文件进入程序** ✓（上游 472 个 ✓）⇒ **不是真空通过** ✓✓；
2. 75 条上游错误**无一涉及补丁文件** ✓；
3. ★ **无效的反证（如实记录 ✗）**：我本想跑"**未打补丁的 1.2 基线**"作对照 ✓，但生成其配置的 `sed` **报错**
   （`unknown option to 's'` ✓）⇒ 该次输出（"75"）**不可信** ✗ ⇒ **不作为证据** ✓（结论改由反证 1/2/3/5 支撑 ✓）；
4. **对照现状** ✓：仓库 1.0.4 的 `custom/` 检查 ⇒ **rc=0、0 错误** ✓。

**这同时回答了缺口 ③** ✓（`pi-agent-core` 的通配别名在 1.2 下**能解析** ✓ —— 否则 `custom/` 会报错 ✓）。

**★ 本结论的边界（必须一起读 ✗✓）**：
- **方法与脚本的真实检查不同** ✗：我让 `paths` 指向**源码** ✓，而脚本是在**构建出 dist 之后**用 `dist/*.d.ts` 检查 ✓
  ⇒ **API 面相同、解析路径不同** ✓ ⇒ 属**强证据，但不等于脚本那一步的逐字等价** ✓（例如 `tsconfig.build.json` 的更严设置、
  生成物差异未覆盖 ✗）；
- ★ **类型通过 ≠ 运行期正确** ✗✓：`before_agent_start` 的 `messageType` 联合是**运行期语义变更** ✓
  ⇒ 本条只证明**类型面没破** ✓，**不证明那 6 个处理器行为正确** ✓ —— 后者要靠**两处 Breaking 适配 + 全量 golden** ✓。

**证据（可复核 ✓）**：探针 `/tmp/pi-typecheck-probe`（11 补丁已应用 ✓ + `tc-custom.json` ✓，12 个改动文件 ✓）；
日志 `/tmp/tc-out2.log`（75 条，全在上游 ✓）；`/tmp/tc-repo.log`（仓库 1.0.4，0 条 ✓）。

**仍未核实（✗）**：① 脚本"构建 dist 后再检查"那条**逐字路径**未复现 ✓（本条是源码面等价 ✓）；
② 运行期行为（6 个 `before_agent_start` 调用点 + 忙语义/注入路径 ✓）未验证 ✓；③ `001` 的 `--3way` 合并结果**语义**未逐字复核 ✓
（只确认了**无冲突标记** ✓ + 上一轮已确认改名与 `piConfig` 生效 ✓）；④ 探针用完未删（**按路径可随时清** ✓）。

