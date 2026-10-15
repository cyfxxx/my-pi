#!/usr/bin/env bash
# dsh-spike.sh — 跑"DSH 换基座" spike：用**真实** @deepseek-ai 包验证 custom/adapters/dsh 的映射
#
# 为什么要有它：换基座的结论不能靠"读了文档觉得行"（本项目纪律：可复跑证据优先）。
# 本脚本做两件事：
#   ① 把 spike 需要的 DSH 包装进 `dsh/spike/node_modules`（**gitignored**，不动仓库其它依赖）；
#   ② 用仓库自带的 tsx 跑 `dsh/spike/spike.ts`（因为适配层是 TS，需要解析无扩展名导入）。
#
# 用法：
#   bash scripts/dsh-spike.sh              # 装（若缺）→ 跑
#   bash scripts/dsh-spike.sh --no-install # 只跑（离线/已装好）
#
# 退出码：0 = 全部检查通过（允许 SKIP）；1 = 有失败检查；2 = 环境问题（装不上/跑不起来）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

SPIKE_DIR="$ROOT/dsh/spike"
NO_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-install) NO_INSTALL=1 ;;
    *) echo "用法: $0 [--no-install]" >&2; exit 2 ;;
  esac
done

if [ ! -f "$SPIKE_DIR/package.json" ]; then
  echo "❌ 缺少 $SPIKE_DIR/package.json" >&2
  exit 2
fi

echo "=== DSH spike 准备（$SPIKE_DIR）==="
if [ ! -d "$SPIKE_DIR/node_modules/@deepseek-ai/dsh-tools" ]; then
  if [ "$NO_INSTALL" = "1" ]; then
    echo "❌ 未安装 DSH 包，且指定了 --no-install" >&2
    echo "   先跑：npm --prefix $SPIKE_DIR install --no-audit --no-fund" >&2
    exit 2
  fi
  echo "→ 安装 spike 依赖（@deepseek-ai/dsh-tools / dsh-system-prompt / cordis）…"
  # 用仓库的 npm（便携 node 里自带），registry 走本机 .npmrc/npmmirror
  if ! npm --prefix "$SPIKE_DIR" install --no-audit --no-fund --loglevel=error; then
    echo "❌ 依赖安装失败（网络/registry？）" >&2
    exit 2
  fi
else
  echo "✓ 依赖已就绪（跳过安装）"
fi

# ── pi 包别名（P5 机制的现场验证与演示）──────────────────────────────────────
# 全量 bootstrap 会经 ui-adapter/session-adapter **运行时** import pi 的包
# （`@earendil-works/pi-tui` 的 TUI 组件、`pi-coding-agent` 的 SessionManager）。
# pi 自己是靠 `vendor/pi/node_modules/@earendil-works/*` 解析的；DSH 部署里没有这些包，
# 所以要么提供等价实现、要么把这两个 specifier 别名到本仓的 shim/别名目录。
# 本脚本用**软链到 vendor/pi 的包**做演示（gitignored 的 custom/node_modules 下），
# 让 A9 能在本机跑通；真正的部署做法见 docs/design/DSH-MIGRATION-PLAN.md 的 P5。
# ★ 必须放在**仓库根**的 node_modules：Node 的裸包解析是从**导入方文件**所在目录向上找，
#   spike 在 dsh/spike/、适配器在 custom/adapters/，只有根 node_modules 对两者都可见。
ALIAS_DIR="$ROOT/node_modules/@earendil-works"
mkdir -p "$ALIAS_DIR"
linked=0
for pair in "pi-tui:tui" "pi-coding-agent:coding-agent" "pi-ai:ai" "pi-agent-core:agent"; do
  spec="${pair%%:*}"; dir="${pair##*:}"
  target="$ROOT/vendor/pi/packages/$dir"
  [ -d "$target" ] || continue
  [ -e "$ALIAS_DIR/$spec" ] && continue
  ln -sfn "$target" "$ALIAS_DIR/$spec" 2>/dev/null && linked=$((linked + 1))
done
if [ -e "$ALIAS_DIR/pi-tui" ] && [ -e "$ALIAS_DIR/pi-coding-agent" ]; then
  echo "✓ pi 包别名就绪（node_modules/@earendil-works，新增 $linked 个）⇒ A9 全量 bootstrap 可跑"
else
  echo "⚠ pi 包别名不可用 ⇒ A9 会记 SKIP（DSH-only 部署需要 P5 的 shim/别名）"
fi

echo "→ 运行 spike（tsx）…"
if bash scripts/run-ts.sh dsh/spike/spike.ts; then
  echo "🎉 DSH spike 通过"
  exit 0
else
  rc=$?
  echo "❌ DSH spike 未通过（退出码 $rc）" >&2
  exit "$rc"
fi
