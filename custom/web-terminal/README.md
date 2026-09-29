# custom/web-terminal — 浏览器终端

用浏览器访问 my-pi：服务在 pty 里拉起**原样的交互式 TUI**（`bash my-pi.sh`），前端用 xterm.js
接管那个终端。它不是一个新界面，而是一条新的接入通道——所有功能、提示、颜色、滚动行为与本地
终端完全一致。

> 这是"远程/移动端能用 my-pi"这一目标的实现方式。**不是**移植 DSH 的 Web GUI：
> DSH 那套 WebUI 是整个宿主契约的投影（140 包闭包、45+ RPC 方法、20+ 投影），为远程访问付那个
> 代价不划算。分析见 `DECISIONS.md` 同日条目。

## 用法

```bash
bash scripts/web-terminal.sh                 # 默认 7717 端口
bash scripts/web-terminal.sh --port 0        # 由系统分配端口
npm run web                                  # 等价快捷方式
```

启动后打印一行**带一次性令牌的地址**：

```
访问地址（含一次性令牌）: http://127.0.0.1:7717/?token=…
```

浏览器打开它即可。首次访问用令牌换取签名 cookie 并重定向到干净路径，之后刷新/重开都不用再带令牌。

选项：

| 选项 | 默认 | 说明 |
|---|---|---|
| `--port <n>` | `7717` | 监听端口；`0` 表示由系统分配 |
| `--cookie-days <n>` | `30` | 授权 cookie 有效期（天） |
| `--trusted-host <h>` | 空 | 额外允许的 `Host`，可重复。默认只信任回环地址 |
| `--command <shell>` | `bash <root>/my-pi.sh` | 覆盖被拉起的命令（调试用） |
| `--cwd <dir>` | 项目根 | 工作目录 |
| `-h, --help` | | 查看帮助 |

## 远程访问

只绑定 `127.0.0.1`，远程访问走 SSH 隧道：

```bash
ssh -N -L 7717:127.0.0.1:7717 <user>@<host>
# 然后在手机/本机浏览器打开启动时打印的地址（端口按隧道本地端口改）
```

**不要**为了"省事"改成绑定 `0.0.0.0`。原因具体：本服务不带 TLS，而会话 cookie 刻意**不带
`Secure`**（回环 HTTP 下浏览器会直接丢弃带 `Secure` 的 cookie）。把它暴露到非回环网络等于用明文
承载长期有效的 bearer cookie。DSH 的 web profile 同样拒绝 `0.0.0.0`，理由相同。

若确实要经反代暴露，必须自己加 TLS 终止，并把 `Host` 加进 `--trusted-host`。

## 安全模型

对齐 DSH `dsh-client-connection` 的浏览器鉴权，做了三件事：

1. **令牌换 cookie**：进程启动时生成 256 位随机令牌并随 URL 打印；`GET /?token=…` 校验后用
   HMAC-SHA256 签发 cookie（`v1.<base64url(payload)>.<base64url(mac)>`），载荷含 authority 与
   起止时间，`HttpOnly; SameSite=Strict; Path=/`。cookie 名按 authority（`host:port`）摘要生成，
   换端口即换名，同一浏览器多实例互不串用。
2. **签名密钥持久化**：密钥落在 `portable/agent/web-terminal-secret.json`（0600，`portable/agent/*`
   已在 `.gitignore` 里整体忽略）。因此重启服务不会让已授权的浏览器掉线。
3. **Host / Origin 栅栏**：每个请求与每个 WebSocket 升级都先过栅栏——`Host` 必须是回环（或
   `--trusted-host` 显式列出）、`sec-fetch-site: cross-site` 直接拒、`Origin` 存在时必须与 `Host`
   一致。这挡的是 DNS rebinding 与跨站请求；它只决定"能不能谈"，身份仍由 cookie 决定。

鉴权失败的状态码：栅栏不过 403，栅栏过但无有效 cookie 401。`/healthz` 有意免鉴权，且只回报
存活/尺寸/客户端数，不含任何会话内容。

## 为什么不用 node-pty

Node 自身没有分配 pty 的 API，而 `node-pty` 需要本地编译（本项目的平台范围包含 Termux/PRoot，
预编译产物不可用）。改用 util-linux 的 `script(1)`：

```
script -q -e -f -E never -c '<prelude>; exec <command>' /dev/null
```

`prelude` 做两件事：把自己的 tty 路径写进临时文件、用 `stty` 设置初始行列。之后窗口改尺寸时对
那个 pty 执行 `stty -F <pty> rows R cols C`——内核会给该 pty 前台进程组发 `SIGWINCH`，pi 的 TUI
据此重绘。重连时再用"行数抖动一次"（`forceRedraw`）强制整屏重画，因为此时尺寸往往没变、
`resize()` 不会发信号，而重放缓冲可能已被上限截断成半截画面。

这条路径零额外依赖（`script`/`stty` 在 util-linux/coreutils 里），代价是要多一次临时文件读写。

## 接入拓扑

```
浏览器 (xterm.js)
   │  HTTP: / , /assets/*        ── 前端资源与鉴权
   │  WS  : /ws                  ── 二进制帧 = pty 字节；文本帧 = JSON 控制消息
   ▼
custom/web-terminal (node, 只监听 127.0.0.1)
   │  script(1) 分配 pty
   ▼
bash my-pi.sh  →  scripts/pi-supervisor.sh  →  pi TUI（原样，含全部 12 个扩展）
```

