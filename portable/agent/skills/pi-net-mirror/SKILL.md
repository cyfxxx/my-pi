---
name: pi-net-mirror
description: 国内网络受限时的访问与下载加速：GitHub 文件走 jsDelivr、模型走 hf-mirror、包管理走国内镜像；降级链在本技能正文，实测表见 packs/net-mirror/MEASUREMENTS.md（按需 read，不背清单）。用户说"下载失败""访问不了""GitHub 打不开""超时""镜像""加速""clone 慢""pip/npm 装不上"时触发。不适用：需要 GitHub Release 二进制（本环境仍无已验证通道）。**git clone 是可用的**：走 gitclone.com 或 Gitee 镜像，见技能内实测。
version: v1.0
更新日期: 2026-10-09
---
# pi-net-mirror 技能

## 铁律：**先探测，别照抄清单**

网上流传的"GitHub 加速清单"在本环境**几乎全是废的**（实测）：`ghproxy.net` / `gh-proxy.com` /
`hub.gitmirror.com` **全部返回 000**，`raw.githubusercontent.com` 直连也 **000**。
**唯一稳定可用的是 jsDelivr**。照抄清单会让模型逐个试、逐个失败，最后错误地得出"网络不通"。


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

## 细节在哪（按需 read，不要背清单）

- **实测表 / 命令模板 / 事实核查更正**：`packs/net-mirror/MEASUREMENTS.md`（用前先 `--probe` 再照它选路）。
- **设计文档**：`docs/design/NET-ACCEL.md`；**调研**：`docs/design/NET-ACCEL-RESEARCH.md`。
- **给 agent 的最轻路径**：先跑 `node scripts/net-proxy.mjs`（探测宿主代理）；有代理就**优先用它**，
  `curl`/`git`/`npm`/`pip` 都认 `HTTPS_PROXY`。
