# 完整性基线（分层防篡改）—— 设计与用法

> **状态（如实）**：**设计与数据已落地**（`packs/security-baseline/tiers.json`）；
> **实现未落地** —— 一次实现尝试的产物**会崩**（`security-scan.mjs` 在 440 行 WIP 里抛
> `ReferenceError`），已**中断并回退**，脚本恢复为可用的上一版。**待重做**（见文末"下一步"）。
> 本文件先把**判据与清单**固定下来，避免下次重做时又要重新论证一遍。

## 一、判据：为什么选这些、为什么排除那些

选目录的判据是 **"改了会怎样"**，不是"目录大不大"：

| 优先级 | 判据 | 为什么最高 |
|---|---|---|
| 1 | **改了＝任意代码执行** | 钩子/脚本/补丁是**每次提交、每次调用都执行**的路径 |
| 2 | **改了＝直接给我下指令** | `AGENTS.md`/`APPEND_SYSTEM.md`/技能/packs 是**提示面**（提示注入） |
| 3 | **改了＝改我的信任边界** | 控制面与凭据（settings/auth/models/modes/trust/seeds） |
| 4 | **改了＝换掉我的身份** | 引导包与密钥（`sync/**`） |
| 5 | 进程内代码入口 | `bootstrap.ts` / `adapters` / `core`（比整个 `custom/**` 小得多且是真正入口） |
| 6 | 系统级持久化点 | 仓库基线**管不到**：rc 文件、`authorized_keys`、cron/计划任务、`PATH` 目录 |

**排除项的判据是"本来就在变"**，不是"不重要"：

| 排除 | 理由 |
|---|---|
| `**/node_modules/**` | 依赖产物；且 `packs/` 里某些包自带依赖 |
| `portable/memory/**` | **运行时数据**（会话/日志/统计每分钟都在写） |
| **`packs/drafts/**`** | **agent 生成 SKILL 草稿的输出目录**（`task-summarizer.mjs` 会往里写）⇒ 纳入即天天误报 |
| `dist/**`、缓存、`**/*.log`、`**/__pycache__/**`、`**/.venv/**` | 产物/日志/缓存，同样会自然变化 |

> **一句话**：把噪声纳入基线的后果不是更安全，而是**守门天天报警然后被无视**——那比没有基线更糟。

## 二、两层的实际规模（2026-10-10 实测，用来校准耗时）

```
.githooks               2 文件 /  16K
scripts                53 文件 / 720K
patches                12 文件 /  76K
portable/agent/skills  25 文件 / 307K
packs                 841 文件 /  13M   ← 占 Tier1 的 ~90%（其中 drafts 必须排除）
sync                    6 文件 / 248K
控制面单体文件            7 个
──────────────────────────────────────
Tier1 合计           ≈939 文件 / ≈14.4M
Tier2 入口（custom/adapters + core + bootstrap.ts）≈182K
```

## 三、效率设计（硬指标，重做时必须满足）

- 清单存 `(相对路径, size, mtimeMs, sha256)`；**验证时先比 `size+mtimeMs`，只有不一致才重算哈希**
  ⇒ 日常成本 **O(改动数)**，不是 O(文件数)（939 次 `stat` vs 14 MB 哈希，差一个量级）。
- **只在显式调用时跑**（`--baseline --verify`），**不进每轮对话路径**。
- **目标**：Tier1 冷 `--init` 几十~一百毫秒量级；热 `--verify` **≲100ms**。
  **超了先查 exclude 是否生效**（多半是把 `packs` 里会变的算进去了），**而不是先优化哈希**。
- 基线存**运行时目录**（`portable/memory/security/<tier>-baseline.json`），**不入库**——
  与 `pi-backup` 的 `.backup-baseline` 惯例一致。**代价要写清**：基线不入库 ⇒ 跨机不通用；
  且**基线本身若被改，验证就失去意义**（这是这套机制的固有局限）。

## 四、便携化（硬指标）

只用 Node 标准库：`node:fs/promises`、`node:crypto`、`node:path`、`node:os`。
**禁止** `sha256sum`/`strings`/`objdump`/`file`/`aide`/`rkhunter`；**禁止** `/dev/null`、`find -printf`、
`env VAR=x`。系统级持久化点用 `os.homedir()` 拼路径，**存在才纳入**（Windows 上换成"计划任务/启动项"）。

## 五、叠加关系（不重复造）

| 层 | 已有机制 | 本基线要不要重做 |
|---|---|---|
| 控制面/凭据 | **`pi-backup` 已有哈希基线**（settings/auth/models/models-store/modes/trust/seeds） | **不重做**，复用 |
| 下载物检查 | `security-scan.mjs` 三态（`clean`/`suspicious`/**`not-scanned`**） | 不重做 |
| 单文件防篡改 | `security-scan.mjs --manifest [--verify]` | 不重做，与新层并存 |

## 六、用法（实现落地后）

```
node scripts/security-scan.mjs --baseline --tier1 --init       # 生成基线（运行时目录）
node scripts/security-scan.mjs --baseline --tier1 --verify     # 增量验证：unchanged/changed/added/removed
node scripts/security-scan.mjs --baseline --tier2 --verify     # Tier2（进程内入口 + 系统级持久化点）
```
**默认只记录、不阻断**（任何自动阻断都属"改默认行为"，需用户批准）。

## 七、下一步（重做时的清单）

1. 修掉那次 WIP 的崩溃（`ReferenceError`），**先证明脚本能跑**，再谈别的；
2. `tiers.json` 里**补上 `packs/drafts/**` 与 `**/.venv/**`**（本文件已列为必排除）；
3. **双向自证**：不改 ⇒ `unchanged`；**改一字节** ⇒ `changed` 且**给出路径**；加文件 ⇒ `added`；
   并保证"永远返回未变"的假实现会**失败**；
4. 交付**实测耗时**（Tier1 init / 热 verify），写回本文件；
5. 不许调用任何外部命令（便携化）——重做后要再自查一次。
