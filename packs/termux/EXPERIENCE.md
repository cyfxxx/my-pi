# termux（packs）经验记录

> 按 my-pi `packs/README.md` 的"经验沉淀机制"维护：每条含**日期 / 子技能 / 环境**（环境必标，防跨设备误会）。

## 2026-10-15 建包：ZeroTermux / Termux 平板开发技能

- 环境: 平板 Android（ZeroTermux）+ **proot-distro Ubuntu 24.04.4 LTS aarch64**（`uname -r` = `6.17.0-PRoot-Distro`）；容器内 Node v22.23.1（tarball）、Python 3.12.3；MemTotal ≈7.9 GB
- 用户诉求: 他主要在**平板**上用 **ZeroTermux** 开发，要一份能让 AI 真正帮上忙的技能（不是泛泛的"Termux 是什么"）。
- 本机实测得到的硬事实（写进 `SKILL.md`，都可复跑）:
  - 宿主一切在 `/data/data/com.termux/files/{usr,home}`，**容器内可直接看到**；宿主 `bin` 720 个可执行；本机 termux-main 源已指 **aliyun**，`x11` 源仍是 `packages-cf.termux.dev`。
  - 容器里 `$PREFIX` **为空**、`$HOME=/root` ⇒ 脚本别依赖 `$PREFIX`（要动宿主就走绝对路径）。
  - **共享网络命名空间**：容器内 `127.0.0.1:19951`（ZeroTermux 的 Java 服务）**可连** ✓；`19952` 只在宿主 `zt` 执行期间按需监听（平时不监听是正常的）。
  - ZeroTermux 的机制目录：`~/.ZtInfo/main_menu_path.xml`（左侧菜单配置，`zt menu reset|update` 管理；菜单项可 `java:` / `jumpUrl:` / `ztShell:`）、`~/.timerdir/{shell_timer.sh,termux_timer.sh,log/}`（定时任务）、`~/.skill/<name>/SKILL.md`（它自带的 agent skills，本机有 `termux-pkg-guide`，用 `send_terminal_command` / `list_zerotermux_pkg_sources` 这类工具）。
  - 版本线（GitHub 一手）：官方 Termux 最新 **v0.118.3**（2025-05-22）；ZeroTermux 最新 **0.118.3.64**（2026-08-08，arm64 debug/release 两个 APK）。
  - 实测坑：`/proc` 时钟自相矛盾（`date`=1792042789 vs `/proc/uptime`=124.08s vs `btime`=1680020856）、`ps -o etimes=` 溢出成 `4294967295`、f2fs 上 `find -type f` **漏文件**（`packs/security-baseline` 实测 2 vs 3）、`systemctl is-system-running` ⇒ `offline`（无 systemd）。
  - ★ 一处**纠正流传说法**：`chmod` 对目录在本机**可用**（700 → 755 实测生效）；`scripts/security-baseline.mjs --self-check` 打印的"chmod 对目录不生效"是那条更严判据的结果，两者不矛盾 —— **别把某条脚本的免责当普适事实**。
- 未在 my-pi 侧实测（✗，已写进 SKILL.md §10）: ZT 内置智能体工具的语义、`zt`↔19951 的协议、`termux-change-repo` 各镜像可用性、X11/VNC 效果、phantom killer 的 adb 命令（来自公开文档，未在本平板跑）。
- 与用户已有资产的边界: ZeroTermux **自带** `~/.skill/termux-pkg-guide`（宿主层 `pkg` 安装/换源，主打"用工具真跑"）；本包是 **my-pi 侧**技能，侧重"三层身份判定 + 宿主↔容器互通 + 保活/定时任务 + proot 实测坑"，两者**互补不重复**（SKILL.md §3.2 写了分工）。

## 2026-10-15 建包时的自我纠错（子代理一手调研 + 我的复核）

- 环境: 同上（ZeroTermux on Android 平板 + proot Ubuntu 24.04 aarch64）
- **写技能时差点写错、后来改掉的四处**（都可复跑/可核对）:
  1. **`chmod`**：我初稿写"实测不生效"是对 `security-baseline.mjs` 免责文案的过度概括 ✗ ⇒ 实测 700→755 **生效**；真正限制是 **`/sdcard` 是 fuseblk + `nosuid,nodev,noexec` 且无 unix 权限**（`stat -f -c %T /storage/self/primary` ⇒ `fuseblk`；`/proc/mounts` 里带 `noexec`）。官方 proot-distro 限制清单里**没有** chmod 这一条。
  2. **f2fs `find -type f` 漏文件**：本机确实复现（2 vs 3），但**找不到权威解释** ⇒ 技能里降级为"本机现象、别当普适规律"，只给对策（用 `! -type d`）。
  3. **`/proc` 时钟**：原以为只是本机怪癖 ⇒ **官方承认**（proot-distro README Limitations：`/proc/stat|uptime|loadavg|vmstat` 是固定替身，`top`/`uptime` 是快照）。
  4. **宿主工具漏进容器**：`proot-distro` 官方原文说 guest `PATH` 末尾会追加 `$PREFIX/bin` ⇒ 本机 `which -a node` 同时给出 pi-node 与 Termux 的 node（**版本串台风险**），技能里加了"容器内显式绝对路径/收紧 PATH"的对策。
- **补进的硬事实**（都可核对）: ZeroTermux **无官方文档站**（wiki 302、无 Gitee 镜像）；它的风险面（内置 8 个插件 APK、权限清单、仓库里带 `phone.jks` 且签名与 Utermux 共用、LICENSE GPLv3-only vs README 链 GPL-2.0）；**Android 15/16 不会因 targetSdk 拒装**（AOSP `MIN_INSTALLABLE_TARGET_SDK`=23/24 vs Termux targetSdk=28），但有一批运行时 issue（#5150/#4788/#4185 16KB page size/#4572/#5360/#5380）；`termux-am` 走 unix socket 比 `/system/bin/am` 快且 `/system/bin/am` 只有 adb/root 够权限；`termux-notification --ongoing` 做常驻通知；外接键盘 Ctrl+Alt 快捷键表；`terminal-margin-*` 为窄边/保护壳设计。
- **隐私边界（有意为之）**: 调研过程中看到了用户宿主 home 与共享存储里的私人文件名/整机备份文件名 ⇒ **一律不写进技能**（技能里只出现机制目录 `ZtInfo/`/`.timerdir/`/`.termux/`/`.skill/`），并在 SKILL.md §9 明写这条纪律。
- 未核实（✗，已写进 §10）: ZT 许可细节、"维修模式"、`zt`↔19951 协议、ZT 内置工具语义、各镜像可用性、X11/VNC 实效、phantom killer adb 命令（未在本平板实测）、社区教程准确性。
