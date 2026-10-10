# 事实核查更正（父代理实测，2026-10-08，**本条优先于下文**）

本文档由子代理调研产出，其主体实测（ghproxy 全系不可达、包镜像全可用、反代全 000）**经我复核一致** ✓；
但有**两处中心结论是错的**，我用原始 curl 输出更正如下（**以本节为准**）：

**① 更正"jsDelivr `/gh/` 不可用、只能当数据 API"——错。** 实测（本环境，跟随重定向）：
```
$ curl -m 12 -sL -o /dev/null -w '%{http_code} size=%{size_download}' \
    https://cdn.jsdelivr.net/gh/git/git@master/README.md
200 size=3808                      ← 真实内容，不是 0 字节
$ curl -m 12 -sL -o /dev/null -w '%{http_code} size=%{size_download}' \
    https://cdn.jsdelivr.net/gh/vuejs/vue@v2.7.16/README.md
200 size=7088                      ← 不可变 tag 同样给内容
$ curl -m 12 -sL -o /dev/null -w '%{http_code} size=%{size_download}' \
    https://cdn.jsdelivr.net/npm/vue@2.7.16/package.json
200 size=4536
```
⇒ **`/gh/` 在本环境可用且给真实字节**。子代理得到"0 字节"的**最可能原因**：它测的路径 jsDelivr
**解析不了**（仓库/ref/文件不存在）⇒ 那种情况下 jsDelivr 才会 301 到 raw（被阻断）⇒ 0 字节。
**从单个失败样本推广成"通道不可用"是这次的主要方法错误**（也正是本任务要求"必须实测"的意义）。
**因此：前面几轮"经 jsDelivr 读 GitHub 仓库内容"的结论本身不需要更正**（本次实测支持它）。

**② 更正"gitclone.com 502、不可用"——错（至少不全面）。** 实测：
```
$ curl -m 8 -o /dev/null -s -w '%{http_code}' https://gitclone.com/
200
$ git ls-remote https://gitclone.com/github.com/git/git HEAD
d38352cd43ab9745686d697872408bc3249a153f	HEAD     ← git 协议真能取到 refs
```
⇒ 它的**首页 502 可能是偶发**，而 **git 协议通道实测可用**。**注意**：单次 502 不足以判死，
判死要像上面这样"换个路径/换协议再测一次"。

**③ 补充（不是更正）**：Gitee 镜像通道我也实测可用（`git ls-remote https://gitee.com/mirrors/redis.git HEAD`
→ `e8726d18…`）⇒ **它是可用通道之一，但不是唯一**。

**纪律（写进本节，供后续同类调研复用）**：① 判"不可达"前至少**换一次路径/协议**复测；
② **给出字节数**而不只是 HTTP 码（`301`/`404` 是"主机活着"而不是"能用"）；③ 从**单个**失败样本
推广到"整类通道不可用"必须**明确标注为推测**，不能写成结论。

---

# 国内网络加速：实测选型与 my-pi 落地建议

> **本文的每条"可达/不可达"都是在本环境用 `curl` 实测的**（`curl -sSL -m 6~15 -o /dev/null -w '%{http_code}'`），
> 环境：aarch64 / Ubuntu 24.04（Termux proot）。**网上清单一律不当事实**——照抄的代价在这个环境里就是
> "反复重试一个早就死的域名"。
>
> **一句话结论**：
> ① **包管理器镜像几乎全可用**（而 npmjs / pypi.org **官方源也直连可用**）⇒ 这部分是**提速**，不是救命；
> ② **GitHub 内容唯一可用的通道是 `gitee.com/mirrors` 的 git 协议**（实测 `git ls-remote` 成功）；
>    **ghproxy 全系 / FastGit 端点 / gitclone / jsDelivr 的 `gh/` 端点 / raw 直连，全部不可用**；
> ③ **"任意 URL 查资料"没有任何免费可用方案**（四个通用反代全 000）⇒ 只能走"可达源 + 显式出口 + 诚实报错"。

---

