# Alacritty + tmux 部署问题总结

> **文档性质：一次性部署排障记录（2026-08-05，本机 WSL2 专属）**——7 个问题中部分为通用教训（TOML 语法、terminfo、会话内执行）、部分为本机环境特有（渲染后端、clipboard panic）。后续部署优先参考「最终架构」与「常用速查」两节；正文问题明细按需查阅。
>
> **适用环境：WSL2/WSLg**（Alacritty + tmux 部署）。Termux/Linux/macOS 下不适用。多环境使用总览见 `docs/operations/ENVIRONMENTS.md`。

> 环境: Ubuntu 24.04 (WSL2/WSLg), root 用户, 无独立 GPU
> 日期: 2026-08-05

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 更新日期 | 2026-09-20 |
| 适用范围 | WSL2/WSLg 环境 Alacritty + tmux 部署 |
| 相关文档 | [ENVIRONMENTS.md](./ENVIRONMENTS.md), [TERMUX-DEV-NOTES.md](./TERMUX-DEV-NOTES.md) |

---

## 目录

- [一、背景](#一背景)
- [二、问题汇总](#二问题汇总共-7-个)
- [三、最终架构](#三最终架构)
- [四、关键配置文件](#四关键配置文件)
- [五、常用速查](#五常用速查)

---

## 一、背景

目标: 安装并优化 Alacritty + tmux。
职责划分: **Alacritty** 负责界面渲染与基础交互, **tmux** 负责会话持久化与多任务管理。

本节及以下配置、wrapper、tmux 插件均属于**本机终端环境**（用户 dotfile 与系统二进制），不在 `portable/` 目录下。
其中 tmux 配置已随仓库分发（`deploy/tmux/`：`tmux.conf`、`tmux-status.sh`、`status-loop.sh`），
安装方式见 `deploy/README.md`；Alacritty wrapper 仍为本机专属。

---

## 二、问题汇总 (共 7 个)

### 1. Alacritty 配置 TOML 语法错误 (×2)
**现象**: 启动时报 `Config error: TOML parse error`, 直接退出。
**原因**:
- `[window]` 内已有 `dimensions = {...}`, 又写了 `[window.dimensions]` 子表 → 重复键冲突。
- `[mouse.bindings]` 表下直接写裸对象 `{ mouse = "Right", ... }` → TOML 非法 (invalid key)。
**修复**: 删除重复的 `[window.dimensions]`; 鼠标绑定改为数组语法:
```toml
[mouse]
bindings = [
    { mouse = "Right", action = "ExpandSelection" },
    { mouse = "Middle", action = "PasteSelection" },
]
```

### 2. 渲染后端选择错误 (初期误判为无 GPU)
**现象**: `libEGL warning: failed to get driver name`、`ZINK: failed to choose pdev`。
**原因**: 此环境是 WSL2/WSLg, GPU 直通**已启用** (`/dev/dxg` 存在,
`/usr/lib/wsl/lib` 含 `libd3d12.so`/`libdxcore.so`, Mesa 带 `d3d12_dri.so`)。
但 WSL 无 `/dev/dri` 节点, Mesa 无法自动探测到 D3D12 后端 → 默认回退 llvmpipe 软件渲染,
同时 ZINK(Vulkan-on-GL) 探测失败报错。
**正确修复**: 显式指定 D3D12 驱动以启用 NVIDIA GPU 硬件加速:
```bash
export GALLIUM_DRIVER=d3d12    # 渲染器变为: D3D12 (NVIDIA GeForce RTX 3070 Ti Laptop GPU)
```
> 曾错误使用 `LIBGL_ALWAYS_SOFTWARE=1` (强制软件渲染, 浪费 GPU), 已废弃。
> 验证方法: `GALLIUM_DRIVER=d3d12 glxinfo -B` 查看 renderer; 或查进程
> `/proc/<pid>/maps` 中加载了 `libd3d12core.so`/`libdxcore.so` 即确认硬件加速。

### 3. alacritty terminfo 缺失
**现象**: `infocmp alacritty` 失败。
**原因**: Ubuntu 的 alacritty 包未附带 terminfo, `TERM=alacritty` 时终端能力表缺失。
**修复**: 从官方仓库下载 `alacritty.info` 并编译:
```bash
curl -skL -o /tmp/alacritty.info \
  https://raw.githubusercontent.com/alacritty/alacritty/v0.13.2/extra/alacritty.info
tic -x /tmp/alacritty.info
```

### 4. smithay-clipboard panic + Broken pipe (最隐蔽)
**现象**: `thread 'smithay-clipboard' panicked ... Broken pipe`, 退出码 1。
**原因**: WSLg 同时暴露 X11 (`:0`) 和 Wayland (`wayland-0`)。
`WAYLAND_DISPLAY` 环境变量存在时, Alacritty 的剪贴板线程**强制**连接 Wayland
(与 `WINIT_UNIX_BACKEND` 无关), 而 WSLg 的 Wayland socket 对 root 连接异常 → panic。
**关键教训**: `[env]` 配置只能**设置**变量, 无法 **unset** 外部已存在的变量,
所以 `WINIT_UNIX_BACKEND=x11` 写在配置里无效, 必须用 wrapper 脚本 unset。
**修复**: 创建 wrapper 替换系统命令:
```bash
mv /usr/bin/alacritty /usr/bin/alacritty.real
# /usr/bin/alacritty (新 wrapper):
#!/usr/bin/env bash
unset WAYLAND_DISPLAY            # 切断 WSLg Wayland，避免剪贴板 panic
export GALLIUM_DRIVER=d3d12      # 显式启用 D3D12 硬件加速（见问题 2）
exec /usr/bin/alacritty.real "$@"
```
> 早期 wrapper 曾写 `export LIBGL_ALWAYS_SOFTWARE=1` 应急，与问题 2 的正确修复冲突，已废弃。

### 5. shell 命令哈希缓存 (PATH 失效)
**现象**: `-bash: /usr/bin/alacritty: No such file or directory`。
**原因**: 原二进制被移走, 但 bash 缓存了旧路径; 且 wrapper 起初放在
`/usr/local/bin`, 与用户 shell 缓存的 `/usr/bin` 路径不一致。
**修复**: wrapper 直接放回 `/usr/bin/alacritty`, 删除重复副本;
shell 内执行 `hash -r` 刷新缓存。

### 6. tmux 感知依赖 `$TMUX`，只在会话内有效
**现象**: 在 tmux 外运行依赖 tmux 的脚本时报大量 `no server running`；相关环境变量为空。
**原因**: tmux 客户端/服务端的行为靠 `$TMUX` 环境变量定位 socket，脱离 tmux 会话时该变量为空。
**与 my-pi 的关系**: my-pi 的 tmux 功能（`custom/features/tmux/`）同样以 `TMUX`（及 `TMUX_SESSION_NAME`）
作为"是否处于 tmux 会话"的判据，在会话开始时检测并提示会话名。它**只做检测与提示**，
不负责创建、保存或恢复会话。
**修复**: 需要 tmux 语义的操作一律在会话内执行（先 `tmux a` / `tmux new -A -s main` 进入会话）；
会话持久化由外部插件处理（见问题 7）。

### 7. 持久化测试的幂等性（tmux-resurrect 外部插件）
**现象**: 恢复时 `duplicate session` / `can't find session`。
**原因**: 恢复流程尝试重建已存在的会话, 或引用了过期快照。
**修复**: 测试前清理快照目录 `~/.local/share/tmux/resurrect`, 确保干净往返测试。
> my-pi 不提供快照/恢复能力，本节属 tmux 插件（tmux-resurrect / tmux-continuum）使用经验。

---

## 三、最终架构

```
用户输入 `alacritty`
  → /usr/bin/alacritty (wrapper: unset WAYLAND_DISPLAY + GALLIUM_DRIVER=d3d12 GPU加速)
  → Alacritty X11 窗口 (界面渲染/基础交互, NVIDIA GPU 硬件加速)
  → bashrc 检测 TERM_PROGRAM=Alacritty 且非 tmux 内
  → tmux new-session -A -s main  (会话持久化/多任务)
  → 会话内运行 ./my-pi.sh；custom/features/tmux 检测到 TMUX 变量并在 UI 提示当前会话名
```

## 四、关键配置文件

| 文件 | 作用 |
|---|---|
| `~/.config/alacritty/alacritty.toml` | Alacritty 界面/字体/键位/回滚 |
| `/usr/bin/alacritty` (wrapper) | 修复 WSLg Wayland 问题 + 启用 D3D12 GPU 加速 |
| `~/.tmux.conf`（或 `~/.config/tmux/tmux.conf`） | tmux 键位/状态栏/持久化插件；由 `deploy/tmux/tmux.conf` 安装生成 |
| `~/.bashrc` (末尾) | 自动进入 tmux 会话 |

> Alacritty wrapper 与 `.bashrc` 为本机 dotfile/系统路径，不随 my-pi 仓库同步；
> tmux 配置现由 `deploy/tmux/` 分发（安装见 `deploy/README.md`），状态文件落在 `~/.cache/my-pi-tmux`。

## 五、常用速查

| 操作 | 命令 |
|---|---|
| 启动终端 | `alacritty` |
| 保存 tmux 快照 | `Ctrl+a C-s` (tmux-resurrect 插件) |
| 恢复 tmux 快照 | `Ctrl+a C-r` (tmux-resurrect 插件，需在会话内) |
| 脱离会话 | `Ctrl+a d` |
| 附加会话 | `tmux a` |
| 分屏 / 切换窗格 | `Ctrl+a \|-` / `Ctrl+a hjkl` |
