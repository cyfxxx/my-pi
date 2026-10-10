# 网络加速 与 下载/浏览安全防护：设计（含本环境实测证据）

> **本文的定位（写给读到这份文件的人）**：本任务是"网络加速 + 下载/浏览安全防护"。
> 同一批工作里已有两份**正式设计**：`docs/design/NET-ACCEL.md`（网络加速）与
> `docs/design/SECURITY-SCAN.md`（安全扫描）。**设计以那两份为准**——本文**不替代**它们。
>
> 本文的价值只在两处，且都是**别人无法从文档里推出来**的东西：
> **§1 实测证据**（本环境哪些镜像/工具/服务真的可用、哪些全灭）与 **§4 边界与风险**
> （免费代理的安全立场、fail-open/fail-closed 的分界、能防住与防不住什么）。
>
> §2/§3 是我在不知道上述两份文档存在时写的**独立设计草案**，与它们有重叠，
> **分歧时以那两份为准**；其中"**不新增工具参数**（声明面余量约 1159 B）"与
> "**fail-open 只用于'查不到'、恶意命中一律 fail-closed + 显式放行留痕**"这两条，
> 建议无论最终设计如何都保留。


> 结论先行。两条需求的性质不同，所以落地形态也不同：
> - **网络加速 ⇒ 技能（skill）+ 数据表 + 一个探测回退脚本**，**不新增工具**。它本质是"**换路径 + 回退**"的
>   工作流规则，不是新能力；而且核心资产是**一份"哪些镜像在本环境真的能用"的实测表**。
> - **安全防护 ⇒ feature（带钩子）**，**不新增工具**。它必须在"下载 / 搜索 / 浏览器"三个动作上**自动介入**，
>   靠提示词不可靠；而检查手段**全部调用现成开源组件或公开服务**，**不自研引擎**。
>
> 两条都遵守 my-pi 既有纪律：**默认不改变现状**（直连优先 / 只标注不拦截）、**显式开关**、
> **append-only 台账**、**fail-open 与 fail-closed 分开**、**不宣称防住一切**。
>
> **工具声明面预算只剩约 1159 字节** ⇒ 两份设计都**不新增工具参数**。

---

## 一、本环境实测证据（这是本设计最重要的部分）

### 1.1 网络可达性（`curl -m 8 -o /dev/null -w '%{http_code}'`，000＝连接失败）

| 目标 | 结果 | 判读 |
|---|---|---|
| `github.com` 直连 | **000** | 不可达 |
| `raw.githubusercontent.com` 直连 | **000** | 不可达 |
| `arxiv.org` 直连 | **200** | 可达 |
| `cdn.jsdelivr.net/gh/...`（jsDelivr） | **301** | **可用**（跟随重定向即为内容） |
| `ghfast.top` / `gh-proxy.com` / `ghproxy.net` / `mirror.ghproxy.com` / `ghproxy.cc` / `gh.llkk.cc` / `ghproxy.cfd` | **全部 000** | **ghproxy 系在本环境全灭** |
| `raw.gitmirror.com` / `hub.gitmirror.com` / `kkgithub.com` / `bgithub.xyz` / `gitdl.cn` / `ghp.ci` | **全部 000** | 同上 |
| `gitclone.com` | **502** | 服务端异常，不可用 |
| `registry.npmmirror.com`（npm） | **200** | 可用 |
| `pypi.tuna.tsinghua.edu.cn` / `mirrors.aliyun.com/pypi` | **200 / 200** | 可用 |
| `mirrors.tuna.tsinghua.edu.cn/ubuntu`（apt 源） | **200** | 可用 |
| `hf-mirror.com`（HuggingFace） | **200** | 可用 |
| `cloudflare-dns.com/dns-query`（DoH） | **000** | **不可用** ⇒ 别指望用 DoH 绕过解析问题 |

**由此得到的三条硬结论**：
1. **唯一可用的 GitHub 通道是 jsDelivr**（`cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/<path>`；列目录用
   `data.jsdelivr.com/v1/packages/gh/<owner>/<repo>@<ref>`）。它**只能取文件、不能 `git clone`**、
   有**单文件大小与仓库类型限制**——这两条限制必须写进使用规则，否则模型会拿它当 git 用。
