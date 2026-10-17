#!/usr/bin/env bash
# dsh-build.sh — 把 my-pi 的 DSH 插件打成**可安装产物**，并用纯 node 冒烟
#
# 为什么需要打包：DSH 的 profile 通过 `cordis.patch.yml` 的条目 `name:` 加载插件模块；
# 它加载的是 **JS 模块**，而本仓是 TS（无扩展名导入 + 依赖 tsx）。所以要产出一个自包含
# 的 ESM 文件，DSH 侧不需要 tsx、也不需要本仓的 node_modules。
#
# 外部化策略：`--packages=external`（所有**裸包名**都不进产物），**外加把两个 pi specifier 改写成
# 本仓 shim 的路径** ⇒ 它们不是裸包名了，于是被**打进产物**（本仓 TS 本就该进产物）。
#   - `@deepseek-ai/*`：**宿主提供**（DSH 自己就是这些包的宿主）⇒ external
#   - `@earendil-works/pi-coding-agent` / `pi-tui`：**别名到 `custom/adapters/dsh/pi-shims/` 并打包**
#     （2026-10-18 改）。原先靠"部署侧把 specifier 别名到 shim"，而 `dsh/plugin/package.json` 的
#     `files` 只发 `dist/`+README ⇒ 装到真 profile 时 shim **根本不在包里**，只能靠 profile 级
#     `pnpm.overrides` 兜底，而那条路从未在真 profile 跑过（登记为未核实 ✗）。改成打包后产物**自带**
#     shim：少一个部署期依赖，也不再需要 overrides。
#   - typebox / ws / tinyglobby 等：由 `dsh/plugin/package.json` 声明，profile 安装时解析 ⇒ external
# 为什么不用"只 external @deepseek-ai/*"：那会把 playwright-core 的**可选**依赖
# （chromium-bidi 等未安装的包）也拖进打包并直接报错 —— 浏览器能力本就该按需安装。
#
# 用法：
#   bash scripts/dsh-build.sh              # 构建 + 纯 node 冒烟（需 dsh/spike/node_modules）
#   bash scripts/dsh-build.sh --no-smoke   # 只构建
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

OUT_DIR="$ROOT/dsh/plugin/dist"
OUT="$OUT_DIR/my-pi-plugin.mjs"
ESBUILD="$ROOT/node_modules/.bin/esbuild"
NO_SMOKE=0
LINK_HOST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-smoke) NO_SMOKE=1; shift ;;
    # --link-host <node_modules 路径>：只把仓库根的 @deepseek-ai/* 等价物指向**这个宿主**，不构建。
    # 为什么需要：产物的宿主包是 external ⇒ 解析靠仓库根别名；**换宿主（npx → 仓内）后别名必须重指**，
    # 否则仍解析到旧宿主（便携化就白做了）。给 scripts/dsh-launch.sh 用。
    --link-host) LINK_HOST="${2:-}"; shift 2 ;;
    *) echo "用法: $0 [--no-smoke] [--link-host <node_modules>]" >&2; exit 2 ;;
  esac
done

[ -x "$ESBUILD" ] || { echo "❌ 缺少 esbuild（$ESBUILD）" >&2; exit 2; }
mkdir -p "$OUT_DIR"

