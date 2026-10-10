---
name: pi-download-safety
description: 下载/安装/解压/使用外部文件（尤其模型文件、脚本、压缩包、浏览器下载）前后的安全流程：哈希校验、类型识别、pickle 风险、路径穿越、清单防篡改，并如实报"未扫描"。用户说"下载""安装""解压""校验""这个文件安全吗""sha256""模型文件"时触发。不适用：纯文本阅读与不落盘的 API 查询。
version: v1.0
更新日期: 2026-10-09
---

# pi-download-safety 技能

## 三态语义（**最重要的一条**）

- `clean` —— **该跑的都跑了**且无命中；
- `suspicious` —— 有具体命中（附规则名与证据）；
- **`not-scanned`** —— 能力缺失（如本机没有 ClamAV）或证据不足。

**`not-scanned` 不得说成"安全"**。本环境实测**没有** ClamAV / YARA / file / gpg / 沙箱，
所以**结论里必然出现 `not-scanned`** —— 这是事实，不是失败。**不要为了让用户安心而省略它。**

## 标准流程（先便宜后昂贵）

1. **哈希**：**优先用本仓库的跨平台脚本** `node scripts/security-scan.mjs --file <file>`（内部用 `node:crypto`，Linux/Windows 都能跑）。**手写命令才分平台**：Linux/macOS `sha256sum <file>` 或 `shasum -a 256 <file>`；**Windows** `certutil -hashfile <file> SHA256`。若来源有官方校验和**必须比对**（模型权重尤其）。
2. **结构**：`node scripts/security-scan.mjs --file <path>`
   —— 扩展名与 magic 是否相符、是否命中 **EICAR 测试串**、**pickle 危险全局引用**、
   zip **路径穿越**与炸弹比率。
3. **杀毒（若可用）**：有 ClamAV 时 `clamscan --infected <file>`；**没有就报 `not-scanned`**。
4. **在线信誉（按需）**：`--update-feed`（URLhaus，免费无需 key）后 `--url <u>`；
   命中叫 `suspicious`，**没命中叫 `not-listed`（不等于安全）**。
5. **落地后防篡改**：`--manifest <dir>` 写清单，之后 `--verify` 校验变更。
6. **可疑时的处置**：**不要执行**、不要解压到工作目录、保留样本、把结论交给用户决定；
   **默认只报告不擅自删除**。

## 纪律

- **不假装安全**：没查的能力说没查；漏报是必然（黑名单滞后、结构性检查≠杀毒）。
- **不一惊一乍**：`clean` 就照常使用；`suspicious` 才升级处置。误报同样要如实写"这是启发式"。
- **自证**：`--file` 的验证用 EICAR（`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`，
  68 字节公开测试文件）——**它必须报 suspicious，否则扫描器就是摆设**。
- 本环境能升级的选项：装 **ClamAV**（若平台有包）/ **YARA + 社区规则** / 提供 **VirusTotal key**。

## 便携化（Linux 主 / Windows 次）

- **优先调用脚本，而不是手写 shell**：`node scripts/security-scan.mjs …` 两端一致（哈希用 `node:crypto`、
  结构识别是纯 JS、无需 `file`/`strings`/`objdump`）✓。
- **手写命令的分平台写法**：哈希 Linux/macOS = `sha256sum` / `shasum -a 256`；Windows = `certutil -hashfile <file> SHA256`。
- **不要用** `file` / `strings` / `objdump` / `bwrap` / `firejail` 之类**本环境本来就没有**的工具（脚本会如实报"未扫描"）。

## 一条可执行流程（把三层串起来用）

下载/引入外部东西时，**按顺序**跑下面这几条（都是本仓库脚本，**跨平台、零外部依赖**）：

1. **看这个东西是什么**（哈希 + 结构 + 三态结论；`L2_antivirus=not-scanned` 是**如实**的，不是"干净"）：
   `node scripts/security-scan.mjs --file <文件>`
   —— 结果只有 `clean` / `suspicious` / **`not-scanned`**；**"未扫描"绝不等于"安全"**。
2. **如果来源给了官方校验和/签名**：**必须比对**（模型权重、安装包尤其）：
   Linux/macOS `sha256sum <文件>` 或 `shasum -a 256 <文件>`；**Windows** `certutil -hashfile <文件> SHA256`。
3. **如果引入了新依赖**（改了 `package.json`/`package-lock.json`）：
   `node scripts/supply-chain-check.mjs`
   —— 只判两件**离线可判**的事：`resolved` 指向非预期 registry、包是否带**安装钩子**；
   结论 `needs-review` **只是"请人确认"**，不是"恶意"（**用镜像是正当的**）。
4. **改完之后**（尤其动了 `.githooks`/`scripts`/`patches`/`AGENTS.md`/`APPEND_SYSTEM.md`/技能/packs）：
   `node scripts/security-baseline.mjs --tier1 --verify`
   —— **增量**（一致就不重算哈希）；**默认只记录不阻断**，要非 0 退出加 `--strict`。
   注意：Tier1 在本机（proot/Android）约 **3.1s**（文件系统遍历主导），**要快用 `--tier2`（约 190ms）**。
5. **改完基线并确认是有意修改后**，再 `--init` 刷新基线；否则下次 verify 会一直报变更。

**姿态（三条都是刻意的）**：
- **只记录、不阻断**——任何自动拦截/自动扫描默认都是关的（要开需用户批准）；
- **不假装安全**——能力缺失时如实报 `not-scanned`；
- **不引入噪声**——免 key 的在线查询优先"拉本地黑名单"（URLhaus），**上传文件本体一律不做**。

## 扫描太慢怎么办（`clamscan` 每次载库 ≈10 秒）

- **现状**：每次扫描要**重新载入病毒库**（本机实测**约 10 秒**、**峰值内存 ≈966 MB、瞬时**）。
  所以自动扫描钩子**只对新下载、且按 sha256 去重后的文件**跑一次 ⇒ 平时几乎不会遇到 ✓。
- **要更快**：可启用**常驻守护**（`clamd` + `clamdscan`，亚秒级 ✓），代价是 **≈1 GB 常驻内存** ✗。
  判断规则与实测数字见 `docs/design/AV-INSTALL-ATTEMPTS.md` 的"常驻 vs 瞬时"一节；
  **本机属"保持瞬时"那一类**（总 7.7 GB、可用 2.5 GB）✓。
- **不要**为了"看起来扫过了"而跳过扫描：**缺能力/内存不足时一律如实报 `not-scanned` / `skipped-low-mem`**，
  **绝不显示成 clean** ✓。