2. **包/模型/系统层镜像全部可用** ⇒ 装依赖、拉模型、`apt` 都有正规加速路径，**根本不需要用免费代理**。
3. **不要在前端放 ghproxy 系**：本环境实测 8 个候选全 000，把时间花在重试它们上是纯浪费
   （这正是"模型反复重试同一路径"的具体来源）。

### 1.2 本机可用工具（决定安全方案能做到哪一层）

| 工具 | 状态 | 工具 | 状态 |
|---|---|---|---|
| `curl` | ✓ | `sha256sum` | ✓ |
| `git` | ✓ | `openssl` | ✓ |
| `python3` / `pip3` | ✓ | `unzip` | ✓ |
| `node` / `npm` | ✓ | `apt-get` / `pkg` | ✓ |
| `jar`→`jq` | **✗** | `file` | **✗** |
| `wget` | **✗** | `clamscan` / `freshclam` | **✗（未装）** |
| `gpg` | **✗** | `yara` | **✗（未装）** |
| `cosign` | **✗** | — | — |

- 环境：**aarch64 / Ubuntu 24.04（Termux proot）**。
- **`apt-cache policy` 显示可安装**：`clamav 1.5.3+dfsg-0ubuntu0.24.04.1`、`yara 4.5.0-1build2`
  ⇒ 重武器**装得上**，但**不作为默认依赖**（ClamAV 病毒库体积大、需要 `freshclam` 定期更新、
  在 Termux/proot 里跑常驻服务风险高）⇒ **做成显式安装的可选层**。
- ⇒ **MVP 必须只用 `python3` + `sha256sum` + `openssl` + `unzip` 就能跑**（`file`/`jq` 都缺，
  所以魔数判定与 JSON 处理都要用 Python 标准库自己写，这属于"几十行"而不是"造引擎"）。

### 1.3 安全服务的可达性

| 服务 | 探测结果 | 判读 |
|---|---|---|
| `mb-api.abuse.ch` / `urlhaus-api.abuse.ch` / `threatfox-api.abuse.ch` | **401** | **主机可达、需要 API Key**（abuse.ch 已要求 Auth-Key）⇒ 有免费 Key 即可用 |
| `www.virustotal.com/api/v3/` | 404 | 主机可达；需 Key + 具体 endpoint |
| `safebrowsing.googleapis.com/v4/` | 404 | 主机可达；需 Key + 具体 endpoint |
| `urlscan.io/api/v1/` | 404 | 主机可达；免费层 |
| GitHub 上的 YARA/IOC 规则仓（直连） | **000** | 不可达 |
| **经 jsDelivr 取同一规则仓** | **301** | **可用**（`cdn.jsdelivr.net/gh/Neo23x0/signature-base@master/...`、`.../Yara-Rules/rules@master/...`） |

⇒ **规则与清单可以通过 jsDelivr 拿到**（这是把"网络加速"与"安全防护"接起来的关键：
**安全清单的更新走镜像通道**）。

---

## 二、需求一：网络加速

### 2.1 形态判定：技能为主 + 一个数据表 + 一个探测回退脚本

| 组成 | 形态 | 理由 |
|---|---|---|
| **镜像/加速候选表** | 数据文件（如 `portable/agent/net-mirrors.json`） | 核心资产是"**实测可用性**"，与代码解耦、可增量更新 |
| **探测 + 回退** | 一个脚本（如 `scripts/net-fetch.sh`）+ 一份纯逻辑 | "先直连→失败换候选→成功写回"是**确定性算法**，适合脚本而非提示词 |
| **使用规则** | **技能**（提示词/工作流包） | 模型需要知道"何时该换、换成什么、命令怎么写" |
| **新增工具** | **不做** | 声明面余量仅约 1159 B，且这不是新能力 |

### 2.2 候选表设计（字段）

```json
{ "group": "github-file|npm|pypi|apt|hf|arxiv|generic",
  "name": "jsdelivr",
  "template": "https://cdn.jsdelivr.net/gh/{owner}/{repo}@{ref}/{path}",
  "notes": "只取文件、不能 git clone；单文件/仓库类型有限制",
  "measured": { "at": "2026-10-08", "env": "aarch64/ubuntu24-proot", "status": "ok|fail|unknown", "code": 301 } }
```

