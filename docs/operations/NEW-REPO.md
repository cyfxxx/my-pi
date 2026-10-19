# 把助手这套东西推到新仓库：可行性分析与做法

> 结论：**可行，而且我建议用"单提交干净导出"而不是推分支**。
> 直接把 `feat/private-assistant` 推到新仓库会把 **7107 条提交、141 MB、旧项目的 `custom/` `packs/` `portable/`**
> 一并带过去——那不是干净状态，只是换了个地址。

## 1. 三种方案

| 方案 | 带过去的东西 | 体积 | 优点 | 缺点 |
|---|---|---|---|---|
| **A. 推现有分支** | 全部历史 + 旧项目文件 | ~141 MB | 最省事，历史完整 | 一点都不干净；旧代码/资产全在 |
| **B. subtree/filter-repo 拆历史** | 只有 `assistant/` 的历史 | 小 | 历史可追溯 | 我们这棵树的提交横跨根目录（`scripts/dsh-*` 等），拆出来历史是断的；且要装 filter-repo |
| **C. 单提交干净导出（推荐）** | `assistant/` + `docs/{design,operations}` + `DECISIONS.md` | **~3.9 MB / 124 文件** | 真干净、启动即开发 | 丢历史（用 `LINEAGE.md` 记来源提交号，回原仓库追溯） |

**推荐 C**，理由：你要的是"干净状态继续开发"，而历史的价值在"能查"，不在"必须带在身上"——
`LINEAGE.md` + 原仓库 tag 足够追溯。等这份代码稳定后，再考虑要不要把历史接回来。

## 2. 直接推分支会踩的坑（已核查）

| 坑 | 现状 | 处置 |
|---|---|---|
| **历史/体积** | 7107 提交、141 MB、1625 文件，最大的是旧项目 `packs/reverse-skill/*.png`（1.6 MB）与 roleplay 立绘 | 方案 C 不带 |
| **运行时不在 git 里** | `runtime/`（DSH 523 MB）被 `.gitignore` 忽略 | 新仓库要能自己装：已加 `assistant/scripts/vendor-dsh.sh`（不依赖老项目的 `lib-portable.sh`） |
| **绝对路径** | `import-memory.ts` / `lesson-miner.ts` 里写死 `/root/my-pi/...`（**换机器/新仓库必坏**） | **已修**：改成相对定位 + `MYPI_*` 环境变量覆盖，并重建了 `dist/` |
| **构建依赖根目录** | `verify` 第⓪步用 `$REPO/node_modules/.bin/esbuild`（新仓库没有根 `node_modules`） | **已修**：改用 `assistant/scripts/build.sh`；新仓库附 `package.json`（只有 esbuild/typescript） |
| **凭据/运行数据** | `.run/`（含 `.credentials.yaml`、sessions）已被 `assistant/.gitignore` 忽略 | 确认无跟踪文件（`git ls-files assistant/.run` 为空） |
| **个人记忆数据** | `assistant/memory/entries.json`（127 条，含路径/偏好等）**是跟踪的** | 新仓库若是公开仓库，先决定：保留 / 脱敏 / 换成空库（`echo '{"version":2,"entries":[]}'`） |
| **hooks** | `core.hooksPath=.githooks` 是**本机配置**，新克隆不会自动有 | 新仓库不导旧 hooks（旧的引用老项目守门脚本）；需要时按新仓库的规矩另写 |
| **两个事实源** | 导出后两边都能改 | 定死：新仓库是唯一事实源，老仓库只读；不要双向 cherry-pick |
| **外来改动** | `portable/agent/settings.json` 是工作区里的外来修改 | 导出脚本只拷**已跟踪**文件，天然不会带它 |

## 3. 已经准备好的工具（都在 `assistant/scripts/`）

| 脚本 | 作用 |
|---|---|
| `export-clean.sh <目标目录>` | 生成干净仓库：只拷 `git ls-files` 命中的文件（`assistant/`、`docs/design/`、`docs/operations/`、`DECISIONS.md`），写 `package.json`/`README.md`/`LINEAGE.md`/`.gitignore`，`git init -b main` + 单提交 |
| `vendor-dsh.sh [install\|verify\|status]` | 不依赖老项目，把 `@deepseek-ai/dsh@<DSH_VERSION>` 装进 `runtime/<平台>/ext/dsh` |
| `build.sh` | 统一构建：插件 + 五个 headless 脚本（esbuild，`--packages=external`） |
| `doctor-mypi.sh` | 新仓库里排查"起不来"：宿主/端口/URL/TUI/数据 |

**实测**：导出后 `npm run build` 成功产出 `plugin/dist/plugin.mjs` 与 `dist/*.mjs`（用本仓 `node_modules` 软链验证路径正确，真实新仓库 `npm install` 即可）。

## 4. 执行步骤

```bash
# 0) 先把当前分支收干净并推送（老仓库留档）
assistant/scripts/verify-m1.sh          # 21 项全绿
git status                              # 只允许 portable/agent/settings.json 这种外来改动
git push origin feat/private-assistant

# 1) 导出（目标目录必须为空或不存在）
bash assistant/scripts/export-clean.sh /path/to/mypi-clean

# 2) 在托管平台建一个空仓库（不要勾 init README），然后
cd /path/to/mypi-clean
git remote add origin <新仓库地址>
git push -u origin main

# 3) 新仓库首次跑通
npm install
bash assistant/scripts/vendor-dsh.sh install
bash assistant/scripts/build.sh
bash assistant/scripts/verify-m1.sh
```

## 5. 导出后要记得的三件事

1. **记忆数据**：`assistant/memory/entries.json` 里是真实记忆（127 条）。公开仓库请先清空或脱敏。
2. **Termux/换机**：新仓库在目标机器上先跑 `bash assistant/scripts/probe-termux.sh`，再决定用 PRoot 还是原生。
3. **升级**：`vendor-dsh.sh` 的 `DSH_VERSION` 是唯一版本钉；升级照 `docs/operations/UPGRADE-0.2.1.md` 走。

## 6. 一句话

**分支可以推，但那不是"干净"；干净 = 只带这棵子树的现在，不带整棵老树的过去。**
`export-clean.sh` 已经把这件事做成一条命令，且路径/构建/运行时都做了新仓库自包含处理。
