#!/bin/bash
# bootstrap-key.sh — age 私钥的「引导包」：打包 / 解包 / 校验（方案 A）
#
# 目的：新设备重建时不必手工搬运私钥——把 **age 私钥**用口令加密后随仓库分发。
# 依据：docs/operations/KEY-BOOTSTRAP-ANALYSIS.md
#   · 只装"解密材料"（age.key）；**不装** SSH 私钥 / auth.json / settings.json 的 deviceId；
#   · SSH 私钥不搬运：新设备 ssh-keygen 生成新 key，用网页 + 2FA 添加公钥（顺带轮换）；
#   · 循环依赖分析：解密不需要該私钥来拉仓库（先 clone/生成新 key 再解包），故不构成死锁。
#
# 用法：
#   bash scripts/bootstrap-key.sh pack                 # 打包 → sync/bootstrap.age（口令交互输两遍）
#   bash scripts/bootstrap-key.sh verify               # 解到临时目录校验成员清单 + 指纹（不安装）
#   bash scripts/bootstrap-key.sh unpack [--yes]       # 解包并安装到私钥路径（已存在则需 --yes）
#   bash scripts/bootstrap-key.sh help
#
# 环境变量（测试与自定义部署）：
#   MY_PI_AGE_KEY              私钥路径（默认 ~/.config/my-pi/age.key）
#   MY_PI_BOOTSTRAP_BUNDLE     引导包路径（默认 sync/bootstrap.age）
#   MY_PI_BOOTSTRAP_META       元信息路径（默认 sync/bootstrap.meta.json，明文、不含秘密）
#   MY_PI_BOOTSTRAP_MODE       passphrase（默认，生产）| recipient（仅自动化测试用）
#   MY_PI_BOOTSTRAP_RECIPIENT  recipient 模式下的收件人（通常取自临时公钥）
#   MY_PI_BOOTSTRAP_PUB        用于指纹核对的公钥（默认 sync/age.pub）
set -u
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

SYNC_DIR="$ROOT/sync"
KEY="${MY_PI_AGE_KEY:-$HOME/.config/my-pi/age.key}"
BUNDLE="${MY_PI_BOOTSTRAP_BUNDLE:-$SYNC_DIR/bootstrap.age}"
META="${MY_PI_BOOTSTRAP_META:-$SYNC_DIR/bootstrap.meta.json}"
MODE="${MY_PI_BOOTSTRAP_MODE:-passphrase}"
PUB="${MY_PI_BOOTSTRAP_PUB:-$SYNC_DIR/age.pub}"
TOOL_VERSION="v1"

# 允许进包的文件（白名单）：私钥本体 + 脚本生成的说明。任何其它成员一律拒绝。
MEMBER_KEY="age.key"
MEMBER_README="bootstrap/README.txt"

STAGE=""
cleanup_stage() { [ -n "$STAGE" ] && rm -rf "$STAGE"; }
trap cleanup_stage EXIT

die() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }
warn() { echo "⚠ $*" >&2; }

need_age() {
  command -v age >/dev/null 2>&1 || die "未找到 age。安装：Debian/Ubuntu 'apt install age'；Termux 'pkg install age'"
  command -v age-keygen >/dev/null 2>&1 || die "未找到 age-keygen"
  command -v tar >/dev/null 2>&1 || die "未找到 tar"
}

fingerprint_of() { # $1 = 私钥路径
  age-keygen -y "$1" 2>/dev/null | tr -d '[:space:]'
}

# 明文私钥出现在共享存储里是真实风险（Android 共享存储属组 aid_everybody，FUSE 还会忽略权限位）
warn_plaintext_copies() {
  # 只提醒、不改变命令退出码（此前函数末尾的条件表达式让 unpack 以 1 退出）
  local found=0 seen=""
  for cand in "/storage/emulated/0/我的文件/my-pi-age.key" "$HOME/.config/my-pi/age.key.bak" "$ROOT/my-pi-age.key" /storage/emulated/0/*/*age*.key /storage/emulated/0/*/*.age.key; do
    [ -f "$cand" ] || continue
    case "$cand" in "$KEY") continue ;; esac
    case " $seen " in *" $cand "*) continue ;; esac
    seen="$seen $cand"
    warn "发现明文私钥副本：$cand（建议移出共享存储/仓库，只保留 $KEY + 离线备份）"
    found=1
  done
  if [ "$found" = "0" ]; then ok "未在共享存储/仓库发现明文私钥副本"; fi
  return 0
}

