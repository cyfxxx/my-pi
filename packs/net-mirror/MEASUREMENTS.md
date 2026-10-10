# net-mirror 实测与命令模板（按需 read，不进技能正文）

> 这份文件**不进 `skills/` 的正文**：技能里只留"触发条件 + 判据 + 指针"，细节放这里按需读。
> 原因：镜像清单**必然腐烂**（血证：网上最常推荐的 ghproxy 全系 8 个实测全 000）⇒ 让**表格与命令**
> 与**判据**分开，正文就不会随清单过期。
> **每次用前仍应先跑**：`node scripts/net-mirror.mjs --probe`（断言字节数）与
> `node scripts/net-proxy.mjs`（探测宿主代理，优先走它）。

## 便携化（Linux 主 / Windows 次）

- 本技能里的 `curl` 命令**两端都有**（Win10+ 自带），但 **`-o /dev/null` 是 POSIX 写法**：Windows 用 `-o NUL`。
- `-w '%{http_code} size=%{size_download}'` 两端一致 ✓；`git` 命令两端一致 ✓。
- **不要**用 `find -printf`、`env VAR=x cmd`、硬编码 `/tmp` 之类 POSIX-only 写法。


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

