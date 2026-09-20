# pi-backup 命令参考

> 所有路径相对仓库根 `/root/my-pi`（下称"仓库根"）。

## `pi-backup create`

创建本地 tar.gz 归档备份。

**参数：**

| 参数 | 说明 |
|------|------|
| `--output <path>` | 输出路径（默认见下方[备份目录约定](#备份目录约定)） |
| `--with-auth` | 包含 `portable/agent/auth.json`（API 密钥）及同源敏感配置 `models.json` / `models-store.json` / `modes.json` / `trust.json`。默认不包含。 |
| `--full` | 额外包含默认排除的可重建项（`node_modules/`、`portable/memory/tool-outputs/`） |
| `--keep N` | 保留最近 N 份备份（默认 5），超出则删除最旧的文件 |

> **备份目录约定**：Termux/Android 环境默认 `/storage/emulated/0/我的文件/pi-backup/`；其他环境默认 `~/pi-backups/`。归档文件名 `pi-backup-{hostname}-{timestamp}.tar.gz`。

**执行步骤：**

1. 如果未指定 `--with-auth`，**必须询问用户**是否包含 `portable/agent/auth.json` 等敏感配置。
2. 在 `/tmp/` 下创建临时目录 `pi-backup-{timestamp}`。
3. 按[备份清单](references/BACKUP-MANIFEST.md)把文件复制到临时目录（保持相对仓库根的目录结构）。文件清单以 git 为基础：
   ```
   cd /root/my-pi
   git ls-files                                  # 跟踪文件（基线）
   git ls-files --others --exclude-standard      # 未跟踪但未被 gitignore 的新文件（技能/文档等，一并收录）
   # 再按清单手工增补 gitignore 但属于备份范围的项（存在时）：
   #   portable/memory/notes.json
   # 按清单排除：vendor/pi/、node_modules/、portable/agent/sessions/、
   #   portable/agent/extensions/、portable/agent/{auth,models,models-store,modes,trust}.json、
   #   portable/agent/pi-link-*.json、portable/agent/scheduled-seeds.json、
   #   portable/agent/sessions/、portable/memory/tool-outputs/
   ```
   `--full` 时额外纳入 `node_modules/`、`portable/memory/tool-outputs/`（每环境独立项即使 `--full` 也不纳入）。
4. 同时写入 `manifest.json` 到归档内：
   ```json
   {
     "tool": "pi-backup",
     "mode": "local",
     "timestamp": "{ISO-8601}",
     "hostname": "{hostname}",
     "full": false,
     "has_auth": false,
     "files": ["custom/bootstrap.ts", "portable/agent/settings.json", "..."],
     "excluded": ["vendor/pi/", "node_modules/", "portable/agent/sessions/", "..."]
   }
   ```
5. 运行 `tar czf {output_path} -C /tmp/pi-backup-{timestamp}/ .`
6. 清理临时目录：`rm -rf /tmp/pi-backup-{timestamp}/`
7. 验证完整性：`tar tzf {output_path} | head -5` 检查可读。
8. 执行保留轮转：如果备份目录下同模式备份超过 `--keep N` 份（默认 5），删除最旧的。
9. 报告备份文件路径、大小、文件数量。

**示例输出：**

```
备份完成：/storage/emulated/0/我的文件/pi-backup/pi-backup-myhost-20260920_120000.tar.gz (1.4 MB)
包含 180 个文件（默认模式，不含 auth）
保留 5 份，已清理 0 份旧备份
```

---

## `pi-backup sync`

将仓库根的 git 追踪文件通过 commit + push 同步到 GitHub。

> **git 模式的边界（重要）**：`.gitignore` 排除了 `portable/agent/*`（仅白名单保留 `AGENTS.md`、`APPEND_SYSTEM.md`、`keybindings.json`、`settings.json`）与 `vendor/pi/`——git 同步**不含** `auth.json`、`models.json`、`models-store.json`、`modes.json`、`trust.json`、`pi-link-*.json`、`scheduled-seeds.json`，也不含 `portable/memory/`、`portable/agent/sessions/`、`portable/agent/extensions/`。新设备 `clone` 后需手动提供或走归档（见 [clone](#pi-backup-clone) 与 `pi-backup create --with-auth`）。

> **与本地归档（`create`）的差异**：git 同步只含入库文件；本地归档另含 gitignored 的记忆数据（`portable/memory/notes.json`）。git 缺失项均为刻意排除，各有替代路径：

> | 归档含但 git 不含 | 性质 | 替代路径 |
> |---|---|---|
> | `portable/agent/{auth,models,models-store,modes,trust}.json` | 每环境独立配置（多环境约定） | clone 后 scp 或 `create --with-auth` 归档恢复 |
> | `portable/memory/notes.json`（笔记） | 运行时数据、每环境独立 | `create` 归档全量带走 |
> | `portable/agent/sessions/`、`portable/agent/extensions/` | 会话历史 / 扩展安装目录 | `--include-sessions` 归档恢复；扩展重新安装 |
> | `vendor/pi/` | 独立上游仓库 | `bash scripts/build.sh` 自动引导 |
>
> 定位差异：**git = 源码 + 配置骨架增量同步**（不含密钥/会话/记忆）；**归档 = 全量快照**（含记忆等运行时数据）。换机完整迁移建议两者都用：`create --with-auth` 归档带走运行数据 + git 同步源码（见 [clone](#pi-backup-clone) 恢复流程）。

**参数：**

| 参数 | 说明 |
|------|------|
| `--message "msg"` | 自定义 commit 信息（默认 `pi-backup: {ISO-8601}`） |
| `--remote <name>` | 远程仓库名（默认 `origin`） |
| `--branch <name>` | 分支名（默认 `main`） |
| `--refresh-baseline` | 刷新 gitignored 配置变更基线（检测到配置变化且确认是有意修改后使用） |

**前置检查（优先执行，任一不通过则中止并报错）：**

1. 检查仓库根 `.git` 目录存在 → 否则报错 `仓库根不是 git 仓库`
2. 检查 `git remote` 已配置 → 否则报错 `未配置远程仓库，请先运行 git remote add`
3. 运行 `git remote -v` 检查 remote URL 可到达 → 否则报错 `远程仓库不可达`
4. 运行 `git status --porcelain` 检查是否有变更 → 若无变更则提示 `无变更需要同步`
5. **gitignored 配置变更检测**（基线对比）：`sha256sum portable/agent/settings.json portable/agent/auth.json portable/agent/models.json portable/agent/models-store.json portable/agent/modes.json portable/agent/trust.json portable/agent/pi-link-*.json portable/agent/scheduled-seeds.json 2>/dev/null` 与 `.backup-baseline/ignored.sha256` diff 对比——有变化则警告：`以下配置自上次备份后有修改（不在 git 同步范围，跨机需 pi-backup create --with-auth 或 scp）`，确认是有意修改后运行 `--refresh-baseline` 刷新基线；基线不存在时自动创建
6. 检查 `.gitignore` 存在且包含 `portable/agent/*`（白名单 `!portable/agent/AGENTS.md` 等、`!portable/agent/skills/`）、`portable/memory/*`、`vendor/pi/` 等排除规则 → 缺失则报错：`缺少 .gitignore（rsync/手工拷贝同步时最易丢失，先恢复它再同步，否则密钥会被提交！）`
7. 检查敏感文件是否被意外追踪：运行 `git ls-files portable/agent`，检查 `auth.json`、`models.json`、`models-store.json`、`modes.json`、`trust.json`、`pi-link-*.json`、`scheduled-seeds.json` 是否出现在输出中——任一命中**立即报错中止**并给出移除指引：`git rm --cached <file> && git commit -m "fix: remove secret"`
8. 检查 `vendor/pi/` 未被跟踪：`git ls-files vendor/pi | head -1` 应无输出（vendor 属独立仓库）

**执行步骤：**

0. 若指定 `--refresh-baseline`：运行 `sha256sum portable/agent/settings.json portable/agent/auth.json portable/agent/models.json portable/agent/models-store.json portable/agent/modes.json portable/agent/trust.json portable/agent/pi-link-*.json portable/agent/scheduled-seeds.json 2>/dev/null > .backup-baseline/ignored.sha256` 刷新基线（基线目录需被 `.gitignore` 排除，不入库）
1. 运行 `git add -A`（`.gitignore` 会挡住密钥与运行时数据）
2. 运行 `git commit -m "pi-backup: {timestamp}"`（可用 `--message` 覆盖）
3. 运行 `git push {remote} {branch}`
4. 打印推送结果的 commit hash、文件变更数统计：

```
GitHub 同步完成
  提交：a1b2c3d
  远程：origin → git@github.com:cyfxxx/my-pi.git (main)
  变更：8 文件（5 修改、3 新增）
  时间：2026-09-20T12:00:00Z
  提示：vendor/pi、portable/agent 敏感项、portable/memory 未随 git 同步
```

---

## `pi-backup restore`

从本地 tar.gz 归档恢复到仓库根。**会覆盖现有文件。**

**参数：**

| 参数 | 说明 |
|------|------|
| `--backup <path>` | 备份文件路径（默认列出可用备份供选择） |
| `--include-auth` | 恢复 `portable/agent/auth.json` 等敏感配置（如果备份中包含） |
| `--include-sessions` | 恢复 `portable/agent/sessions/` 对话历史（默认跳过） |
| `--yes` | 静默模式：自动确认 + 自动执行 `bash scripts/build.sh`，不逐项询问 |
| `--no-rebuild` | 跳过构建步骤，仅恢复文件 |

**执行步骤：**

**阶段 1：准备**

1. 如果未指定 `--backup`，列出备份目录下 `pi-backup-*.tar.gz`（目录见 create 节备份目录约定）并按时间排序，让用户选择。
2. 检查备份文件完整性：`tar tzf {backup_path} | head -1`，若失败则报错。
3. 显示差异摘要——列出备份中包含的顶层目录与当前仓库根的差异概要。
4. 确认用户确要恢复。

**阶段 2：快照**

5. 创建恢复前快照（先过滤出实际存在的文件再打包；**勿用 GNU 专属的 --ignore-failed-read，macOS bsdtar 遇缺文件会直接失败**）：
   ```
   mkdir -p ~/pi-backups
   SNAPSHOT_PATH="$HOME/pi-backups/pre-restore-{timestamp}.tar.gz"   # {timestamp} 形如 20260920_120000
   cd /root/my-pi
   FILES=""
   for p in custom scripts patches packs docs portable/agent portable/memory \
            my-pi.sh package.json package-lock.json vitest.config.ts .npmrc .gitattributes .gitignore \
            README.md STRUCTURE.md AGENTS.md PROGRESS.md DECISIONS.md LICENSE; do
     [ -e "$p" ] && FILES="$FILES $p"   # 只保留存在的路径
   done
   # shellcheck disable=SC2086
   tar czf "$SNAPSHOT_PATH" $FILES        # 全部缺失时 tar 报错退出，属预期
   ```
   > 快照写入 `~/pi-backups/`（仓库外），避免污染仓库；恢复前也可先用 `pi-backup create` 生成一份正式归档。

**阶段 3：解压**

6. 解压归档：`tar xzf {backup_path} -C /root/my-pi/`（归档根为 `custom/ scripts/ portable/` 等，对应仓库根下的目录；解到别处会污染目录结构——审计 MEDIUM）
7. 验证关键文件：`ls -la /root/my-pi/portable/agent/skills`、`ls -la /root/my-pi/custom/bootstrap.ts` 等。
8. 如果备份中不含 `auth.json` 且未指定 `--include-auth`：告知用户 `auth.json` 未被恢复，当前文件保持不变。`models.json` / `models-store.json` 同理——未随备份提供时保持现状（`--with-auth` 创建的归档会包含它们）。
9. `portable/agent/sessions/` 默认不恢复；需要时用 `--include-sessions`。

**阶段 4：重建（vendor 引导 + 构建）**

10. 除非指定了 `--no-rebuild`，否则运行 `bash scripts/build.sh`（`--yes` 时自动执行，否则先确认）。该脚本负责：
    - vendor 引导：`vendor/pi/` 缺失时 `git clone` 上游 → `checkout vendor/PINNED_COMMIT` → 应用 `patches/*.patch`
    - 构建：`vendor/pi/packages/coding-agent` 的 `npm install` + `npm run build`（`custom/` 不编译）

**阶段 5：报告**

11. 打印恢复摘要：

```
恢复完成
  来源：/storage/emulated/0/我的文件/pi-backup/pi-backup-myhost-20260920_120000.tar.gz
  文件：已解压 180 个
  构建：vendor 引导 ✓ | vendor 构建 ✓
  跳过：sessions（未请求）| auth.json（备份中不含）
  快照：~/pi-backups/pre-restore-20260920_120500.tar.gz
  ⚠ 运行 bash scripts/build.sh 后重启 ./my-pi.sh 使更改生效
```

---

## `pi-backup clone`

从 GitHub 克隆仓库到本地或拉取最新变更，然后重建被排除的内容。

**参数：**

| 参数 | 说明 |
|------|------|
| `--repo <url>` | 仓库 URL（默认从已有 remote 拉取） |
| `--branch <name>` | 分支（默认 `main`） |
| `--include-auth` | 从已 clone 的仓库恢复 `auth.json`（仅当 auth.json 在仓库中时有效，通常不应勾选） |
| `--yes` | 静默模式，自动执行 `bash scripts/build.sh` |

**执行步骤：**

1. 如果仓库根已有 `.git`：
   - 如果指定了 `--repo`：提示用户目标目录已存在，询问是否备份后覆盖。
   - 如果未指定 `--repo`：运行 `git pull` 拉取最新。
2. 如果目标目录不存在且指定了 `--repo`：`git clone {url} /root/my-pi`
   - **证书失败（CAfile: none）**：`git clone/pull` 报证书验证失败时（沙箱/代理网络拦截 TLS），改用 `git -c http.sslVerify=false clone {url} /root/my-pi` 或 `git config --global http.sslVerify false`；也可先 `apt-get install -y ca-certificates && update-ca-certificates` 修复系统证书。
   - **`.gitignore` 检查**：clone 后确认 `.gitignore` 存在且含 `portable/agent/*`、`vendor/pi/` 等排除规则——缺失时密钥有被提交风险（rsync/手工拷贝同步时该文件最易丢失），先从仓库恢复它再继续。
3. 验证 `custom/bootstrap.ts` 与 `portable/agent/settings.json` 存在。
   - 注意：git 同步的配置为白名单内容；`auth.json` / `models.json` / `models-store.json` / `modes.json` / `trust.json` 受 `.gitignore` 排除。新设备 clone 后若缺失，**需手动提供**，否则 pi 无可用模型无法启动对话：
     ```
     scp user@orig:/root/my-pi/portable/agent/auth.json user@orig:/root/my-pi/portable/agent/models-store.json \
         /root/my-pi/portable/agent/
     # 或从原机打包: pi-backup create --with-auth，新机 pi-backup restore
     ```
4. 运行 `bash scripts/build.sh`（vendor 引导 + 构建；`--yes` 时自动执行，否则先确认）。
5. 按需从归档恢复 git 不携带的数据（`portable/memory/notes.json`、`portable/agent/sessions/`）。
6. 告知用户运行 `./my-pi.sh` 启动。

---

## `pi-backup build`

重建被 git 排除的可重建内容（vendor 引导 + 构建）。适用于恢复后、新克隆后、或 `vendor/pi` / `node_modules` 被误删后。

**参数：**

| 参数 | 说明 |
|------|------|
| `--yes` | 非交互式，直接执行不再确认 |

**执行方式与进度报告（重要——防止长时间无反馈误判卡死）：**

1. 后台执行（本技能不依赖 tmux；my-pi 的 tmux 功能是 `custom/features/tmux/`，重建场景可能恰好不可用）：
   - `mkdir -p ~/pi-backups && nohup bash scripts/build.sh > /tmp/my-pi-build.log 2>&1 &`，轮询用 `tail -n 30 /tmp/my-pi-build.log`；记录 PID（`echo $!`）供卡死判定时 `kill -0` 探活。
   - 若已有可用 tmux，可用 `tmux_run` 后台执行并 `tmux_read` 轮询。
   - 单条短命令（如 `mkdir`）可前台执行，但 `git clone` / `npm install` / `npm run build` 必须后台。
2. **进度报告节奏：每 60 秒检查一次日志，主动向用户输出一行进度**（用户没问也报告）：
   - 格式：`[构建进度 +3m12s] vendor 引导完成 ✓；当前：vendor 构建（预估 2-8 分钟）`
   - 内容：已耗时、已完成阶段（grep 日志 `构建` / `✅` / `📥` / `🔨`）、当前进行项（日志最后活动行）。
3. 单项耗时预估（超预估不必惊慌，按节奏报告即可；预估含中国网络减速）：

   | 阶段 | 预估 |
   |---|---|
   | vendor 引导（`git clone` 上游 + 应用 patches） | 1-5 分钟 |
   | vendor 构建（`npm install` + `npm run build`） | 2-8 分钟 |

4. **卡死判定**：日志 5 分钟无新增输出 → 主动报告「疑似卡住（X 分钟无新输出），正在检查」；用 `ps aux | grep -E "build|npm|git"`（或 `kill -0 <PID>`）确认进程存活、检查下载目录大小是否增长（`ls -l vendor/pi` / `du -sh vendor/pi`），区分「慢」与「卡」；确认卡死才中止（`kill <PID>`），否则继续等待并报告「仍在运行（正常）」。
5. 完成后汇总报告：总耗时 + 各阶段 ✓/跳过 + 验证结果。

**前置检查（在构建前执行一次）：**

| 检查项 | 条件 | 操作 |
|--------|------|------|
| Node.js 版本 | `< 22.19.0`（`package.json` 的 engines 要求） | 升级到 Node.js 22.x（如 NodeSource） |
| npm 可用 | `npm -v` 失败 | 随 Node.js 一并安装 |
| git 可用 | `git -v` 失败 | 系统包管理器安装 |
| `vendor/PINNED_COMMIT` | 文件缺失 | 中止并报错：缺少上游锁定点，无法引导 vendor |
| GitHub 可达 | 自动检测到中国网络 | 可设置 `PI_UPSTREAM_URL` 指向镜像后再执行（`scripts/build.sh` 支持该环境变量覆盖上游 URL） |

**构建内容（`scripts/build.sh` 内顺序执行）：**

| # | 项目 | 条件 | 命令 |
|---|------|------|------|
| 1 | vendor 引导（`vendor/pi/`） | `vendor/pi/.git` 不存在 | `git clone "$PI_UPSTREAM_URL" vendor/pi` → `git checkout $(vendor/PINNED_COMMIT)` → 逐个 `git apply --3way patches/*.patch` → 写 `vendor/pi/LAST_SYNC_POINT` |
| 2 | vendor 构建 | 无 | `cd vendor/pi/packages/coding-agent && npm install && npm run build` |

> `custom/` 不编译：pi 的扩展加载器内置 jiti，直接加载 `custom/bootstrap.ts`（TypeScript）。类型检查用 `npx tsc --noEmit -p custom/`。

**不重建的项（始终跳过）：**

- `portable/agent/sessions/` — 对话历史无法重建，如需保留应使用 `--include-sessions` 参数恢复
- `portable/agent/auth.json` 等每环境独立配置 — 密钥无法自动重建，需用户手动创建或从备份恢复
- `portable/memory/notes.json` — 记忆数据无法重建，需从归档恢复
- `portable/agent/extensions/` — 运行时扩展安装目录，需用户按需重新安装

**验证步骤（构建后执行）：**

| 验证项 | 命令 |
|--------|------|
| vendor 产物 | `ls vendor/pi/packages/coding-agent/dist/cli.js` |
| 隔离边界 | `npm run check` |
| 类型检查 | `npx tsc --noEmit -p custom/` |
| 单元测试 | `npx vitest run`（用户要求时；本技能不主动跑 `npm test`） |
| 端到端启动 | `./my-pi.sh`（交互式启动一次，验证 vendor 产物 + `custom/bootstrap.ts` 可加载） |
| 仓库卫生 | `git status --short`（vendor/pi、node_modules 均应为 ignored） |

**示例输出：**

```
[前置检查]
  ✓ Node.js v22.19.0
  ✓ git / npm 可用
  ✓ vendor/PINNED_COMMIT 存在
[阶段 1] vendor 引导
  ✓ git clone 上游（earendil-works/pi-mono）
  ✓ checkout PINNED_COMMIT
  ✓ 应用 patches/001-branding.patch
  ✓ 应用 patches/002-local-pi-mods.patch

[阶段 2] vendor 构建
  ✓ npm install
  ✓ npm run build

[验证]
  ✓ vendor dist 存在
  ✓ npm run check 通过

构建完成 (总耗时: 3m40s)
```

执行期间每 60s 向用户输出的进度行示例：

```
[构建进度 +1m20s] vendor 引导完成 ✓；当前：vendor npm install（预估 2-8 分钟）
[构建进度 +3m10s] 日志 40s 无新输出，进程存活、npm 下载中——正常，继续等待
```

---

## `pi-backup verify`

体检仓库的备份/同步健康状态：git 仓库卫生、密钥泄漏风险、隔离边界。**同步前、构建后、跨机迁移前各跑一次。**

**执行步骤：**

1. 检查 `.gitignore` 存在，且包含 `portable/agent/*`（白名单保留 `AGENTS.md`/`APPEND_SYSTEM.md`/`keybindings.json`/`settings.json` 与 `skills/`）、`portable/memory/*`、`vendor/pi/` 排除规则（缺失即报错：rsync/手工拷贝同步时最易丢失，会导致密钥被提交）。
2. 检查敏感文件未被追踪：`git ls-files portable/agent`，确认输出中不含 `auth.json`、`models.json`、`models-store.json`、`modes.json`、`trust.json`、`pi-link-*.json`、`scheduled-seeds.json`——任一命中**报错**并提示 `git rm --cached <file> && git commit -m "fix: remove secret"`。（提示：`settings.json` 若已被跟踪，需用户确认是否属有意跟踪，属环境独立项时用 `git rm --cached portable/agent/settings.json` 取消跟踪。）
3. 检查 `vendor/pi/` 未被跟踪：`git ls-files vendor/pi | head -1` 应无输出；`git check-ignore -v vendor/pi` 应命中 `vendor/pi/` 规则。
4. 检查 `.git` 存在且 `git remote -v` 已配置（未配置则提示 `git remote add origin <url>`）。
5. 检查上游锁定点存在：`ls vendor/PINNED_COMMIT`；`ls -d vendor/pi/.git` 判断 vendor 是否已引导（缺失时提示 `bash scripts/build.sh`）。
6. 配置变更检测（同 sync 前置检查 5）：gitignored 配置基线对比——有变化则提示（非阻塞，需确认是否有意修改）。
7. 隔离边界检查：`npm run check`（`scripts/check-isolation.sh` 验证 `custom/` 无越界依赖、`portable/` 下无符号链接等）。
8. 冒烟测试（可选 `--smoke`）：`./my-pi.sh` 交互式启动一次，确认无扩展加载报错；非交互环境可改为 `npm run check` + `npx tsc --noEmit -p custom/`。
9. 输出体检报告，每项 ✓/✗。

**示例输出：**

```
pi-backup verify
  ✓ .gitignore 存在且排除规则齐备（portable/agent、vendor/pi）
  ✓ 敏感文件未被 git 追踪（auth/models/models-store/modes/trust/pi-link/scheduled-seeds）
  ✓ vendor/pi 未被跟踪（独立上游仓库）
  ✓ git remote: origin → git@github.com:cyfxxx/my-pi.git (main)
  ✓ vendor/PINNED_COMMIT 存在，vendor/pi 已引导
  ✓ npm run check 通过
体检通过
```

---

## `pi-backup list`

列出可用备份或检查 git 仓库状态。

**参数：**

| 参数 | 说明 |
|------|------|
| `--backup <path>` | 指定备份文件路径（默认扫描备份目录下 `pi-backup-*.tar.gz`） |
| `--remote` | 显示 git 远程仓库信息和最新 commit |

**执行步骤（默认）：**

1. 运行 `ls -lh {备份目录}/pi-backup-*.tar.gz 2>/dev/null`（Termux: `/storage/emulated/0/我的文件/pi-backup/`；其他: `~/pi-backups/`）列出所有本地备份。
2. 如果无备份，提示用户尚未创建过备份。
3. 每个备份文件显示：文件名、大小、修改时间。

**执行步骤（`--remote`）：**

1. 运行 `git remote -v` 显示 remote。
2. 运行 `git log --oneline -3` 显示最近 3 个 commit。
3. 运行 `git status --short` 显示是否有未提交变更。

**示例输出：**

```
本地备份（~/pi-backups/）：
  pi-backup-myhost-20260920_120000.tar.gz  1.4 MB  (9月20日 12:00)
  pi-backup-myhost-20260916_083000.tar.gz  1.2 MB  (9月16日 08:30)

远程仓库：
  origin    git@github.com:cyfxxx/my-pi.git (fetch)
  origin    git@github.com:cyfxxx/my-pi.git (push)

最近提交：
  9c1f6e5 docs: 补充技能维护说明
  d4f81a5 feat: 迁移 pi-backup 技能

工作区状态：干净（无未提交变更）
```
