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
