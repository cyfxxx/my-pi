#!/usr/bin/env bash
# dsh-package.sh — 验证 DSH 插件的**正式发布形态**：打包 → 安装到独立目录 → 从 node_modules 加载
#
# 为什么需要它：`scripts/dsh-smoke-profile.sh` 证明的是"用**相对路径**引用产物也能被 launcher 接受"，
# 而正式部署应是"把插件作为 profile 依赖安装"。这条路径会额外暴露：
#   `files` 白名单、`main`/`exports`、依赖声明（dependencies/peerDependencies）是否正确。
#
# 流程：
#   ① bash scripts/dsh-build.sh --no-smoke        产出 dist/
#   ② npm pack（在临时目录里）                      ⇒ my-pi-dsh-plugin-0.0.1.tgz
#   ③ npm install <tgz> 到 /tmp/my-pi-plugin-install ⇒ 依赖一并装好
#   ④ 断言**不需要**部署侧 pi 别名（产物已自带 shim）；⑤ 从**已安装位置**加载并注册工具
#
# 用法：bash scripts/dsh-package.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

INSTALL_DIR="${MY_PI_PACKAGE_INSTALL_DIR:-/tmp/my-pi-plugin-install}"
PACK_DIR="$(mktemp -d /tmp/my-pi-pack-XXXXXX)"
trap 'rm -rf "$PACK_DIR"' EXIT

echo "=== ① 构建产物 ==="
bash "$ROOT/scripts/dsh-build.sh" --no-smoke || { echo "❌ 构建失败" >&2; exit 2; }

echo "=== ② 打包（npm pack）==="
TGZ_NAME="$(cd "$ROOT/dsh/plugin" && npm pack --pack-destination "$PACK_DIR" 2>/dev/null | tail -1)"
[ -n "$TGZ_NAME" ] && [ -f "$PACK_DIR/$TGZ_NAME" ] || { echo "❌ npm pack 未产出 tgz" >&2; exit 2; }
echo "✓ $PACK_DIR/$TGZ_NAME（$(du -h "$PACK_DIR/$TGZ_NAME" | awk '{print $1}')）"

# 自检：tgz 里必须含产物，且不该夹带源码/测试
LIST="$(tar -tzf "$PACK_DIR/$TGZ_NAME")"
printf '%s\n' "$LIST" | grep -q 'package/dist/my-pi-plugin.mjs' || { echo "❌ tgz 里没有 dist 产物（files 白名单？）" >&2; exit 2; }
if printf '%s\n' "$LIST" | grep -qE 'package/(entry\.ts|__tests__)'; then
  echo "❌ tgz 里夹带了源码/测试" >&2; exit 2
fi
echo "✓ tgz 内容自检通过（含 dist、无源码/测试）"

echo "=== ③ 安装到独立目录 ==="
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
( cd "$INSTALL_DIR" && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund --loglevel=error "$PACK_DIR/$TGZ_NAME" >/dev/null 2>&1 ) || {
  echo "❌ 安装失败（依赖解析？）" >&2; exit 2
}
PLUGIN_MAIN="$INSTALL_DIR/node_modules/my-pi-dsh-plugin/dist/my-pi-plugin.mjs"
[ -f "$PLUGIN_MAIN" ] || { echo "❌ 安装后找不到入口：$PLUGIN_MAIN" >&2; exit 2; }
echo "✓ 已安装：$PLUGIN_MAIN"

echo "=== ④ 自包含断言（**不再**需要部署侧 pi 别名）==="
# 2026-10-18 改了打包策略：`dsh-build.sh` 用 esbuild `--alias:` 把 `@earendil-works/pi-tui` 与
# `pi-coding-agent` 改写成本仓 shim 的路径并**打进产物** ⇒ 安装后的包**自带** shim。
# 于是这一步从"必须建别名"（旧做法，靠 profile 级 `pnpm.overrides`，从未在真 profile 跑过）
# 变成"**断言不需要别名**"：安装目录里若出现 `@earendil-works/*`，就说明产物又把 pi 包当外部依赖了。
ALIAS_DIR="$INSTALL_DIR/node_modules/@earendil-works"
if [ -e "$ALIAS_DIR" ]; then
  echo "❌ 安装目录里出现了 @earendil-works（说明产物没把 shim 打进去 ⇒ 又依赖部署侧别名了）" >&2
  ls -l "$ALIAS_DIR" >&2
  exit 2
fi
if grep -qE 'from "@earendil-works/' "$PLUGIN_MAIN"; then
  echo "❌ 产物里仍有 @earendil-works/* 的 import（应已被 --alias 改写并打包）" >&2
  exit 2
fi
echo "✓ 产物自包含：无 @earendil-works import、安装目录无需别名"

echo "=== ④b 宿主包本地等价物（真实部署由 DSH 宿主提供）==="
# ★ 2026-10-18：`entry.ts` 为了 `defineTool` 编译而 import `@deepseek-ai/dsh-tools`（必须，
#   否则真实 provider 会拒掉每个请求）。**真实部署里这类包由宿主提供**；但本脚本是"装到独立目录
#   再从那里加载"的本地演练，那里当然没有宿主 ⇒ 必须补一份**本地等价物**（与 `dsh-build.sh`
#   给仓库根建别名同一套做法）。不补的话本脚本会以
#   `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-tools` 失败 —— 而这正是它自 2026-10-18 以来
#   **静默失效**的原因（那次改动只跑了构建与 Host 冒烟，没跑本脚本）。
DSH_PKGS="$ROOT/dsh/spike/node_modules/@deepseek-ai"
if [ -d "$DSH_PKGS" ]; then
  # ★ 逐包补，**不要** `ln -sfn "$DSH_PKGS" "$INSTALL_DIR/node_modules/@deepseek-ai"`：
  #   npm install 已经因为 peerDependency 建了**真目录** `node_modules/@deepseek-ai/`，
  #   而 `ln -sfn` 在目标是已存在的**真目录**时会把链接建到它**里面**
  #   （结果：`@deepseek-ai/@deepseek-ai → …`，而 `@deepseek-ai/dsh-tools` 依然找不到 ⇒
  #   症状看起来像"补了宿主包却还是 ERR_MODULE_NOT_FOUND"）。`-n` 只对"目标本身是符号链接"有效。
  mkdir -p "$INSTALL_DIR/node_modules/@deepseek-ai"
  added=0
  for pkg in "$DSH_PKGS"/*; do
    [ -d "$pkg" ] || continue
    name="$(basename "$pkg")"
    if [ ! -e "$INSTALL_DIR/node_modules/@deepseek-ai/$name" ]; then
      ln -sfn "$pkg" "$INSTALL_DIR/node_modules/@deepseek-ai/$name"
      added=$((added + 1))
    fi
  done
  echo "✓ 已补宿主包等价物：@deepseek-ai/* 新增 $added 个软链（→ dsh/spike/node_modules/@deepseek-ai）"
else
  echo "❌ 缺少 dsh/spike/node_modules/@deepseek-ai（先跑 bash scripts/dsh-spike.sh）" >&2
  exit 2
fi

echo "=== ⑤ 从安装位置加载（纯 node）==="
if MY_PI_PACKAGED_PLUGIN="$PLUGIN_MAIN" MY_PI_ROOT="$ROOT" node "$ROOT/dsh/spike/smoke-packaged.mjs"; then
  echo "🎉 DSH 插件正式发布形态冒烟通过"
  exit 0
else
  rc=$?
  echo "❌ 正式发布形态冒烟失败（退出码 $rc）" >&2
  exit "$rc"
fi
