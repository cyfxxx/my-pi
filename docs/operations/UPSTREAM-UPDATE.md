# 更新 vendored pi：体检 → 决策 → 同步 → 验证

`vendor/pi` 是上游 `earendil-works/pi-mono` 的独立 git clone，`patches/` 是本地改动的唯一真值。
更新上游不是 `git pull`，而是「把补丁栈在**新基线**上确定性重放」。这个过程有两个风险：

1. 补丁失配（上游改了 footer.ts，004–009 全部要重做）；
2. **同步成功但行为变了**——补丁能原样应用，可是上游改了默认主题、工具链、`--no-extensions` 语义、
   默认模型表。这类变化 `git apply` 不会报错，`tsc` 也不会报错，只有人看得见。

所以流程是四步，体检必须在同步**之前**。

| 属性 | 值 |
|------|-----|
| 更新日期 | 2026-10-01 |
| 适用范围 | `vendor/pi` 上游同步 |
| 相关文档 | [../../patches/README.md](../../patches/README.md)、[../../scripts/README.md](../../scripts/README.md)、[UPSTREAM-CHANGES-v0.87.0-to-d2931ad3.md](UPSTREAM-CHANGES-v0.87.0-to-d2931ad3.md)（上一次 130 提交跳版的实测报告）、[../../DECISIONS.md](../../DECISIONS.md) |

---

## 1. 体检（只读，先跑这个）

```bash
bash scripts/check-upstream.sh          # fetch 上游 + 出报告
bash scripts/check-upstream.sh v0.99.1  # 指定目标版本/commit
PI_CHECK_NO_FETCH=1 bash scripts/check-upstream.sh <commit>   # 不联网（离线/受限网络）
PI_CHECK_STRICT=1 ...                   # 需先改补丁时 exit 2（给钩子/CI 用）
```

报告分六段，结论只有三种：

| 结论 | 含义 | 下一步 |
|------|------|--------|
| `已最新` | 基线 == 目标，补丁栈无需动 | 无事 |
| `可同步` | 补丁目标文件与 adapters API 面都没变 | 直接第 3 步 |
| `需先改补丁/适配` | 有补丁的目标文件被上游改过，或有 API 符号消失 | 先按报告改 `patches/`，回到第 2 步 |

六段内容与读法：

1. **目标**：当前基线 / 目标 commit / 版本 tag / 区间提交数 / 改动规模。方向反了会显式警告
   （拿旧 tag 当目标做演练时会看到）。
2. **各包改动量 Top 10 + 新增包**：判断这次跳版是"补丁维护成本"还是"整个新子系统"。
   实测教训：v0.87.0→v0.99.1 的 churn 第一名是 `durable`（41,516 行），第二 `coding-agent`（36,108），
   还凭空多了 `mcp`、`codemode` 两个包——只看 `git log --oneline` 是看不出来的。
3. **changelog 新增版本段**：列出各包新增的 `## [x.y.z]` 段。注意上游可能**不按版本号发版**：
   那次跳跃只有 `0.87.1 / 0.99.0 / 0.99.1` 三段，中间没有 0.88–0.98。**别按版本号推断范围，用 commit 区间。**
4. **区间 changelog 关键词**：命中 `breaking / removed / deprecat / no longer / default / telemetry /
   analytics / opt-in / opt out` 的行。这一段最容易被忽略也最值得读——破坏性变更往往就藏在
   "Changed: 默认主题改为 system" 这种一句话里。
5. **本地补丁 vs 上游改动**：逐个 `patches/*.patch`，提取它改的文件，看上游在区间内有没有动过这些文件。
   没动 = 可原样重放；动了 = 同步时 `--3way` 可能合上但语义漂移，**必须人工比对**。
6. **API 面**：`custom/adapters` 依赖的入口/类型文件是否改动 + 逐符号核对导出是否还在。
   这只是**快速预检**（符号可能换文件或经 index 再导出），最终判定以第 3 步 `sync-upstream.sh`
   第 6 步的 `npx tsc --noEmit -p custom/` 为准。

