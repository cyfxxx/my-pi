# 完整性基线（分层防篡改）—— 设计与用法

> **状态：已实现并自证通过**（`scripts/security-baseline.mjs`）。
> 层定义是**数据**：`packs/security-baseline/tiers.json`。
> **实测耗时（本机 = proot/Android，`stat` 很慢，务必按本机事实读）**：
> Tier1（949 文件）init **7.6s** / 热 verify **3.1s**（**重算哈希 0 个** ⇒ 增量生效；时间由**目录遍历**主导）；
> Tier2（25 文件）init **0.4s** / 热 verify **190ms**。
> ⇒ **要快就用 Tier2**；Tier1 在慢文件系统上不适合频繁跑（这也正是"只在显式调用时跑"的原因）。
>
> **两条来自实测的教训**（都已写进代码注释）：
> ① 第一版只对"文件"过滤 include/exclude ⇒ **整个仓库（含 `.git/`）都被遍历** ⇒ Tier2 只有 25 个文件也要 **3s**；
>    加两道剪枝后 Tier2 降到 **190ms**（13×）。
> ② 但剪枝第一版**剪错了**：`**/*.txt` 这类**没有字面前缀**的模式被判成"不可能命中" ⇒ 一个子目录都不进 ⇒
>    **静默少看文件**。**自证当场判红**（`unchanged=1` 应为 2、`removed=[]` 应含 `sub/b.txt`）。
>    ⇒ 规则修正为：**无字面前缀的模式 = 可匹配任何地方 ⇒ 不得剪枝**。

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

## 八、第 ⑤ 层：供应链（`scripts/supply-chain-check.mjs`，离线）

`--init` 已把 `package.json` / `package-lock.json` / `custom/package.json` 纳入 Tier1（**lockfile 被改 = 依赖被换**）。
此外用 `node scripts/supply-chain-check.mjs` 做**离线**审计，两个指标都是**不需要联网、不需要装任何东西**：
① `resolved` 指向**非预期 registry**（镜像劫持 / typosquat 的迹象）；② **带安装钩子的包**
（`hasInstallScript` ⇒ `npm install` 时就执行别人的代码）。
**实测（本机）**：`needs-review 2 项` —— `esbuild`（下载自身二进制）与 `fsevents`（macOS 专用），**都是已知正常**；
`my-pi-custom` 曾被我误报为"陌生 registry"（它是 workspace 本地链接）⇒ 已修，**本地链接单独跳过**。
**口径**：只出 `clean` / `needs-review`，**不判恶意、不阻断**；用镜像是正当选择，脚本只负责指出偏离。

## 九、第 ⑦ 层：系统级持久化点（**tier3 已实现**；缺口收窄为 2 项）

用户已**批准为此破一次"只用 Node 标准库"的约束**，但**只限本层**（Tier1/Tier2 仍是零依赖 —— 实测 Tier2 仍
`重算哈希 0 个`、不调任何外部命令）。

### 覆盖情况（2026-10-10 实测，本机 Linux）

| 位置 | 状态 | 实测 |
|---|---|---|
| 用户级 `cron`（`crontab -l`） | ✅ **已覆盖** | Linux 上取到输出 ⇒ 记为 1 个环境源（`env:crontab`） |
| Windows 注册表 `Run`（HKCU / HKLM） | ✅ **已实现**（本机不适用） | 如实输出 `not-scanned：平台不适用（要求 win32，当前 linux）` |
| Windows 任务计划（`schtasks /query`） | ✅ **已实现**（本机不适用） | 同上，`not-scanned` 且写明原因 |
| `PATH` 变量值本身 | ⚙️ **已实现但默认关** | 便宜方案（能发现 PATH 被改），按用户要求默认不收；要开就把 `tiers.json` 里 `enabled` 改 true |
| `PATH` 目录内容 | ❌ **仍不收** | 体量巨大且随安装常变 ⇒ 纳入即误报（判据不变） |
| `~/.bashrc` / `.profile` / `.zshrc` / `.ssh/*` / autostart / Windows 启动文件夹 | ✅ 已覆盖 | 这些是**文件**，在 **Tier2**（不需要外部命令） |

### 用法与实测耗时（本机 Linux）