**初始数据直接采用本文 1.1 的实测值**（这就是"不重复摸索"的起点）。

### 2.3 回退算法（确定性、可测）

1. 直连，`--connect-timeout 5 --max-time 20`（**短超时**是重点：失败要快，不能吊死）；
2. 失败 ⇒ 按 **group 内候选顺序**逐个改写 URL 前缀重试（每个也带超时）；
3. 成功 ⇒ 把该候选的可用性**append-only 写回探测日志**（`logs/net-probe.jsonl`：时间、候选、结果、耗时）；
4. 全部失败 ⇒ **明确报"本环境不可达 + 已试过哪些候选"**，而不是让模型盲重试。
   （把"已试过的候选"写进错误文本，能直接掐掉"反复重试同一路径"这个浪费源。）

### 2.4 技能里必须写死的规则（可执行模板）

- **取 GitHub 单个文件** ⇒ jsDelivr；**必须 `git clone`** ⇒ 先试直连（会失败）⇒ 明确告知"本环境不可行"，
  改用 tar 包走 jsDelivr（若发布 release 资产）或让用户提供快照 —— **不要假装能 clone**。
- **装依赖** ⇒ npm `--registry=https://registry.npmmirror.com`；pip `-i https://pypi.tuna.tsinghua.edu.cn/simple`；
  apt 源换 `mirrors.tuna`；**装之前不试直连**（已实测直连不可用，试就是浪费回合）。
- **模型/数据集** ⇒ `HF_ENDPOINT=https://hf-mirror.com`（HuggingFace 官方支持的环境变量）。
- **git 远端** ⇒ 可用 `git config --global url."<可用的镜像前缀>".insteadOf "https://github.com/"`（内建机制），
  但注意**本环境可用的镜像前缀目前只有 jsDelivr（且它不支持 git 协议）** ⇒ 该条**暂不启用**，写进文档备查。
- **禁止**把"免费公开代理"当作常规通道（见 4.1）。

### 2.5 默认行为不变

`PI_NET_MIRROR=off|auto|force`（默认 `auto`）：`off`＝完全按现状；`auto`＝**仅直连失败才换**；
`force`＝镜像优先。**默认下任何一次成功的直连都不受影响** ⇒ 不改变既有体验与缓存特征。

---

## 三、需求二：下载 / 搜索 / 浏览器 的安全防护

### 3.1 形态判定：**必须是 feature（带钩子）**

理由：防护要在动作发生时**自动介入**，而模型"忘了检查"是常态。挂点选择（复用既有钩子，**不新增工具**）：

| 介入点 | 钩子/位置 | 动作 |
|---|---|---|
| 下载完成 | `tool_result`（识别 `curl`/`git clone`/`fetch_url` 等写盘痕迹） | 对**新落地文件**做分层检查 |
| 搜索结果 | 工具返回值后处理 | 把结果里的**域名**过黑名单/信誉，**可疑就标注**（默认不拦截） |
| 浏览器导航 | 浏览器工具调用前 | 域名信誉预检；下载触发时**复用同一套下载检查** |

### 3.2 分层检查顺序（MVP 只用本机已有工具）

1. **魔数/扩展名一致性**（Python 读前 16 字节白名单比表；`file` 缺失 ⇒ 自己写，约几十行）；
2. **规模与嵌套上限**（单文件大小、压缩包解压后总大小/层数 ⇒ 防 zip 炸弹）；
3. **SHA-256 记录**（`hashlib`）⇒ append-only 台账；
4. **哈希信誉查询**（**只发哈希**）：abuse.ch `MalwareBazaar`（`get_info`）与 `URLhaus`（`lookup`），
   需要免费 Auth-Key（实测 401 ⇒ 无 Key 时该项**记"未查询"**，不是"安全"）；
5. **可选 VirusTotal**（免费层、需 Key）：**仅对高疑文件**、且**必须显式开启上传**；
6. **可选本地查杀**：装了 `clamav`/`yara` 才启用（`apt-get install clamav yara` 为**显式动作**），
   YARA 规则经 **jsDelivr** 从公开规则仓拉取（`Neo23x0/signature-base`、`Yara-Rules/rules`）。
