#!/usr/bin/env bash
# sync-memory.sh — 长期记忆 / 选定会话的加密同步（age）
#
# 目的：把 gitignore 的记忆与会话有选择地加密后纳入 GitHub，便于跨设备继续任务。
# 仓库只提交密文（sync/memory.tar.age）；明文始终不落库。
#
# 用法：
#   bash scripts/sync-memory.sh init          # 生成 age 密钥（私钥在仓库外）并写公钥到 sync/age.pub
#   bash scripts/sync-memory.sh push          # 打包清单内文件 → age 加密 → sync/memory.tar.age
#   bash scripts/sync-memory.sh pull          # 解密 → 备份现有文件 → 覆盖回填
#   bash scripts/sync-memory.sh verify        # 校验密文可解密 + 清单一致 + JSON 有效（需私钥）
#   bash scripts/sync-memory.sh verify --no-key  # 无私钥时仅做密文头部/完整性检查
#   bash scripts/sync-memory.sh status        # 查看密钥/密文/清单状态与密钥指纹
#
# 环境变量：
#   MY_PI_AGE_KEY        私钥路径（默认 ~/.config/my-pi/age.key；务必自行备份，丢失=记忆不可解）
#   MY_PI_AGE_RECIPIENT  覆盖收件人（默认读 sync/age.pub）
#   MY_PI_SYNC_DIR       覆盖 sync 目录（默认 <root>/sync；测试用）
#
# 会话白名单：sync/manifest.txt（每行一个相对仓库根的路径，# 注释）。
# 未创建时默认只含核心记忆文件；把要同步的会话 JSONL 路径加入即可（"部分会话"）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_DIR="${MY_PI_SYNC_DIR:-$ROOT/sync}"
MANIFEST="$SYNC_DIR/manifest.txt"
BUNDLE="$SYNC_DIR/memory.tar.age"
PUB="$SYNC_DIR/age.pub"
KEY="${MY_PI_AGE_KEY:-$HOME/.config/my-pi/age.key}"

die() { echo "错误：$*" >&2; exit 1; }
need_age() {
  command -v age >/dev/null 2>&1 || die "未找到 age。安装：Debian/Ubuntu 'apt install age'；Termux 'pkg install age'；或见 https://github.com/FiloSottile/age"
}

file_size() { stat -c%s "$1" 2>/dev/null || wc -c < "$1"; }

# 公钥指纹：用于确认"我备份的那把私钥"是不是当前这把（私钥遗失=记忆不可解，必须能核对）
key_fingerprint() {
  local pub; pub="$(age-keygen -y "$KEY" 2>/dev/null | tr -d '[:space:]')" || return 1
  [ -n "$pub" ] || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$pub" | sha256sum | cut -c1-16
  else
    printf '%s' "$pub" | cksum | awk '{printf "%08x", $1}'
  fi
}

# sync/age.pub 是否由当前私钥导出（跨设备/换密钥后最容易出错的地方）
pub_matches_key() {
  [ -f "$KEY" ] && [ -f "$PUB" ] || return 1
  local derived stored
  derived="$(age-keygen -y "$KEY" 2>/dev/null | tr -d '[:space:]')"
  stored="$(tr -d '[:space:]' < "$PUB")"
  [ -n "$derived" ] && [ "$derived" = "$stored" ]
}

ensure_manifest() {
  mkdir -p "$SYNC_DIR"
  if [ ! -f "$MANIFEST" ]; then
    cat > "$MANIFEST" <<'EOF'
# my-pi 加密同步清单：每行一个相对仓库根的路径（明文，不会入库）。
# 长期记忆：
portable/memory/entries.json
portable/memory/summaries.json
portable/memory/notes.json
# 隔离命名空间记忆（如 roleplay）：
portable/memory/roleplay/entries.json
portable/memory/roleplay/summaries.json
portable/memory/roleplay/notes.json
# 选定会话（示例，按需取消注释并改为真实路径）：
# portable/agent/sessions/-root-my-pi/<session-id>.jsonl
EOF
    echo "已创建默认清单：$MANIFEST（请按需增删条目）"
  fi
}

manifest_entries() { grep -vE '^[[:space:]]*(#|$)' "$MANIFEST" 2>/dev/null || true; }

existing_list() {
  local tmp; tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    [ -f "$ROOT/$line" ] && printf '%s\n' "$line" >> "$tmp"
  done < "$MANIFEST"
  printf '%s' "$tmp"
}

