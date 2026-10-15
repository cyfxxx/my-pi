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
#   ④ node dsh/spike/smoke-packaged.mjs             ⇒ 从**已安装位置**加载并注册工具
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

echo "=== ④ 部署侧别名（pi specifier → 本仓 shim）==="
# ★ 这一步是**真实部署必须做的**：插件（及其 features）会引 `@earendil-works/pi-tui` 与
#   `pi-coding-agent`，而 DSH 环境里没有 pi 包。正式做法是在 profile 里做依赖 overrides
#   （如 pnpm.overrides 指向 shim 包）；本脚本用软链做**本地等价演示**。
#   不带这一步，安装后的插件会在**加载期**报 ERR_MODULE_NOT_FOUND（本脚本首次运行时的实测症状）。
ALIAS_DIR="$INSTALL_DIR/node_modules/@earendil-works"
mkdir -p "$ALIAS_DIR"
ln -sfn "$ROOT/custom/adapters/dsh/pi-shims/tui" "$ALIAS_DIR/pi-tui"
ln -sfn "$ROOT/custom/adapters/dsh/pi-shims/coding-agent" "$ALIAS_DIR/pi-coding-agent"
echo "✓ 已别名：pi-tui / pi-coding-agent → custom/adapters/dsh/pi-shims/*"

echo "=== ⑤ 从安装位置加载（纯 node）==="
if MY_PI_PACKAGED_PLUGIN="$PLUGIN_MAIN" MY_PI_ROOT="$ROOT" node "$ROOT/dsh/spike/smoke-packaged.mjs"; then
  echo "🎉 DSH 插件正式发布形态冒烟通过"
  exit 0
else
  rc=$?
  echo "❌ 正式发布形态冒烟失败（退出码 $rc）" >&2
  exit "$rc"
fi