浏览器标签页之间共享同一个 pty：多个标签是"同屏镜像"，输入来自任意一个。断线不杀进程，刷新即
回到原会话（服务端保留 4 MiB 回放缓冲，重连后重放并强制重绘）。

## 文件职责

| 文件 | 职责 |
|---|---|
| `auth.ts` | 纯逻辑：令牌、cookie 签名/校验、Home/Origin 信任栅栏、Cookie 头解析 |
| `static.ts` | 纯逻辑：URL 路径 → 磁盘路径（含穿越防护）、MIME |
| `pty-session.ts` | pty 会话：`script` 启动、tty 发现、输出回放缓冲、改尺寸/强制重绘、重启、进程组回收 |
| `server.ts` | HTTP 路由与鉴权接线、WebSocket 数据面与控制消息 |
| `args.ts` | 命令行解析（非法值回退默认，不把 NaN 传进 `listen()`） |
| `main.ts` | 进程入口：密钥读写、资源解析、启动横幅、信号处理 |
| `public/` | 前端（`index.html` / `app.js` / `style.css`，无打包器，直接原生 ES 脚本） |

前端依赖 `@xterm/xterm`、`@xterm/addon-fit`（来自 `node_modules`，服务直接映射到 `/assets/`），
服务端依赖 `ws`。三者精确锁版本在 `custom/package.json`；`npm install` 后即可用。

### 为什么 xterm 锁在 5.5.0

**xterm 6.0.0 移动端无法滑动查看历史**，所以刻意不上 6.x。实测（隔离页面 + 真实触摸事件）：

| 版本 | viewport `scrollHeight` / `clientHeight` | 滚动占位元素 | 手指下滑后 |
|---|---|---|---|
| 6.0.0 | 476 / 476 | 不存在 | `scrollTop` 恒 0，缓冲区不动 |
| 5.5.0 | 7515 / 465 | `.xterm-scroll-area` | `scrollTop` 4900 → 4840，首行前移 |

v6 移除了 `.xterm-scroll-area` 占位元素，`.xterm-viewport` 里没有任何子元素，于是
**浏览器侧根本不存在可滚动区域**——触摸滑动没有可作用的对象，回滚只存在于 xterm 内部 buffer，
只能靠它自己的手势路径（在移动端同样无效）。5.x 保留占位元素，走的是原生滚动，因此手机上是
系统级的惯性滑动。`@xterm/addon-fit` 相应锁 `0.10.0`（5.x 兼容线）。

升级 xterm 前请先复验这一项：`node scripts/test-web-terminal.mjs` 不含滚动断言，
需手工确认 `/assets/xterm.js` 里仍能搜到 `xterm-scroll-area`。

### 资源缓存与版本戳

`/assets/xterm.js` / `xterm.css` / `addon-fit.js` 是第三方产物，带 `immutable` 长缓存
（手机经隧道取 480 KB 不该每次重来）。但它们的 URL 固定，换版本后浏览器会继续用旧副本——
升级 xterm 时曾因此让修复"看起来没生效"。所以服务启动时按资源文件的**大小+mtime**算一个 10 位
版本戳，渲染 `index.html` 时替换 `__ASSET_V__`，得到 `/assets/xterm.js?v=<戳>`；换版本即换 URL，
旧缓存自然失效。`test-web-terminal.mjs` 断言这一条（占位符必须已被替换、带戳 URL 仍可访问）。

## 与后端的消息约定

| 方向 | 帧类型 | 内容 |
|---|---|---|
| 服务端 → 客户端 | 二进制 | pty 原始输出 |
| 服务端 → 客户端 | 文本 JSON | `{t:'hello',cols,rows,alive,exit,command,clients}` / `{t:'size',…}` / `{t:'exit',code,signal}` |
| 客户端 → 服务端 | 二进制 | 键盘输入字节 |
| 客户端 → 服务端 | 文本 JSON | `{t:'resize',cols,rows}` / `{t:'restart'}` / `{t:'redraw'}` / `{t:'ping'}` |

服务端每 30 秒发一次 WebSocket 协议级 ping，避免移动网络下中间设备静默断开。

## 已知限制

- **首屏约 20 秒**：这是 pi 自身启动成本（jiti 编译 `custom/` 扩展 + 加载模型），与 web-terminal
  无关（实测无 web 层时同样约 19 秒）。前端在首个字节到齐前显示"agent 启动中… Ns"。
- **单会话**：一个服务进程对应一个 pty。多会话请起多个实例（不同端口），或直接在 TUI 里用
  autopilot 的会话切换。
- **无 TLS、只绑回环**：见上文。
- **回放缓冲上限 4 MiB**：超出后丢弃最旧输出；重连后靠 `redraw` 恢复画面而不是完整历史。
- **移动端软键盘**：依赖 `interactive-widget=resizes-content`（Chrome 108+ / iOS 16.4+）；更老的
  引擎上键盘弹出可能遮挡最后几行。

## 验证

- 单测（vitest）：`custom/web-terminal/__tests__/` 4 个文件 33 例，覆盖纯函数与真实 pty 的
  改尺寸/SIGWINCH；真实 pty 部分在缺 `script`/`stty` 时自动跳过。
- 进程级守门：`node scripts/test-web-terminal.mjs`（22 项），被 `scripts/golden-tasks.sh` 第 12 步
  调用；覆盖鉴权、cookie 属性、穿越防护、Host 栅栏、方法限制、WS 双向数据、resize、未授权升级拒绝、
  restart。零 LLM 消耗。