cmd_pack() {
  need_age
  [ -f "$KEY" ] || die "私钥不存在：$KEY（先跑 bash scripts/sync-memory.sh init）"
  # 私钥绝不能在仓库内（否则会被 git 看见）
  case "$(cd "$(dirname "$KEY")" && pwd)/$(basename "$KEY")" in
    "$ROOT"/*) die "私钥位于仓库内（$KEY）——请先移到仓库外（如 ~/.config/my-pi/age.key）" ;;
  esac
  local fp; fp="$(fingerprint_of "$KEY")" || die "无法从私钥导出公钥（文件损坏？）"
  if [ -f "$PUB" ]; then
    local pub; pub="$(tr -d '[:space:]' < "$PUB")"
    [ "$fp" = "$pub" ] || die "sync/age.pub 与私钥不匹配（换密钥后忘了刷新？先跑 sync-memory.sh init）"
  fi
  if [ -f "$BUNDLE" ] && [ "${1:-}" != "--force" ]; then
    die "引导包已存在：$BUNDLE（确要覆盖加 --force）"
  fi

  STAGE="$(mktemp -d)"
  local stage="$STAGE"
  install -m 600 "$KEY" "$stage/$MEMBER_KEY"
  mkdir -p "$stage/bootstrap"
  cat > "$stage/$MEMBER_README" <<EOF
my-pi age 引导包（方案 A）
生成时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)
密钥指纹：$fp
仓库：$(git -C "$ROOT" remote get-url origin 2>/dev/null || echo '(未知)')

包含：age.key（解密 portable/memory 加密同步物所需的私钥）+ 本说明。
不含：SSH 私钥、auth.json、settings.json 的 deviceId —— 这些不要放进来。

新设备恢复：
  1) 生成新的 SSH key 并在 GitHub 网页（密码 + 2FA）添加公钥（不要搬运旧私钥）；
  2) git clone <仓库>；
  3) bash scripts/bootstrap-key.sh unpack --yes     # 输口令
  4) bash scripts/sync-memory.sh verify && bash scripts/sync-memory.sh pull
口令来源与轮换步骤见 sync/README.md「引导包」一节。
EOF
  # 白名单断言：stage 里只能有这两个成员
  local members; members="$(cd "$stage" && find . -type f | sed 's|^\./||' | sort | tr '\n' ' ')"
  [ "$members" = "$MEMBER_KEY $MEMBER_README " ] || die "引导包成员不在白名单内：$members"

  mkdir -p "$(dirname "$BUNDLE")"
  local umask_old; umask_old="$(umask)"; umask 077
  if [ "$MODE" = "recipient" ]; then
    [ -n "${MY_PI_BOOTSTRAP_RECIPIENT:-}" ] || die "recipient 模式需要 MY_PI_BOOTSTRAP_RECIPIENT（仅测试用）"
    tar -czf - -C "$stage" . | age -r "$MY_PI_BOOTSTRAP_RECIPIENT" -o "$BUNDLE" || die "打包失败"
  else
    echo "请输入引导包口令（建议 ≥6 词 diceware 或 20+ 随机字符，不复用其它口令）："
    tar -czf - -C "$stage" . | age -p -o "$BUNDLE" || die "打包失败（口令不一致或中断）"
  fi
  umask "$umask_old"
  chmod 644 "$BUNDLE"

  local sha; sha="$(sha256sum "$BUNDLE" | awk '{print $1}')"
  cat > "$META" <<EOF
{
  "tool": "bootstrap-key.sh $TOOL_VERSION",
  "mode": "$MODE",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bundle": "$(basename "$BUNDLE")",
  "bundle_sha256": "$sha",
  "bundle_bytes": $(wc -c < "$BUNDLE"),
  "members": ["$MEMBER_KEY", "$MEMBER_README"],
  "age_recipient_fingerprint": "$fp",
  "contains_ssh_key": false,
  "note": "只装 age 私钥（解密材料）。SSH 私钥请在新设备重新生成并在 GitHub 网页添加公钥。"
}
EOF
  ok "引导包已生成：$BUNDLE（$(wc -c < "$BUNDLE") 字节，sha256 ${sha:0:12}…）"
  ok "元信息：$META（明文、不含秘密）"
  ok "密钥指纹：$fp"
  warn_plaintext_copies
  echo "下一步：git add sync/bootstrap.age sync/bootstrap.meta.json && git commit -m 'chore(sync): 更新私钥引导包'"
}

# 解密到临时目录并校验（verify 与 unpack 共用）
decrypt_to_stage() {
  local stage="$1"
  [ -f "$BUNDLE" ] || die "引导包不存在：$BUNDLE（先在有私钥的设备上 pack）"
  need_age
  if [ "$MODE" = "recipient" ]; then
    [ -f "$KEY" ] || die "recipient 模式需要本地私钥解密：$KEY"
    age -d -i "$KEY" -o "$stage/memory.tar" "$BUNDLE" || die "解密失败"
  else
    age -d -o "$stage/memory.tar" "$BUNDLE" || die "解密失败（口令错误？）"
  fi
  tar -xzf "$stage/memory.tar" -C "$stage" || die "解包失败（不是预期 tar？）"
  local members; members="$(cd "$stage" && find . -type f ! -name memory.tar | sed 's|^\./||' | sort | tr '\n' ' ')"
  case "$members" in
    "$MEMBER_KEY $MEMBER_README "|"$MEMBER_README $MEMBER_KEY ") : ;;
    *) die "引导包含非白名单成员：$members（拒绝继续——仓库里的引导包被替换过？）" ;;
  esac
  [ -f "$stage/$MEMBER_KEY" ] || die "引导包缺少 $MEMBER_KEY"
}

cmd_verify() {
  STAGE="$(mktemp -d)"
  local stage="$STAGE"
  decrypt_to_stage "$stage"
  local fp; fp="$(fingerprint_of "$stage/$MEMBER_KEY")" || die "解出的私钥无法导出公钥"
  ok "引导包可解密，成员：$(ls -1 "$stage/bootstrap" 2>/dev/null | tr '\n' ' ')$MEMBER_KEY"
  ok "解出私钥指纹：$fp"
  if [ -f "$PUB" ]; then
    local pub; pub="$(tr -d '[:space:]' < "$PUB")"
    if [ "$fp" = "$pub" ]; then ok "与 sync/age.pub 一致（可解当前仓库的 memory.tar.age）"
    else die "与 sync/age.pub 不一致 → 该引导包解不开当前加密同步物（需要重做 pack）"; fi
  else
    warn "未找到 sync/age.pub，跳过一致性核对"
  fi
  [ -f "$META" ] && ok "元信息：$(tr -d '\n' < "$META" | head -c 200)…"
  warn_plaintext_copies
}

cmd_unpack() {
  local force="${1:-}"
  need_age
  if [ -f "$KEY" ] && [ "$force" != "--yes" ]; then
    die "私钥已存在：$KEY（覆盖请加 --yes；旧私钥会被 .bak 备份）"
  fi
  STAGE="$(mktemp -d)"
  local stage="$STAGE"
  decrypt_to_stage "$stage"
  local fp; fp="$(fingerprint_of "$stage/$MEMBER_KEY")" || die "解出的私钥无法导出公钥"
  if [ -f "$PUB" ]; then
    local pub; pub="$(tr -d '[:space:]' < "$PUB")"
    [ "$fp" = "$pub" ] || die "指纹与 sync/age.pub 不一致（$fp ≠ $pub）——拒绝安装"
  fi
  mkdir -p "$(dirname "$KEY")"; chmod 700 "$(dirname "$KEY")"
  [ -f "$KEY" ] && cp -p "$KEY" "$KEY.bak.$(date +%s)"
  install -m 600 "$stage/$MEMBER_KEY" "$KEY"
  ok "已安装私钥：$KEY（600）指纹 $fp"
  echo "下一步：bash scripts/sync-memory.sh verify && bash scripts/sync-memory.sh pull"
  warn_plaintext_copies
}

case "${1:-help}" in
  pack)   shift; cmd_pack "$@" ;;
  verify) cmd_verify ;;
  unpack) shift; cmd_unpack "${1:-}" ;;
  help|*) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