cmd_init() {
  need_age
  mkdir -p "$(dirname "$KEY")"
  if [ ! -f "$KEY" ]; then
    age-keygen -o "$KEY"
    chmod 600 "$KEY"
    echo "已生成私钥：$KEY（请立即备份到安全位置，切勿提交）"
  else
    echo "私钥已存在：$KEY"
  fi
  mkdir -p "$SYNC_DIR"
  age-keygen -y "$KEY" > "$PUB"
  echo "公钥已写入：$PUB（随仓库提交）"
  echo "密钥指纹：$(key_fingerprint)（请连同私钥备份一并记下，换机时用于核对）"
  ensure_manifest
}

cmd_push() {
  need_age
  [ -f "$PUB" ] || die "缺少 $PUB，先运行 init"
  ensure_manifest
  local list; list="$(existing_list)"
  [ -s "$list" ] || die "清单中没有存在的文件，请编辑 $MANIFEST"
  local recipient="${MY_PI_AGE_RECIPIENT:-$(cat "$PUB")}"
  tar -czf - -C "$ROOT" -T "$list" | age -r "$recipient" -o "$BUNDLE"
  rm -f "$list"
  echo "已加密写入：$BUNDLE"
  echo "下一步：git add sync/ && git commit -m 'chore(sync): 更新加密记忆/会话' && git push"
  if [ "${MY_PI_SYNC_AUTOCOMMIT:-0}" = "1" ]; then
    git -C "$ROOT" add sync/memory.tar.age sync/age.pub sync/manifest.txt 2>/dev/null || true
    git -C "$ROOT" commit -q -m "chore(sync): 更新加密记忆/会话" && echo "已提交（未推送）"
  fi
}

cmd_pull() {
  need_age
  [ -f "$KEY" ] || die "缺少私钥 $KEY（在新设备上用安全方式放置，或设置 MY_PI_AGE_KEY）"
  [ -f "$BUNDLE" ] || die "缺少密文 $BUNDLE（先 git pull）"
  ensure_manifest
  local tmp; tmp="$(mktemp)"
  age -d -i "$KEY" "$BUNDLE" > "$tmp"
  # 覆盖前备份现有清单文件（本地未同步改动可回滚）
  local list; list="$(existing_list)"
  if [ -s "$list" ]; then
    local bak="$SYNC_DIR/.local-backup-$(date +%Y%m%d-%H%M%S).tgz"
    if tar -czf "$bak" -C "$ROOT" -T "$list" 2>/dev/null; then
      echo "已备份现有文件到：$bak"
    fi
    rm -f "$list"
  fi
  tar -xzf "$tmp" -C "$ROOT"
  rm -f "$tmp"
  echo "已回填记忆/会话到 portable/。注意：会话目录按 cwd 转义命名，跨设备路径不同会错位。"
}

