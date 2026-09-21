#!/bin/bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_PI="$ROOT/vendor/pi"
PIN_FILE="$ROOT/vendor/PINNED_COMMIT"
UPSTREAM_URL="${PI_UPSTREAM_URL:-https://github.com/earendil-works/pi-mono.git}"
# 可选国内镜像（npm 安装加速）：PI_CN_MIRROR=1 bash scripts/build.sh
NPM_REGISTRY="${PI_NPM_REGISTRY:-}"
if [ "${PI_CN_MIRROR:-0}" = "1" ] && [ -z "$NPM_REGISTRY" ]; then
  NPM_REGISTRY="https://registry.npmmirror.com"
fi

# ── Node 版本检查（my-pi engines 要求 >= 22）──
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

# ── vendor/pi 引导（独立 git clone，不纳入主仓库）──
if [ ! -d "$VENDOR_PI/.git" ]; then
    echo "📥 vendor/pi 不存在，从上游引导..."
    rm -rf "$VENDOR_PI"
    git clone "$UPSTREAM_URL" "$VENDOR_PI"

    PIN="$(grep -v '^#' "$PIN_FILE" 2>/dev/null | head -1 | awk '{print $1}')"
    if [ -n "$PIN" ]; then
        echo "锁定到 $PIN"
        git -C "$VENDOR_PI" checkout "$PIN"
    fi

    for patch in "$ROOT/patches"/*.patch; do
        [ -e "$patch" ] || continue
        echo "应用补丁：$(basename "$patch")"
        git -C "$VENDOR_PI" apply --3way "$patch"
    done

    git -C "$VENDOR_PI" rev-parse HEAD > "$VENDOR_PI/LAST_SYNC_POINT"
else
    # 已存在：核对补丁是否已应用（幂等提示，不改动）
    for patch in "$ROOT/patches"/*.patch; do
        [ -e "$patch" ] || continue
        base="$(basename "$patch")"
        if git -C "$VENDOR_PI" apply --check "$patch" >/dev/null 2>&1; then
            echo "⚠ 补丁未应用：$base（运行 bash scripts/sync-upstream.sh 或 git apply）"
        elif git -C "$VENDOR_PI" apply --check --reverse "$patch" >/dev/null 2>&1; then
            echo "✓ 补丁已应用：$base"
        else
            echo "⚠ 补丁状态未知（基线不符？）：$base"
        fi
    done
fi

echo "🔨 构建 vendor/pi (coding-agent)..."
cd "$VENDOR_PI/packages/coding-agent"
if [ -n "$NPM_REGISTRY" ]; then
    echo "  npm registry: $NPM_REGISTRY"
    npm install --registry="$NPM_REGISTRY"
else
    npm install
fi
npm run build

# Termux：给 playwright-core 打 android→linux 平台补丁（幂等；非 Termux 自动跳过）
# 不吞输出：补丁未命中时明确告警，避免"构建成功但浏览器不可用"。
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

# custom/ 不编译：pi 的扩展加载器内置 jiti，直接加载 custom/bootstrap.ts（TypeScript）。
# 类型检查用 `npx tsc --noEmit -p custom/`（见 npm run check 与文档）。
echo "✅ 构建完成（custom/ 以 TypeScript 源码由 pi 加载，无需编译）"
echo "  启动：./my-pi.sh   类型检查：npx tsc --noEmit -p custom/   完整检查：npm run check"