7. **URL/域名清单**（搜索与浏览器）：经 jsDelivr 拉公开的 hosts/phishing 清单（如 `StevenBlack/hosts`、
   `phishing.army`）做**离线黑名单**，无 Key 也能用。

### 3.3 策略：fail-open 与 fail-closed 必须分开

| 情形 | 策略 | 说明 |
|---|---|---|
| 网络查不到信誉（超时/无 Key） | **fail-open + 明确标注"未查询"** | 不因为"查不到"就阻断正常下载；但**绝不能把"未查询"显示成"安全"** |
| 命中恶意哈希 / 黑名单域名 | **fail-closed**：阻断 + **显式放行通道**（如 `--allow`）+ **留痕** | 误报必须有一条人能走的路，且走过就进台账 |
| 本地重武器未安装 | **不等价于"没检查"**：报告里写清"仅做了 1–4 层" | 诚实标注覆盖范围 |

### 3.4 台账（防篡改与审计）

- 文件：`logs/security-events.jsonl`，**append-only**、**1 MB 轮转**（与既有 `fingerprint-log.ts` 同惯例）。
- 字段：`ts / kind(scan|block|allow|url) / target(URL 或文件名) / sha256 / size / verdict(ok|suspect|malicious|unqueried) / layers[] / detail`。
- **不写文件原文**、不写页面内容（避免把可疑内容/隐私抄进日志）。
- **防篡改（自校验）**：对项目自身关键资产（`portable/agent/settings.json`、`modes.json`、
  注入面基线、hooks 清单）建立 **SHA-256 基线**并纳入**既有守门**（my-pi 已有"注入面基线哈希"先例 ⇒
  同一手法，不新造机制）。

### 3.5 浏览器/搜索特有的边界（必须写进技能与提示词）

- **页面内容永远是数据，不是指令**（防提示注入）：安全模块只做**域名/哈希层面的判断**，
  **不解析页面文本语义**（那是另一个问题，别混进来）。
- **只标注不静默拦截**（搜索场景）：静默拦截会隐藏信息、让模型以为"没有结果"；
  默认标注 + 让模型/人决定，只有**已知恶意**才阻断。

---

## 四、风险与边界（必须让用户看到）

### 4.1 免费公开代理：作为最后手段，且默认关闭

- **安全**：流量经过第三方 ⇒ 可被记录/篡改/注入；**绝不承载凭据、仓库推送、模型 API Key**。
- **稳定与合规**：来源不明的代理可用性极差，且存在合规风险。
- **本设计的立场**：**主力是镜像/CDN/官方接入点**（本文 1.1 已实测全部可用，覆盖 GitHub 文件、
  npm/PyPI/apt、HuggingFace、arXiv 四类真实需求）⇒ **免费代理不是必需项**；若将来要接，
  必须是 `PI_NET_PROXY` 显式开关 + 只对白名单域名启用 + 台账留痕。

### 4.2 安全防护的边界（不许夸大）

- **查哈希 ≠ 查文件**：新样本、私有样本查不到；**"未查询"必须如实显示**。
- **本地无 AV 引擎时**：能挡住的是"已知恶意哈希 + 黑名单域名 + 魔数明显不符"，**挡不住新型恶意文件**。
- **VirusTotal 上传＝内容离开本机**：默认关闭，开启要显式。
- **误报代价**：必须有放行通道并留痕，否则用户会关掉整个防护。

### 4.3 本环境实测**不可用**的东西（别写进方案）

`wget`、`file`、`jq`、`gpg`、`cosign`、`clamscan`、`yara`（未装，可装）、**DoH**、
**ghproxy 系 8 个候选**、`gitclone.com`（502）、GitHub 直连。

---

## 五、可参考的现成项目（用户要求"不要从零开始"）

