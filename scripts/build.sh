#!/bin/bash
# build.sh — 一键重建 / 引导（新设备可复现）
#
# 阶段：
#   1. Node 版本检查（>=22）
#   2. 根工作区依赖安装（npm workspaces，含 custom/ 依赖；package-lock 一致则跳过）
#   3. vendor/pi 引导：clone 上游 → checkout PINNED_COMMIT → 幂等应用并提交 patches/
#   4. 构建 vendor/pi（工作区按依赖顺序）；模型数据缺失时联网生成（packages/ai）
#   5. 可选：生成 portable/agent/bin 的 fd/rg shim（PI_SETUP_BIN=1）
#   6. 可选：缓存已知良好 dist 供崩溃自愈（PI_CACHE_DIST=1）
#
# 环境变量：
#   PI_SKIP_ROOT_INSTALL=1   跳过根依赖安装
#   PI_SKIP_VENDOR_BUILD=1   跳过 vendor 构建（只做引导/依赖）
#   PI_SKIP_MODEL_GEN=1      不自动联网生成模型数据（数据缺失时构建会失败）
#   PI_FORCE_ROOT_INSTALL=1  强制重新安装根依赖
#   PI_FORCE_VENDOR_INSTALL=1 强制重新安装 vendor 依赖
#   PI_NODE_IPV4=0           不注入 ipv4first NODE_OPTIONS（默认注入以规避 IPv6 超时）
#   PI_CLONE_TIMEOUT=<秒>    上游 clone 超时（默认 600）
#   PI_CN_MIRROR=1           使用 npmmirror 加速 npm
#   PI_NPM_REGISTRY=<url>    指定 npm registry
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_PI="$ROOT/vendor/pi"
PIN_FILE="$ROOT/vendor/PINNED_COMMIT"
UPSTREAM_URL="${PI_UPSTREAM_URL:-https://github.com/earendil-works/pi-mono.git}"
# shellcheck source=scripts/lib-vendor.sh
. "$ROOT/scripts/lib-vendor.sh"

NPM_REGISTRY="${PI_NPM_REGISTRY:-}"
if [ "${PI_CN_MIRROR:-0}" = "1" ] && [ -z "$NPM_REGISTRY" ]; then
  NPM_REGISTRY="https://registry.npmmirror.com"
fi
npm_args=()
[ -n "$NPM_REGISTRY" ] && npm_args+=(--registry="$NPM_REGISTRY")

# ── 1. Node 版本检查（my-pi engines 要求 >= 22）──
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 node。请安装 Node.js >= 22（https://nodejs.org 或 nvm install 22）" >&2
  exit 1
fi
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  echo "✗ Node.js $(node -v) < 22，my-pi 要求 >= 22（vendor/pi 构建亦需较新 Node）" >&2
  echo "  升级建议：nvm install 22 && nvm use 22；或系统包管理器安装 Node 22" >&2
  exit 1
fi
echo "✓ Node.js $(node -v) / npm $(npm -v 2>/dev/null || echo '?')"

# ── 2. 根工作区依赖（custom/ 依赖提升到根 node_modules）──
if [ "${PI_SKIP_ROOT_INSTALL:-0}" = "1" ]; then
  echo "• 跳过根依赖安装（PI_SKIP_ROOT_INSTALL=1）"
elif [ "${PI_FORCE_ROOT_INSTALL:-0}" != "1" ] && root_deps_ok "$ROOT"; then
  echo "✓ 根依赖已就绪（package-lock 一致，跳过）"
else
  echo "📦 安装根工作区依赖（npm ci，不改动 lock）..."
  deps_install "$ROOT" "${npm_args[@]}"
fi

# ── 3. vendor/pi 引导（独立 git clone，不纳入主仓库）──
if [ ! -d "$VENDOR_PI/.git" ]; then
  echo "📥 vendor/pi 不存在，从上游引导..."
  rm -rf "$VENDOR_PI"
  if ! timeout "${PI_CLONE_TIMEOUT:-600}" git clone "$UPSTREAM_URL" "$VENDOR_PI"; then
    echo "✗ clone 上游失败/超时（网络受限？）。可设 PI_UPSTREAM_URL 指向镜像。" >&2
    exit 1
  fi

  PIN="$(grep -v '^#' "$PIN_FILE" 2>/dev/null | head -1 | awk '{print $1}')"
  if [ -n "$PIN" ]; then
    echo "锁定到 $PIN"
    git -C "$VENDOR_PI" checkout "$PIN"
  fi
  BASE_SHA="$(git -C "$VENDOR_PI" rev-parse HEAD)"

  echo "应用补丁（幂等，首次引导会提交为本地 commit）..."
  vendor_apply_patches "$ROOT" "$VENDOR_PI" 1 || {
    echo "✗ 补丁应用失败，vendor/pi 处于未完成引导状态；请检查 patches/ 与 PINNED_COMMIT 是否匹配" >&2
    exit 1
  }

  echo "$BASE_SHA" > "$VENDOR_PI/LAST_SYNC_POINT"
  vendor_exclude_local "$VENDOR_PI"
  echo "  同步点（上游基线）：$BASE_SHA"
else
  echo "• vendor/pi 已存在，核对补丁状态（只读，不自动提交；需修复用 scripts/doctor.sh --fix）"
  vendor_patch_status "$ROOT" "$VENDOR_PI" || true
