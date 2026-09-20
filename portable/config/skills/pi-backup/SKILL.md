---
name: pi-backup
description: 备份/恢复 my-pi 仓库（tar.gz 归档或 GitHub git 同步两种模式）：custom/、scripts/、patches/、packs/、docs/、技能与 portable/memory 笔记。用户说"备份""存档""迁移""恢复""同步""推送"时触发。不适用：仅同步单个文件/临时传文件（用 scp/rsync）；不含配置的普通代码仓库同步。
version: v1.1
更新日期: 2026-09-20
---

# pi-backup 技能

备份/恢复 my-pi 项目（`/root/my-pi`）的仓库内容、技能与记忆数据。

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.1 |
| 更新日期 | 2026-09-20 |
| 适用场景 | 备份/恢复 my-pi 仓库（源码、配置、技能、记忆数据） |
| 不适用 | 仅同步单个文件/临时传文件（用 scp/rsync）；不含配置的普通代码仓库同步 |
| 依赖 | tar, git, npm, node, `scripts/build.sh` |

---

## 目录

- [一、概述](#一概述)
- [二、命令列表](#二命令列表)
- [三、备份清单](#三备份清单)
- [四、注意事项](#四注意事项)

---

## 一、概述

对 my-pi 仓库（`/root/my-pi`）进行打包备份与恢复：`custom/`、`scripts/`、`patches/`、`packs/`、`portable/config` 中跟踪的配置文件、`portable/memory` 笔记数据、`portable/config/skills/` 技能（`docs/` 存在时一并收录）。支持两种模式：

- **本地归档**（`create` / `restore`）：tar.gz 压缩包，适合快照存档
- **GitHub 同步**（`sync` / `clone`）：git push/pull，适合日常增量同步

`vendor/pi/` 不随主仓库分发（独立 git 仓库，已 gitignore），fresh checkout 后由 `bash scripts/build.sh` 自动引导 + 构建，因此不在备份范围内。

## 二、命令列表

- [`pi-backup create`](COMMANDS.md#pi-backup-create) — 创建本地 tar.gz 归档
- [`pi-backup sync`](COMMANDS.md#pi-backup-sync) — 推送到 GitHub（git commit + push）
- [`pi-backup restore`](COMMANDS.md#pi-backup-restore) — 从本地归档恢复到仓库根
- [`pi-backup clone`](COMMANDS.md#pi-backup-clone) — 从 GitHub 克隆/拉取到仓库根
- [`pi-backup build`](COMMANDS.md#pi-backup-build) — vendor 引导 + 构建（`scripts/build.sh`）
- [`pi-backup verify`](COMMANDS.md#pi-backup-verify) — 体检：git 卫生 / 密钥泄漏 / 隔离边界
- [`pi-backup list`](COMMANDS.md#pi-backup-list) — 列出可用备份 / 检查状态

> **不适用的命令**（pi-tools 时代的能力，my-pi 无对应实现，已删除）：`install-cron`、`install-wrapper`、`install-systemd`（无 crontab/wrapper/systemd 安装脚本）、`pi-link-keys.sh install`（`custom/features/link/` 不再提供公钥安装脚本）、`searxng`/`whisper`/`venv` 重建（my-pi 无这些子系统）。

## 三、备份清单

> 完整三表（始终包含 / 默认排除（`--full` 时额外包含） / 按需包含）见 `references/BACKUP-MANIFEST.md`。
> create/restore/clone 执行前先读该文件确认覆盖范围与重建方式。

## 四、注意事项

1. **敏感数据**：`portable/config/auth.json`（API 密钥）与 `models.json` / `models-store.json`（provider 密钥）默认不包含在备份中。`git sync` 时 `.gitignore` 会自动排除它们——但仍建议定期确认 `git ls-files portable/config` 中不含这些文件，防止意外追踪。
2. **重启生效**：恢复或克隆后必须重新运行 `./my-pi.sh` 才能加载更新后的配置。
3. **恢复前快照**：每次 `restore` 操作会自动创建 `~/pi-backups/pre-restore-{timestamp}.tar.gz`，可用于回滚。
4. **每环境独立项**：`portable/config/{auth.json,models.json,models-store.json,modes.json,trust.json,pi-link-*.json,scheduled-seeds.json}`、`portable/config/sessions/`、`portable/config/extensions/` 均为每环境独立数据（gitignore），默认既不进 git 同步也不进归档。跨机迁移三选一：① `pi-backup create --with-auth` 打包 → restore；② scp 直接传；③ 新设备手动重建。
5. **vendor 引导**：`vendor/pi/` 与根 `node_modules/`、`custom/dist/` 都不备份。恢复/克隆后必须运行 `bash scripts/build.sh` 重新引导 vendor（clone 上游 + checkout `vendor/PINNED_COMMIT` + 应用 `patches/*.patch`）并构建。
6. **构建超时**：`scripts/build.sh` 包含 `git clone`（vendor 引导）、`npm install` 与 `tsc` 编译，网络慢时可能耗时较长。建议在网络稳定的环境下执行，并按下方 `build` 节的 60 秒进度报告节奏向用户汇报。
7. **技能目录**：技能位于 `portable/config/skills/<name>/SKILL.md`（pi 从 `agentDir/skills` 自动发现，`agentDir` = `portable/config`），随仓库跟踪、无需单独备份。`packs/` 是按需读取的外部技能包（不注入系统提示词），同样建议纳入归档。
8. **记忆数据**：`portable/memory/` 整体被 gitignore（仅保留 `.gitkeep`），包含 note-store 的 `notes.json` 与工具输出归档 `tool-outputs/`——**git 同步不带走**，换机保留记忆必须用 `create` 归档。`tool-outputs/` 属可再生的运行时归档，默认排除。
9. **归档内可含 git 未跟踪的配置**：`portable/config/skills/` 等目录下的技能文件可能是本机新装、尚未提交的，`create` 以 git 文件清单为基础并按 `.gitignore` 排除，这些文件会一并带走（这正是归档比 git 同步更完整的原因）。
10. **端到端验证**：构建/恢复后建议依次运行 `npm run check`（隔离边界）与 `./my-pi.sh` 实际启动一次——`npm run check` 可验证 `custom/` 无越界依赖、`portable/` 下无符号链接；`./my-pi.sh` 验证 vendor 产物与 `custom/bootstrap.ts` 能被加载。
11. **`pi-backup verify`**：同步前先跑体检（git 卫生 / 密钥泄漏 / `.gitignore` 完整性），防止手工拷贝或 rsync 式同步丢了 `.gitignore` 后把密钥提交进仓库。命中时应立即 `git rm --cached <file> && git commit -m "fix: remove secret"`。

---

## 使用后改进（必做）

任务收尾时清点：执行过程与本文步骤/路径/结论的偏差。有 → 追加一条到 `improvements.md`（证据导向：命令、路径、现象，不直接改正文）。未合并条目 ≥3 条或用户要求时，合并进正文并清日志。机制全文见 `docs/development/SKILLS-MAINTENANCE.md`。
