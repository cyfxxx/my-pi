# Termux / 陌生环境探针（怎么用、怎么判读）

目标：在**不改任何东西**的前提下，用一条命令回答三件事——
① 这台机器能不能跑 Node + 仓内宿主；② Web 入口能不能起来；③ 哪些能力降级了。

## 跑法

```bash
bash assistant/scripts/probe-termux.sh            # 完整（会起一次宿主，约 30–60s）
bash assistant/scripts/probe-termux.sh --quick    # 只体检，不起宿主
```

把输出整段贴回来即可。探针做的事：

| 段 | 内容 |
|---|---|
| 环境 | `uname`（是不是 PRoot/bionic）、`node -v`、`npm -v`、git/tmux 是否存在、libc（glibc 还是 bionic）、内存、磁盘 |
| 宿主 | 找 `runtime/<平台>/ext/dsh`，跑 `--version` 证明宿主可执行 |
| 自检 | 用**临时 home** 起一次宿主（端口 3199）→ 拿带 token 的 URL → 用 cookie 请求 Web 首页 → 停宿主并清理 |

## 判读

| 现象 | 含义 | 处置 |
|---|---|---|
| `node` 缺失 | Termux **原生**（bionic）没有 Node | `pkg install nodejs`（不要用仓内 vendored Node：那是 glibc 版） |
| `宿主起不来` + `Cannot find module .../system.node` | 原生 addon 与 libc 不匹配（Termux 原生常见） | 只能在 PRoot（glibc 用户态）里跑，或补 musl 版依赖 |
| `glibc 2.39` + `PRoot`（本次实测的环境） | **PRoot 里已验证可跑** | 直接用；注意内存/存储路径 |
| Web 入口 200 | 宿主 + Web 都正常 | 可以进入"一轮对话"验证 |
| Web 入口非 200 | 宿主起来了但静态资源/路由异常 | 贴日志；多半是 `--port` 冲突或前端产物缺失 |

## 已知环境事实（本机实测，2026-10-18）

```
uname       : Linux ... 6.17.0-PRoot-Distro ... aarch64 GNU/Linux   ← 已经是 PRoot
node        : v22.23.1
libc        : glibc 2.39
memtotal    : 7717MB
disk        : 37G 可用
宿主        : 0.2.0-rc.2（仓内）
自检        : ✓ 宿主起来了  ✓ Web 入口 HTTP 200
```

⇒ 当前这台机器就是 **Termux + PRoot（glibc）**，所以"仓内 vendored Node + glibc 原生 addon"能跑通；
Termux **原生**（bionic，不套 proot）另当别论，需要按上表处置。

## 不做什么

- 探针**不写**任何真实记忆/会话数据（用临时 home，结束即删）；
- 探针**不碰**正在跑的实例（默认端口 3199，独立于 3099/3080）。
