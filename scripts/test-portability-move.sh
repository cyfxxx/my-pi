#!/usr/bin/env bash
# test-portability-move.sh — **真实搬移测试**：把仓库整棵拷到另一个路径后仍然可用
#
# ## 为什么必须"真搬"
#
# 便携性的失效形态都很安静：`~/.local/share/pi-node` 里的 Node、`/opt/searxng` 的 venv、
# `~/.npm` 缓存——在本机跑得好好的，只在**换路径/换机器**时爆。守门脚本
# (`scripts/check-portability.sh`) 查的是"代码里还写不写仓外路径"，本项目纪律要求
# **可复跑的证据**（不是"我检查过了"），所以这里做一次端到端搬迁：
#
#   ① 硬链接整树复制到 `/tmp/my-pi-moved-<pid>`（省时省空间，秒级）
#   ② **清空环境**（`env -i`，PATH 只有 /usr/bin:/bin，HOME 指到仓内假目录）后：
#      - `./my-pi.sh --version` ⇒ 必须打印版本，且启动行里的 node 路径**必须在新仓库下**
#      - 便携 python + 站点包：`import pypdf/PIL` ⇒ 必须成功
#      - `portable-runtime.sh verify` ⇒ 必须全绿（node/python/caches 都在新仓库内）
#   ③ SearXNG 在新路径启动 + 真实 JSON 搜索 ⇒ 有结果（证明源码/依赖/settings 全部可搬）
#   ④ 扫旧路径残留（只报告，判定以 ②③ 的功能事实为准）
#
# 用法：bash scripts/test-portability-move.sh
#   PI_MOVE_DEST=<dir>        指定目标（默认 /tmp/my-pi-moved-$$；必须不存在或为空）
#   PI_MOVE_KEEP=1            测完不删（排查用）
#   PI_MOVE_PORT=<port>       搬迁实例的 SearXNG 端口（默认 8897，避开在跑的 8889）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${PI_MOVE_DEST:-/tmp/my-pi-moved-$$}"
PORT="${PI_MOVE_PORT:-8897}"
KEEP="${PI_MOVE_KEEP:-0}"

PASS=0; FAILN=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
bad() { echo "  ❌ $1"; FAILN=$((FAILN + 1)); }
info(){ echo "  → $1"; }