# 校验：密文可解密 + 清单一致 + JSON 有效。私钥遗失=记忆不可解，故这是数据资产的关键自检。
cmd_verify() {
  local no_key=0
  [ "${1:-}" = "--no-key" ] && no_key=1
  need_age
  [ -f "$BUNDLE" ] || die "缺少密文 $BUNDLE（先 git pull 或 push）"

  if ! head -c 64 "$BUNDLE" | grep -q 'age-encryption.org/v1'; then
    die "密文头部不是 age v1 格式：$BUNDLE"
  fi
  echo "密文：$BUNDLE（$(file_size "$BUNDLE") 字节，age v1 头部 ✅）"

  ensure_manifest
  if [ "$no_key" = "1" ]; then
    echo "（--no-key）仅完成密文完整性检查；私钥可用时重跑 verify 可校验可解密性与内容"
    return 0
  fi
  if [ ! -f "$KEY" ]; then
    echo "⚠ 未找到私钥 $KEY：无法验证可解密性"
    echo "  放置私钥或设置 MY_PI_AGE_KEY 后重跑；仅做完整性检查用 verify --no-key"
    return 1
  fi
  echo "私钥：$KEY（指纹 $(key_fingerprint)）"
  if [ -f "$PUB" ]; then
    if pub_matches_key; then
      echo "公钥一致性：sync/age.pub 与私钥匹配 ✅"
    else
      echo "公钥一致性：sync/age.pub 与私钥**不匹配** ❌（换过密钥？旧密文将无法解密）"
      return 1
    fi
  fi

  local tmp; tmp="$(mktemp)"
  local err; err="$(mktemp)"
  if ! age -d -i "$KEY" "$BUNDLE" > "$tmp" 2>"$err"; then
    cat "$err" >&2; rm -f "$tmp" "$err"
    die "解密失败：私钥与密文不匹配（或密文损坏）"
  fi
  rm -f "$err"

  local members; members="$(tar -tzf "$tmp")"
  local count total
  count="$(printf '%s\n' "$members" | grep -c . || true)"
  total="$(tar -tzvf "$tmp" | awk '{s+=$3} END {printf "%d", s+0}')"
  echo "内容：${count} 个成员，解压后约 $(( total / 1024 )) KiB"

  local missing=0 extra=0 badjson=0 absent=0
  # 硬校验：清单中**本地存在**的条目必须都在密文里（与 push 的取材口径一致）
  local present; present="$(existing_list)"
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    if ! printf '%s\n' "$members" | grep -qxF "$entry"; then
      echo "  ❌ 本地存在的清单条目缺失于密文：$entry"
      missing=$((missing + 1))
    fi
  done < "$present"
  rm -f "$present"

  # 提示：清单里本地不存在的条目（push 时会跳过，不算失败）
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    [ -f "$ROOT/$entry" ] && continue
    echo "  · 清单条目本地不存在（push 会跳过）：$entry"
    absent=$((absent + 1))
  done < <(manifest_entries)

  while IFS= read -r m; do
    [ -n "$m" ] || continue
    if ! manifest_entries | grep -qxF "$m"; then
      echo "  · 密文含清单外成员：$m"
      extra=$((extra + 1))
    fi
  done <<< "$members"

  if command -v node >/dev/null 2>&1; then
    local m
    while IFS= read -r m; do
      case "$m" in *.json) ;; *) continue ;; esac
      if ! tar -xzOf "$tmp" "$m" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s)}catch{process.exit(1)}})'; then
        echo "  ❌ JSON 解析失败：$m"
        badjson=$((badjson + 1))
      fi
    done <<< "$members"
    [ "$badjson" -eq 0 ] && echo "JSON 校验：通过 ✅"
  else
    echo "（无 node，跳过 JSON 解析校验）"
  fi

  rm -f "$tmp"
  if [ "$missing" -gt 0 ] || [ "$badjson" -gt 0 ]; then
    die "verify 失败：清单缺失 ${missing} 项、JSON 损坏 ${badjson} 项"
  fi
  echo "✓ verify 通过：可解密、清单一致、JSON 有效$([ "$extra" -gt 0 ] && echo "（另有 ${extra} 个清单外成员，仅提示）" || true)"
}

cmd_status() {
  echo "仓库根：$ROOT"
  echo "sync 目录：$SYNC_DIR"
  echo "私钥：$KEY $([ -f "$KEY" ] && echo "(存在)" || echo "(缺失)")"
  echo "公钥：$PUB $([ -f "$PUB" ] && echo '(存在)' || echo '(缺失)')"
  echo "密文：$BUNDLE $([ -f "$BUNDLE" ] && echo "(存在, $(file_size "$BUNDLE") 字节)" || echo '(缺失)')"
  echo "清单：$MANIFEST $([ -f "$MANIFEST" ] && echo "(存在, $(manifest_entries | grep -c . || true) 条)" || echo '(缺失)')"
  command -v age >/dev/null 2>&1 && echo "age：$(age --version 2>/dev/null || echo 已安装)" || echo "age：(未安装)"
  if [ -f "$KEY" ]; then
    echo "密钥指纹：$(key_fingerprint)"
    if [ -f "$PUB" ]; then
      pub_matches_key && echo "公钥一致性：匹配 ✅" || echo "公钥一致性：不匹配 ❌（换过密钥？）"
    fi
    echo "提示：私钥遗失=记忆不可解，请确认已另行备份（备份时记下上面的指纹）。"
  else
    echo "⚠ 无私钥：无法 pull/verify；从备份恢复私钥后重试。"
  fi
}

case "${1:-status}" in
  init) cmd_init ;;
  push) cmd_push ;;
  pull) cmd_pull ;;
  verify) shift || true; cmd_verify "${1:-}" ;;
  status) cmd_status ;;
  *) die "用法：$0 {init|push|pull|verify [--no-key]|status}" ;;
esac
