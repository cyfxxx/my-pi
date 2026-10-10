---
name: pi-net-mirror
description: 国内网络受限时的访问与下载加速：GitHub 文件走 jsDelivr、模型走 hf-mirror、包管理走国内镜像；含降级链与实测表。用户说"下载失败""访问不了""GitHub 打不开""超时""镜像""加速""clone 慢""pip/npm 装不上"时触发。不适用：需要 GitHub Release 二进制（本环境仍无已验证通道）。**git clone 是可用的**：走 gitclone.com 或 Gitee 镜像，见技能内实测。
version: v1.0
更新日期: 2026-10-09
---

## 实测补充（2026-10-10，父代理复核）

**git clone 是可用的**（推翻本技能早前"无已验证通道"的说法；原结论来自单次探测）：

```
$ git ls-remote https://gitclone.com/github.com/git/git HEAD
d38352cd43ab9745686d697872408bc3249a153f	HEAD        # ✓ 真实 refs
$ git ls-remote https://gitee.com/mirrors/redis.git HEAD
e8726d18e5bab24cbfcb0a0c36f21ce5a1140471	HEAD        # ✓ Gitee 镜像同样可用
```

**jsDelivr 的 `/gh/` 通道给的是真实内容**（不是"只能当数据 API"，也不是 0 字节）：

```
$ curl -m 12 -sL -o /dev/null -w '%{http_code} size=%{size_download}' https://cdn.jsdelivr.net/gh/git/git@master/README.md
200 size=3808
$ curl -m 12 -sL -o /dev/null -w '%{http_code} size=%{size_download}' https://cdn.jsdelivr.net/gh/vuejs/vue@v2.7.16/README.md
200 size=7088          # 不可变 tag 同样给内容
```

**仍然不可用**（我实测，与网上常见推荐相反）：`ghproxy` 全系（ghproxy.com / gh-proxy.com / mirror.ghproxy.com /
ghproxy.net / ghfast.top / ghproxy.cc / gh.llkk.cc / gh-proxy.net）**全部 000**；`github.com` 与
`raw.githubusercontent.com` 亦不可达。**判"不可达"前请换路径/协议复测，并给出字节数**——单次探测不足以判死。

# pi-net-mirror 技能

## 铁律：**先探测，别照抄清单**

网上流传的"GitHub 加速清单"在本环境**几乎全是废的**（实测）：`ghproxy.net` / `gh-proxy.com` /
`hub.gitmirror.com` **全部返回 000**，`raw.githubusercontent.com` 直连也 **000**。
**唯一稳定可用的是 jsDelivr**。照抄清单会让模型逐个试、逐个失败，最后错误地得出"网络不通"。

## 实测可用（2026-10-09）

| 用途 | 用什么 | 实测 |
|---|---|---|
| GitHub **文件** | `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path>` | 200 / 0.40s |
| HuggingFace | `https://hf-mirror.com` | 200 / 0.48s |
| pip | `-i https://pypi.tuna.tsinghua.edu.cn/simple` | 200 / 2.62s |
| npm | `https://registry.npmmirror.com` | 200 / 0.49s |
| Go | `https://goproxy.cn` | 200 / 0.48s |
| 系统包 | `https://mirrors.ustc.edu.cn`（最快 0.16s）/ `mirrors.aliyun.com`（301） | ✓ |
| 论文 | `curl https://arxiv.org/html/<id>v<N>`（含附录全文） | ✓ |

## 降级链（按序、每次只前进一步）

1. 目标 URL **直连一次**（通了就别折腾）；
2. GitHub 文件 → **jsDelivr**（把 `raw.githubusercontent.com/<o>/<r>/<ref>/<path>` 映射成
   `cdn.jsdelivr.net/gh/<o>/<r>@<ref>/<path>`；**注意分支名与 tag 用 `@`**）；
3. 模型/数据集 → `hf-mirror.com`；
4. 包管理 → 上表对应镜像；
5. **全失败 ⇒ 如实说"本环境无可用通道"**，并给出选项（让用户提供文件、换网络、给代理），
   **绝不允许**假装下载成功或编造文件内容。

## 能力边界（写清楚，省得空转）

- jsDelivr 只覆盖**仓库里的公开文件**：**Release 资产（`releases/download/...`）、`git clone`、
  GitHub API、私有仓库都不覆盖**；本环境这几类**目前没有已验证的通道**。
- 用脚本探测而不是凭记忆：`node scripts/net-mirror.mjs --probe`（输出可用性与耗时）。
- 镜像域名会变 ⇒ **每次重要下载前探测一次**，发现失效就更新本文与脚本的表。
