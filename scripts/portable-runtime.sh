#!/usr/bin/env bash
# portable-runtime.sh — 把运行时与依赖**装进仓库**（完全便携化的引导器）
#
# ## 解决什么
#
# Linux 侧此前"能跑"但**不便携**：Node 在 `~/.local/share/pi-node`、SearXNG/whisper 的
# venv 在 `/opt/*`、npm 缓存写 `~/.npm`。把仓库搬到另一台机器（或另一个路径）就散架。
# 本脚本按 `scripts/portable-artifacts.txt` 的清单，把官方发布物**校验 sha256 后**解包进
# `<repo>/runtime/<平台>/`，之后 `my-pi.sh` / supervisor / 各守门脚本自动优先用仓内版本
# （解析逻辑见 `scripts/lib-portable.sh`）。
#
# ## 用法
#
#   bash scripts/portable-runtime.sh status          # 现在处于什么状态（只读）
#   bash scripts/portable-runtime.sh node            # 装便携 Node（默认平台）
#   bash scripts/portable-runtime.sh python          # 装便携 CPython
#   bash scripts/portable-runtime.sh deps [profile…] # 装 pack 依赖到仓内站点目录
#   bash scripts/portable-runtime.sh env             # 打印 eval 用的环境（不安装）
#   bash scripts/portable-runtime.sh searxng         # 把 SearXNG 源码+依赖装进仓库（web_search 后端）
#   bash scripts/portable-runtime.sh repair          # 从已校验缓存重解包运行时（符号链接被污染时自愈）
#   bash scripts/portable-runtime.sh verify          # 自证：版本/落点/导入/无仓外写入
#   bash scripts/portable-runtime.sh all             # node + python + 默认依赖
#
# 依赖 profile（默认 `pdf media game`）：
#   pdf   → packs/pdf-toolkit/requirements.txt
#   media → packs/media-toolkit/requirements.txt
#   game  → packs/gamedev/skills/design/create-game-assets/scripts/requirements.txt
#   voice → faster-whisper + opencc（重，按需）
#   sherpa→ sherpa-onnx + numpy（重，按需）
#
# 可选环境变量：
#   PORTABLE_MIRROR_NODE   覆盖 Node 镜像前缀（逗号或空格分隔多个）
#   PORTABLE_NO_VERIFY=1   跳过 sha256 校验（**只用于调试**，正常流程不允许）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib-portable.sh
. "$ROOT/scripts/lib-portable.sh"

ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠ $1"; }
info() { echo "  → $1"; }
bad()  { echo "  ✗ $1" >&2; }

PLATFORM="$(pi_platform)"
RUNTIME="$(pi_runtime_root)"

# ── 清单解析（纯 bash，不依赖 jq/python，保证冷启动可用）──────────────────────
MANIFEST="$(pi_portable_artifacts_file)"
NODE_VERSION=""; NODE_MIN=""; NODE_MIRRORS=""
PYTHON_VERSION=""; PYTHON_RELEASE=""; PYTHON_URL=""; GITHUB_PROXIES=""
SEARXNG_COMMIT=""; SEARXNG_URL=""
PIP_INDEX=""; PIP_HOST=""

read_manifest() {
  [ -f "$MANIFEST" ] || { bad "缺少清单文件 $MANIFEST"; return 1; }
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in
      *=*) key="${line%%=*}"; val="${line#*=}"
           case "$key" in
             node_version) NODE_VERSION="$val" ;;
             node_min) NODE_MIN="$val" ;;
             node_mirrors) NODE_MIRRORS="$val" ;;
             python_version) PYTHON_VERSION="$val" ;;
             python_release) PYTHON_RELEASE="$val" ;;
             python_url) PYTHON_URL="$val" ;;
             github_proxies) GITHUB_PROXIES="$val" ;;
             searxng_commit) SEARXNG_COMMIT="$val" ;;
             searxng_url) SEARXNG_URL="$val" ;;
             pip_index) PIP_INDEX="$val" ;;
             pip_host) PIP_HOST="$val" ;;
           esac ;;
      *) : ;;  # 制品行由 artifact_lookup 单独读取
    esac
  done < "$MANIFEST"
  [ -n "$NODE_VERSION" ] || { bad "清单里没有 node_version"; return 1; }
  return 0
}

