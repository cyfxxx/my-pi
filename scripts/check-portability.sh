#!/usr/bin/env bash
# check-portability.sh — 便携性守门（"所有项目相关内容都在仓库内、随项目移动"）
#
# ## 为什么有它
#
# 2026-10-15 的实测结论：Linux 侧此前**能跑但不可搬**——Node 来自
# `/root/.local/share/pi-node`、SearXNG 在 `/opt/searxng`、whisper/sherpa 的 venv 在
# `/opt/*`、npm 缓存写 `~/.npm`。这些不是"注意一下"就能守住的：它们**不会报错**，
# 只在"换台机器 / 换个路径 / 整盘拷走"时集中爆出来，而那时离改动已经很久。
# 按本项目纪律（VISION §3.1「反复有效的软引导必须硬化」），把三条判据变成断言：
#
#   P1 生产代码里不得有**仓外绝对路径**作为默认落点（注释里可以写历史，不算违规）
#   P2 `runtime/` 必须仍被 gitignore，且**不得有 runtime 下的文件入库**
#   P3 解析必须落在仓内：装了仓内 runtime 时，`pi_resolve_node`/`pi_resolve_python`
#      必须解析到仓库内部；缓存（npm/pip/pycache）必须指向仓库内部
#   P4 便携制品清单里的 sha256 必须是 64 位十六进制（防手抄半截/占位符）
#   P6 DSH 宿主也**仓内优先**（runtime/<平台>/ext/dsh）：解析行为命中仓内、portable/dsh 不入库、版本单源
#
# 口径说明：只查"**默认值**"，不查显式覆盖（`MY_PI_NODE=`、`PI_WHISPER_VENV=` 等
# 允许用户指到任何地方）。这也是为什么 P1 跳过注释行——本仓有大量"为什么不再用
# /opt/... "的说明，那些必须留着。
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
# shellcheck source=scripts/lib-portable.sh
. "$ROOT/scripts/lib-portable.sh"

FAIL=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "=== 便携性守门 ==="

# ── P1：生产代码不得把仓外绝对路径当默认落点 ──────────────────────────────
# 目标文件：真正会跑的生产代码（脚本 + 非测试 TS + 语音服务）。
# 排除：__tests__（夹具里出现 /root/my-pi 是刻意的）、vendor/、node_modules/、docs/。
PATTERNS='/opt/(searxng|pi-whisper|pi-sherpa|pi-tts)|/root/\.local/share/pi-node|/root/my-pi|/home/[A-Za-z0-9_-]+/\.pi|C:\\Users'
# ★ 实现用**单次 grep**（不是逐行读+逐行 grep）：逐行版本在 6 万行上要 5 分钟以上
#   （每行一次进程派生），而被 pre-commit（golden --fast）调用时那是不可接受的；单次扫描 <1 秒。
#   注意排除**本文件自身**：它定义 PATTERNS（那几行"看起来就是"仓外路径），扫自己必然假红。
HITS="$(git ls-files 'scripts/*.sh' 'scripts/*.mjs' 'my-pi.sh' 'custom/**/*.ts' 'custom/**/*.sh' 'custom/**/*.py' 2>/dev/null \
  | grep -vE '(__tests__/|/node_modules/|/vendor/|__probe__|^docs/|^scripts/test-|^scripts/check-portability\.sh$)' \
  | xargs -r grep -nE "$PATTERNS" 2>/dev/null \
  | grep -vE ':[0-9]+:[[:space:]]*(#|//|/\*|\*)' || true)"
if [ -n "$HITS" ]; then
  bad "以下**非注释**代码把仓外绝对路径当默认落点（应改用 scripts/lib-portable.sh 的仓内解析）："
  printf '%s\n' "$HITS" | head -20 | sed 's/^/      /'
else
  ok "生产代码无仓外绝对路径默认落点（注释里的历史路径不计）"
fi

# ── P2：runtime/ 必须被忽略，且不得入库 ───────────────────────────────────
if git check-ignore -q runtime; then
  ok "runtime/ 被 .gitignore 排除"
