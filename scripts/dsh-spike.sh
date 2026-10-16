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
# ★ 判据是"**package.json 里声明的每一个依赖**是否都在 node_modules 里"，不是只看 dsh-tools：
#   原先只看 dsh-tools 存在就跳过安装 ⇒ **往 package.json 里加依赖不会生效**（实测：加了
#   dsh-agent / dsh-agent-loop / dsh-llm 后仍显示"依赖已就绪"，直到手工 npm install 才发现）。
MISSING_DEPS="$(node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const dir = process.argv[2];
const miss = Object.keys(p.dependencies ?? {}).filter((d) => !fs.existsSync(`${dir}/${d}`));
process.stdout.write(miss.join(" "));
' "$SPIKE_DIR/package.json" "$SPIKE_DIR/node_modules" 2>/dev/null)"
if [ -n "${MISSING_DEPS:-}" ]; then
  if [ "$NO_INSTALL" = "1" ]; then
    echo "❌ 未安装 DSH 包，且指定了 --no-install" >&2
    echo "   先跑：npm --prefix $SPIKE_DIR install --no-audit --no-fund" >&2
    exit 2
  fi
  echo "→ 安装 spike 依赖（缺：${MISSING_DEPS}）…"
  # 用仓库的 npm（便携 node 里自带），registry 走本机 .npmrc/npmmirror
  if ! npm --prefix "$SPIKE_DIR" install --no-audit --no-fund --loglevel=error; then
    echo "❌ 依赖安装失败（网络/registry？）" >&2
    exit 2
  fi
else
  echo "✓ 依赖已就绪（跳过安装）"
fi

# ── pi 包别名：默认用**本仓 shim**（证明"没有 pi 包也能加载全部特性"）──────────
# 背景：`ui-adapter.ts` / `session-adapter.ts` 会**运行时** import `@earendil-works/pi-tui`
# 与 `pi-coding-agent`。pi 靠 `vendor/pi/node_modules/@earendil-works/*` 解析；DSH 部署里没有 pi，
# 所以必须把这两个 specifier 别名到等价实现。本仓库的做法是 `custom/adapters/dsh/pi-shims/`
# （惰性 TUI 组件 + 会话枚举降级，均**显式上报**）。
#
# PI_SPIKE_PI_ALIAS=shim    （默认）别名到本仓 shim ⇒ A9 证明**零 pi 运行时依赖**也能全量加载
# PI_SPIKE_PI_ALIAS=vendor  别名到 vendor/pi 真包 ⇒ 作为对照（行为更完整，但那是 pi 的代码）
ALIAS_MODE="${PI_SPIKE_PI_ALIAS:-shim}"
ALIAS_DIR="$ROOT/node_modules/@earendil-works"
mkdir -p "$ALIAS_DIR"
for spec in pi-tui pi-coding-agent pi-ai pi-agent-core; do rm -f "$ALIAS_DIR/$spec"; done
linked=0
if [ "$ALIAS_MODE" = "vendor" ]; then
  for pair in "pi-tui:tui" "pi-coding-agent:coding-agent" "pi-ai:ai" "pi-agent-core:agent"; do
    spec="${pair%%:*}"; dir="${pair##*:}"
    target="$ROOT/vendor/pi/packages/$dir"
    [ -d "$target" ] || continue
    ln -sfn "$target" "$ALIAS_DIR/$spec" 2>/dev/null && linked=$((linked + 1))
  done
  echo "→ pi 包别名：**vendor/pi 真包**（对照模式，新增 $linked 个）"
else
  for pair in "pi-tui:pi-shims/tui" "pi-coding-agent:pi-shims/coding-agent"; do
    spec="${pair%%:*}"; dir="${pair##*:}"
    target="$ROOT/custom/adapters/dsh/$dir"
    [ -d "$target" ] || continue
    ln -sfn "$target" "$ALIAS_DIR/$spec" 2>/dev/null && linked=$((linked + 1))
  done
  echo "→ pi 包别名：**本仓 shim**（$linked 个；A9 将证明零 pi 运行时依赖也能全量加载）"
fi
if [ -e "$ALIAS_DIR/pi-tui" ] && [ -e "$ALIAS_DIR/pi-coding-agent" ]; then
  echo "✓ 别名就绪（$ALIAS_DIR）"
else
  echo "⚠ 别名不可用 ⇒ A9 会记 SKIP"
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