## 一、实测总表（HTTP 码；`000`＝连接失败，`301`＝重定向**而重定向目标是不可达的 raw**）

### 1.1 GitHub 加速（本次调研的核心结论）

| 手段 | 实测 | 说明 |
|---|---|---|
| `raw.githubusercontent.com` 直连 | **000** | 不可达 |
| `github.com` 直连 | **000** | 不可达 |
| ghproxy 系：`ghproxy.net` / `ghfast.top` / `gh-proxy.com` / `mirror.ghproxy.com` / `ghproxy.cc` / `gh.llkk.cc` / `ghproxy.cfd` / `ghp.ci` | **全部 000** | **整类全灭**，不要再试 |
| 其他反代：`raw.gitmirror.com` / `hub.gitmirror.com` / `kkgithub.com` / `bgithub.xyz` / `gitdl.cn` / `hub.nuaa.cf` | **全部 000** | 同上 |
| FastGit：`hub.fastgit.org` / `fastgit.org` | **000 / 200** | 站点活着但**代理端点不通** ⇒ 不要依赖 |
| `gitclone.com` | **502** | 服务端异常 |
| **jsDelivr `gh/` 端点** `cdn.jsdelivr.net/gh/<o>/<r>@<ref>/<path>` | **301，跟随重定向后落到 `raw.githubusercontent.com` ⇒ 0 字节** | **不可用**（`@main`、`@latest`、**不可变 tag `vue@v2.7.16` 都是 301 ⇒ 0 字节**） |
| **jsDelivr 数据 API** `data.jsdelivr.com/v1/packages/gh/<o>/<r>@<ref>` | **200** | **只能列文件树，拿不到文件内容** |
| **jsDelivr `npm/` 端点** `cdn.jsdelivr.net/npm/<pkg>@<ver>/<path>` | **200** | **可用**（npm 包内文件直出） |
| **Gitee**：`git ls-remote https://gitee.com/mirrors/redis.git` | **成功（返回真实 refs）** | **✅ 本环境唯一实测可用的"取 GitHub 代码"通道** |
| Gitee 镜像组织页 `gitee.com/mirrors` | 200（仓库页对 HEAD 返 405，属正常） | 官方镜像组织 |

> **重要更正（我先前说错、这次实测推翻）**：本会话早前我把 jsDelivr 的 `301` 当成"可用"。
> **实测跟随重定向后是 `raw.githubusercontent.com`（被阻断）、0 字节** ⇒
> **jsDelivr 的 GitHub 端点在本环境不可用**；能用的只有它的 `/npm/` 端点和数据 API。

### 1.2 包管理器 / 语言生态镜像（几乎全可用）

| 类别 | 目标 | 实测 |
|---|---|---|
| npm | `registry.npmmirror.com` ｜ `registry.npmjs.org`（**官方直连**） | **200 / 200** |
| PyPI | 清华 ｜ 阿里 ｜ 中科大 ｜ `pypi.org`（**官方直连**） | **200 / 200 / 200 / 200** |
| apt | 清华 ｜ 中科大 ｜ 阿里 | **200 / 200 / 200** |
| Rust | `rsproxy.cn` ｜ 清华 rustup | **200 / 200** |
| Go | `goproxy.cn` ｜ `goproxy.io` | **200 / 200** |
| Maven | `maven.aliyun.com/repository/public` | **404**（该路径不是可探测的索引；需带具体构件路径，**未验证**） |
| Docker | `docker.m.daocloud.io/v2/` ｜ `hub-mirror.c.163.com/v2/` | **401（可达，符合 registry 协议）** ｜ **000** |
| HuggingFace | `hf-mirror.com` | **200** |
| 学术 | `arxiv.org` 直连 | **200** |
| DNS-over-HTTPS | `cloudflare-dns.com/dns-query` | **000**（别指望 DoH） |
| Cloudflare（WARP 相关域） | `1.1.1.1` ｜ `cloudflare.com` | **000 / 000** |

**可直接使用的配置写法（供技能引用）**

