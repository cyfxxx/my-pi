#!/usr/bin/env bash
# doctor.sh — 本地环境 vs 仓库 体检（新设备可复现性）
#
# 逐项核对“重建/运行所需”的本地状态与仓库内容是否一致，输出缺口与修复命令；
# 加 --fix 时按安全顺序自动修复（幂等，可重复运行）。
#
# 用法：
#   bash scripts/doctor.sh          # 只体检
#   bash scripts/doctor.sh --fix    # 体检并修复可自动修复项
#   bash scripts/doctor.sh --full   # 追加较慢检查（custom/ 类型检查）
#   bash scripts/doctor.sh --no-net # 跳过 git fetch（离线）
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_PI="$ROOT/vendor/pi"
CLI="$VENDOR_PI/packages/coding-agent/dist/cli.js"
CACHE_CLI="$ROOT/portable/agent/recovery/cache/dist/cli.js"
BIN_DIR="$ROOT/portable/agent/bin"
# shellcheck source=scripts/lib-vendor.sh
. "$ROOT/scripts/lib-vendor.sh"

FIX=0; FULL=0; NET=1
for a in "$@"; do
  case "$a" in
    --fix) FIX=1 ;;
    --full) FULL=1 ;;
    --no-net) NET=0 ;;
  esac
done

OK=0; WARN=0; BAD=0
ok()   { echo "  ✓ $1"; OK=$((OK + 1)); }
warn() { echo "  ⚠ $1"; WARN=$((WARN + 1)); }
bad()  { echo "  ✗ $1"; BAD=$((BAD + 1)); }
maybe_fix() { [ "$FIX" = "1" ] && echo "      → 修复中…"; }

cd "$ROOT" || exit 1
echo "=== my-pi doctor（$ROOT）==="

# ── 1. Node ──
echo "[1] 运行时"
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "${MAJOR:-0}" -ge 22 ]; then ok "Node $(node -v)"; else bad "Node $(node -v) < 22（需要 >=22）"; fi
else
  bad "未找到 node（安装 Node >=22）"
fi

# ── 2. 根工作区依赖 ──
echo "[2] 依赖"
if root_deps_ok "$ROOT"; then
  ok "根依赖与 package-lock 一致"
else
  if [ "$FIX" = "1" ]; then
    maybe_fix; PI_SKIP_VENDOR_BUILD=1 bash "$ROOT/scripts/build.sh" && ok "根依赖已安装" || bad "根依赖安装失败"
  else
    bad "根依赖缺失或与 package-lock 不一致（bash scripts/build.sh）"
  fi
fi

