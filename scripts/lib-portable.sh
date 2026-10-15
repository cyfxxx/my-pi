#!/usr/bin/env bash
# lib-portable.sh — **完全便携化**的单一事实来源（Linux / Windows / macOS 通用）
#
# ## 为什么有它
#
# Windows 侧早在 2026-10-13 就做到了"插到任何机器都能跑"：`<repo>/runtime/` 里放
# PortableGit + 便携 Node，启动器 `run-my-pi.ps1` 解析它。但 Linux 侧当时只是
# "能在本机跑"：Node 来自仓外（`/root/.local/share/pi-node`）、SearXNG/whisper/sherpa
# 的 venv 在 `/opt/*`、npm 缓存写 `~/.npm`。**项目被拆成"仓库 + 一堆仓外状态"**，
# 一旦把仓库搬走或换台机器就散架。
#
# 更糟的是解析点曾经有四份拷贝（`run-my-pi.ps1` / `pi-supervisor.sh` / `lib-vendor.sh`
# 各写一遍 + 文档里再描述一遍），`BUILD-PORTABILITY.md` §4.3 已记录过"解析点不一致"
# 造成的真实缺陷（`mode_resolve` 拿到 node、裸 `node` 却调不到）。所以这里把
# **平台判定、运行时目录、Node/Python 解析、便携环境导出** 收敛到本文件一处。
#
# ## 布局（`<repo>/runtime/`，整目录 gitignore，随项目移动）
#
# ```
# runtime/
#   <os>-<arch>/                  # 当前平台（linux-arm64 / linux-x64 / win-x64 …）
#     node/bin/node               # 便携 Node（官方 tarball，sha256 校验后解包）
#     py/bin/python3              # 便携 CPython（python-build-standalone）
#     ext/<服务名>/               # 服务源码 + 站点包 + 配置 + 日志（SearXNG/whisper/…）
#       py/site-packages/         # 通用三方包（pip --target 安装 → 天然可搬迁）
#       home/ cache/ tmp/         # 服务私有 HOME/XDG/TMP（保证不写仓外）
#   node/                         # 旧扁平布局（Windows 现状）→ 兼容保留，不写入
# ```
#
# ## 两条硬纪律（后面的脚本都靠它成立）
#
# 1. **一律 `python -m <模块>`，不调用 venv 的 bin 脚本** —— console script 的 shebang
#    里是绝对路径，仓库一搬就失效；`python -m` 没有这个问题。
# 2. **不创建 venv**，改用 `pip install --target <repo>/…/site-packages` + `PYTHONPATH`
#    —— venv 的 `pyvenv.cfg`/`bin/python` 软链都带绝对路径，`--target` 装出来的站点目录
#    是纯数据，天然可搬迁（这条是本文件与 BUILD-PORTABILITY.md 的分工）。
#
# 用法：`. scripts/lib-portable.sh`（调用方通常已有 `ROOT`；没有则按脚本位置上溯）
# 本文件只定义函数与常量，**不产生任何副作用**（不下载、不建目录、不改 PATH）。

# ── 平台标识 ────────────────────────────────────────────────────────────────
# 与 runtime 子目录名一致；Windows 侧 git-bash/MSYS 也归到 win-<arch>。
pi_platform() {
  local os arch
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW*|MSYS*|CYGWIN*) os=win ;;
    *) os="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo unknown)" ;;
  esac
  case "$(uname -m 2>/dev/null || echo unknown)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l|armv6l) arch=armv7l ;;
    i386|i686) arch=x86 ;;
    *) arch="$(uname -m 2>/dev/null || echo unknown)" ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