```bash
# npm
npm config set registry https://registry.npmmirror.com          # 或临时：npm i --registry=...
# pip / PyPI
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
# 临时：pip install -i https://pypi.tuna.tsinghua.edu.cn/simple <pkg>
# Rust
export RUSTUP_DIST_SERVER=https://mirrors.tuna.tsinghua.edu.cn/rustup
export RUSTUP_UPDATE_ROOT=https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup
# Go
export GOPROXY=https://goproxy.cn,direct
# HuggingFace（官方支持的环境变量）
export HF_ENDPOINT=https://hf-mirror.com
# apt（Ubuntu 24.04，/etc/apt/sources.list.d/ubuntu.sources 里的 URIs 换域名）
#   https://mirrors.tuna.tsinghua.edu.cn/ubuntu/  |  https://mirrors.ustc.edu.cn/ubuntu/
# Gitee 取 GitHub 代码（本环境唯一可用通道）
git clone https://gitee.com/mirrors/<repo>.git      # 仅覆盖 Gitee 已镜像的仓库
```

### 1.3 通用 URL 反代（"查任意网页"）—— **全部不可用**

| 服务 | 实测 |
|---|---|
| `r.jina.ai/<url>`（Jina Reader，免费无需 key） | **000** |
| `api.allorigins.win/raw?url=` | **000** |
| `api.codetabs.com/v1/proxy?quest=` | **000** |
| `corsproxy.io/?<url>` | **000** |

⇒ **"任意 URL 访问"在本环境没有免费方案**。这解释了用户痛点里最硬的那一块：
**不是"慢"，是"这条链路根本不通"**，而模型若继续重试就是纯浪费回合。

### 1.4 免费代理（**能拿到列表 ≠ 应该用**）

| 项 | 实测 | 判读 |
|---|---|---|
| `proxylist.geonode.com/api/proxy-list` | **200** | 列表 API 可达 |
| `cdn.jsdelivr.net/gh/TheSpeedX/PROXY-List@master/http.txt` | **301（内容 0 字节）** | 这台机器上**连列表内容都取不到** |
| Cloudflare WARP 相关域 | **000** | 本环境根本够不着 |

**安全与合规立场（必须写清）**：公开免费代理 = **中间人**（可记录/篡改/注入），稳定性极差、来源不明；
**绝不能承载凭据、仓库推送、模型 API Key**。**优先用镜像与反代；代理只作最后手段**，且需
**显式开关 + 域名白名单 + 台账留痕**；不推荐任何来路不明的付费/灰色服务。

---

## 二、可参考的现成项目（用户要求"不从零开始"）

