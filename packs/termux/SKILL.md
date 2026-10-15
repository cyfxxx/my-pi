---
name: termux
description: 在 Android 平板/手机上的 ZeroTermux（Termux 0.118.3 的中文增强 fork）或官方 Termux 里做开发时使用：先判身份（宿主 Termux / proot 容器 / PC），再做宿主↔容器互通、包管理与换源、保活与定时任务（signal 9 / phantom process killer）、平板交互与文件互传、X11/VNC 与容器管理、以及在 proot 里跑 Node/Python/AI agent 的实测坑与官方已知限制。不要用于非 Android 环境；不要用它替代仓库自身的守门与授权门禁。
---

# termux — ZeroTermux / Termux 平板开发（my-pi 侧技能）

> **定位**：让 AI 在**平板**上帮用户干活时不再"照 PC 的习惯瞎猜"。本文把**两个程序的关系**、**官方已知限制**、以及**本机实测事实**
> （aarch64 + proot-distro Ubuntu 24.04 容器）写清楚，并给出可直接粘贴的命令。
> **本技能不装任何东西、不改任何配置**：所有"安装/换源/改设置"都要先按 [packs/README.md](../README.md) 的纪律向用户披露副作用并取得同意。

## 触发条件

`ZeroTermux`/`ZT`、`Termux`、平板/手机开发、`pkg`、`termux-change-repo`、`proot-distro`/容器、`signal 9`、`Process completed (signal 9)`、
后台被杀、`termux-wake-lock`、`termux-setup-storage`、X11/VNC、`ZtInfo`、`zt` 命令、`~/.timerdir`、extra keys、平板剪贴板/互传、`$PREFIX`。

## 0. 先判"你在哪一层"（第一步永远是这条）

```bash
uname -r                 # 含 PRoot ⇒ 在 proot 容器里（本机实测：6.17.0-PRoot-Distro）
echo "PREFIX=${PREFIX:-<空>} HOME=$HOME"   # 宿主：PREFIX=/data/data/com.termux/files/usr；容器里 PREFIX 为空、HOME=/root
command -v pkg >/dev/null && echo "宿主 Termux 层" || echo "非宿主（容器/PC）"
cat /etc/os-release 2>/dev/null | head -2      # 容器里是 Ubuntu/Debian；宿主 Termux 没有 /etc/os-release
```

| 层 | 包管理 | `$HOME` | `$PREFIX` | `uname -r` |
|---|---|---|---|---|
| **宿主 Termux / ZeroTermux** | `pkg`（apt 后端） | `/data/data/com.termux/files/home` | `/data/data/com.termux/files/usr` | 内核版本，无 `PRoot` |
| **proot 容器（本机 Ubuntu 24.04）** | `apt`（容器自己的） | `/root` | **空**（脚本里别依赖 ✗） | `…-PRoot-Distro` |
| PC / 远程 | 各自 | — | — | — |

★ 在容器里 `pkg install` 必然失败（无 `pkg`）⇒ 要动宿主必须走**宿主前缀绝对路径**（§2）。

## 1. 两个程序是什么关系（一手核实 + 风险硬事实）