fi

# ── 4. 构建 vendor/pi (coding-agent) ──
if [ "${PI_SKIP_VENDOR_BUILD:-0}" = "1" ]; then
  echo "• 跳过 vendor 构建（PI_SKIP_VENDOR_BUILD=1）"
else
  echo "🔨 构建 vendor/pi（工作区按依赖顺序构建）..."
  # 在 vendor 工作区根用 npm ci：按 lock 安装、不改动上游 package-lock（保持 vendor 干净）
  if [ "${PI_FORCE_VENDOR_INSTALL:-0}" != "1" ] && deps_ok "$VENDOR_PI"; then
    echo "  ✓ vendor 依赖已就绪（跳过）"
  else
    if [ -n "$NPM_REGISTRY" ]; then
      echo "  npm registry: $NPM_REGISTRY"
      deps_install "$VENDOR_PI" --registry="$NPM_REGISTRY"
    else
      deps_install "$VENDOR_PI"
    fi
  fi

  # 上游编码助手依赖 ai 包内生成的模型数据（.gitignore，需联网生成）。
  # 修复 Node IPv6 happy-eyeballs 在部分网络下连接超时：默认 ipv4first + 关闭地址族自动选择。
  if [ "${PI_NODE_IPV4:-1}" != "0" ] && [ -z "${NODE_OPTIONS:-}" ]; then
    export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
  fi

  # 仅当 src/providers/*.models.ts 引用的 data/*.json 有缺失时才联网生成
  NEED_MODEL_DATA=0
  while IFS= read -r json; do
    [ -f "$VENDOR_PI/packages/ai/src/providers/data/$json" ] || NEED_MODEL_DATA=1
  done < <(grep -rhoE '\./data/[A-Za-z0-9_-]+\.json' "$VENDOR_PI/packages/ai/src/providers" 2>/dev/null \
            | sed 's#\./data/##; s#"##g' | sort -u)
  if [ "${PI_SKIP_MODEL_GEN:-0}" = "1" ]; then
    echo "  • 跳过模型数据生成（PI_SKIP_MODEL_GEN=1）"
  elif [ "$NEED_MODEL_DATA" = "1" ]; then
    echo "  → 生成模型数据（需要网络）..."
    ( cd "$VENDOR_PI/packages/ai" && npm run generate-models )
  else
    echo "  ✓ 模型数据已就绪"
  fi

  # build:offline 按依赖顺序构建全部工作区包（chord→tui→…→ai→agent→…→coding-agent）
  ( cd "$VENDOR_PI" && npm run build:offline )

  # Termux：给 playwright-core 打 android→linux 平台补丁（幂等；非 Termux 自动跳过）
  if [ -f "$ROOT/scripts/patch-playwright-core.mjs" ]; then
    set +e
    PATCH_OUT="$(node "$ROOT/scripts/patch-playwright-core.mjs" 2>&1)"
    PATCH_RC=$?
    set -e
    echo "$PATCH_OUT"
    if [ "$PATCH_RC" -ne 0 ]; then
      echo "⚠ playwright-core 平台补丁未完成（exit $PATCH_RC）：Termux 浏览器可能不可用，请检查上面的输出" >&2
    fi
  fi

  CLI="$VENDOR_PI/packages/coding-agent/dist/cli.js"
  [ -f "$CLI" ] || { echo "✗ 构建产物缺失：$CLI" >&2; exit 1; }
  echo "✓ 构建产物：$CLI"

  # 构建戳：记录本次构建对应的 vendor/pi 内容标识（HEAD + 工作树改动哈希）。
  # doctor.sh 用它替代源码 mtime 比对（patch 应用/checkout 会 touch 源文件导致误报）。
  # dist/ 已被 vendor/pi/.gitignore 忽略，戳文件不会污染 git 状态。
  STAMP="$VENDOR_PI/packages/coding-agent/dist/.build-stamp"
  {
    git -C "$VENDOR_PI" rev-parse HEAD 2>/dev/null || echo unknown
    git -C "$VENDOR_PI" status --porcelain 2>/dev/null | sha256sum | cut -c1-16
  } > "$STAMP"
  echo "✓ 构建戳：$STAMP"
fi

# ── 5. 可选：fd/rg shim ──
if [ "${PI_SETUP_BIN:-0}" = "1" ]; then
  echo "🔧 生成 portable/agent/bin 的 fd/rg shim..."
  bash "$ROOT/scripts/setup-external.sh" fd-rg || true
fi

# ── 6. 可选：崩溃自愈的已知良好 dist 缓存 ──
if [ "${PI_CACHE_DIST:-0}" = "1" ]; then
  echo "🗃  缓存已知良好 dist（供崩溃自愈 pi_self 路径）..."
  bash "$ROOT/scripts/pi-source-build.sh" --no-build || true
fi

# custom/ 不编译：pi 的扩展加载器内置 jiti，直接加载 custom/bootstrap.ts（TypeScript）。
echo "✅ 构建完成（custom/ 以 TypeScript 源码由 pi 加载，无需编译）"
echo "  启动：./my-pi.sh   体检：bash scripts/doctor.sh   类型检查：npx tsc --noEmit -p custom/"