# artifact_lookup <kind> <platform> → 打印 "<file> <sha256>"；未命中返回 1
artifact_lookup() {
  local kind="$1" plat="$2" line k p file sha
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*|*=*) continue ;; esac
    IFS=$'\t' read -r k p file sha <<<"$line"
    [ "$k" = "$kind" ] || continue
    if [ "$p" = "$plat" ] || [ "$p" = "any" ]; then
      printf '%s %s' "$file" "$sha"; return 0
    fi
  done < "$MANIFEST"
  return 1
}

pi_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else return 1; fi
}

download_dir() { printf '%s/downloads' "$(pi_runtime_legacy_root)"; }

# download_verified <urls(空格分隔)> <file> <sha256> → 打印下载后的绝对路径
download_verified() {
  local urls="$1" file="$2" sha="$3" dir dest url got
  dir="$(download_dir)"; mkdir -p "$dir"
  dest="$dir/$file"
  if [ -f "$dest" ]; then
    got="$(pi_sha256_file "$dest" || echo '')"
    if [ "$got" = "$sha" ]; then ok "已缓存且校验通过：$dest" >&2; printf '%s' "$dest"; return 0; fi
    warn "缓存文件校验不符，重新下载：$dest" >&2
    rm -f "$dest"
  fi
  for url in $urls; do
    info "下载 $url" >&2
    if curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 -C - -o "$dest.partial" "$url" 2>/dev/null; then
      mv -f "$dest.partial" "$dest"
    else
      warn "下载失败：$url" >&2; rm -f "$dest.partial"; continue
    fi
    if [ "${PORTABLE_NO_VERIFY:-0}" = "1" ]; then
      warn "PORTABLE_NO_VERIFY=1 ⇒ 跳过 sha256 校验（仅调试）" >&2
      printf '%s' "$dest"; return 0
    fi
    got="$(pi_sha256_file "$dest" || echo '')"
    if [ "$got" = "$sha" ]; then ok "sha256 校验通过（$(du -h "$dest" | awk '{print $1}')）" >&2; printf '%s' "$dest"; return 0; fi
    bad "sha256 不符：期望 $sha 实际 $got ⇒ 丢弃（防投毒/防截断）"
    rm -f "$dest"
  done
  return 1
}

