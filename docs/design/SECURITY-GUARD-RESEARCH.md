# 安全防护（以防病毒为主）：现成开源/免费工具的落地调研（2026-10-09）

> 目标：模型**下载文件 / 网络搜索 / 操作浏览器**时的防护——哈希校验、杀毒、特征识别、防篡改。
> **优先开源/免费第三方**（自研杀毒不合理）。**本文所有"可用"结论都是本环境实测**，命令与输出在文中。
>
> **一句话结论**：本机**没有任何杀毒引擎**（ClamAV/YARA 未装），且 **ClamAV 官方病毒库在本环境不通**；
> 能立刻用起来的只有**哈希 + openssl/strings/objdump + 自建结构检查 + urlscan.io**。
> ⇒ 设计必须是"**能查的查、没查的说清楚**"，而不是假装有杀毒。

## 0. 本环境实测（`command -v` / `import` / `curl`，2026-10-09）

| 能力 | 实测 | 结论 |
|---|---|---|
| `sha256sum` / `sha1sum` | `/usr/bin/sha256sum`、`/usr/bin/sha1sum` | ✓ 哈希层可用 |
| `openssl` | `/usr/bin/openssl` | ✓ 可做 `dgst` 哈希、证书/签名相关 |
| `strings` / `objdump` | Termux 下均有 | ✓ 可做**轻量特征提取**（不依赖 `file`） |
| `git` | ✓（`git fsck --connectivity-only` 实测可用，输出 dangling 对象属正常） | ✓ 仓库完整性可查 |
| `file`（libmagic） | **未安装** | ✗ 需自备极小 magic 表 |
| `shasum` | **未安装** | ✗ 用 `sha256sum` 即可 |
| `clamscan`/`clamdscan`/`freshclam` | **未安装** | ✗ **本地杀毒不可用** |
| `yara` | **未安装** | ✗ 规则引擎不可用 |
| gpg / minisign / cosign | **未安装** | ✗ 签名校验不可用 |
| bwrap / firejail | **未安装** | ✗ 沙箱执行不可用 |
| python3 | ✓；`hashlib`/`pickletools` ✓；`requests` ✓ | ✓ |
| python 侧 `oletools`/`pefile`/`magic`/`yara` | **均 ✗** | ✗ Office 宏/PE 解析需另装 |
| pip 安装 | **被 PEP 668 拦下**（需 venv 或 `--break-system-packages`） | ✗ 不能随手装 ⇒ **方案要零依赖** |

## 1. 哈希校验（**唯一现在就能做好的**）

- 工具：`sha256sum`（✓）/ `openssl dgst -sha256`（✓，两者互为独立实现，可交叉验证）。
- **校验和来源**（按可信度）：① 官方发布页/tag 上的校验和文件；② **签名文件**（PGP/minisign —— **本机无工具，✗**）；
  ③ 包管理器自身（`npm audit signatures`、`pip --require-hashes`）；④ 浏览器 **SRI**（网页资源）。
- **没有官方哈希时**：只能做 **TOFU（首次见到的哈希记下来，之后比对）**——
  **它防的是"以后被替换"，防不了"第一次就是坏的"**，必须在结论里写明这一局限（不要把 TOFU 说成"已验证"）。

## 2. 杀毒 / 恶意软件扫描

| 方案 | 许可 | 本环境 | 备注 |
|---|---|---|---|
| **ClamAV**（`clamscan`/`clamdscan` + `freshclam`） | GPL-2.0 | **未安装** | 免费、离线可用（有库就能扫）；**病毒库更新是最大障碍，见下** |
| YARA | Apache-2.0（引擎） | 未安装 | 规则引擎，不是杀毒库；规则质量决定效果 |
| 商业/在线引擎 | — | — | 需账号；隐私代价见 §4 |

**受限网络下 ClamAV 病毒库怎么更新（本环境实测，结论不乐观）**：
- 官方 `https://database.clamav.net/main.cvd` ⇒ **000（不通）**；
- 国内镜像尝试：`mirrors.tuna.tsinghua.edu.cn/clamav/`、`mirrors.ustc.edu.cn/clamav/`、`mirrors.aliyun.com/clamav/`
  ⇒ 三个都是 **404**（**域名可达但该路径不存在**）⇒ **"国内有 ClamAV 库镜像"这一说法本文未验证成功**。
- ⇒ **诚实的可落地做法**：① 用能联网的机器/另一网络下好库再拷进来（`*.cvd`/`*.cld` 是文件级可搬运的）；
  ② 或改用**不依赖大库**的层级（§3）；③ **不要**在没有库的情况下让 `clamscan` 结果被当成"已扫描"。

## 3. 特征识别 / 规则引擎（零依赖可做的部分）

- **轻量分类**：`strings`（✓）+ `objdump`（✓）+ 自备**极小 magic 表**（PNG/JPEG/ZIP/GZIP/ELF/PE/PDF），
  用来抓"**扩展名与内容不符**"——这是最便宜、命中率最高的一类检查。
- **脚本/宏检测**：`oletools`（Office 宏，**未装 ✗**，需 pip）；shell 侧可用**保守文本特征**
  （`curl … | sh`、`base64 -d |`、`eval(`、`Powershell -enc`）。
- **模型文件（值得单独说）**：Python **`pickletools`（标准库 ✓）** 能列出 pickle 的 opcode 与**全局引用**，
  足以暴露反序列化执行类风险（`os.system`/`subprocess`/`eval` 等）；`safetensors` 头部长度自洽性也可
  零依赖校验。**这是本环境最有性价比的一层**（模型文件投毒的主要入口之一）。