# 仓库根：优先 $ROOT（既有脚本都设了），否则按本文件位置（scripts/..）上溯。
pi_repo_root() {
  if [ -n "${ROOT:-}" ]; then printf '%s' "$ROOT"; return 0; fi
  if [ -n "${PI_ROOT:-}" ]; then printf '%s' "$PI_ROOT"; return 0; fi
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

# ── 运行时目录 ──────────────────────────────────────────────────────────────
pi_runtime_root() { printf '%s/runtime/%s' "$(pi_repo_root)" "$(pi_platform)"; }   # 当前平台
pi_runtime_legacy_root() { printf '%s/runtime' "$(pi_repo_root)"; }               # Windows 旧扁平布局
pi_ext_root() { printf '%s/ext' "$(pi_runtime_root)"; }
pi_ext_dir() { printf '%s/ext/%s' "$(pi_runtime_root)" "${1:?pi_ext_dir 需要服务名}"; }
pi_py_site() { printf '%s/ext/py/site-packages' "$(pi_runtime_root)"; }
pi_bin_dir() { printf '%s/bin' "$(pi_runtime_root)"; }
pi_npm_cache() { printf '%s/npm-cache' "$(pi_runtime_root)"; }
pi_pip_cache() { printf '%s/pip-cache' "$(pi_runtime_root)"; }
pi_tmp_dir() { printf '%s/tmp' "$(pi_runtime_root)"; }
pi_portable_artifacts_file() { printf '%s/scripts/portable-artifacts.txt' "$(pi_repo_root)"; }

# ── Node：版本门禁（口径与 lib-vendor.sh 一致，已收敛到此处） ────────────────
# 为什么必须比到 minor：上游构建脚本用 Node 内置类型剥离直接跑 .ts，该能力 22.18+ 才有；
# Node 22.14.0（主版本同为 22）会通过"只看主版本"的旧判定，然后在构建中途崩
# （ERR_UNKNOWN_FILE_EXTENSION，报错点离根因很远，详见 BUILD-PORTABILITY.md §1）。
PI_NODE_MIN_MAJOR=22
PI_NODE_MIN_MINOR=19
PI_NODE_MIN_PATCH=0
PI_NODE_MIN="${PI_NODE_MIN_MAJOR}.${PI_NODE_MIN_MINOR}.${PI_NODE_MIN_PATCH}"

# 语义化版本比较：_pi_version_ok <major> <minor> <patch>
_pi_version_ok() {
  local maj="${1:-0}" min="${2:-0}" pat="${3:-0}"
  [ "$maj" -gt "$PI_NODE_MIN_MAJOR" ] && return 0
  [ "$maj" -lt "$PI_NODE_MIN_MAJOR" ] && return 1
  [ "$min" -gt "$PI_NODE_MIN_MINOR" ] && return 0
  [ "$min" -lt "$PI_NODE_MIN_MINOR" ] && return 1
  [ "$pat" -ge "$PI_NODE_MIN_PATCH" ] && return 0
  return 1
}

# 拆一个 node 版本串并判定：_pi_node_version_ok <raw>
_pi_node_version_ok() {
  local raw="${1#v}" maj min pat
  maj="${raw%%.*}"; min="$(printf '%s' "$raw" | cut -d. -f2)"; pat="$(printf '%s' "$raw" | cut -d. -f3)"
  pat="$(printf '%s' "${pat:-0}" | sed 's/[^0-9].*$//')"
  case "${maj}" in ''|*[!0-9]*) return 1 ;; esac
  case "${min}" in ''|*[!0-9]*) min=0 ;; esac
  case "${pat}" in ''|*[!0-9]*) pat=0 ;; esac
  _pi_version_ok "$maj" "$min" "$pat"
}

# 校验某个 node 可执行文件（路径或命令名）存在且版本达标。用法：_pi_node_ok <node>
_pi_node_ok() {
  [ -x "$1" ] || command -v "$1" >/dev/null 2>&1 || return 1
  local v
  v="$("$1" -v 2>/dev/null)" || return 1
  _pi_node_version_ok "$v"
}

# 校验 PATH 上的 node（未安装 `node` 视为"不是版本问题"，返回 0，与既有口径一致）
node_version_ok() {
  command -v node >/dev/null 2>&1 || return 0
  local raw; raw="$(node -v 2>/dev/null)" || return 1
  _pi_node_version_ok "$raw"
}

