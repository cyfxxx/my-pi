# 上游 pi 1.2 同步切换（Runbook · **已执行**）

> ## ✅ 状态：**已完成**（2026-10-14，提交 `d51f7255b`）
> 执行结果：`vendor/pi` HEAD = **`c3bc10e24`**（`local: 011-tool-search-cjk`）、`LAST_SYNC_POINT` = `PINNED_COMMIT` =
> **`6374c2baf432419ccb4541a99ce4958ecd03dae0`**、`packages/coding-agent` 版本 = **1.2.0**、`upstream` URL 已还原为 GitHub；
> 1.2 版 `002`/`010` 已换入 `patches/`（见第 4 步）；`voice` 三处 `deliverAs: 'steer'` 已加；
> `patches-next/` **已于 2026-10-15 删除**（内容与 `patches/` 逐字节相同，见第 4 步的 sha256）。
> **本文件保留为"当时怎么做 + 怎么回滚"的历史记录**；下次同步**不要照抄**，先读 `docs/design/UPSTREAM-SYNC-PLAN.md` 与脚本当前形态。
>
> **适用**：把 `vendor/pi` 从 **1.0.4**（`LAST_SYNC_POINT` = `28dcce2b…`）切到上游 **1.2**。
> **分工**：本 runbook 的每一步都有验证门槛；**失败是显式的**（脚本"全成功才移动 vendor 分支"），但仍**必须在用户在场时执行**。
> **纪律**：**绝不为让门禁变绿而改断言/阈值**；**注入面基线哈希若变必须有意更新并写明理由**。

---

## 0. 前置（先记录回滚点）

| 项 | 当前值（记录之） |
|---|---|
| `vendor/pi` HEAD | **`db03484e20f1bf5b6ad7f3f64e3e271652040404`**（`local: 011-tool-search-cjk`） |
| `vendor/pi/LAST_SYNC_POINT` | **`28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9`** |
| 主仓库 | 干净、`main == origin/main`；记下当时的 SHA |

★ 目标 commit：`6374c2baf432419ccb4541a99ce4958ecd03dae0`（`upstream/main`，= `v1.2.0-37`）。

## 1. 目标选择（**先决定**）

- **建议先按 `v1.2.0` tag** ✓（变化面小、有 changelog 对照）；验证后再考虑跟进 `main`。
- ★ **脚本当前指向 `upstream/main`**（比 tag 多 37 笔）⇒ **指定 tag 的开关名未核实** ✗
  ⇒ **执行前先读 `scripts/sync-upstream.sh` 确认开关名/来源变量**，**不要照抄一个没核实的开关** ✗。

## 2. 干跑（只读 ✓）

```bash
PI_SYNC_DRY_RUN=1 bash scripts/sync-upstream.sh
```
★ 已知：**干跑只打印计划、不重放** ✗（它不会回答"补丁能否重放"）—— 补丁重放结论来自**另一条只读演算**（见 `docs/design/UPSTREAM-SYNC-PLAN.md`）。

## 3. 真正执行（**全成功才移动 vendor** ✓）

```bash
bash scripts/sync-upstream.sh
```
- 它在**临时 worktree** 里重放 `patches/*.patch`；**任一失败 ⇒ vendor 不变** ✓。
- ★ 预期风险点：**001 需要 `git apply -3`**（三方合并）；002/010 需要 1.2 版（见第 4 步）。

## 4. 换入 1.2 版补丁（两个）—— **已完成**

原来放在 `patches-next/1.2/`（当时刻意放在 `patches/` 之外：`golden-tasks.sh` 第 6 步只 glob `patches/*.patch`，
在 vendor 还停在 1.0.4 时把 1.2 版放进 `patches/` 会**当场让门禁变红**），切换时换入 `patches/002-local-pi-mods.patch`
与 `patches/010-disable-share-bug.patch`（★ **保留补丁内自标记 `Patch (NNN-name):`** ✓）。

**因此 `patches-next/` 已完成使命，2026-10-15 删除**。删除前的等价性是**逐字节 sha256 相同**（当时的核对命令：
`sha256sum patches-next/1.2/002-local-pi-mods.patch patches/002-local-pi-mods.patch`；`010` 同）——
★ 该命令**现在已不可复跑**（目录已删），要复核请用 git：`git show bc3e4ba11:patches-next/1.2/002-local-pi-mods.patch | sha256sum`
与 `sha256sum patches/002-local-pi-mods.patch` 对比 ✓。
要回看当时的原文/生成法：`git show bc3e4ba11:patches-next/1.2/README.md` ✓（该目录只在那一笔提交里）。

## 5. 加一行适配（语音路径）

