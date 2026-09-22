# 多环境使用指南（Termux / WSL2 / Linux / macOS）

my-pi 仓库通过 GitHub 在多台设备/多个环境间同步，运行时数据统一收敛在仓库内的 `portable/` 目录（`config/`、`sessions/`、`extensions/`、`memory/`），其中大部分被 `.gitignore` 排除。不同环境（Termux/Android、WSL2、Linux 桌面、macOS）的配置与使用经验存在差异，本指南说明如何识别环境、区分共享数据与每环境独立数据，避免配置互相覆盖。

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 更新日期 | 2026-09-20 |
| 适用范围 | 多环境配置、运行时数据同步、配置管理 |
| 相关文档 | [TERMUX-DEV-NOTES.md](./TERMUX-DEV-NOTES.md), [alacritty-tmux-setup.md](./alacritty-tmux-setup.md), [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) |

---

## 目录

- [一、环境识别](#一环境识别)
- [二、运行时数据布局](#二运行时数据布局)
- [三、共享数据与冲突消解](#三共享数据与冲突消解)
- [四、配置层（每环境独立）](#四配置层每环境独立)
- [五、常见环境差异坑](#五常见环境差异坑)
- [六、环境切换日常流程](#六环境切换日常流程)

---

## 一、环境识别

my-pi 不做环境自动探测：环境判断由操作者完成，配置层面按环境各写各的（见 §4）。识别方法：

| 环境 | 检测方法 | 特征 |
|------|----------|------|
| Termux/Android | `/storage/emulated/0` 存在 | `uname -a` 含 `PRoot`；`pkg` 包管理器 |
| WSL2 | `/proc/version` 含 `microsoft` | `/mnt/c/` 挂载；WSLg 显示与音频桥 |
| Linux 桌面 | 其余 Linux | apt/dnf/pacman 等 |
| macOS | `uname` = Darwin | `brew`；剪贴板用 `pbcopy`/`pbpaste`（无 `xclip`） |

```bash
uname -a
grep -qi microsoft /proc/version && echo WSL2
[ -d /storage/emulated/0 ] && echo Termux
```

识别结果决定三件事：本机该用哪套每环境独立配置（§4）、哪些终端/输入差异需要处理（§5）、以及记录经验时是否需要标注环境（§2）。

## 二、运行时数据布局

所有运行时数据都在仓库内的 `portable/` 下，通过启动脚本 `my-pi.sh`（或 `scripts/dev.sh`）把 `PI_CODING_AGENT_DIR` 指向 `portable/agent`；技能由 pi 从 `agentDir/skills`（即 `portable/agent/skills/`）自动发现。

| 路径 | 入库策略 | 说明 |
|------|----------|------|
| `portable/agent/`（部分文件） | 部分跟踪 | `settings.json`、`keybindings.json`、`AGENTS.md`、`APPEND_SYSTEM.md` 入库共享；其余被 `.gitignore` 排除 |
| `portable/agent/skills/` | **入库共享** | 技能目录（pi 从 `agentDir/skills` 发现；`.gitignore` 已加白名单，随仓库分发） |
| `portable/agent/sessions/` | 不入库 | 会话历史（`agentDir/sessions/<转义 cwd>/`） |
| `portable/agent/extensions/`、`portable/agent/{npm,git}/` | 不入库 | 第三方扩展（自动发现目录与 `pi install` 装入的包） |
| `portable/memory/` | 不入库（仅 `.gitkeep`） | 自定义功能数据：note-store 笔记与工具输出归档 |

由此得到两条基本规则：

1. **仓库里能同步的只有代码、共享配置与技能**（`custom/`、`scripts/`、`patches/`、`packs/`、`docs/`、`portable/agent/` 中列入白名单的四个文件与 `portable/agent/skills/`）。`portable/memory/`、`portable/agent/{sessions,extensions,npm,git}/`、每环境独立配置等不会随 `git pull` 到达新环境。
2. **换机保留记忆必须走归档/手工拷贝**，例如 `pi-backup create` 归档，或直接拷贝对应目录；技能随 git 同步，通常无需额外处理。

**环境专属信息的标注约定**：记忆数据统一放在 `portable/memory/`。记录时在同一份记忆中区分环境——环境专属的经验（如"某环境的终端快捷键/音频桥配置"）在内容里标注环境标签（`termux`/`wsl2`/`linux`/`macos`）；只是"在某个环境里发现"的通用知识不标注。这样跨环境复习时能快速分辨哪些经验只对当前机器成立。

## 三、共享数据与冲突消解

### 3.1 共享文件清单

| 文件 | 说明 |
|------|------|
| `portable/agent/settings.json` | 默认 provider/model、技能覆盖列表（`"skills": ["+skills/<name>/SKILL.md", ...]`，相对 `agentDir`）等 |
| `portable/agent/keybindings.json` | 终端快捷键；不同终端差异较大，改动前确认是否所有环境都适用 |
| `portable/agent/AGENTS.md` | Pi 全局约定 |
| `portable/agent/APPEND_SYSTEM.md` | 追加系统提示 |

这些文件跨环境共享，**不要写入机器专属路径、主机名或密钥**——它们会被同步到其它环境。密钥类配置一律放 `auth.json`/`models.json`（每环境独立、gitignore，见 §4）。同步前可用 `pi-backup verify` 做一次 git 卫生与密钥泄漏体检。

### 3.2 冲突处理流程

不入库的文件（`auth.json`、`models.json`、`sessions/`、`memory/` 等）不参与 git 合并，`git pull` 不会覆盖本机配置，这是每环境独立配置的保障。真正会冲突的只有 §3.1 的共享文件：

1. `git pull` 报冲突 → 先确认该文件在本环境是否仍需本地改动
2. 共享配置以最新修订为准：`git checkout --theirs <file>` 保留远程版本
3. 若本地确有必须保留的改动（如本环境必需的快捷键），从本地备份中手工重放后再 `git add <file>` 完成合并
4. 合并后启动一次 `./my-pi.sh`，确认配置可被解析（`settings.json` 语法错误会导致启动异常）

多机交替 push 时以最新 push 为准：另一台机器下次 pull 前若还有未提交的共享配置改动，先提交或备份，避免被覆盖后无法追溯。

## 四、配置层（每环境独立）

原则：**每环境各写各的配置，绝不跨机覆盖**。首次 clone 后按本机能力手动配置，之后只 pull 共享文件。

| 文件 | 策略 | 说明 |
|------|------|------|
| `portable/agent/models.json` | 每环境独立配置（gitignore） | 各机器按能力配置（WSL2 等有 GPU 的机器可用大模型，Termux 用更小的模型）；首次 clone 后手动配置。共享的 `settings.json` 中涉及本机能力的选择（默认 provider/model）如需按环境区分，改在 `models.json` 侧落地，避免把机器专属配置写进共享文件 |
| `portable/agent/auth.json` | 每环境独立（gitignore） | API 凭据不跨机同步（安全） |
| `portable/agent/models-store.json` | 每环境独立（gitignore） | provider 密钥等运行时数据 |
| `portable/agent/modes.json` / `trust.json` | 每环境独立（gitignore） | 模式与项目信任状态，随本机使用变化 |
| `portable/agent/pi-link-*.json` | 每环境独立（gitignore） | 多设备互联的设备清单与运行时状态（`pi-link-active.json`/`pi-link-state.json`/`pi-link-outbox.json`） |
| `portable/agent/scheduled-seeds.json` | 每环境独立（gitignore） | 定时相关运行时数据 |
| `portable/agent/sessions/` / `portable/agent/{extensions,npm,git}/` / `portable/memory/` | 每环境独立（gitignore） | 会话历史、第三方扩展、自定义功能数据 |

跨机迁移每环境独立项时三选一：① 用 `pi-backup create` 打包后 `restore`；② 直接 `scp`/`rsync` 拷贝对应文件或目录；③ 在新环境手动重建。日常同步**不要**用归档覆盖新环境的独立配置。

## 五、常见环境差异坑

| 主题 | Termux | WSL2 | Linux 桌面 | macOS |
|------|--------|------|-----------|-------|
| 包管理器 | `pkg` | 发行版自带 | apt/dnf/pacman | `brew` |
| tmux 组合键 | 需 `extended-keys` 透传 | 需 `extended-keys` | 一般无需 | 一般无需 |
| 剪贴板 | 不适用（无 X） | `xclip` / WSLg 集成 | `xclip` 或 `wl-copy` | `pbcopy` / `pbpaste` |
| 回车输入 | ICRNL 转 `\n`（Kitty 解析为 shift+enter） | 正常 | 正常 | 正常 |
| 路径与挂载 | 家目录在 `/data/data/com.termux/files/home` | Windows 盘挂载于 `/mnt/c/` | 常规 FHS | 常规（注意大小写不敏感卷） |
| GPU | 无 | 可用（D3D12 透传） | 可用 | 可用 |
| 终端配置 | 见 [TERMUX-DEV-NOTES.md](./TERMUX-DEV-NOTES.md) | WSLg 显示/音频需调优，见 [alacritty-tmux-setup.md](./alacritty-tmux-setup.md) | 常规 | 常规 |

遇到上表之外的环境差异，按 §2 的约定把结论记入 `portable/memory/` 并标注环境，或在 `docs/operations/` 下补充文档。

## 六、环境切换日常流程

```bash
# 每次切换环境后（在仓库根执行）
git pull          # 拉取共享更新（settings.json / keybindings.json / AGENTS.md / APPEND_SYSTEM.md）

# 本机独立配置：仅首次 clone 后需要
#   portable/agent/{auth.json,models.json,models-store.json,modes.json,trust.json,pi-link-*.json}
#   按本机情况配置或从归档恢复（见 §4）
```

```bash
# 新环境首次克隆后：一键重建（安装根依赖 + 引导 vendor + 构建）
bash scripts/build.sh

# 体检并自动修复缺口（依赖/vendor/补丁/dist 新鲜度/自愈缓存/shim/可选服务）
bash scripts/doctor.sh --fix

# 启动（自动指向 portable/ 运行时数据）
./my-pi.sh
```

```bash
# 更新 pi（上游）后：自动修复（合并上游 → 补齐补丁 → 重建 dist → 刷新自愈缓存 → 类型检查）
bash scripts/sync-upstream.sh
# 只读预演（看将同步到哪个 commit，不改动任何内容）
PI_SYNC_DRY_RUN=1 bash scripts/sync-upstream.sh
```

> `sync-upstream.sh` 需要网络；拉取超时可用 `PI_FETCH_TIMEOUT` 调整。若上游改动与本地补丁冲突，
> 脚本会中止并列出冲突文件、回滚 vendor，不会留下半完成状态。

```bash
# 定期同步与归档（在任一环境）
pi-backup create     # 归档仓库内容、技能与 portable/memory 笔记（详见 pi-backup 技能）
pi-backup sync       # 推送到 GitHub（git commit + push）
pi-backup verify     # 同步前体检：git 卫生 / 密钥泄漏 / 隔离边界
```

切换环境后建议验证一次：`npm run check`（隔离边界）、`npx tsc --noEmit -p custom/`（类型），再实际启动 `./my-pi.sh`。启动失败优先查 [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)。