# 安全护栏：删除前必须确认目标是我们自己造的前缀目录（防 rm -rf 打偏）
case "$DEST" in
  /tmp/my-pi-moved-*|/tmp/*/my-pi-moved-*) : ;;
  *) echo "拒绝执行：PI_MOVE_DEST 必须是 /tmp/ 下的 my-pi-moved-* 目录（当前：$DEST）" >&2; exit 2 ;;
esac

echo "=== 便携性搬移测试 ==="
echo "  源仓库：$ROOT"
echo "  目标  ：$DEST"

# ── 1. 整树复制（tar 管道；跳过 .git 与 packs/）──────────────────────────────
# ★ 为什么**绝不能**用 `cp -al`（硬链接复制）——实测教训（2026-10-15）：
#   ① 在 npm workspace 的符号链接上它返回 `Operation not permitted`（GNU cp 的 `-l` 不为
#      符号链接建硬链接）；
#   ② 更糟的是它**会改到源**：本机 PRoot/FUSE 层在"覆盖更短的链接目标"时不截断尾部，
#      于是 `cp -al` 把**源仓库** runtime 下的 545 个符号链接写成了 `xxx0001`（并删掉了
#      `py/bin/python3`），本次靠 `python3` 悬空后静默回退到系统解释器才暴露。
#   ③ proot 下"每文件一次硬链接系统调用"比按字节复制更慢（vendor 一个子树就 3 分钟）。
# tar 管道是实测最快的可靠方式（不碰符号链接语义）。跳过 `.git`（10 万文件）与
# `packs/`（14 MB，与本次判据无关）后更省。
rm -rf "$DEST"
mkdir -p "$DEST"
info "整树复制（tar 管道，跳过 .git 与 packs/；proot 下约 3-6 分钟）..."
if ! ( cd "$ROOT" && tar -cf - --exclude=./.git --exclude=./packs . ) | ( cd "$DEST" && tar -xf - ); then
  echo "复制失败" >&2; exit 2
fi
# verify 里用 `git check-ignore` 判 runtime 是否被忽略 ⇒ 目标侧需要一个 git 仓库（.gitignore 已随复制过来）
( cd "$DEST" && git init -q 2>/dev/null ) || true
ok "已复制到 $DEST（$(du -sh "$DEST" 2>/dev/null | awk '{print $1}')）"

# ── 2. 清空环境后启动 ───────────────────────────────────────────────────────
FAKEHOME="$DEST/.fakehome"; mkdir -p "$FAKEHOME"
# 最小 PATH：只给 /usr/bin:/bin + git 所在目录。**不给** node/python 的路径——
# 若 my-pi 仍依赖系统 node/python，这一步就会失败（这正是本测试要抓的）。
GITDIR="$(dirname "$(command -v git 2>/dev/null || echo /usr/bin/git)")"
MINPATH="$GITDIR:/usr/bin:/bin"
info "用**最小环境**（PATH=$MINPATH、HOME=$FAKEHOME）启动..."
MOVE_OUT="$(cd "$DEST" && env -i PATH="$MINPATH" HOME="$FAKEHOME" TERM=dumb bash -c './my-pi.sh --version' 2>&1)"
echo "$MOVE_OUT" | sed 's/^/      | /'
case "$MOVE_OUT" in
  *1.2.0*) ok "搬迁后 my-pi.sh 可用（打印出版本）" ;;
  *) bad "搬迁后 my-pi.sh 未打印版本" ;;
esac
case "$MOVE_OUT" in
  *"$DEST/runtime/"*) ok "用的是**新路径**下的 node（$DEST/runtime/...）" ;;
  *) bad "启动行里的 node 不在新仓库内 ⇒ 仍依赖仓外运行时" ;;
esac
case "$MOVE_OUT" in
  *"/root/my-pi"*) bad "输出里仍出现**旧仓库路径** ⇒ 有绝对路径被写死" ;;
  *) ok "输出中不含旧仓库路径" ;;
esac

# ── 3. 便携 python + 站点包（新路径）────────────────────────────────────────
info "便携 python + 站点包导入自证..."
PY_OUT="$(cd "$DEST" && env -i PATH="$MINPATH" HOME="$FAKEHOME" bash -c '
  . scripts/lib-portable.sh
  pi_portable_env
  python3 -c "import sys,pypdf,PIL,pdfplumber,pymupdf; print(sys.executable); print(\"imports ok\")"' 2>&1)"
echo "$PY_OUT" | sed 's/^/      | /'
case "$PY_OUT" in
  *"$DEST/runtime/"*"imports ok"*) ok "搬迁后便携 python 与站点包可用（含 pypdf/PIL/pdfplumber/pymupdf）" ;;
  *) bad "搬迁后便携 python/站点包不可用" ;;
esac

# ── 4. 搬迁后的自证（node/python/缓存都在新仓库内）───────────────────────────
info "portable-runtime.sh verify（在新仓库执行）..."
V_OUT="$(cd "$DEST" && env -i PATH="$MINPATH" HOME="$FAKEHOME" bash -c 'bash scripts/portable-runtime.sh verify' 2>&1)"
echo "$V_OUT" | sed 's/^/      | /'
case "$V_OUT" in
  *"🎉 便携化自证全部通过"*) ok "新路径下便携化自证全绿" ;;
  *) bad "新路径下便携化自证未通过" ;;
esac

# ── 5. SearXNG 搬迁实测（源码/依赖/settings 全在仓内）────────────────────────
info "在新路径启动 SearXNG（端口 $PORT）并跑一次真实搜索..."
(cd "$DEST" && SEARXNG_PORT="$PORT" bash scripts/setup-external.sh searxng >/tmp/move-searxng.log 2>&1) || true
sleep 2
SX_CODE="$(curl -s -o /tmp/move-sx.json -w '%{http_code}' --max-time 30 "http://127.0.0.1:$PORT/search?q=%E4%BE%BF%E6%90%BA%E6%80%A7&format=json" 2>/dev/null)"
SX_N="$(python3 -c "import json;print(len(json.load(open('/tmp/move-sx.json')).get('results',[])))" 2>/dev/null || echo 0)"
if [ "$SX_CODE" = "200" ] && [ "${SX_N:-0}" -gt 0 ]; then
  ok "搬迁后 SearXNG 可用（http=$SX_CODE，结果 $SX_N 条）"
else
  bad "搬迁后 SearXNG 不可用（http=$SX_CODE，结果 ${SX_N:-0} 条；日志 /tmp/move-searxng.log）"
fi
(cd "$DEST" && bash scripts/setup-external.sh searxng-stop >/dev/null 2>&1) || true

# ── 6. 旧路径残留扫描（只报告）─────────────────────────────────────────────
REMAIN="$(grep -rl "$ROOT" "$DEST/runtime" 2>/dev/null | head -10 | sed "s|$DEST|.|")"
if [ -n "$REMAIN" ]; then
  info "runtime 下仍有文本引用旧路径（多为 pip RECORD 元数据；功能由上面 3/5 步证明）："
  printf '%s\n' "$REMAIN" | sed 's/^/      · /'
else
  ok "runtime 下无文本引用旧路径"
fi

# ── 7. 清理 ────────────────────────────────────────────────────────────────
if [ "$KEEP" = "1" ]; then
  info "PI_MOVE_KEEP=1 ⇒ 保留 $DEST 供排查"
else
  case "$DEST" in
    /tmp/my-pi-moved-*|/tmp/*/my-pi-moved-*) rm -rf "$DEST"; info "已清理 $DEST" ;;
    *) bad "目标路径不匹配安全前缀，拒绝删除：$DEST" ;;
  esac
fi

echo ""
if [ "$FAILN" -eq 0 ]; then
  echo "🎉 搬移测试全部通过（$PASS 项）"
  exit 0
fi
echo "❌ 搬移测试失败 $FAILN 项（通过 $PASS 项）"
exit 1