```
node scripts/security-baseline.mjs --tier3 --init      # 58ms
node scripts/security-baseline.mjs --tier3 --verify    # 71ms / 66ms（两次均 unchanged=1，稳定）
```
**默认关**：只有显式 `--tier3` 才跑；`--strict` 才在发现变更时非 0 退出。

### 三条安全设计（都可复核）

1. **只读白名单**：命令与参数都要过 `READ_ONLY_ALLOWLIST`（只允许 `reg query`、`schtasks /query`、
   `crontab -l`）；**不在白名单 ⇒ 记 `not-scanned` 且不执行** ⇒ "写注册表/改任务"在结构上不可能发生。
   自证里专门有一条：`reg add …` 必须被拒（实测输出 `写命令被拒⇒true`）。
2. **如实缺席**：命令不存在（ENOENT）、非零退出、平台不适用 ⇒ 一律 `not-scanned` 并**写明原因**；
   基线与输出里记录**实际执行的命令**（可复核跑了什么）。
3. **注入式执行器**：`runEnvSources(sources, exec, platform)` 收一个 `exec` 函数 ⇒ 自证用**桩**覆盖
   "命令不存在 / 有输出 / 非零退出 / 写命令 / 平台不匹配"五种情形，**不触真实系统**。

### 增量说明（如实，别被"0 次重算"误导）

env 源**没有 mtime 可依赖** ⇒ 每次都要运行命令并哈希其输出，**无法像文件那样跳过**。
好在**源数量是常数级**（cron 1 条 + Windows 3 条）⇒ 成本与文件数无关，实测 **58~71ms**。
**文件层的增量不受影响**（Tier1/Tier2 仍是"先比 size+mtime，只有不一致才重算哈希"）。

## 十、PATH 中**可写目录**的覆盖（默认开，2026-10-10）

**判据（为什么只取可写目录）**：攻击者要**植入假命令**（PATH 劫持）**必须有该目录的写权限** ⇒
**可写目录是小而高信号的子集** ✓；全量 PATH 目录**体量大、随安装常变 ⇒ 天天误报** ✗（而且本机 stat 极慢）。
**可写判据** = 权限位有写位（`mode & 0o222 !== 0`）**且** `accessSync(W_OK)` 通过 ——
**必须带权限位**：本环境以 **root** 运行时 `access()` 对**一切目录**都成立，只看它会把不可写目录也算进来 ✗。
**范围**：只取每个目录的**顶层文件**（PATH 查找命中的就是顶层），不下潜 ✓。
**与 `env:path-value` 互补** ✓：那个记的是 **PATH 变量值**（"PATH 被人改了"），这个记的是**目录里的文件**（"命令被换了"）。

**上限护栏（实测调过）**：单目录 **300**、总计 **900**，**确定性截断**（先按文件名排序再截断 ⇒ 覆盖集合可复现 ✓），
到上限**如实记 `pathTruncated`**，**绝不假装扫全** ✓。

**实测（本机 proot/Android）**：

| 配置 | Tier2 热 `--verify` |
|---|---|
| 未加 PATH 覆盖 | **190ms** |
| 2422 个 PATH 文件（12 个目录） | **1946ms** ✗ 超 1 秒 ⇒ 收紧上限 |
| **900 个 PATH 文件（上限护栏）** | **763ms** ✓ |

⇒ 也顺带量到：**本机每次 stat 约 0.7ms**（2422 → 1946ms），所以"PATH 目录全覆盖"在这台机器上不可行 ✓。

**代价如实说（三条局限）**：
1. **部分覆盖**（到上限即停）⇒ **不是**完整的 PATH 完整性检查 ✗；
2. 被包管理器更新的目录（如 Termux 的 `$PREFIX/bin`、`/usr/bin`）**装包后本来就会变** ⇒ 那时出现 `changed` 是**预期信号**，
   处理方式是**装完包重新 `--init`** ✓（不要当噪声忽略 ✗）；
3. 本环境 **`chmod` 对目录不生效**（proot/Android）⇒ 自证里"不可写目录被排除"这一分支**未能实测** ✗，
   只能用代码判据 + "不存在的路径被排除"代替，并在自证输出里**如实标注** ✓。