node_version_hint() {
  echo "  当前：$(node -v 2>/dev/null || echo '未找到 node')；要求：Node.js >= ${PI_NODE_MIN}" >&2
  echo "  说明：上游构建脚本用 Node 内置类型剥离直接运行 .ts（如 node scripts/check-model-data.ts），" >&2
  echo "        该能力在 22.18+ 才默认开启；仅主版本为 22 并不够，构建中途会以" >&2
  echo "        ERR_UNKNOWN_FILE_EXTENSION 失败。" >&2
  echo "  修复（任选其一）：" >&2
  echo "    a) 装进仓库自带运行时：bash scripts/portable-runtime.sh node" >&2
  echo "    b) 用系统包管理器/NVM 装 Node.js >= ${PI_NODE_MIN}" >&2
  echo "    c) 显式指定：MY_PI_NODE=<node 绝对路径>" >&2
}

# Node 候选路径，**按优先级打印**（每行一个）：
#   ① 当前平台目录（新主布局，随项目移动）    ② 旧扁平 runtime/node（Windows 现状）
#   ③ 与仓库同级的历史"工具分区"布局（跨盘符时相对路径无效，故放最后）
pi_node_candidates() {
  local root rt
  root="$(pi_repo_root)"
  rt="$(pi_runtime_root)"
  printf '%s\n' \
    "$rt/node/bin/node" \
    "$rt/node/node" \
    "$rt/node/node.exe" \
    "$root/runtime/node/node" \
    "$root/runtime/node/node.exe" \
    "$root/../runtime/node/node" \
    "$root/../runtime/node/node.exe"
}

# 解析出一个**版本达标**的 node 并打印其路径；找不到时返回 1 且不打印。
# 优先级：MY_PI_NODE → 便携布局候选 → PATH。
pi_resolve_node() {
  local c
  if [ -n "${MY_PI_NODE:-}" ] && _pi_node_ok "$MY_PI_NODE"; then
    printf '%s' "$MY_PI_NODE"; return 0
  fi
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    if _pi_node_ok "$c"; then printf '%s' "$c"; return 0; fi
  done < <(pi_node_candidates)
  if _pi_node_ok node; then printf '%s' node; return 0; fi
  return 1
}