| 项 | 官方 Termux | ZeroTermux |
|---|---|---|
| 上游 | [termux/termux-app](https://github.com/termux/termux-app)，最新 release **v0.118.3**（2025-05-22；F-Droid 与 GitHub 两条线，F-Droid 只发 universal 且更新晚数天到一周+） | [hanxinhao000/ZeroTermux](https://github.com/hanxinhao000/ZeroTermux)（3k+ stars），最新 release **ZeroTermux-0.118.3.64**（2026-08-08；arm64 `debug`≈94MB / `release`≈83MB） |
| 关系 | 上游本体（**GPLv3-only**） | 基于 Termux **0.118.3** 的中文增强 fork；包空间 `com.termux.zerocore`；`sharedUserId="com.termux"` |
| 权威入口 | 官方 wiki + GitHub Releases | **没有官方文档站**（wiki 302 无内容、无 Gitee 镜像、README 无 homepage）⇒ 权威入口只有 **GitHub README + Releases**；联系人只有 QQ 群；另有一个**第三方自家下载服务器**（README 让"复制地址到浏览器打开"，非 GitHub）。中文教程站一律属**社区内容**（未核实 ✗） |
| 独有功能 | — | 中文 UI、**切换源**、**容器管理**（proot-distro / QEMU）、**备份还原**、**X11/VNC**、**定时任务**、**右侧栏 AI 智能体 + skills + LSP（JAVA/C/PY）**、维修模式（release note 提及，**功能未核实** ✗） |

**★ 安全硬事实（来自本机已安装 APK 解包与 manifest，不是传闻）**：
1. **应用内自装 8 个插件 APK**（`assets/apk/*.ip`，规避安装限制）+ `REQUEST_INSTALL_PACKAGES`，其中 `utermux_file_plug.ip` 是**第三方**插件、`zero_float.ip` 是自家悬浮窗；
2. **权限面远大于官方 Termux**：`READ_SMS`/`SEND_SMS`/`READ_CONTACTS`/`CAMERA`/`READ_PHONE_STATE`/`READ_LOGS`/`DUMP`/`WRITE_SECURE_SETTINGS`/`SYSTEM_ALERT_WINDOW`/`REQUEST_DELETE_PACKAGES`/`MOUNT_UNMOUNT_FILESYSTEMS`/`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`/`RECEIVE_BOOT_COMPLETED` 等；本机 Termux 自报 `TERMUX_APP__APK_RELEASE="UNKNOWN"`（**非官方来源**标记）、`TARGET_SDK=28`；
3. **签名与许可**：仓库根**直接提交了签名库 `phone.jks`**，且 README 承认签名与 Utermux 共用 ⇒ 与官方 Termux "GitHub 用社区共享 testkey" 属**同一类可伪造更新风险**，只是这次密钥在 fork 仓库里；许可 `LICENSE` 写 **GPLv3-only**，README 却链到 GPL-2.0（**自相矛盾**）；
4. 依赖里有 root 库（libsu）、root 检测（rootbeer）、adb 库、jcifs、nanohttpd（内含 HTTP/文件服务器）、下载器（aria）；**grep 未命中**内购/广告/统计 SDK（`billing|ads|umeng|analytics|bugly|firebase|admob|getui|jpush`）—— 这是**基于 grep 的否定**，不是官方声明 ✗。
⇒ **用法建议**：把它当"功能强、但信任边界比官方 Termux 低"的工具；别在它里面放长期有效凭据；重要数据自行加密备份。

## 2. 从容器操作宿主（本机实测路径，直接可用）

```bash
P=/data/data/com.termux/files/usr          # 宿主 $PREFIX
H=/data/data/com.termux/files/home         # 宿主 $HOME
"$P/bin/pkg" list-installed | head         # 在容器里执行宿主包管理（真的会动宿主 ⇒ 先取得用户同意）
"$P/bin/termux-wake-lock"                  # 保活（§5）
"$P/bin/termux-setup-storage"              # 首次授权存储（弹系统授权框，需用户点）
"$P/bin/proot-distro" list                 # 容器管理（别名 pd）
"$P/bin/am" start -a android.intent.action.VIEW -d 'http://127.0.0.1:7717/'   # 让平板浏览器打开容器里跑的服务
```

- 宿主 `bin` 本机 **720** 个可执行 ✓（含 `git`/`node`/`python3`/`sshd`/`curl`/`nano`/`proot-distro`/`pkg`/`am`/`termux-am`）。
- ★ **`am` 三兄弟（本机实测 + `termux-am --help` 原文）**：应用内用 **`$PREFIX/bin/am` 或 `termux-am`**（后者是走 unix socket `…/termux-am/am.sock` 的包装，**更快**，因为不必每次起 dalvik VM；服务默认只允许 termux 用户与 root 连）；
  **`/system/bin/am` 只有 adb/root 才够权限**（本机实测：以 app uid 调 `settings get global …` ⇒ `requires android.permission.INTERACT_ACROSS_USERS`，`dumpsys deviceidle` ⇒ `missing android.permission.DUMP`）。
- **共享网络命名空间**（proot 不建 namespace）⇒ 容器里的 `127.0.0.1` 与宿主是同一个（本机实测：容器内 `127.0.0.1:19951` 可连 ✓，见 §3）。
- ★ **宿主 `$PREFIX/bin` 会被追加进容器的 `PATH`**（proot-distro README 原文："`$PREFIX/bin` is appended to `PATH` so Termux host tools stay reachable inside the guest"）
  ⇒ **宿主 Termux 的工具会"漏进"容器**：本机实测 `which -a node` 同时给出容器内的 `/root/.local/share/pi-node/.../node` 与宿主的 `/data/data/com.termux/files/usr/bin/node`
  ⇒ **ABI/版本串台风险**：容器里跑构建时，脚本若用 `node`/`python3` 裸名，可能用到宿主的那个（版本/依赖都不同）✗。**对策：容器内显式用绝对路径或收紧 PATH。**
- 存储：`/sdcard` = `/storage/emulated/0`，容器里**默认也被 bind**（`--isolated` 可去掉）；该分区 `fuseblk` 且挂载为 `rw,lazytime,nosuid,nodev,noexec,noatime`（本机实测）
  ⇒ **不能放可执行文件、不支持 unix 权限/符号链接/socket** ✗（这正是"`chmod` 在 /sdcard 上没用"的原因，而不是 PRoot 限制）。
- ★ **容器里不要用 `$PREFIX`/`$TERMUX_*`**：本机实测容器内 `$PREFIX` 为空、`$HOME=/root` ⇒ 脚本要写成"取参数或绝对路径"。

## 3. ZeroTermux 的桥与 AI 机制

### 3.1 `zt` 命令 = 与 ZT 的 Java 服务通话

宿主 `$PREFIX/bin/zt`（本机实测：721 B shell 脚本）：
1. 确保有 `nc`（没有就 `pkg install netcat-openbsd -y`）；
2. 探活 **`127.0.0.1:19951`**（ZT 的 Java 服务 `ZTSocketService`）——不在就打印"Java服务未运行"并退出；
3. 在 **`19952`** 上开一次性监听，把参数原样发给 19951。

```bash
"$P/bin/zt" menu reset     # 恢复左侧菜单默认（改坏了用这个）
"$P/bin/zt" menu update    # 改完菜单立即生效
```

- **本机实测**：`127.0.0.1:19951` 从**容器内**可连 ✓；`19952` 只在 `zt` 执行期间按需监听（平时不监听**不是故障**）。
- 自定义命令入口在 ZT 源码 `java/com/termux/zerocore/socket/ZTSocketService.java`（`zt` 脚本注释所写）⇒ 协议细节**未核实** ✗。
- ZT 的"在线脚本/下载站"（左侧菜单入口）实际拉的是**它自家服务器**与公共镜像（QEMU Windows 镜像来自它自家域名、发行版安装器走 BFSU 的 LXC 镜像、filebrowser 二进制等）
  ⇒ **默认不点**；要用先看清 URL 与脚本内容（这是第三方源的典型面 ✗）。

### 3.2 ZT 自带 AI vs my-pi（别互相打架）

| | ZeroTermux 内置智能体（右侧栏） | my-pi（本技能服务的对象） |
|---|---|---|
| 运行位置 | **宿主 Termux 层**（app 内） | 容器（本机：proot Ubuntu）里跑 CLI |
| 工具面 | 形如 `send_terminal_command` / `read_terminal` / `list_zerotermux_pkg_sources` / `switch_zerotermux_pkg_source`（`user_confirmed=true`） | my-pi 自己的工具（bash/read/write/子代理/定时任务…） |
| skills | `~/.skill/<name>/SKILL.md`（ZT 自管；frontmatter 有 `bundled_version`/`bundled`/`bundled_locale`） | `packs/`（本仓库，需按需 read；见 [packs/README.md](../README.md)） |
| 分工建议 | 宿主层动作（装宿主包、换源、开容器、X11、截屏/剪贴板）**优先交给 ZT 内置智能体**（同层，权限与 UI 都对） | 容器内开发（代码/构建/测试/长任务/定时任务）交给 my-pi；要动宿主就用 §2 的绝对路径命令，或请用户切到 ZT 内置智能体 |

## 4. 包管理与换源

```bash
# 宿主（本机实测：termux-main 已指向 aliyun ✓）
"$P/bin/pkg" update && "$P/bin/pkg" upgrade -y
"$P/bin/pkg" install -y git nodejs python clang make    # 包名是 nodejs，不是 node
"$P/bin/termux-change-repo"                             # 交互式换源；ZT 也可从左侧菜单"切换源"
# 容器（本机 Ubuntu 24.04）
apt-get update && apt-get install -y <pkg>               # 容器里没有 pkg
```

- 本机宿主源实测：`deb https://mirrors.aliyun.com/termux/termux-main stable main` ✓；另有 `x11` 源仍指 `packages-cf.termux.dev`（**国内可能慢**）。
- 额外源：`pkg install root-repo x11-repo`（装完 `pkg update`）；`pkg search <关键词>` 先确认包名（**别编造包名** ✗）。
- 报错对应：`No mirror or mirror group selected` ⇒ 换源；`Unable to locate package` ⇒ 改名/加源；`Hash Sum mismatch` ⇒ 换源重试；`unmet dependencies` ⇒ `pkg update && pkg upgrade -y` 后重试。
- ★ 未取得同意**不要**替用户 `pkg upgrade`/改源（影响面大、回滚成本高）。

## 5. 保活：平板上最大的痛点

**症状**：进程突然消失，宿主终端出现 `[Process completed (signal 9) - press Enter]`；在装的包/在跑的桌面全停。

**原因**：Android 12+ 的 **phantom process killer**（子进程超 32 个或吃 CPU 就被杀；**Android 11 及更早不受影响**）。官方 README 原文承认："Termux may be unstable on Android 12+ … will kill any (phantom) processes greater than 32 … You may get `[Process completed (signal 9) - press Enter]`"。

| 版本 | 处置 |
|---|---|
| **Android 14+** | 设置 › 系统 › 开发者选项 › Apps 区 → 打开 **「停用子进程限制 / Disable child process restrictions」**（各家 ROM 文案不同，搜 "child process"）。**无需电脑**，重启仍有效 |
| **Android 12 / 12L / 13** | 用 adb（可**从平板自己**做：开发者选项开**无线调试** → `pkg install android-tools` → `adb pair` + `adb connect`，或用 LADB/Shizuku）：<br>`adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"`<br>`adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"`<br>`adb shell "settings put global settings_enable_monitor_phantom_procs false"` |
| 撤销 | `… set_sync_disabled_for_tests none` / `… delete activity_manager max_phantom_processes` / `settings delete global settings_enable_monitor_phantom_procs` |

**配套**：
- **电池优化**：给 Termux/ZeroTermux 关掉（应用 › 电池 → 无限制）；国产 ROM 还要在"后台运行管理"里放行。
- **`termux-wake-lock`**：长任务前加锁（`"$P/bin/termux-wake-lock"`），结束 `termux-wake-unlock`；★ 但**官方 issue #5150 显示 Android 15 上仍有"拿了 wake-lock 也被杀"**⇒ 别把 wake-lock 当万灵药。
- **钉一条常驻通知**（Termux:API 应用 + `termux-api` 包；本机已装 `com.termux.api` 0.53.0）：
  ```bash
  "$P/bin/termux-notification" --ongoing -i pi -t "pi 服务" -c "vite 5173 运行中" --priority high \
      --button1 "打开" --button1-action "termux-open-url http://127.0.0.1:5173"
  ```
  （常用选项：`-i/--id` 同 id 覆盖、`--ongoing` 钉住、`--priority high`、`--alert-once`、`--buttonN`/`--buttonN-action`、`--on-delete`、`--sound`/`--vibrate`）
- 长任务**不要挂在会话里**：用 §5.1 定时任务 / `tmux` / 容器内 `nohup`，或交给 my-pi 的定时任务机制（`portable/agent/scheduled-seeds.json`）。

### 5.1 ZeroTermux 定时任务（本机实测形态）

- 目录 `~/.timerdir/`：`shell_timer.sh`、`termux_timer.sh`（+ `log/`）✓ —— ZT 的"定时任务"就是跑这两个脚本，日志在同目录。
- 改前先备份；`shell_timer.sh` 在**宿主机**跑 ⇒ 里面用宿主层命令；要驱动容器写 `proot-distro login ubuntu -- <cmd>`。

## 6. 平板交互与互传

### 6.1 交互
- **extra keys**：`~/.termux/termux.properties` 的 `extra-keys = [[...],[...]]`（本机实测该文件**全是注释** = 默认配置）；改完 `termux-reload-settings`。
- **外接键盘（官方 wiki `Hardware_Keyboard` 原文，一律 `Ctrl+Alt+` 前缀）**：`C` 新建会话、`R` 重命名、`N`/`↓` 下一个、`P`/`↑` 上一个、`→` 开抽屉、`←` 关抽屉、`M` 菜单、`U` 选 URL、`V` 粘贴、`+`/`-` 字号、`1-9` 跳会话、`K` 开关软键盘。
- **触屏键位（wiki `Touch_Keyboard`）**：音量下 = Ctrl；音量上 + `E/T/1..0/B/F/X/W/A/S/D/L/H/U/P/N/./V/Q/K` 对应 Esc/Tab/F1-F10/Alt 组合与方向键/`|`/`~`/`_`/PgUp/PgDn/Ctrl-\/音量面板/extra keys 开关。
- **窄边/保护壳遮字**：`terminal-margin-horizontal`（0–100dp，默认 3）、`terminal-margin-vertical`（默认 0）——官方 wiki 明确为此设计。
- **选文本**：extra keys 行向左滑出 **Text Input View**；Android 16 上 TalkBack 选择模式有已知 bug（termux-app #5360）。
- **悬浮窗**：官方是 `termux-float` 插件；ZeroTermux 自带 `zero_float.ip`（自家悬浮窗）。分屏/多窗口用 Android 自身能力。

### 6.2 文件互传
```bash
"$P/bin/termux-setup-storage"        # 首次：授权后才能用 ~/storage/{downloads,shared,…}
ls "$H/storage/downloads"            # 手机下载目录
cp /root/out.tar.gz /sdcard/Download/           # 容器 → 共享存储（本机实测可写）
"$P/bin/sshd"                                   # 宿主起 sshd，PC 端 scp/sftp 进来
python3 -m http.server 8000                     # 容器起 HTTP，平板/PC 浏览器取
"$P/bin/am" start -a android.intent.action.VIEW -d 'http://127.0.0.1:8000/'   # 直接用平板浏览器打开
```
★ ZeroTermux 在共享存储有它自己的工作目录（备份、在线脚本资产、字体、iso 等）——**不要替用户清理或移动**这些目录 ✗。

## 7. proot 容器实践：官方已知限制 + 本机实测坑

```bash
"$P/bin/proot-distro" install ubuntu          # 5.10+ 已改为拉 OCI/Docker 镜像
"$P/bin/proot-distro" login ubuntu
"$P/bin/proot-distro" list                    # 别名 pd；子命令 install/search/build/push/login/run/list/ps/kill/remove/rename/reset/backup/restore/copy/sync/clear-cache
ls "$P/var/lib/proot-distro/containers/"      # 容器 rootfs（本机：ubuntu/rootfs，aarch64）
```

**★ 官方承认的限制**（`termux/proot-distro` README 的 `Limitations` 小节，本机装 5.10.0）：

| PRoot | PRoot-Distro |
|---|---|
| **性能**：ptrace 拦每个 syscall ⇒ 编译/包管理明显慢 | 不支持 zstd 层；`build` 走 proot 而非 BuildKit；`push` 只单架构 |
| **无真 root**：`sudo`/`mount` 真文件系统/`iptables` 等**必然失败** | 无 live state 迁移；跨架构 termux 型容器不支持 |
| **无内核特性**：FUSE、部分 iptables target、自定义 cgroup 不工作 | **无嵌套**（proot 拒绝套娃） |
| **无后台服务**：`systemd`/`OpenRC`/socket-activated daemon **一般起不来** | ★ **`/proc` 固定替身（官方原文）**：Android 屏蔽部分 `/proc`，`/proc/stat`、`/proc/uptime`、`/proc/loadavg`、`/proc/vmstat` 在容器里看到的是**固定替身** ⇒ `top`/`uptime` 显示快照不是实时值；`--minimal` 可关掉 |
| **无 namespace**：`unshare`、容器套容器、network namespace 不工作 | 另：`/sdcard` 默认被 bind（`--isolated` 去掉）；**guest `PATH` 末尾追加 `$PREFIX/bin`**（§2 的"宿主工具漏进来"） |

**本机实测坑（aarch64 + Ubuntu 24.04；★ 标"官方未列举"的只在本机成立，别当普适规律）**：

| 现象 | 实测 | 性质与对策 |
|---|---|---|
| `/proc` 时钟自相矛盾 | `date +%s`=1792042789 而 `/proc/uptime`=124.08s、`btime`=1680020856（2023）；`ls -la /proc/uptime` 显示它是从 `…/containers/ubuntu/sysdata/uptime` bind 来的静态文件 | ✅ **官方承认**（上表）⇒ 别做墙钟↔uptime 换算；判"谁先启动"只比 `/proc/<pid>/stat` 的 starttime **节拍** |
| `ps -o etimes=` 溢出 | 对本机所有进程都给 `4294967295`（0xFFFFFFFF）；`/proc/1` ⇒ `Permission denied`、`/proc` 里只看得见本 app 自己的进程 | ⚠ 官方未列举（是上面替身/权限的派生现象）⇒ 不要用 `etimes` 判进程年龄 |
| `systemctl` 不可用 | `systemctl is-system-running` ⇒ `offline` | ✅ 与官方"无后台服务"一致 ⇒ 用 `service`/`sv`/`nohup` |
| f2fs 上 `find -type f` 漏文件 | 本机 `packs/security-baseline`：`find . -type f`=2 而 `find . ! -type d`=3 | ⚠ **未找到权威解释** ✗（本机现象）⇒ 统计/遍历用 `! -type d`，别断言"f2fs 一定漏" |
| `chmod` 对目录 | `/data`（f2fs）上 700 → `chmod 755` → **755 生效** ✓ | ❌ **不是** PRoot 限制（官方清单里没有）；真正的限制是 **`/sdcard` 是 `fuseblk` + `noexec`/无 unix 权限** ⇒ 那里放不了可执行文件与符号链接 |
| 内存 | `MemTotal` ≈ **7.9 GB** | 一次只跑一个重活（容器里跑 pi/浏览器/编译时别再开第二个） |

## 8. 在容器里跑 Node / Python / AI（本机形态，供对照）

- 本机容器内：**Node v22.23.1**（tarball，`/root/.local/share/pi-node/node-v22.23.1-linux-arm64/bin/node` ✓）、**Python 3.12.3** ✓。
- ★ **先解决 §2 的 PATH 串台**：容器里显式用绝对路径，或把 PATH 收紧到系统目录，再跑构建/测试。
- 原生模块编译：容器 `apt-get install -y build-essential python3-dev`；宿主 `pkg install clang make python`。装不上时优先**纯 JS/Python 或预编译 arm64 产物**，别硬编译。
- 镜像：`npm config set registry https://registry.npmmirror.com`；pip 用清华源。本机实测 npmmirror 稳定、GitHub raw/codeload 视时间可达（**同一通道过一会儿可能就通** ⇒ 判"不可达"前换路径复测；本仓 [packs/net-mirror](../net-mirror/MEASUREMENTS.md) 记了实测表）。
- my-pi 在这台机器上的进程形态（排障用）：`proot` → 宿主 `bash -l` → 容器内 `my-pi.sh` → `pi-supervisor.sh` → `pi`；**一次只跑一个会话**（内存约束）。
- 让 AI 干活的纪律（本仓口径）：长任务放定时任务/后台，别挂在会话里；动宿主层配置前先披露副作用并取得同意。

## 9. 安全边界

- **只从官方渠道装 app**：官方 Termux 走 F-Droid 或 GitHub Releases；ZeroTermux 走它的 GitHub Releases。**ZT 内置的"在线脚本/下载站"与第三方下载服务器默认不点** ✗（要看清 URL 与脚本，见 §3.1）。
- **信任边界**：ZT 权限面大、应用内会自装插件 APK、仓库里带签名密钥且与 Utermux 共用、许可表述自相矛盾（GPLv3-only vs 链 GPL-2.0）⇒ **别放长期凭据**；重要数据加密备份。
- **`~/.ZtInfo/main_menu_path.xml`** 支持 `java:`（调内部类）、`jumpUrl:`、`ztShell:`（**执行 shell**）⇒ 改前备份，改完 `zt menu update`；**不要**把别人给的菜单/脚本直接粘进去。
- **Android 版本兼容**：官方 Termux **targetSdk = 28 > 系统最低可安装门槛 23/24**（AOSP `MIN_INSTALLABLE_TARGET_SDK`）⇒ **不会被"低 targetSdk 禁装"卡住** ✗；但 Android 15/16 上仍有一批真实问题（termux-app issue 标题级）：#5150 拿了 wake-lock 仍被杀、#4788 无法更新仓库、#4185 **16 KB page size**、#4572 GrapheneOS 安装失败、#5360 TalkBack 选不中文本、#5380 键盘兼容。⇒ 遇到怪问题先查 issue 再怀疑自己。
- 给 Termux 的权限按需给（存储、通知、电池白名单）；**不要**在 Root/越狱设备上让 AI 自动改系统设置。
- 本技能**不碰**用户隐私：不收集、不列举宿主 home 与共享存储里的私人文件名（只写机制目录 `ZtInfo/`、`.timerdir/`、`.termux/`、`.skill/`）。

## 10. 未核实（✗ 如实标注）

- ZeroTermux **许可证条款细节**：`LICENSE` 写 GPLv3-only、README 又链 GPL-2.0（自相矛盾）⇒ 再分发/商用前自行核对。
- **本机安装的 ZT/Termux 版本号**：容器内没有可靠读取途径（发布线见 §1 的 GitHub 数据）✗。
- `zt` ↔ 19951 的**协议细节**（只核实端口可达）✗；ZT 内置智能体工具的语义（只在 my-pi 侧读其 SKILL.md 原文，**未实测调用**）✗。
- ZT "维修模式"的功能 ✗；"无内购/无广告/无统计"是**基于依赖 grep 的否定**，非官方声明 ✗。
- `termux-change-repo` 各镜像可用性、X11/VNC 在本平板上的实际效果 ✗（未在本机跑）。
- phantom process killer 的 adb 命令来自公开文档，**未在本平板实测** ✗；Android 14/15/16 官方 behavior-changes 页面本机不可达，§9 的结论来自 **AOSP 源码原文**与 issue 标题 ✗。
- 社区中文教程站点未逐篇验证准确性 ✗。

**来源**：[termux/termux-app releases](https://github.com/termux/termux-app/releases) ·
[hanxinhao000/ZeroTermux](https://github.com/hanxinhao000/ZeroTermux) ·
[termux/proot-distro（Limitations）](https://github.com/termux/proot-distro) ·
[termux-app issue #2366（phantom processes killed）](https://github.com/termux/termux-app/issues/2366) ·
[agnostic-apollo: phantom, cached and empty processes](https://github.com/agnostic-apollo/Android-Docs/blob/master/en/docs/apps/processes/phantom-cached-and-empty-processes.md) ·
[Andronix: Process Completed (signal 9)](https://docs.andronix.app/troubleshooting/signal-9) ·
Termux wiki（`Hardware_Keyboard`/`Touch_Keyboard`/`Differences_from_Linux`/`Termux_Google_Play`）·
本机实测（§0/§2/§3/§5.1/§6/§7/§8 的命令与输出，2026-10-15，aarch64 + proot Ubuntu 24.04）

## 使用后经验沉淀

任务结束后按 [packs/README.md](../README.md) 的"经验沉淀机制"收尾：把执行过程与本文的偏差（命令失效、路径变化、ROM 差异、新发现）追加到包根 `EXPERIENCE.md`
（格式：`## YYYY-MM-DD <子技能> / - 环境: … / - 场景·经验: …`，**环境必须标注**，例如平板型号/Android 版本/Termux 或 ZT 版本）；未合并条目 ≥3 条时合并进本文件对应章节。