## 2. 读懂变更

体检给的是"代价面"，第 2 步是判断"这次的上游变化我接不接受"。要读的原始材料：

```bash
git -C vendor/pi log --oneline <基线>..<目标>            # 提交标题
git -C vendor/pi diff <基线> <目标> -- packages/<包>/CHANGELOG.md
git -C vendor/pi diff <基线> <目标> -- packages/coding-agent/src/core/extensions/types.ts
```

历史报告的写法可参照 [UPSTREAM-CHANGES-v0.87.0-to-d2931ad3.md](UPSTREAM-CHANGES-v0.87.0-to-d2931ad3.md)：
版本时间线 → 主题分章（模型/provider、扩展 API 与 TUI、权限与安全、新包、默认值、破坏性、需评估）→
每条断言标注来源（「changelog 明确写」还是「从 diff 推断」，未说明处写**未说明**）。

需要时可派子代理读 changelog + diff 产出报告（不要在主线里逐条读；一次跳版有 700+ 文件）。

## 3. 决策

按体检结论走：

- `可同步` → 直接第 4 步，但仍然要扫一眼第 4/5/6 段的输出。
- `需先改补丁/适配` → 先把 `patches/` 改到能在新基线上应用，再同步。
- 整版都不想要（例如上游引入了你不接受的默认行为）→ **不动** `LAST_SYNC_POINT`，也就是停在当前基线；
  想升时用 `bash scripts/sync-upstream.sh <commit>` 指定一个跳过坏版本的 commit。
  详见下面「不想要的变更怎么处理」。

## 4. 同步

```bash
PI_SYNC_DRY_RUN=1 bash scripts/sync-upstream.sh    # 只读预演：看会应用到哪个 commit、几个补丁
bash scripts/sync-upstream.sh                      # 真正同步
bash scripts/sync-upstream.sh <commit|tag>         # 指定目标
```

`sync-upstream.sh` 做六件事，理解它才能判断失败后处于什么状态：

1. 校验 `vendor/pi` 是独立仓库且工作树干净；
2. fetch 上游（超时保护）→ 确定目标 commit；
3. 在**临时 worktree** 上 checkout 目标基线 → 幂等应用 `patches/` 并逐个提交为 `local: NNN-*`；
   **任一补丁失配则 vendor 分支完全不动**（不留半完成状态），并报出失败的补丁；
4. 成功才把 `vendor/main` 指向新补丁栈，同时更新 `LAST_SYNC_POINT` 与 `vendor/PINNED_COMMIT`
   （以及 `STRUCTURE.md` 里的版本行）——三者必须同基线，否则 fresh checkout 引导会失败；
5. 重建 `vendor/pi` dist 并刷新崩溃自愈的"好 pi"缓存；
6. `npx tsc --noEmit -p custom/`：上游 API 变更的第一道防线。

补充：`PI_SKIP_REBUILD=1` 跳过第 5 步；`PI_SYNC_RUN_GOLDEN=1` 追加跑 golden。

> `custom/` 不需要编译（`custom/tsconfig.json` 是 `noEmit`，pi 每次启动用 jiti 从源码转译），
> 但 **vendor 的改动必须重建 dist**——补丁只改源码，运行时用的是 dist。

## 5. 验证

```bash
bash scripts/doctor.sh --no-net     # 依赖/vendor/补丁/dist 新鲜度/自愈缓存/类型
bash scripts/golden-tasks.sh        # 全量行为门（--fast 只跑结构守门）
```

`doctor.sh` 会断言 `dist 与源码同步（stamp ...）` 与 `补丁齐备（N）`；golden 会跑补丁行为守门
（`check-patches-behavior.mjs`）。另外，凡是**会改变注入面**的同步（system prompt 文案、工具描述），
`check-injection-surface.sh` 会报红——那不是 bug，是提示你确认前缀指纹的变化是否符合预期
（确认后用 `--update` 刷新基线）。