else
  bad "runtime/ 未被 .gitignore 排除（二进制/运行时会被提交进仓库）"
fi
RUNTIME_TRACKED="$(git ls-files 'runtime/**' 'runtime' 2>/dev/null | wc -l)"
if [ "$RUNTIME_TRACKED" = "0" ]; then
  ok "runtime/ 下没有任何文件入库（0 个）"
else
  bad "runtime/ 下有 $RUNTIME_TRACKED 个文件已入库（应全部排除）"
fi

# ── P3：解析与缓存必须落在仓内 ────────────────────────────────────────────
PLATFORM="$(pi_platform)"
NODE_IN_REPO="$(pi_resolve_node 2>/dev/null || true)"
PY_IN_REPO="$(pi_resolve_python 2>/dev/null || true)"
if [ -x "$(pi_runtime_root)/node/bin/node" ] || [ -x "$(pi_runtime_root)/node/node" ] || [ -x "$ROOT/runtime/node/node" ]; then
  if [ -n "$NODE_IN_REPO" ] && pi_is_inside_repo "$NODE_IN_REPO"; then
    ok "node 解析落在仓内：$NODE_IN_REPO"
  else
    bad "仓库里已有便携 node，但解析结果在仓外：${NODE_IN_REPO:-（无）} ⇒ 解析顺序回归"
  fi
else
  echo "  · 仓库内还没装便携 node（bash scripts/portable-runtime.sh node）—— 跳过 P3-node"
fi
if [ -x "$(pi_runtime_root)/py/bin/python3" ]; then
  if [ -n "$PY_IN_REPO" ] && pi_is_inside_repo "$PY_IN_REPO"; then
    ok "python 解析落在仓内：$PY_IN_REPO"
  else
    bad "仓库里已有便携 python，但解析结果在仓外：${PY_IN_REPO:-（无）} ⇒ 解析顺序回归"
  fi
else
  echo "  · 仓库内还没装便携 python（bash scripts/portable-runtime.sh python）—— 跳过 P3-python"
