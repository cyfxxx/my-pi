#!/usr/bin/env bash
# sync-memory.sh — 长期记忆 / 选定会话的加密同步（age）
#
# 目的：把 gitignore 的记忆与会话有选择地加密后纳入 GitHub，便于跨设备继续任务。
# 仓库只提交密文（sync/memory.tar.age）；明文始终不落库。
#
# 用法：
#   bash scripts/sync-memory.sh init    # 生成 age 密钥（私钥在仓库外）并写公钥到 sync/age.pub
#   bash scripts/sync-memory.sh push    # 打包清单内文件 → age 加密 → sync/memory.tar.age
#   bash scripts/sync-memory.sh pull    # 解密 → 备份现有文件 → 覆盖回填
#   bash scripts/sync-memory.sh status  # 查看密钥/密文/清单状态
#
# 环境变量：
#   MY_PI_AGE_KEY   私钥路径（默认 ~/.config/my-pi/age.key；务必自行备份，丢失=记忆不可解）
#   MY_PI_AGE_RECIPIENT  覆盖收件人（默认读 sync/age.pub）
#
# 会话白名单：sync/manifest.txt（每行一个相对仓库根的路径，# 注释）。
# 未创建时默认只含核心记忆文件；把要同步的会话 JSONL 路径加入即可（"部分会话"）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_DIR="$ROOT/sync"
MANIFEST="$SYNC_DIR/manifest.txt"
BUNDLE="$SYNC_DIR/memory.tar.age"
PUB="$SYNC_DIR/age.pub"
KEY="${MY_PI_AGE_KEY:-$HOME/.config/my-pi/age.key}"

die() { echo "错误：$*" >&2; exit 1; }
need_age() {
  command -v age >/dev/null 2>&1 || die "未找到 age。安装：Debian/Ubuntu 'apt install age'；Termux 'pkg install age'；或见 https://github.com/FiloSottile/age"
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

cmd_status() {
  echo "仓库根：$ROOT"
  echo "私钥：$KEY $([ -f "$KEY" ] && echo '(存在)' || echo '(缺失)')"
  echo "公钥：$PUB $([ -f "$PUB" ] && echo '(存在)' || echo '(缺失)')"
  echo "密文：$BUNDLE $([ -f "$BUNDLE" ] && echo "(存在, $(stat -c%s "$BUNDLE" 2>/dev/null || wc -c < "$BUNDLE") 字节)" || echo '(缺失)')"
  echo "清单：$MANIFEST $([ -f "$MANIFEST" ] && echo '(存在)' || echo '(缺失)')"
  command -v age >/dev/null 2>&1 && echo "age：$(age --version 2>/dev/null || echo 已安装)" || echo "age：(未安装)"
}

case "${1:-status}" in
  init) cmd_init ;;
  push) cmd_push ;;
  pull) cmd_pull ;;
  status) cmd_status ;;
  *) die "用法：$0 {init|push|pull|status}" ;;
esac