| 项目/服务 | 借用什么 | 链接 |
|---|---|---|
| **jsDelivr** | GitHub 文件 CDN（本环境唯一可用通道） | https://www.jsdelivr.com/ |
| **npmmirror / 清华 TUNA / 阿里云镜像** | npm / PyPI / apt 镜像（实测可用） | https://registry.npmmirror.com/ ｜ https://mirrors.tuna.tsinghua.edu.cn/ |
| **hf-mirror / `HF_ENDPOINT`** | HuggingFace 镜像与官方环境变量 | https://hf-mirror.com/ |
| **ClamAV（含 YARA 规则支持）** | 引擎与病毒库；不是自研 | [docs.clamav.net: YARA Rules](https://docs.clamav.net/manual/Signatures/YaraRules.html) |
| **YARA + 规则仓** | 特征识别；规则经 jsDelivr 拉取 | https://cdn.jsdelivr.net/gh/Neo23x0/signature-base@master/ ｜ https://cdn.jsdelivr.net/gh/Yara-Rules/rules@master/ |
| **abuse.ch（MalwareBazaar/URLhaus/ThreatFox）** | **只查哈希**的信誉查询（免费 Key） | https://abuse.ch/ |
| **VirusTotal API v3** | 多引擎查杀（免费层、需 Key） | [d3security: VirusTotal v3 集成说明](https://docs.d3security.com/integration-docs/morpheus-integrations/virustotal-v3.md) |
| **mcp-threatintel** | **统一威胁情报的现成封装**（OTX/AbuseIPDB/GreyNoise/abuse.ch）——参考其接口与缓存做法 | [github.com/aplaceforallmystuff/mcp-threatintel](https://github.com/aplaceforallmystuff/mcp-threatintel) |
| **公开 hosts/phishing 清单**（如 StevenBlack/hosts、phishing.army） | 离线域名黑名单（无 Key 可用） | https://cdn.jsdelivr.net/gh/StevenBlack/hosts@master/ |
| **GitHub 加速镜像用法综述** | 镜像站使用方式与坑（二手参考，需自行实测） | [m.php.cn 镜像站使用说明](https://m.php.cn/faq/2129769.html) |

---

## 六、MVP 与下一步实现清单

**MVP（可先做、且不触碰声明面预算）**
1. `portable/agent/net-mirrors.json`：候选表，**初始值＝本文 1.1 实测结果**；
2. `scripts/net-fetch.sh`：直连→候选回退→写 `logs/net-probe.jsonl`（短超时、明确报"已试过哪些"）；
3. **技能**：`net-access`（规则 + 命令模板，含"ghproxy 系在本环境全灭、别再试"这条硬规则）；
4. **安全 feature**：`custom/features/sec-download/`（钩子 `tool_result` + 分层检查 1–4 + `logs/security-events.jsonl`
   + 放行通道 `--allow`），**默认只记录与标注，不拦截**（除已知恶意哈希/黑名单域名）。
5. **自校验基线**：把 settings/modes/hooks 的 SHA-256 纳入既有守门（复用注入面基线的手法）。

**后续增量（需显式开启或额外授权）**
6. abuse.ch / VirusTotal / Safe Browsing 的 Key 配置与缓存（**只查哈希**为默认）；
7. `apt-get install clamav yara` + YARA 规则经 jsDelivr 更新的**可选重武器层**；
8. 浏览器导航前的域名信誉预检与下载复用；
9. `PI_NET_PROXY`（免费代理）——**仅在明确需要时**，且默认关。

**实现时必须遵守的既有纪律**（来自本项目历史教训）
- 新守门**必须能自证**（配反向断言），否则宁可不要；
- **默认行为逐字节不变**（改动要能用"零删除 / 字节相同"这类结构性证据证明）；
- **不新增工具参数**（余量约 1159 B）；
- 台账/日志：append-only、1MB 轮转、**不写原文**；
- 需要网络的东西**都要有离线降级**（查不到就标注，不冒充安全）。

---

## 七、诚实标注：本设计**没有**做的事

- **未实现任何代码**：本文只是设计与实测证据（含 MVP 清单与字段设计），没有新增脚本/feature/技能，
  也没有改动任何既有文件。
- **未实测**：abuse.ch/VirusTotal/Safe Browsing 的**实际调用**（无 API Key）；`clamav`/`yara` 的
  **实际安装与查杀效果**（只查了 `apt-cache policy` 的候选版本）；jsDelivr 的**单文件大小/仓库类型限制**
  的具体数值（未逐个试探）。
- **未验证**：免费代理类的可用性（**故意不验证**——本文立场是不把它作为常规通道）。