`doctor.sh` 的离线归档判据已加强：不再只看"归档存在"，而是要求**至少一个归档含当前
`PINNED_COMMIT`**（用 `git bundle list-heads` 比对）。只报存在会给出假安全——实测同时存在
v0.87.0 与 v0.99.1 两个归档，只有后者能用于引导。

---

## 已知待办（触发条件式，不是"有空再做"）

| 触发条件 | 动作 | 依据 |
|---|---|---|
| ~~要给 my-pi 接 MCP~~ | **已满足**：2026-10-05 同步到 v1.0.4（`28dcce2ba`），`codemode`/`tool_search` 的 description 不再随 MCP 工具集变化，服务器列表改走 `mcp_servers` 段 | 原待办要求"先升到 v0.99.2"；本次跳版已越过 v0.99.2，见 [UPSTREAM-CHANGES-v0.99.1-to-28dcce2ba.md](UPSTREAM-CHANGES-v0.99.1-to-28dcce2ba.md) |
| 要用 `Sign in with ChatGPT`（`/login openai`） | 提交前清掉 `portable/agent/settings.json` 里的 `deviceId` | 该键是安装级 UUID，只在首次登录时创建，而 settings.json 是**入库**文件（见 `AGENTS.md`「运行时状态不入库」） |
| 上游出现"默认开启"的新能力（如配了 MCP 就自动激活 codemode） | 按下面「不想要的变更」四档处理，并在 `DECISIONS.md` 留记录 | 默认值变化不会让 `git apply` 或 `tsc` 报错，只有人看得见 |
| 想让 `link` 支持"在远端环境里执行" | 评估上游 `packages/env`（SSH 远程执行环境 + daemon）能否复用，而不是自己造 | v1.0.2–v1.0.4 新增包；本项目尚未采用 |

---

## 不想要的变更怎么处理

**总原则：补丁优先，不回退基线。** 我们的架构已经把这件事做成了常规操作——
`patches/` 是唯一真值，同步时自动重放，所以"改掉上游某个行为"的成本是**加一个补丁**，
而不是维护一个分叉分支。

按代价从低到高，四档手段：

| 档 | 手段 | 适用 | 代价/风险 |
|----|------|------|-----------|
| 1 | **用配置/环境变量关掉** | 上游提供了开关（`PI_*`、settings、flag） | 最低；不产生补丁冲突面 |
| 2 | **补丁改默认值** | 行为本身可用，只是默认值不合意（默认主题、默认模型、默认开启的实验特性） | 低；一行改动，冲突面小 |
| 3 | **补丁删入口/整段 revert** | 完全不要这个能力（删命令、删 UI 入口、去掉自动激活） | 中；和上游同段代码的后续改动容易冲突，补丁里要写清"为什么删" |
| 4 | **跳过整个版本** | 整版都不想要，或某版引入的破坏性不值得付 | 高（长期落后上游，安全/模型更新滞后）；用 `sync-upstream.sh <commit>` 停在好版本 |

硬性约束：

- **不要手改 `vendor/pi` 工作树然后不落补丁**——下次同步会冲掉，`check-isolation` 也会因为工作树脏而报错。
- **不要手写 `LAST_SYNC_POINT` / `vendor/PINNED_COMMIT`**——它们由同步脚本维护；手改会让引导基线
  与 `patches/` 不同源，fresh checkout 直接失败。
- **每一条"不接受的上游变更"都要在 [DECISIONS.md](../../DECISIONS.md) 留一条记录**：上游改了什么、
  为什么不接受、用哪个补丁/开关挡掉。否则半年后没人知道那个补丁为什么存在，
  而"补丁到期该不该清"是 `patches/README.md` 里明写的维护项。

### 新增/修改补丁的流程

