# 备份清单（始终包含 / 默认排除 / 按需包含）

> 原位于 SKILL.md 正文，外置至此。执行 create/restore/clone 前先读本文件确认覆盖范围，再决定 --full/--with-auth 等参数。
> 下表路径均相对仓库根 `/root/my-pi`。清单以 **git 跟踪文件** 为基线（`git ls-files` + 未跟踪但未被 gitignore 的文件），再按下表增补/排除。

### 始终包含（默认模式）

| 分组 | 相对路径 | 说明 |
|------|----------|------|
| 自定义层源码 | `custom/` | adapters / core / features / bootstrap.ts / package.json / tsconfig.json（排除 `dist/`、`node_modules/`） |
| 构建脚本 | `scripts/` | `build.sh`（vendor 引导+构建）、`dev.sh`、`check-isolation.sh`、`sync-upstream.sh` |
| 上游补丁 | `patches/` | `001-branding.patch`、`002-local-pi-mods.patch`、`README.md` |
| 技能包 | `packs/` | 外部技能包（按需读取，不注入系统提示词） |
| 项目文档 | `docs/` | 项目文档（存在时收录） |
| 跟踪配置 | `portable/config/settings.json` | 主配置：provider、model、extension 设置、skills 覆盖列表（**注意：属每环境独立项，见"按需包含"**） |
| 跟踪配置 | `portable/config/AGENTS.md` | Pi 全局约定（开发规范索引指向此文件） |
| 跟踪配置 | `portable/config/APPEND_SYSTEM.md` | 追加系统提示词 |
| 跟踪配置 | `portable/config/keybindings.json` | pi 用户级键位配置 |
| 技能 | `portable/config/skills/*/` | 所有已安装技能（SKILL.md 及附属文件，如 `references/`） |
| 记忆笔记 | `portable/memory/notes.json` | note-store 持久记忆数据（gitignore，**必须靠归档带走**） |
| 仓库入口 | `my-pi.sh` | 便携启动脚本（解析仓库根 + 加载 `custom/bootstrap.ts`） |
| 仓库配置 | `package.json`、`package-lock.json`、`vitest.config.ts`、`.npmrc`、`.gitattributes` | 依赖声明 / 测试配置 / 仓库级属性 |
| 仓库配置 | `.gitignore` | git 忽略规则（含 `portable/config/*`、`vendor/pi/` 排除规则） |
| 仓库文档 | `README.md`、`STRUCTURE.md`、`AGENTS.md`、`PROGRESS.md`、`DECISIONS.md`、`LICENSE` | 仓库级文档 |

> **技能目录收录方式**：`portable/config/skills/` 下的技能随仓库跟踪（`.gitignore` 白名单）；若本机新装的技能尚未入库，`create` 归档仍会按"未被 gitignore 排除"原则收录。

### 默认排除（`--full` 时额外包含）

| 分组 | 相对路径 | 说明 | 重建方式 |
|------|----------|------|---------|
| 上游源码 | `vendor/pi/` | 独立 git 仓库（上游 pi-mono），不随主仓库分发 | `bash scripts/build.sh`（自动 clone + checkout `vendor/PINNED_COMMIT` + 应用 `patches/`） |
| npm 依赖 | `node_modules/`、`custom/node_modules/` | 根 workspaces 依赖 | `npm install`（由 `scripts/build.sh` 调用） |
| 构建产物 | `custom/dist/` | custom 层编译输出 | `bash scripts/build.sh` |
| 会话历史 | `portable/config/sessions/` | 对话历史（每环境独立，可能含隐私） | 不可重建，需 `--include-sessions` 恢复 |
| 扩展安装 | `portable/config/extensions/` | 运行时扩展安装目录（每环境独立） | 不可重建，需用户重新安装 |
| 会话目录 | `portable/config/sessions/` | pi 运行时在 agentDir 下产生的会话缓存 | 不可重建，不恢复 |
| 运行时配置 | `portable/config/{auth.json,models.json,models-store.json,modes.json,trust.json}` | API 密钥 / provider 模型 / 模式 / 项目信任（每环境独立） | 需 `--with-auth` 或从原机 scp |
| 互联运行时 | `portable/config/pi-link-*.json` | pi-link 活跃时间戳 / 远程状态 / 信箱（每设备运行时数据） | 运行时自动重建 |
| 调度种子 | `portable/config/scheduled-seeds.json` | 调度种子运行时数据 | 运行时自动重建 |
| 工具输出归档 | `portable/memory/tool-outputs/` | context 功能的工具输出归档（可再生的运行时数据） | 自动产生 |

> `--full` 的边界：`--full` 只额外纳入上表**可重建**项（`node_modules/`、`custom/dist/`、`tool-outputs/`）；每环境独立项（`auth.json`、`models*.json`、`portable/config/sessions/`、`portable/config/extensions/`、`vendor/pi/`）**即使 `--full` 也不包含**，需 `--with-auth` / `--include-sessions` 显式指定。

### 按需包含

| 分组 | 相对路径 | 说明 |
|------|----------|------|
| auth | `portable/config/auth.json` | API 密钥。**默认不包含**，需 `--with-auth` 确认。包含后应提醒用户注意安全。 |
| 模型配置 | `portable/config/models.json`、`portable/config/models-store.json` | provider/模型定义（含 provider 密钥，机器特定）。**默认不包含**，随 `--with-auth` 一并收录；否则新设备需 scp 或手动重建。 |
| 模式/信任 | `portable/config/modes.json`、`portable/config/trust.json` | 模式定义与项目信任设置（每环境独立）。**默认不包含**，随 `--with-auth` 一并收录。 |
| 会话历史 | `portable/config/sessions/` | 对话历史。**默认不包含**，需 `--include-sessions`。 |

---