# 该 node 路径是否落在仓库内（便携性判据；`node` 这种裸命令名算"不在仓内"）。
pi_is_inside_repo() {
  local p="$1" root
  root="$(pi_repo_root)"
  case "$p" in
    /*) case "$p" in "$root"/*) return 0 ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}

# ── Python：便携 CPython → 仓内站点包 → 系统 python3（末位兜底） ──────────────
pi_python_candidates() {
  local rt; rt="$(pi_runtime_root)"
  printf '%s\n' "$rt/py/bin/python3" "$rt/py/bin/python"
}

# 解析一个 python 解释器并打印路径（找不到返回 1）。
# 优先级：PI_PY → 仓内便携 CPython → PATH 上的 python3/python（**会标注为仓外**）。
pi_resolve_python() {
  local c
  if [ -n "${PI_PY:-}" ] && [ -x "${PI_PY}" ]; then printf '%s' "$PI_PY"; return 0; fi
  while IFS= read -r c; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done < <(pi_python_candidates)
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

# ── 便携 venv 的"自愈"（少数仍用 venv 的重依赖服务：whisper / sherpa）─────────
# 通用 Python 包走 `pip --target` 站点目录（见文件头纪律 2），但 faster-whisper /
# sherpa-onnx 这类**重原生依赖**历史上按 venv 组织，改造收益低。折中：venv 也放进仓库，
# 并在启动时做一次**幂等自愈**，把 venv 里指向旧路径的绝对引用改回当前位置 ——
# 这样"整盘搬走后仍能起来"（否则 `bin/python` 还指着旧仓库路径，必崩）。
#
# 修两类（venv 里只有这两类与路径绑定）：
#   ① `pyvenv.cfg` 的 `home =`：基础解释器所在 bin 目录
#   ② `bin/python*` 的符号链接：默认指向基础解释器的**绝对**路径 ⇒ 改成**相对**链接
# 不修 `bin/pip`/`bin/uvicorn` 等 console script 的 shebang（`#!` 不支持相对路径）；
# 本仓约定一律用 `"$VENV/bin/python" -m <模块>` 调用，绕开 shebang（见文件头纪律 1）。
pi_py_repair_venv() {
  local venv="${1:?pi_py_repair_venv 需要 venv 路径}"
  [ -d "$venv" ] || return 0
  local py bin base rel vbin name
  py="$(pi_resolve_python 2>/dev/null)" || return 1
  case "$py" in */*) ;; *) return 1 ;; esac      # 裸命令名（系统 python3）算不出相对路径
  bin="$(cd "$(dirname "$py")" && pwd)"
  base="${py##*/}"
  if [ -f "$venv/pyvenv.cfg" ]; then
    if grep -q '^home = ' "$venv/pyvenv.cfg" 2>/dev/null; then
      sed -i "s|^home = .*|home = $bin|" "$venv/pyvenv.cfg"
    else
      printf 'home = %s\n' "$bin" >> "$venv/pyvenv.cfg"
    fi
  fi
  vbin="$venv/bin"; [ -d "$vbin" ] || vbin="$venv/Scripts"   # Windows venv 布局
  [ -d "$vbin" ] || return 0
  rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$bin" "$vbin" 2>/dev/null || true)"
  [ -n "$rel" ] || return 0
  for name in python python3 python3.12 python3.11 python3.13; do
    [ -e "$vbin/$name" ] || [ -L "$vbin/$name" ] || continue
    rm -f "$vbin/$name"
    ln -s "$rel/$base" "$vbin/$name" 2>/dev/null || true
  done
  return 0
}

# 便携 python 是否就位（决定"完全便携"还是"依赖系统 python3"）
pi_python_is_portable() {
  local p; p="$(pi_resolve_python 2>/dev/null)" || return 1
  pi_is_inside_repo "$p"
}