# ── 3. vendor/pi 引导 ──
echo "[3] vendor/pi"
if [ -d "$VENDOR_PI/.git" ]; then
  ok "vendor/pi 是独立 git 仓库"
  if git -C "$VENDOR_PI" diff --quiet 2>/dev/null; then ok "vendor/pi 工作树干净"; else
    warn "vendor/pi 有未提交修改（check-isolation 会失败）"
  fi
  if grep -Eq '^[0-9a-f]{7,40}([[:space:]]|$)' "$VENDOR_PI/LAST_SYNC_POINT" 2>/dev/null; then
    ok "LAST_SYNC_POINT: $(awk '{print $1}' "$VENDOR_PI/LAST_SYNC_POINT")"
  else
    bad "LAST_SYNC_POINT 缺失或格式无效"
  fi
  # 离线兜底：上游改写历史/删库时，只有 bundle 能恢复 vendor（仓库本身不存 bundle）
  if ls "$ROOT"/vendor/*.bundle >/dev/null 2>&1; then
    ok "vendor 离线归档存在（$(ls -1 "$ROOT"/vendor/*.bundle | wc -l | tr -d ' ') 个）"
  else
    warn "无 vendor 离线归档（上游改写历史将无法引导；bash scripts/vendor-bundle.sh create 后另存仓库外）"
  fi
  if [ "$FIX" = "1" ]; then
    NEED=0; for p in "$ROOT"/patches/*.patch; do
      [ -e "$p" ] || continue
      vendor_patch_applied "$VENDOR_PI" "$p" || git -C "$VENDOR_PI" apply --check --reverse "$p" >/dev/null 2>&1 || NEED=1
    done
    if [ "$NEED" = "1" ]; then maybe_fix; vendor_apply_patches "$ROOT" "$VENDOR_PI" 1 || bad "补丁应用失败"; fi
  fi
  if vendor_patch_status "$ROOT" "$VENDOR_PI" >/tmp/doctor-patches.log 2>&1; then
    ok "补丁齐备（$(grep -c '已应用' /tmp/doctor-patches.log)）"
  else
    bad "补丁未齐备（详情：bash scripts/doctor.sh --fix）"
    sed 's/^/      /' /tmp/doctor-patches.log
  fi
else
  if [ "$FIX" = "1" ]; then maybe_fix; bash "$ROOT/scripts/build.sh" && ok "vendor/pi 已引导" || bad "引导失败"; else
    bad "vendor/pi 不存在（bash scripts/build.sh）"
  fi
fi

# ── 4. 构建产物新鲜度 ──
echo "[4] 构建产物"
if [ -f "$CLI" ]; then
  ok "dist/cli.js 存在"
  # 优先用构建戳（build.sh 写入：HEAD + 工作树改动哈希）比对；
  # 不用源码 mtime——patch 应用 / git checkout 会 touch 源文件，导致必然误报。
  STAMP="$VENDOR_PI/packages/coding-agent/dist/.build-stamp"
  HEAD_SHA="$(git -C "$VENDOR_PI" rev-parse HEAD 2>/dev/null)"
  DIRTY="$(git -C "$VENDOR_PI" status --porcelain 2>/dev/null)"
  CUR_DIRTY="$(printf '%s' "$DIRTY" | sha256sum 2>/dev/null | cut -c1-16)"
  STALE_REASON=""
  if [ -f "$STAMP" ]; then
    ST_SHA="$(sed -n '1p' "$STAMP" 2>/dev/null)"
    ST_DIRTY="$(sed -n '2p' "$STAMP" 2>/dev/null)"
    if [ -z "$HEAD_SHA" ]; then
      warn "无法读取 vendor/pi HEAD，跳过构建戳比对"
    elif [ "$ST_SHA" != "$HEAD_SHA" ] || [ "$ST_DIRTY" != "$CUR_DIRTY" ]; then
      STALE_REASON="构建戳 ${ST_SHA:0:9} ≠ 当前 ${HEAD_SHA:0:9}（或 vendor/pi 工作树与构建时不一致）"
    fi
  elif [ -n "$DIRTY" ]; then
    STALE_REASON="vendor/pi 工作树有未提交改动且无构建戳"
  fi
  if [ -n "$STALE_REASON" ]; then
    if [ "$FIX" = "1" ]; then maybe_fix; PI_SKIP_ROOT_INSTALL=1 bash "$ROOT/scripts/build.sh" && ok "dist 已重建" || bad "重建失败"; else
      warn "dist 可能过期（$STALE_REASON；PI_SKIP_ROOT_INSTALL=1 bash scripts/build.sh）"
    fi
  elif [ -f "$STAMP" ]; then
    ok "dist 与源码同步（stamp ${HEAD_SHA:0:9}）"
  else
    ok "dist 存在（无构建戳，跳过比对；下次 build.sh 后生成）"
  fi
else
  if [ "$FIX" = "1" ]; then maybe_fix; PI_SKIP_ROOT_INSTALL=1 bash "$ROOT/scripts/build.sh" && ok "dist 已构建" || bad "构建失败"; else
    bad "dist/cli.js 缺失（bash scripts/build.sh）"
  fi
fi

# ── 5. 崩溃自愈缓存 ──
echo "[5] 自愈缓存"
if [ -f "$CACHE_CLI" ]; then
  ok "recovery/cache/dist 就绪"
else
  if [ "$FIX" = "1" ]; then maybe_fix; bash "$ROOT/scripts/pi-source-build.sh" --no-build >/dev/null 2>&1 && ok "自愈缓存已生成" || warn "自愈缓存生成失败（不影响运行）"; else
    warn "recovery/cache/dist 缺失（bash scripts/pi-source-build.sh --no-build）"
  fi
fi

# ── 6. 运行时目录与 shim ──
echo "[6] 运行时目录"
for d in portable/agent portable/memory; do
  [ -d "$d" ] && ok "$d" || bad "$d 缺失"
done
if [ "$FIX" = "1" ] && { [ ! -x "$BIN_DIR/fd" ] || [ ! -x "$BIN_DIR/rg" ]; }; then
  maybe_fix; bash "$ROOT/scripts/setup-external.sh" fd-rg >/dev/null 2>&1 || true
fi
for b in fd rg; do
  if [ -x "$BIN_DIR/$b" ]; then ok "portable/agent/bin/$b 就绪"; else warn "portable/agent/bin/$b 缺失（bash scripts/setup-external.sh fd-rg）"; fi
done

# ── 7. 每环境独立文件（不入库，主动提示）──
echo "[7] 每环境独立配置"
[ -f portable/agent/auth.json ] && ok "auth.json 存在" || warn "auth.json 缺失（首次用需配置 API 凭据；不入库）"
[ -f portable/agent/models.json ] && ok "models.json 存在" || warn "models.json 缺失（可选；按本机能力配置）"

# ── 8. 外部工具（可选能力）──
echo "[8] 外部工具（可选）"
have() { command -v "$1" >/dev/null 2>&1; }
have tmux && ok "tmux" || warn "tmux 未安装（tmux_* 工具不可用）"
have fd || have fdfind && ok "fd" || warn "fd 未安装"
have rg && ok "rg" || warn "rg 未安装"
have espeak-ng || have espeak && ok "espeak-ng" || warn "espeak-ng 未安装（TTS fallback）"
have ffmpeg && ok "ffmpeg" || warn "ffmpeg 未安装（语音转码）"
if curl -s --max-time 3 http://127.0.0.1:8889/ >/dev/null 2>&1; then ok "SearXNG 运行中"
elif [ "$FIX" = "1" ]; then maybe_fix; bash "$ROOT/scripts/setup-external.sh" web >/dev/null 2>&1 && ok "SearXNG 已启动" || warn "SearXNG 启动失败"
else warn "SearXNG 未运行（bash scripts/setup-external.sh web）"; fi

# ── 9. 类型检查（--full）──
if [ "$FULL" = "1" ]; then
  echo "[9] 类型检查"
  if npx tsc --noEmit -p custom/ >/tmp/doctor-tsc.log 2>&1; then ok "custom/ 类型检查通过"; else bad "custom/ 类型检查失败（见 /tmp/doctor-tsc.log）"; fi
fi

# ── 10. 本地 vs 远程 ──
echo "[10] 本地 vs origin"
if [ "$NET" = "1" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  git fetch origin -q 2>/dev/null || true
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
    BEHIND="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
    if [ "$BEHIND" -gt 0 ]; then warn "落后 origin/main $BEHIND 个提交（git pull）"; else ok "与 origin/main 同步（领先 $AHEAD）"; fi
  else
    warn "无 origin/main 引用"
  fi
else
  echo "  • 已跳过（--no-net 或非 git 仓库）"
fi

# ── 11. 加密同步（记忆/会话资产）──
# 私钥遗失=记忆不可解；密文过期=新设备拉不到最新记忆。两者都只告警，不阻断提交。
echo "[11] 加密同步（记忆/会话）"
if [ -f "$ROOT/sync/memory.tar.age" ]; then
  ok "密文存在（$(stat -c%s "$ROOT/sync/memory.tar.age" 2>/dev/null || echo '?') 字节）"
  if [ -f "$HOME/.config/my-pi/age.key" ] || [ -n "${MY_PI_AGE_KEY:-}" ]; then
    if bash "$ROOT/scripts/sync-memory.sh" verify >/tmp/doctor-sync.log 2>&1; then
      ok "verify 通过（可解密 / 公钥匹配 / 清单一致）"
    else
      warn "sync verify 未通过（备份过期或密钥不匹配）：$(tail -1 /tmp/doctor-sync.log)"
    fi
  else
    warn "无私钥（无法 pull/verify；从备份恢复后重试）"
  fi
else
  warn "无密文（bash scripts/sync-memory.sh push 后提交 sync/）"
fi

echo ""
echo "=== 结果：$OK 正常 / $WARN 警告 / $BAD 异常 ==="
if [ "$BAD" -gt 0 ]; then
  [ "$FIX" = "1" ] && echo "部分项修复失败，请按上面提示处理" || echo "运行 bash scripts/doctor.sh --fix 自动修复可修复项"
  exit 1
fi
[ "$WARN" -gt 0 ] && echo "无阻断性异常（警告项多为可选能力）"
exit 0