# 解包（去掉顶层目录）到目标；先解到临时目录，成功后再整体替换，避免半途失败留下脏树
extract_strip1() {
  local archive="$1" dest="$2" tmp
  tmp="$dest.tmp-$$"
  rm -rf "$tmp"; mkdir -p "$tmp"
  case "$archive" in
    *.tar.xz)  tar -xJf "$archive" -C "$tmp" --strip-components=1 || { rm -rf "$tmp"; return 1; } ;;
    *.tar.gz|*.tgz) tar -xzf "$archive" -C "$tmp" --strip-components=1 || { rm -rf "$tmp"; return 1; } ;;
    *.zip)     command -v unzip >/dev/null 2>&1 || { bad "需要 unzip 解 .zip"; rm -rf "$tmp"; return 1; }
               unzip -q "$archive" -d "$tmp/_z" || { rm -rf "$tmp"; return 1; }
               mv "$tmp/_z"/*/* "$tmp"/ 2>/dev/null || true
               rm -rf "$tmp/_z" ;;
    *) bad "未知归档类型：$archive"; rm -rf "$tmp"; return 1 ;;
  esac
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  mv "$tmp" "$dest"
}

# ── 子命令 ──────────────────────────────────────────────────────────────────
cmd_status() {
  read_manifest >/dev/null 2>&1 || true
  echo "=== 便携运行时状态 ==="
  pi_portable_status
  local rt; rt="$(pi_runtime_root)"
  echo "  清单：node v${NODE_VERSION:-?}（下限 ${NODE_MIN:-?}）/ python ${PYTHON_VERSION:-?}（${PYTHON_RELEASE:-?}）"
  [ -d "$rt/node" ] && ok "runtime/<平台>/node 已就绪" || warn "runtime/<平台>/node 未安装（portable-runtime.sh node）"
  [ -x "$rt/py/bin/python3" ] && ok "runtime/<平台>/py 已就绪" || warn "runtime/<平台>/py 未安装（portable-runtime.sh python）"
  local site; site="$(pi_py_site)"
  if [ -d "$site" ]; then ok "站点包 $(ls -1 "$site" 2>/dev/null | wc -l) 个顶层条目（仓内）"; else warn "站点包未创建（portable-runtime.sh deps）"; fi
}

cmd_node() {
  read_manifest || exit 1
  local spec file sha urls dir mirror
  spec="$(artifact_lookup node "$PLATFORM")" || { bad "清单里没有 $PLATFORM 的 node 制品（可用平台：$(awk -F'\t' '$1=="node"{print $2}' "$MANIFEST" | tr '\n' ' ')）"; exit 1; }
  file="${spec%% *}"; sha="${spec##* }"
  # 两个镜像都是 `<前缀>/v<版本>/<文件>` 的形状（nodejs.org 的前缀自带 /dist）⇒ 直接拼
  urls=""
  for mirror in ${PORTABLE_MIRROR_NODE:-$NODE_MIRRORS}; do
    urls="$urls $mirror/v$NODE_VERSION/$file"
  done
  dir="$(download_verified "$urls" "$file" "$sha")" || { bad "Node 下载/校验失败"; exit 1; }
  info "解包到 $RUNTIME/node"
  extract_strip1 "$dir" "$RUNTIME/node" || { bad "解包失败"; exit 1; }
  if _pi_node_ok "$RUNTIME/node/bin/node"; then
    ok "便携 Node 就绪：$RUNTIME/node/bin/node（$("$RUNTIME/node/bin/node" -v)）"
  elif _pi_node_ok "$RUNTIME/node/node"; then
    ok "便携 Node 就绪：$RUNTIME/node/node"
  else
    bad "解包后未找到可用的 node（检查归档布局是否变化）"; exit 1
  fi
}

cmd_python() {
  read_manifest || exit 1
  local spec file sha url dir found
  spec="$(artifact_lookup python "$PLATFORM")" || { bad "清单里没有 $PLATFORM 的 python 制品（可用平台：$(awk -F'\t' '$1=="python"{print $2}' "$MANIFEST" | tr '\n' ' ')）"; exit 1; }
  file="${spec%% *}"; sha="${spec##* }"
  url="${PYTHON_URL//\{release\}/$PYTHON_RELEASE}"
  url="${url//\{file\}/$file}"
  # 直连优先；GitHub 在本网络下时通时断，故按清单追加代理前缀兜底（内容仍由 sha256 兜住）
  local urls="$url" proxy
  for proxy in ${PORTABLE_MIRROR_GITHUB:-$GITHUB_PROXIES}; do
    urls="$urls ${proxy}${url}"
  done
  dir="$(download_verified "$urls" "$file" "$sha")" || { bad "Python 下载/校验失败"; exit 1; }
  info "解包到 $RUNTIME/py"
  extract_strip1 "$dir" "$RUNTIME/py" || { bad "解包失败"; exit 1; }
  local py="$RUNTIME/py/bin/python3"
  [ -x "$py" ] || py="$RUNTIME/py/bin/python3.12"
  if [ -x "$py" ]; then
    ok "便携 Python 就绪：$py（$("$py" -V 2>&1)）"
    if ! "$py" -m pip --version >/dev/null 2>&1; then
      info "该解释器没有 pip，尝试 ensurepip"
      "$py" -m ensurepip --upgrade >/dev/null 2>&1 && ok "pip 已就绪" || warn "ensurepip 失败，装依赖时再处理"
    fi
  else
    bad "解包后未找到 $RUNTIME/py/bin/python3"; exit 1
  fi
}

# profile → requirement 文件（相对仓库根）
profile_requirements() {
  case "$1" in
    pdf)   printf '%s' "packs/pdf-toolkit/requirements.txt" ;;
    media) printf '%s' "packs/media-toolkit/requirements.txt" ;;
    game)  printf '%s' "packs/gamedev/skills/design/create-game-assets/scripts/requirements.txt" ;;
    *) return 1 ;;
  esac
}

profile_extra_packages() {
  case "$1" in
    voice)  printf '%s' "faster-whisper opencc-python-reimplemented" ;;
    sherpa) printf '%s' "sherpa-onnx numpy" ;;
    *) return 1 ;;
  esac
}

cmd_deps() {
  read_manifest >/dev/null 2>&1 || true
  local allow_system=0 profiles=()
  local a
  for a in "$@"; do
    case "$a" in
      --system) allow_system=1 ;;
      *) profiles+=("$a") ;;
    esac
  done
  [ "${#profiles[@]}" -gt 0 ] || profiles=(pdf media game)

  local py; py="$(pi_resolve_python 2>/dev/null)" || { bad "找不到 python 解释器（先跑 portable-runtime.sh python）"; exit 1; }
  if ! pi_is_inside_repo "$py"; then
    if [ "$allow_system" = "1" ]; then
      warn "用**系统** python3（$py）装依赖：包能装进仓库，但解释器仍依赖系统；完全便携请先 bash scripts/portable-runtime.sh python"
    else
      bad "当前解析到的解释器在仓外（$py）⇒ 拒绝继续"
      info "先装便携解释器：bash scripts/portable-runtime.sh python"
      info "确实要用系统 python3（临时/受限环境）：bash scripts/portable-runtime.sh deps --system ${profiles[*]}"
      exit 1
    fi
  fi
  local site; site="$(pi_py_site)"
  mkdir -p "$site" "$(pi_pip_cache)"
  info "解释器：$py"
  info "目标站点目录：$site"
  local pipargs=(--no-warn-script-location --disable-pip-version-check --upgrade --upgrade-strategy only-if-needed --target "$site")
  [ -n "$PIP_INDEX" ] && pipargs+=(-i "$PIP_INDEX" --trusted-host "${PIP_HOST:-mirrors.aliyun.com}")
  local p rc=0
  for p in "${profiles[@]}"; do
    local req; req="$(profile_requirements "$p" 2>/dev/null)" || req=""
    if [ -n "$req" ]; then
      if [ -f "$ROOT/$req" ]; then
        info "profile $p → $req"
        "$py" -m pip install "${pipargs[@]}" -r "$ROOT/$req" || rc=1
      else
        warn "profile $p 的依赖清单不存在：$req"
      fi
    else
      local pkgs; pkgs="$(profile_extra_packages "$p" 2>/dev/null)" || pkgs=""
      if [ -n "$pkgs" ]; then
        info "profile $p → $pkgs"
        # shellcheck disable=SC2086
        "$py" -m pip install "${pipargs[@]}" $pkgs || rc=1
      else
        warn "未知 profile：$p（可选 pdf/media/game/voice/sherpa）"
        rc=1
      fi
    fi
  done
  [ "$rc" = "0" ] && ok "依赖已装入 $site" || bad "部分依赖安装失败"
  return "$rc"
}

# ── repair：从**已校验的缓存归档**重解包运行时（自愈）────────────────────────
# 为什么需要：PRoot/FUSE 层在"覆盖一个更短的符号链接目标"时**不截断尾部**，会留下
# `xxx0001` 这类垃圾尾巴；`cp -al`（硬链接复制）在本机会**改到源**（实测 545 个链接被
# 污染，见 docs/design/CODING-TRAPS.md 第 9 条）。这类损坏不会报错，只在执行时才炸
# （如 `python3` 变悬空 ⇒ 静默回退到系统的另一个解释器）。修复方式就是从归档重解包。
cmd_repair() {
  read_manifest || exit 1
  local spec file sha arch did=0
  for kind in node python; do
    spec="$(artifact_lookup "$kind" "$PLATFORM" 2>/dev/null)" || continue
    file="${spec%% *}"; sha="${spec##* }"
    arch="$(download_dir)/$file"
    if [ ! -f "$arch" ]; then warn "$kind: 缓存归档不存在（$arch），先跑 portable-runtime.sh $kind"; continue; fi
    if [ "$(pi_sha256_file "$arch" 2>/dev/null || echo '')" != "$sha" ]; then
      bad "$kind: 缓存归档 sha256 不符，拒绝用它修复（先删掉再重新下载）"; continue
    fi
    case "$kind" in
      node) info "重解包 node → $RUNTIME/node"; extract_strip1 "$arch" "$RUNTIME/node" && did=$((did+1)) ;;
      python) info "重解包 python → $RUNTIME/py"; extract_strip1 "$arch" "$RUNTIME/py" && did=$((did+1)) ;;
    esac
  done
  # SearXNG 源码（只在已安装时修；依赖 site/ 不动）
  if [ -d "$(pi_ext_dir searxng)/src" ]; then
    spec="$(artifact_lookup searxng any 2>/dev/null)" || spec=""
    if [ -n "$spec" ]; then
      file="${spec%% *}"; sha="${spec##* }"; arch="$(download_dir)/$file"
      if [ -f "$arch" ] && [ "$(pi_sha256_file "$arch" 2>/dev/null || echo '')" = "$sha" ]; then
        info "重解包 SearXNG 源码 → $(pi_ext_dir searxng)/src"
        extract_strip1 "$arch" "$(pi_ext_dir searxng)/src" && did=$((did+1))
      else
        warn "SearXNG 缓存归档缺失或校验不符，跳过（可跑 portable-runtime.sh searxng 重装）"
      fi
    fi
  fi
  local bad_links
  bad_links="$(find "$RUNTIME" -maxdepth 6 -type l -printf '%p -> %l\n' 2>/dev/null | grep -c '0001$' || true)"
  if [ "${bad_links:-0}" = "0" ]; then
    ok "已重解包 $did 个组件；runtime 下无 '0001' 污染的符号链接"
  else
    warn "重解包 $did 个组件，但仍有 $bad_links 个链接带 0001 尾巴（可能在 site-packages，需重跑 deps/searxng）"
  fi
}

cmd_env() {
  pi_portable_env
  cat <<EOF
export PI_PY="$(pi_resolve_python 2>/dev/null || echo '')"
export NODE_BIN="$(pi_resolve_node 2>/dev/null || echo '')"
export PI_PORTABLE_PLATFORM="$(pi_platform)"
export PI_RUNTIME_ROOT="$(pi_runtime_root)"
EOF
}

# ── SearXNG：源码 + 它自己的 Python 依赖都装进仓库 ───────────────────────────
# 为什么源码也要进仓库：`web_search` 依赖本地 SearXNG；若它装在 /opt 或系统 python
# 里，换机器/换路径就没了——正是用户要求消除的"分散"。这里把
#   ext/searxng/src   源码（commit 内容地址 + sha256 双重锚定）
#   ext/searxng/site  它自己的依赖（pip --target，纯数据、可搬迁）
#   ext/searxng/settings.yml  由 scripts/searxng-config.sh 生成（国内可达引擎）
#   ext/searxng/{home,tmp,log,run}  服务私有 HOME/日志/pid（保证不写仓外）
# 全部放在 `<repo>/runtime/<平台>/` 下，随项目移动；启动见 scripts/setup-external.sh。
cmd_searxng() {
  read_manifest || exit 1
  local spec file sha url urls dir ext src site py proxy req
  spec="$(artifact_lookup searxng any)" || { bad "清单里没有 searxng 制品"; exit 1; }
  file="${spec%% *}"; sha="${spec##* }"
  [ -n "$SEARXNG_URL" ] || { bad "清单里没有 searxng_url"; exit 1; }
  url="${SEARXNG_URL//\{commit\}/$SEARXNG_COMMIT}"
  urls="$url"
  for proxy in ${PORTABLE_MIRROR_GITHUB:-$GITHUB_PROXIES}; do urls="$urls ${proxy}${url}"; done
  dir="$(download_verified "$urls" "$file" "$sha")" || { bad "SearXNG 源码下载/校验失败"; exit 1; }

  ext="$(pi_ext_dir searxng)"; src="$ext/src"; site="$ext/site"
  info "解包源码到 $src（commit ${SEARXNG_COMMIT:0:9}）"
  extract_strip1 "$dir" "$src" || { bad "解包失败"; exit 1; }

  py="$(pi_resolve_python 2>/dev/null)" || { bad "找不到 python（先跑 portable-runtime.sh python）"; exit 1; }
  if ! pi_is_inside_repo "$py"; then
    warn "解释器在仓外（$py）：依赖能装进仓库，但解释器仍依赖系统 —— 完全便携请先 bash scripts/portable-runtime.sh python"
  fi
  mkdir -p "$site" "$(pi_pip_cache)"
  local pipargs=(--no-warn-script-location --disable-pip-version-check --upgrade --upgrade-strategy only-if-needed --target "$site")
  [ -n "$PIP_INDEX" ] && pipargs+=(-i "$PIP_INDEX" --trusted-host "${PIP_HOST:-mirrors.aliyun.com}")
  local rc=0
  for req in "$src/requirements.txt" "$src/requirements-server.txt"; do
    [ -f "$req" ] || { warn "缺少 $req（上游布局变了？）"; continue; }
    info "安装依赖：${req#"$src"/}"
    "$py" -m pip install "${pipargs[@]}" -r "$req" || rc=1
  done
  [ "$rc" = "0" ] || { bad "SearXNG 依赖安装失败"; return 1; }

  mkdir -p "$ext/home" "$ext/tmp" "$ext/log" "$ext/run"
  if [ ! -f "$ext/settings.yml" ]; then
    info "生成 settings.yml（国内可达引擎分组）"
    SEARXNG_HOME="$ext" bash "$ROOT/scripts/searxng-config.sh" || warn "settings.yml 生成失败（可稍后手动跑 scripts/searxng-config.sh）"
  else
    ok "settings.yml 已存在（$ext/settings.yml）"
  fi
  ok "SearXNG 已装入仓库：$ext"
  info "启动：bash scripts/setup-external.sh searxng     停止：bash scripts/setup-external.sh searxng-stop"
  info "自检：bash scripts/setup-external.sh status（web_search 默认打 http://127.0.0.1:8889）"
  return 0
}

# 自证：每一条都对应一个真实失败模式，全部可复跑
cmd_verify() {
  read_manifest >/dev/null 2>&1 || true
  local fail=0
  echo "=== 便携化自证 ==="
  local node; node="$(pi_resolve_node 2>/dev/null)" || node=""
  if [ -z "$node" ]; then bad "无可用 node"; fail=1
  elif pi_is_inside_repo "$node"; then ok "node 在仓内：$node（$("$node" -v)）"
  else warn "node 在仓外：$node（便携性未达成；bash scripts/portable-runtime.sh node）"; fail=1
  fi
  local py; py="$(pi_resolve_python 2>/dev/null)" || py=""
  if [ -z "$py" ]; then bad "无可用 python"; fail=1
  elif pi_is_inside_repo "$py"; then ok "python 在仓内：$py（$("$py" -V 2>&1)）"
  else warn "python 在仓外：$py（bash scripts/portable-runtime.sh python）"; fail=1
  fi
  # 站点包落点 + 导入自证（模块名与 requirement 不完全同名，这里用实测映射）
  local site; site="$(pi_py_site)"
  if [ -d "$site" ]; then
    ok "站点包在仓内：$site"
    if [ -n "$py" ]; then
      if PYTHONPATH="$site" "$py" - <<'PY' >/dev/null 2>&1
import importlib
mods = ["PIL"]
for m in mods:
    importlib.import_module(m)
PY
      then ok "站点包可导入（PIL）"
      else warn "站点包导入自证未通过（可能只装了部分 profile）"
      fi
    fi
  else
    warn "站点包未创建（bash scripts/portable-runtime.sh deps）"
  fi
  # 缓存与临时目录不得落到 HOME 下
  pi_portable_env
  case "${npm_config_cache:-}" in "$ROOT"/*) ok "npm 缓存在仓内：$npm_config_cache" ;; *) warn "npm 缓存不在仓内：${npm_config_cache:-未设置}"; fail=1 ;; esac
  case "${PIP_CACHE_DIR:-}" in "$ROOT"/*) ok "pip 缓存在仓内：$PIP_CACHE_DIR" ;; *) warn "pip 缓存不在仓内：${PIP_CACHE_DIR:-未设置}"; fail=1 ;; esac
  case "${PYTHONPYCACHEPREFIX:-}" in "$ROOT"/*) ok "pycache 在仓内：$PYTHONPYCACHEPREFIX" ;; *) warn "pycache 不在仓内"; fail=1 ;; esac
  # 符号链接污染自证（PRoot/FUSE 的"覆盖短目标不截断"陷阱；见 CODING-TRAPS 第 9 条）
  local polluted
  polluted="$(find "$RUNTIME" -type l -printf '%p -> %l\n' 2>/dev/null | grep -c '0001$' || true)"
  if [ "${polluted:-0}" = "0" ]; then
    ok "runtime 下无 '0001' 污染的符号链接"
  else
    bad "runtime 下有 $polluted 个符号链接带 '0001' 尾巴（FUSE 覆盖短目标不截断）⇒ 跑 bash scripts/portable-runtime.sh repair"
    fail=1
  fi
  # runtime 必须仍然被 gitignore（否则二进制会进仓库）
  if git -C "$ROOT" check-ignore -q runtime; then ok "runtime/ 仍被 .gitignore 排除"; else bad "runtime/ 未被忽略（危险：二进制会入库）"; fail=1; fi
  [ "$fail" = "0" ] && echo "🎉 便携化自证全部通过" || echo "❌ 便携化自证有未通过项（见上）"
  return "$fail"
}

case "${1:-status}" in
  status) cmd_status ;;
  node) cmd_node ;;
  python) cmd_python ;;
  deps) shift; cmd_deps "$@" ;;
  searxng) cmd_searxng ;;
  repair) cmd_repair ;;
  env) cmd_env ;;
  verify) cmd_verify ;;
  all) cmd_node && cmd_python && cmd_deps pdf media game && cmd_verify ;;
  *) echo "用法: $0 {status|node|python|deps [profile…]|searxng|repair|env|verify|all}" >&2; exit 1 ;;
esac