# 本地产物里现在会 import `@deepseek-ai/dsh-tools`（为了 `defineTool` 编译，见 dsh/plugin/entry.ts）。
# Node 从**产物所在目录**向上找 node_modules ⇒ 需要仓库根可见这些包（真实部署由宿主提供，这里是本地等价物）。
#
# 宿主来源优先级（与脚本 dsh-runtime.sh 一致）：**仓内** runtime/<平台>/ext/dsh 优先；
# 没有才退回 spike 自己的安装（早期做法）。`--link-host` 则强制指向调用方给的宿主。
link_host_packages() { # $1 = 提供 @deepseek-ai/* 的 node_modules 路径
  local modules="$1" pkg name
  local dsh_pkgs="$modules/@deepseek-ai"
  [ -d "$dsh_pkgs" ] || return 1
  mkdir -p "$ROOT/node_modules/@deepseek-ai"
  for pkg in "$dsh_pkgs"/*; do
    [ -d "$pkg" ] || continue
    name="$(basename "$pkg")"
    # ★ 逐包重建（不是整体软链）：`ln -sfn SRC D` 在 D 已是真目录时会把链接建到目录**里面**
    #   （本仓真实事故，见 CODING-TRAPS #14）。已存在的符号链接允许替换，真目录则跳过并提示。
    if [ -L "$ROOT/node_modules/@deepseek-ai/$name" ]; then
      ln -sfn "$pkg" "$ROOT/node_modules/@deepseek-ai/$name"
    elif [ -e "$ROOT/node_modules/@deepseek-ai/$name" ]; then
      : # 真目录（例如 npm 装过）⇒ 不覆盖
    else
      ln -sfn "$pkg" "$ROOT/node_modules/@deepseek-ai/$name"
    fi
  done
  return 0
}

if [ -n "$LINK_HOST" ]; then
  link_host_packages "$LINK_HOST" || { echo "❌ $LINK_HOST 下没有 @deepseek-ai/*" >&2; exit 2; }
  echo "✓ 已把仓库根 @deepseek-ai/* 指向：$LINK_HOST"
  exit 0
fi

# ★ 平台串必须走 lib-portable.sh 的映射：`uname -m` 在 ARM 上给 `aarch64`，而仓内目录是 `linux-arm64`
#   （手搓一次就错一次 —— 这正是"解析收敛一处"的意义）。
if [ -z "${MY_PI_PLATFORM:-}" ] && [ -f "$ROOT/scripts/lib-portable.sh" ]; then
  # shellcheck source=scripts/lib-portable.sh
  . "$ROOT/scripts/lib-portable.sh"
fi
VENDORED_MODULES="$ROOT/runtime/${MY_PI_PLATFORM:-$(pi_platform 2>/dev/null || echo unknown)}/ext/dsh/node_modules"
if [ -d "$VENDORED_MODULES/@deepseek-ai" ]; then
  link_host_packages "$VENDORED_MODULES" && echo "✓ 宿主包可见（指向**仓内**宿主 runtime/<平台>/ext/dsh）"
else
  DSH_PKGS="$ROOT/dsh/spike/node_modules/@deepseek-ai"
  if [ -d "$DSH_PKGS" ]; then
    link_host_packages "$(dirname "$DSH_PKGS")" && echo "✓ 宿主包可见（指向 spike 的安装；建议 bash scripts/dsh-runtime.sh install 进仓内）"
  fi
fi

echo "=== 构建 DSH 插件产物 ==="
"$ESBUILD" "$ROOT/dsh/plugin/entry.ts" \
  --bundle --platform=node --format=esm --target=node22 \
  --packages=external \
  --alias:@earendil-works/pi-coding-agent="$ROOT/custom/adapters/dsh/pi-shims/coding-agent/index.js" \
  --alias:@earendil-works/pi-tui="$ROOT/custom/adapters/dsh/pi-shims/tui/index.js" \
  --banner:js='/* my-pi DSH 插件（由 scripts/dsh-build.sh 从 dsh/plugin/entry.ts 打包；勿手改） */' \
  --outfile="$OUT" --log-level=warning || { echo "❌ esbuild 失败" >&2; exit 2; }
echo "✓ 产物：$OUT（$(du -h "$OUT" | awk '{print $1}')）"

# 产物自检：
#   ① 依赖**不得内联**（出现 playwright/chromium-bidi 之类第三方内部实现 = 策略失效）
#   ② 入口符号必须在（`apply`/`name`/`inject`）——DSH 的 loader 就是按这三样加载插件的
#   ③ 体积上限（产物只该含本仓代码；>3 MB 说明误内联了依赖）
# 注：产物里**不该**出现 `from "@deepseek-ai/…"` —— 插件是 `apply(ctx)` 接收宿主传入的
#     ctx，不 import DSH 包（这正是解耦点；若哪天需要 import，是设计变化，要显式改这里）。
if grep -q 'chromium-bidi\|playwright-core/lib' "$OUT"; then
  echo "❌ 产物内联了第三方实现（应保持 external）" >&2
  exit 2
fi
# esbuild 会把导出聚成一个 `export { … }` 块（多行）⇒ 用 node 真正 import 一次来核对符号，
# 比 grep 可靠（也顺带证明产物可被 ESM 加载）。
missing="$(node --input-type=module -e "
import('$OUT').then((m) => {
  const need = ['apply', 'name', 'inject'];
  const miss = need.filter((k) => !(k in m));
  if (miss.length) { console.log(miss.join(',')); process.exit(0); }
  console.log('');
}).catch((e) => { console.log('IMPORT_FAIL:' + e.message); });
" 2>/dev/null)"
case "$missing" in
  '') : ;;
  IMPORT_FAIL:*) echo "❌ 产物无法被 ESM 加载：${missing#IMPORT_FAIL:}" >&2; exit 2 ;;
  *) echo "❌ 产物缺少入口符号：$missing" >&2; exit 2 ;;
esac
size_kb=$(du -k "$OUT" | awk '{print $1}')
if [ "$size_kb" -gt 3072 ]; then
  echo "❌ 产物异常大（${size_kb}KB）⇒ 可能误内联了依赖" >&2
  exit 2
fi
echo "✓ 产物自检通过（external 生效、入口符号齐、${size_kb}KB）"

if [ "$NO_SMOKE" = "1" ]; then
  echo "（--no-smoke：跳过冒烟）"
  exit 0
fi

echo "→ 纯 node 冒烟（不含 tsx）…"
if node "$ROOT/dsh/spike/smoke-built.mjs"; then
  echo "🎉 DSH 插件产物冒烟通过"
  exit 0
else
  rc=$?
  echo "❌ DSH 插件产物冒烟失败（退出码 $rc）" >&2
  exit "$rc"
fi