fi
# 缓存三件套：只要 pi_portable_env 被改回"尊重外部环境变量"，这里就会红
(
  pi_portable_env
  for kv in "npm_config_cache:${npm_config_cache:-}" "PIP_CACHE_DIR:${PIP_CACHE_DIR:-}" "PYTHONPYCACHEPREFIX:${PYTHONPYCACHEPREFIX:-}"; do
    k="${kv%%:*}"; v="${kv#*:}"
    printf '%s\t%s\n' "$k" "$v"
  done
) > /tmp/pi-portable-cache-$$.txt
while IFS=$'\t' read -r k v; do
  case "$v" in
    "$ROOT"/*) ok "$k 指向仓内：$v" ;;
    *) bad "$k 不在仓内（${v:-未设置}）⇒ 运行状态会散到用户目录" ;;
  esac
done < /tmp/pi-portable-cache-$$.txt
rm -f /tmp/pi-portable-cache-$$.txt

# ── P5：运行时里的符号链接不得被 FUSE"短目标不截断"污染（xxx0001）──────────
# 实测（2026-10-15）：本机 PRoot/FUSE 在覆盖更短的符号链接目标时不截断尾部，留下 `0001` 尾巴；
# `cp -al`（硬链接复制）还会**改到源**，一次就污染了 runtime 下 545 个链接（详见
# docs/design/CODING-TRAPS.md 第 9 条）。全量扫描 runtime 要 30 秒以上，故此处只查
# **关键 bin/lib 层**（1 秒级，适合 pre-commit）；全量扫描在 `portable-runtime.sh verify`。
POLLUTED="$(find "$(pi_runtime_root)" -maxdepth 6 -type l -printf '%p -> %l\n' 2>/dev/null | grep -c '0001$' || true)"
if [ "${POLLUTED:-0}" = "0" ]; then
  ok "runtime 关键层的符号链接无 '0001' 污染（全量自证见 portable-runtime.sh verify）"
else
  bad "runtime 下有 $POLLUTED 个符号链接带 '0001' 尾巴（FUSE 覆盖短目标不截断）⇒ bash scripts/portable-runtime.sh repair"
fi

# ── P6：DSH 宿主的便携化（仓内优先；非便携要显式告警，不能悄悄依赖 npx 缓存）──
# 为什么单独一节：`dsh` CLI 原来只活在 npx 缓存里（仓外、会被清掉）。现在宿主装进
# `runtime/<平台>/ext/dsh/`，就必须**用行为**证明三件事：解析优先命中仓内、仓内 home 不入库、
# 版本钉死单源。全部"跑一下看输出"，不靠读源码猜。
VENDORED_MODULES="$(bash scripts/dsh-runtime.sh path 2>/dev/null || true)"
if [ -n "$VENDORED_MODULES" ] && [ -x "$VENDORED_MODULES/.bin/dsh" ]; then
  HOST_LINE="$(bash scripts/dsh-launch.sh --print-host 2>/dev/null || echo none)"
  case "$HOST_LINE" in
    vendored*) ok "DSH 宿主解析命中**仓内** ⇒ 不依赖 npx 缓存（${HOST_LINE}）" ;;
    *)         bad "已装仓内宿主，但启动器解析到的是：$HOST_LINE（应优先仓内）" ;;
  esac
  PIN="$(grep -oE '^DSH_VERSION="[^"]+"' scripts/dsh-runtime.sh | head -1 | cut -d'"' -f2)"
  HAVE="$("$VENDORED_MODULES/.bin/dsh" --version 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$PIN" ] && [ -n "$HAVE" ]; then
    [ "$PIN" = "$HAVE" ] && ok "仓内宿主版本与钉死版本一致（$PIN）" \
      || bad "仓内宿主版本 $HAVE ≠ 钉死的 $PIN（换机/重装后要重跑 install）"
  else
    bad "读不到版本钉死或仓内宿主版本（DSH_VERSION / --version 输出变了？）"
  fi
else
  echo "  · 仓内还没装 DSH 宿主（bash scripts/dsh-runtime.sh install --from-npx）—— 跳过 P6-a/P6-c"
fi
if git check-ignore -q portable/dsh; then
  ok "仓内 DSH home（portable/dsh/）被 .gitignore 排除"
else
  bad "portable/dsh/ 未被 .gitignore 排除（会话日志/**凭据**会被提交）"
fi
DSH_HOME_TRACKED="$(git ls-files 'portable/dsh/**' 'portable/dsh' 2>/dev/null | wc -l)"
[ "$DSH_HOME_TRACKED" = "0" ] && ok "portable/dsh/ 下没有任何文件入库（0 个）" \
  || bad "portable/dsh/ 下有 $DSH_HOME_TRACKED 个文件已入库（含凭据风险）"

# ── P4：制品清单的 sha256 必须是 64 位十六进制 ─────────────────────────────
MANIFEST="$(pi_portable_artifacts_file)"
if [ -f "$MANIFEST" ]; then
  BAD_SHA="$(awk -F'\t' '!/^#/ && NF==4 { if ($4 !~ /^[0-9a-f]{64}$/) print $3": "$4 }' "$MANIFEST" || true)"
  ROWS="$(awk -F'\t' '!/^#/ && NF==4' "$MANIFEST" | wc -l)"
  if [ -n "$BAD_SHA" ]; then
    bad "制品清单里有非 64 位十六进制的 sha256（手抄易错，务必用 sha256sum 生成）："
    printf '%s\n' "$BAD_SHA" | sed 's/^/      /'
  else
    ok "制品清单 sha256 格式合法（$ROWS 条制品）"
  fi
else
  bad "缺少便携制品清单：$MANIFEST"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 便携性守门通过（平台 $PLATFORM；runtime=$ROOT/runtime/$PLATFORM）"
  exit 0
fi
echo "❌ 便携性守门失败 $FAIL 项"
exit 1