```bash
# 1. 在 vendor/pi 里改源码（只改必要的行）
# 2. 提交为本地补丁 commit
git -C vendor/pi add <改动的文件>
git -C vendor/pi -c user.name=my-pi -c user.email=my-pi@localhost commit --no-verify -m "local: 009-footer-badge"
# 3. 导出补丁文件（补丁文件是提交的产物，不是手写的）
git -C vendor/pi diff HEAD~1 HEAD > patches/009-footer-badge.patch
# 4. 更新 patches/README.md 的表格与文件清单
# 5. 重建 dist 才生效
PI_SKIP_ROOT_INSTALL=1 bash scripts/build.sh
```

两个必须遵守的约定：

- **补丁命名 `{序号}-{功能}.patch`，序号即应用顺序**。多个补丁改同一文件是常态（004–009 全部改
  `footer.ts`），所以**不要**用 `git apply --check --reverse` 逐个判定"是否已应用"——顺序叠加后
  早期补丁的 reverse-check 会假失败。判定以提交历史为准（`scripts/lib-vendor.sh` 的 `vendor_patch_applied`）。
- **在改动处写自标记注释 `Patch (NNN-name):` + 理由**。`check-patches-behavior.mjs` 靠这个标记断言
  "补丁行为是否真的还在代码里"——上游同步、手工回退或三方合并都可能让补丁"应用成功但行为消失"，
  没有标记就只能靠人眼看。注释里写清问题与取舍，不要只写"改了什么"。

## 常见坑（上一次跳版实测）

- **上游会跳过版本号**：区间内可能只有 `0.87.1 → 0.99.0`，中间 0.88–0.98 从未发布。
  用 `git rev-list --count 基线..目标` 和 changelog 段，不要用版本号做算术。
- **基线 commit 可能比最近的 tag 新**：上次 `PINNED_COMMIT` 比 `v0.99.1` 多 19 个提交，
  那些 `[Unreleased]` 改动也在升级范围内。
- **`--no-extensions` 语义会变**：0.99.0 起它同时禁用内置扩展（含 provider）。
  autopilot 的定时任务正是以 `-p --no-session --no-extensions` 运行的，
  这类语义变化要专门确认（守门脚本是 `check-seeds-headless.mjs`）。
- **默认模型表与会话格式**：默认模型改名（如 `openai-codex` → `gpt-6.1-sol`、provider 更名 legacy）
  会影响 selector、虚拟模型与 `models-store.json`，同步后要跑一次真实会话确认。
- **构建工具链跳版风险最大**：上游换 TS 大版本 / target ES 版本 / 删 `tsx` 时，
  本地脚本（`patch-playwright-core.mjs`、`vendor-bundle.sh`、自愈缓存）都要复验。
- **遥测要每次确认**：`enableInstallTelemetry` 上游默认 `true` 且会发 provider attribution headers。
  my-pi 已在两处硬关闭：`portable/agent/settings.json` 的 `enableInstallTelemetry:false`
  与 `scripts/pi-supervisor.sh` / `scripts/dev.sh` 的 `PI_TELEMETRY=0`（env 优先级最高）。
  每次同步仍在 settings/telemetry 相关 diff 里确认默认值与开关语义没变，并确认没有新增
  **绕过该开关**的上报路径（例如独立 fetch 或新 provider 的 attribution header）。
- **不要依赖 `vendor/pi/node_modules` 里的任何东西**：上游删依赖时，本地 `node_modules` 不会立刻
  反映（`npm ci` 只在 `deps_ok` 判定需要时跑），于是"看起来还能用"。实测：v0.99.0 删除了 `tsx`
  （改用 Node 内置类型剥离），而 `scripts/run-ts.sh` 当时正是从 `vendor/pi/node_modules/.bin/tsx` 取的，
  本地那份只是升级残留——**换机或重新引导后 headless 写记忆会静默失效**（autopilot 的 `daily-review`、
  `knowledge-subscribe` 都走它）。现已改为 `custom/package.json` 声明 `tsx`、从根 `node_modules` 取。
  排查手法：`python3 -c "import json;d=json.load(open('vendor/pi/package-lock.json'));print([k for k in d['packages'] if k.endswith('node_modules/<包名>')])"`
  返回空 = 该包在 vendor 里已不是受管依赖。