- **YARA 规则来源**：`Yara-Rules/rules`、`Neo23x0/signature-base`（均 GitHub）——
  本环境**直连不可达**，走 **jsDelivr** 实测 **301（需跟随重定向，未用 `-L` 深测）** ⇒ **未验证可用**，别写"可用"。

## 4. 在线信誉服务（**免 key 的只有一家**；隐私代价必须写清）

| 服务 | 免 key？ | 实测 | 隐私代价 |
|---|---|---|---|
| **urlscan.io**（`/api/v1/search/`） | **✓ 200** | **可用** | 查询的是**域名**，不传文件本身；仍会暴露"你在查什么" |
| VirusTotal API v3（`/files/<hash>`） | ✗ **401** | 需 key（免费档有速率限制） | **传哈希通常可接受**；**绝不建议上传私密文件本体** |
| Google Safe Browsing | ✗ 需 key（实测 404，需 POST+key） | 需 key | 传 URL |
| Hybrid Analysis | ✗（301 ⇒ 需 key/接口变更） | 未验证 | 上传样本＝**样本会被第三方留存/共享**，私密文件禁止 |
| URLhaus（`urlhaus.abuse.ch/downloads/text/`） | **✓ 200（前序实测）** | **可用** | **拉全量黑名单到本地**，**不对外暴露你在查什么** ⇒ 隐私最好 |

⇒ **推荐顺序**：**URLhaus 本地黑名单（隐私最佳、免 key）> urlscan.io（免 key、查域名）> VT（需 key、只传哈希）**；
**任何"上传文件本体"的服务默认不用**。

## 5. 防篡改 / 完整性

- **文件基线哈希**：首次记录 `path → sha256`（清单），之后 `--verify` 比对；**改动/新增/删除分别报**
  （本会话已有实现先例：`scripts/security-scan.mjs --manifest [--verify]`，实测改一字节即报 `tamper-changed` ✓）。
- **仓库完整性**：`git fsck --connectivity-only`（✓ 可用；dangling 对象正常）。
- **注入面基线**：本仓库已有 `check-injection-surface.sh` 的"基线哈希 + 变了就红"范式 ⇒ **同一思想可直接复用**。
- **局限**：清单自身也会被改 ⇒ 清单要么进 git（有历史可查），要么放在受保护位置；**别把它放在同一目录却不加保护**。

## 6. 浏览器侧

- **URL 信誉**：导航前用 URLhaus 本地表 + urlscan.io 查**域名**（不要上传完整含 token 的 URL）。
- **下载目录监控**：新文件落盘即算哈希、跑结构检查、记入清单（**默认只记录**，见 §7）。
- **扩展/权限**：浏览器扩展是高权限面，**不装来路不明的扩展**；模型**不应**自动安装扩展。
- **明确不做**：把未校验的下载**直接执行/解压到工作目录**；`curl | sh`；在没有沙箱的机器上跑未知二进制。
- **本方案管不到的**：**网页内 JS 行为与挂马**（无沙箱/EDR）⇒ 不要声称能防。

## 7. 落地形态建议（结合 my-pi 既有结构）

**推荐：技能 + 脚本 + 默认只记录的钩子；不新增声明工具。**

| 形态 | 采用 | 理由 |
|---|---|---|
| **脚本**（`scripts/security-scan.mjs` 已存在） | ✓ | 零依赖、可被 bash 直接调用；三层：哈希/结构 → 本地 AV（**未装则报 not-scanned**）→ 在线（opt-in） |
| **技能**（`pi-download-safety` 已存在） | ✓ | 把"下载后必做什么、没做要怎么说"写成配方；**零声明面字节** |
| **钩子**（下载动作后自动扫描） | △ **默认只记录** | 自动**拦截**＝改默认行为，**需用户批准**；先记录、留证据、供人复核 |
| **新声明工具** | ✗ | 工具面余量仅 **1159 B**；且安全扫描是"按需调用"，不是"模型必须随时看得见" |

**必须 opt-in 的**：在线查询（传哈希/域名给第三方）、病毒库更新（网络+磁盘）、任何**阻断**行为。
**能做成"证据留盘、供人复核"的**：哈希与结构检查结论、清单比对、URL 查询结果 ⇒ 落 JSONL（**不进模型上下文**），
只把**摘要与三态结论**给模型。

**三态语义（要害）**：`clean` / `suspicious` / **`not-scanned`**；
**本机没有 ClamAV ⇒ 结论里必须出现 `not-scanned`**，"未扫描 ≠ 安全"。

## 8. 需要用户决策或安装的点

1. **是否安装 ClamAV/YARA**（并解决**病毒库更新通道**：本环境官方库 000、国内镜像 404 ⇒ 需离线搬运或换网络）；
2. **是否提供 VirusTotal API key**（只传哈希，不传文件）；
3. **是否允许钩子自动阻断**（默认只记录）；
4. **哪些目录纳入基线清单**（范围越大越安全也越慢）。

## 附：引用的开源项目（名 / 仓库 / 许可）

| 项目 | 仓库 | 许可 |
|---|---|---|
| ClamAV | `Cisco-Talos/clamav` | GPL-2.0 |
| YARA | `VirusTotal/yara` | Apache-2.0 |
| YARA 规则集 | `Yara-Rules/rules` | 见仓库（多为 Apache-2.0/自定义） |
| 特征库 | `Neo23x0/signature-base` | 见仓库（Detection Rule License） |
| oletools | `decalage2/oletools` | BSD-2-Clause |
| URLhaus（abuse.ch） | `abusech/urlhaus`（数据服务） | 免费 API，使用条款见 abuse.ch |
| urlscan.io | 公共服务 | 免费档，条款见官网 |
| pickletools | Python 标准库 | PSF |