| 项目 | 仓库 | 能替我们做掉哪部分 | 引入还是借鉴 |
|---|---|---|---|
| **chsrc**（全平台通用换源工具/框架） | `github.com/RubyMetric/chsrc`（[搜索命中](https://github.com/RubyMetric/chsrc)，二次确认存在） | **"换源"这件事本身**：npm/pip/apt/brew/… 的源切换与测速 | **借鉴其镜像清单与命令形态**；引入依赖需评估（本环境装它也要先能下载）——**建议不引入，只抄清单** |
| `dautovri/mirrors-china` | [github.com/dautovri/mirrors-china](https://github.com/dautovri/mirrors-china)（**二手来源**） | 国内镜像/registry 汇总清单 | **只借鉴清单**（内容未读到，因 GitHub 不可达） |
| `a121bc/Thanks-Mirror` | [github.com/a121bc/Thanks-Mirror](https://github.com/a121bc/Thanks-Mirror)（**二手来源**） | 各包管理器/系统镜像清单 | **只借鉴清单**（同上） |
| **Gitee 官方镜像组织** | `gitee.com/mirrors`（**实测可用**） | 直接提供 GitHub 热门仓库的可用副本 | **引入为"代码获取通道"**（不是依赖，是**使用约定**） |
| **jsDelivr** | `cdn.jsdelivr.net`（**只有 `/npm/` 与数据 API 可用**） | npm 包内文件直出、GitHub 文件树列举 | **按能力使用**，不要当通用 GitHub 代理 |

> 说明：`chsrc` / `mirrors-china` / `Thanks-Mirror` 的**项目内容我读不到**（GitHub 直连与 jsDelivr `gh/`
> 都不可用，jsDelivr 数据 API 只给文件树）⇒ 表中"能替我们做什么"属**基于项目定位的判断**，
> 引用处已标"二手"。**落地前若需要其清单原文，必须换一条可达通道（例如 Gitee 上的同名镜像仓）。**

---

## 三、落地到 my-pi 的候选设计

### 3.1 形态判定

| 需求 | 形态 | 理由 |
|---|---|---|
| 包管理器/生态镜像（npm/pip/apt/rust/go/HF） | **技能（提示词 + 配置片段），零代码** | 命令与配置是**固定的**；且**官方源也直连可用** ⇒ 只在"慢/失败"时才切 ⇒ **不改默认行为** |
| GitHub 代码获取 | **技能规则（一条硬规则）** | "唯一可用通道 = Gitee 镜像的 git 协议；**ghproxy/jsDelivr-gh/raw/反代已实测全灭，禁止重试**" ⇒ 直接消灭"反复重试"的浪费 |
| 任意 URL 查资料 | **规则 + 显式出口** | 无免费方案 ⇒ **优先可达源**；有合规出口时用 `HTTPS_PROXY` 显式注入（**默认关**）；不可达就**明确报错**并列出"已试过的通道" |
| 免费代理 | **不做成默认通道** | 安全/合规风险；只保留显式开关的位置 |

### 3.2 建议的最小落地（技能，不需要新增工具）

1. **新增一个技能**（如 `net-access`），内容就三块：
   ① **禁止清单**（本环境实测全灭：ghproxy 全系、FastGit 端点、gitclone、jsDelivr-gh、raw、四个通用反代）；
   ② **可用清单 + 命令模板**（上文 1.2 的 export/config 写法 + `git clone https://gitee.com/mirrors/<repo>.git`）；
   ③ **失败处理协议**：直连失败**最多试一次**镜像 → 仍失败就**如实报告"本环境不可达 + 已试通道"**，
   **不要重复同一路径**（这是当前最大的回合浪费来源）。
2. **一份可达性探测记录**（可选）：把本文 1.1–1.4 的实测结果固化为数据文件，供后续复测对比；
   复测要**只测而不改默认配置**。
3. **不改默认行为**：不自动改 `npm/pip/apt` 的全局配置、不自动设置 `HTTPS_PROXY`。

### 3.3 **需要用户批准**的（会改变默认行为）

- 永久写入镜像配置（`npm config set` / `pip config set` / 改 apt 源 / `GOPROXY` / `HF_ENDPOINT` 写进 shell profile）；
- 设置全局 `HTTPS_PROXY`（影响所有出网请求，含隐私与安全后果）；
- 引入 **chsrc** 之类的第三方换源工具作为依赖；
- 启用"免费代理"通道（含白名单与留痕设计）。

---

## 四、明确未验证 / 不可达（诚实清单）

- **未验证**：Gitee 镜像**覆盖哪些仓库**（只测了 `redis` 成功；`Lean4Agent` 这类小众仓库**大概率没有**）；
  Maven 阿里的**正确索引路径**；Docker Daocloud 的**实际拉取**（只测 `/v2/` 返 401=可达）；
  `chsrc`/`mirrors-china`/`Thanks-Mirror` 的**清单内容**（通道不可达）。
- **不可达（实测）**：`github.com`、`raw.githubusercontent.com`、ghproxy 全系、`hub.fastgit.org`、
  `gitclone.com`(502)、`hub.nuaa.cf`、jsDelivr `gh/` 端点、四个通用 URL 反代、`cloudflare.com`/`1.1.1.1`、
  DoH、`hub-mirror.c.163.com`。
- **本环境工具缺口**（影响"下载后校验"等后续需求）：无 `wget`、无 `file`、无 `jq`、无 `gpg`、无 `cosign`。