`custom/features/voice/index.ts` 的 `:78` / `:344` / `:367` 三处（经 `custom/adapters/ui-adapter.ts:185`/`:193` 包装）
⇒ **加 `deliverAs: 'steer'`** ✓。
- 依据：1.2 把 `deliverAs` **直接映射为 `streamingBehavior`**；语音 = 用户**此刻**在说话 ⇒ 立即生效（= 敲字回车）。
- ★ 为什么零风险：**我们自己的适配器类型本来就声明了 `deliverAs?: 'steer' | 'followUp'`**（`ui-adapter.ts:189`），
  **pi 1.0.4 也接受** ⇒ 两个版本都能编译 ✓。

## 6. 两道闸门的预期报警与处置

| 闸门 | 预期 | 处置 |
|---|---|---|
| **注入面基线**（`8493be6d…`，golden 第 8 步） | 若上游动了 system prompt / hard rules ⇒ **会变** | ★ **必须有意更新并写明理由** ✓ —— **绝不为变绿而改** ✗ |
| **补丁行为自标记**（第 7 步） | 换入 1.2 版补丁后仍应在 | 若报错 ⇒ 补回 `Patch (NNN-name):` ✓ |

## 7. 验证（按此顺序）

```bash
node_modules/.bin/tsc --noEmit -p custom/
node_modules/.bin/vitest run
bash scripts/golden-tasks.sh --fast
PI_GOLDEN_SCENARIO=1 bash scripts/golden-tasks.sh     # ★ 三个 pty 场景必须显式开启
```
★ **注意**：第 19/20/21 步（模式切换 / 两实例隔离 / 会话切换）**默认跳过** ✗，不加 `PI_GOLDEN_SCENARIO=1` **也不会跑**；
本项目日志还提示第 19/20 步是**"留出集：开发期间不应查看结果，只在验收时跑"** ⇒ **跑完后其盲测新鲜度会被消耗**，请知悉后再决定是否查看
（第 21 步是 2026-10-14 那次会话切换改动的开发期检查，不属于留出集）。

## 8. 回滚（已验证路径 ✓）

```bash
git -C vendor/pi reset --hard db03484e20f1bf5b6ad7f3f64e3e271652040404   # 旧补丁栈顶
echo 28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9 > vendor/pi/LAST_SYNC_POINT
# 再重建 dist 与"好 pi"缓存；并恢复 patches/ 里的 002/010 为 1.0.4 版
```

★ **1.0.4 版补丁从 git 历史取**（`patches-next/` 已删，但那不是来源）：

```bash
git log --oneline -- patches/002-local-pi-mods.patch        # 找到切换前那一笔
git show <切换前那笔 SHA>:patches/002-local-pi-mods.patch > patches/002-local-pi-mods.patch
git show <切换前那笔 SHA>:patches/010-disable-share-bug.patch > patches/010-disable-share-bug.patch
```

## 9. 仍未核实（执行前请知道 ✗）

- **指定 tag 的开关名**（第 1 节）✗；
- `sync-upstream.sh` 在 worktree 里的**实际应用命令**（`git apply` vs `git am`）**未逐字读到** ⇒ 我们那条"11/11"是**内容层面**等价验证 ✗；
- 1.2 的 **`event.message` 负载形状**（影响 `intervention` 能否"记对"正文）✗；
- 1.2 **流式中不传 `deliverAs` 的运行期行为**（只证了**签名相同**，不是**行为相同**）✗；
- 上游自身构建是否容忍 `return` 后的**不可达代码** ✗。

---

## 附：本次为切换已完成的前置工作（都已推送）

- **补丁层**：11/11 可干净重放到 `6374c2baf` ✓（含本 runbook 第 4 步的两个 1.2 版补丁 ✓）
- **引用层**：无"必炸"引用 ✓（`pi-client`/`pi-protocol`/`pi-server` 0 命中；`pi-agent-core` 的 harness API 0 命中）
- **编译层**：`custom/` 类型检查 **0 错误**（源码面等价 ✓）
- **适配层**：`before_agent_start` 已按 `messageType` 双兼容适配 ✓（`custom/features/intervention/index.ts`）；`voice` 的 `deliverAs` 与补丁换入列为第 4/5 步 ✓；**010 实测无需扩展** ✓

## 附二：切换后的收尾（2026-10-15）

- **`patches-next/` 已删除**（冗余：与 `patches/` 里换入后的两份补丁 **sha256 逐字节相同**；可 `git show bc3e4ba11:patches-next/…` 回看）。
- **`packs/reverse-skill` 已从更早的上游快照同步到上游 main `cab634bd`**（与本 runbook 无关，见 `DECISIONS.md` 同日条目）。
- **回归确认**：`golden-tasks.sh --fast` 全绿（含第 6 步"patches 全部可应用/已应用"）；`node_modules/.bin/tsc --noEmit -p custom/` rc=0；
  全量 vitest / 两个 pty 场景见切换当时的记录（`DECISIONS.md` 2026-10-14 条目）。