# 打印解析结果所需的解释器绝对路径（供 PATH 前置用）
pi_python_bin_dir() {
  local p; p="$(pi_resolve_python 2>/dev/null)" || return 1
  case "$p" in
    */*) (cd "$(dirname "$p")" && pwd) ;;
    *) return 1 ;;
  esac
}

# ── 服务私有 HOME/XDG/TMP（保证服务不往仓外写状态） ─────────────────────────
# 用法：eval "$(pi_service_env searxng)" 或在子 shell 里 source 导出。
pi_service_env() {
  local name="${1:?pi_service_env 需要服务名}" d
  d="$(pi_ext_dir "$name")/home"
  printf 'export HOME=%q\n' "$d"
  printf 'export XDG_CONFIG_HOME=%q\n' "$d/.config"
  printf 'export XDG_CACHE_HOME=%q\n' "$d/.cache"
  printf 'export XDG_DATA_HOME=%q\n' "$d/.local/share"
  printf 'export XDG_STATE_HOME=%q\n' "$d/.local/state"
  printf 'export TMPDIR=%q\n' "$(pi_ext_dir "$name")/tmp"
  printf 'export PIP_CACHE_DIR=%q\n' "$(pi_pip_cache)"
  printf 'export PYTHONPYCACHEPREFIX=%q\n' "$(pi_ext_dir "$name")/pycache"
}

# ── 便携环境导出（幂等；`my-pi.sh` / supervisor / 服务脚本共用） ─────────────
# 做三件事：
#   ① 把仓内 node / python / runtime bin 前置进 PATH（保证子进程里的裸 `node`/`python3`
#      也命中仓内版本——这正是 BUILD-PORTABILITY.md §4.3 坑 2 的根因）
#   ② 把 npm / pip 缓存与 pycache 指到仓内（否则写 ~/.npm、~/.cache）
#   ③ 把仓内站点包加进 PYTHONPATH（`--target` 安装的包不依赖 venv，天然可搬迁）
pi_portable_env() {
  local node py_bin site
  node="$(pi_resolve_node 2>/dev/null)" || node=""
  if [ -n "$node" ] && [ "$node" != "node" ]; then
    PATH="$(cd "$(dirname "$node")" && pwd):$PATH"; export PATH
  fi
  py_bin="$(pi_python_bin_dir 2>/dev/null)" && [ -n "$py_bin" ] && { PATH="$py_bin:$PATH"; export PATH; }
  # 随项目携带的 CLI（rg/fd/age…，见 setup-external.sh fd-rg 与 PORTABLE-LINUX.md §6）
  local pbin; pbin="$(pi_bin_dir)"
  if [ -d "$pbin" ]; then
    case ":$PATH:" in *":$pbin:"*) ;; *) PATH="$pbin:$PATH"; export PATH ;; esac
  fi
  site="$(pi_py_site)"
  if [ -d "$site" ]; then
    case "${PYTHONPATH:-}" in
      *"$site"*) ;;
      *) PYTHONPATH="$site${PYTHONPATH:+:$PYTHONPATH}"; export PYTHONPATH ;;
    esac
  fi
  # 缓存与 pycache **强制**指向仓库内（`MY_PI_*`/`PI_*` 显式覆盖才让路）。
  # 为什么不用 `${npm_config_cache:-…}` 这种"已设置就尊重"的写法（实测踩到）：
  # 从 npm 脚本/CI 里启动 my-pi 时，环境里本来就有 `npm_config_cache=/root/.npm`，
  # 尊重它等于把缓存写回用户目录 ⇒ 便携性静默失效。默认值必须由本仓决定。
  export npm_config_cache="${PI_NPM_CACHE:-$(pi_npm_cache)}"
  export PIP_CACHE_DIR="${PI_PIP_CACHE:-$(pi_pip_cache)}"
  export PYTHONPYCACHEPREFIX="${PI_PYCACHE_PREFIX:-$(pi_runtime_root)/pycache}"
  export PI_PORTABLE_PLATFORM="$(pi_platform)"
  export PI_RUNTIME_ROOT="$(pi_runtime_root)"
  return 0
}

# 便携性体检：打印每个组件的落点与"是否在仓内"。只读，不建目录。
pi_portable_status() {
  local node py site
  printf 'platform: %s\n' "$(pi_platform)"
  printf 'runtime : %s\n' "$(pi_runtime_root)"
  node="$(pi_resolve_node 2>/dev/null)" || node=""
  if [ -n "$node" ]; then
    if pi_is_inside_repo "$node"; then printf 'node    : %s (%s) [仓内 ✓]\n' "$node" "$("$node" -v 2>/dev/null)";
    else printf 'node    : %s (%s) [仓外 ✗ 便携性未达成]\n' "$node" "$("$node" -v 2>/dev/null)"; fi
  else
    printf 'node    : 未找到满足 >=%s 的 node\n' "$PI_NODE_MIN"
  fi
  py="$(pi_resolve_python 2>/dev/null)" || py=""
  if [ -n "$py" ]; then
    if pi_is_inside_repo "$py"; then printf 'python  : %s (%s) [仓内 ✓]\n' "$py" "$("$py" -V 2>&1)";
    else printf 'python  : %s (%s) [仓外 ✗ 依赖系统 python3]\n' "$py" "$("$py" -V 2>&1)"; fi
  else
    printf 'python  : 未找到（便携 python 与系统 python3 都没有）\n'
  fi
  site="$(pi_py_site)"
  if [ -d "$site" ]; then printf '站点包  : %s（%s 个顶层条目）[仓内 ✓]\n' "$site" "$(ls -1 "$site" 2>/dev/null | wc -l)";
  else printf '站点包  : %s 未创建（bash scripts/portable-runtime.sh deps）\n' "$site"; fi
  return 0
}
