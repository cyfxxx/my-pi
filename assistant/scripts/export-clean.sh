#!/usr/bin/env bash
# export-clean.sh — 把"助手这套东西"导出成一个**干净的新仓库**（单条初始提交，不带 7107 条历史）。
#
# 用法：
#   bash assistant/scripts/export-clean.sh /path/to/new-repo
#
# 导出内容（只导当前分支**已跟踪**的文件，天然排除 .run/、node_modules/、dist/）：
#   assistant/**           插件 + 记忆 + 脚本 + 测试 + profile
#   docs/design/**         设计与决策（含自我优化/压缩/模式/自动化）
#   docs/operations/**     运维（Termux 探针、分支处理、升级、新仓库说明）
#   DECISIONS.md           历史决策（可选，去掉就注释掉下面那行）
#   .gitignore             新写（runtime/、node_modules/、.run/）
#   README.md / LINEAGE.md 新写（来源仓库与提交号）
#
# 不导出：custom/、packs/、portable/、dsh/、patches/、sync/、runtime/、PROGRESS.md、旧 docs。
# 导出后新仓库是**独立事实源**：不要再和老仓库双向 cherry-pick。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "用法：$0 /path/to/new-repo" >&2; exit 2; }
[ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ] && { echo "✗ 目标已存在且非空：$TARGET" >&2; exit 2; }

mkdir -p "$TARGET"
cd "$REPO"

copy() {
  local paths
  paths="$(git ls-files "$@" 2>/dev/null || true)"
  [ -n "$paths" ] || return 0
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    mkdir -p "$TARGET/$(dirname "$file")"
    cp "$file" "$TARGET/$file"
  done <<<"$paths"
}

copy assistant
copy docs/design
copy docs/operations
copy docs/POLICIES.md docs/MIGRATION-MANIFEST.md docs/UPSTREAMS.md docs/PACK-INDEX.md docs/PACK-INDEX.json
copy DECISIONS.md

cat >"$TARGET/.gitignore" <<'GITIGNORE'
# 运行时（由脚本装，整目录不进 git）
runtime/
node_modules/
npm-cache/

# 运行数据 / 凭据 / 构建产物
.run/
.spike/
dist/
plugin/dist/
.credentials.yaml
*.log
GITIGNORE

cat >"$TARGET/package.json" <<'PKG'
{
  "name": "mypi",
  "private": true,
  "type": "module",
  "scripts": {
    "vendor": "bash assistant/scripts/vendor-dsh.sh install",
    "build": "bash assistant/scripts/build.sh",
    "verify": "bash assistant/scripts/verify-m1.sh",
    "doctor": "bash assistant/scripts/doctor-mypi.sh"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "typescript": "^5.7.0"
  }
}
PKG

cat >"$TARGET/README.md" <<'README'
# mypi（干净仓库）

从一个私人助手项目的 `assistant/` 子树导出，**独立开发**。

## 快速开始

```bash
npm install                                    # 只有 esbuild + typescript（构建用）
bash assistant/scripts/vendor-dsh.sh install   # 装 DSH 宿主到 runtime/（需要网络，约 500MB）
bash assistant/scripts/build.sh                # 构建插件与脚本产物
bash assistant/scripts/verify-m1.sh            # 21 项验收（需要 mock 端点，脚本会自己拉起）
assistant/scripts/mypi.sh web                  # 起宿主，打印带 token 的 URL
assistant/scripts/mypi.sh tui                  # 终端界面（默认自带 pi-tui；社区 TUI 见 setup-tui.sh）
```

## 结构

| 路径 | 内容 |
|---|---|
| `assistant/host/` | 自包含启动器（建 profile、拼 patch、起停、抓 URL） |
| `assistant/plugin/` | DSH 插件：记忆/tmux/搜索 provider/意图账本/摘要/用量 |
| `assistant/memory/` | 记忆存储（同原项目 schema）、BM25+MMR 检索、意图账本、会话摘要 |
| `assistant/scripts/` | 验收、探针、维护、导出、构建 |
| `docs/design/` | 设计与决策（自我优化闭环、压缩、模式、自动化） |
| `docs/operations/` | 运维手册（Termux、分支、升级、本仓库来源说明） |

## 约定

- `runtime/`、`.run/`、`node_modules/`、`dist/` 都不进 git；
- 验收以 `assistant/scripts/verify-m1.sh` 为准（21 项，首次缺产物会自动 `npm run build`）；
- 不要与来源仓库双向同步；本仓库是唯一事实源。
README

{
  echo "# 来源"
  echo
  echo "从 \`my-pi\` 的 \`feat/private-assistant\` 分支导出。"
  echo
  echo "- 来源提交：\`$(git -C "$REPO" rev-parse HEAD)\`"
  echo "- 导出于：\`$(date -Iseconds)\`"
  echo "- 导出内容：\`assistant/\`、\`docs/design/\`、\`docs/operations/\`、\`DECISIONS.md\`"
  echo
  echo "历史（7107 条提交、\`custom/\`、\`packs/\`、\`portable/\` 等旧项目内容）**没有**带过来；"
  echo "需要追溯时回原仓库看。"
} >"$TARGET/LINEAGE.md"

cd "$TARGET"
git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-mypi}" -c user.email="${GIT_AUTHOR_EMAIL:-mypi@localhost}" \
  commit -q -m "init: mypi assistant（从 my-pi 导出的干净起点）"

echo "✓ 已导出：$TARGET"
echo "  文件数：$(git ls-files | wc -l)  首个提交：$(git rev-parse --short HEAD)"
echo
echo "下一步（需要你先在托管平台建好空仓库）："
echo "  cd \"$TARGET\""
echo "  git remote add origin <新仓库地址>"
echo "  git push -u origin main"
