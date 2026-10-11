#!/usr/bin/env bash
# lib-vendor.sh — vendor/pi 补丁与依赖的共享逻辑（被 build.sh / sync-upstream.sh / doctor.sh source）
#
# 设计要点：
#   * 补丁应用幂等：已应用（reverse-check 通过）跳过，不改动；可应用才应用。
#   * fresh 引导时把补丁提交为本地 commit，使 vendor 工作树保持干净
#     （check-isolation 要求 vendor 干净），且与主仓库现有 vendor 模型一致，
#     从而 sync-upstream 的 merge/rebase 能自然工作。
#   * 不产生副作用时可安全重复调用。

# ── Node 版本下限 ──────────────────────────────────────────────────────────
# my-pi 与全部 vendor/pi 包（13 个）的 engines 均为 >=22.19.0；上游 README 亦明言
# "Pi requires Node.js 22.19 or newer"。
#
# 为什么必须比到 minor 而不能只看主版本（真实事故）：
#   上游构建脚本直接用 Node 内置类型剥离运行 TypeScript，例如
#     packages/ai: "check:model-data": "node scripts/check-model-data.ts"
#     packages/ai: "generate-models": "node scripts/generate-models.ts --strict"
#   该能力在 Node 22.18+ 才默认开启。Node 22.14.0（主版本同为 22）会通过旧的主版本
#   检查，然后在构建中途以 ERR_UNKNOWN_FILE_EXTENSION 崩溃，报错位置离根因很远。
PI_NODE_MIN_MAJOR=22
PI_NODE_MIN_MINOR=19
PI_NODE_MIN_PATCH=0
PI_NODE_MIN="${PI_NODE_MIN_MAJOR}.${PI_NODE_MIN_MINOR}.${PI_NODE_MIN_PATCH}"

# 校验一个语义化版本是否 >= 下限。用法：_pi_version_ok <major> <minor> <patch>
_pi_version_ok() {
  local maj="${1:-0}" min="${2:-0}" pat="${3:-0}"
  [ "$maj" -gt "$PI_NODE_MIN_MAJOR" ] && return 0
  [ "$maj" -lt "$PI_NODE_MIN_MAJOR" ] && return 1
  [ "$min" -gt "$PI_NODE_MIN_MINOR" ] && return 0
  [ "$min" -lt "$PI_NODE_MIN_MINOR" ] && return 1
  [ "$pat" -ge "$PI_NODE_MIN_PATCH" ] && return 0
  return 1
}

# 校验当前 PATH 上的 node 是否满足下限。
# 用法：node_version_ok  → 0=满足（或未安装 node 以外的情形），1=过旧
# 仅做版本判定；"未安装 node" 由调用方单独处理，避免两处口径不一致。
node_version_ok() {
  command -v node >/dev/null 2>&1 || return 0
  local raw maj min pat
  raw="$(node -v 2>/dev/null)" || return 1
  raw="${raw#v}"
  maj="${raw%%.*}"
  min="$(printf '%s' "$raw" | cut -d. -f2)"
  pat="$(printf '%s' "$raw" | cut -d. -f3)"
  # 预发布版本（如 22.19.0-rc.1）的 patch 段会带后缀，剥掉非数字尾部
  pat="$(printf '%s' "${pat:-0}" | sed 's/[^0-9].*$//')"
  case "${maj}" in ''|*[!0-9]*) return 1 ;; esac
  case "${min}" in ''|*[!0-9]*) min=0 ;; esac
  case "${pat}" in ''|*[!0-9]*) pat=0 ;; esac
  _pi_version_ok "$maj" "$min" "$pat"
}

# 打印 Node 版本不达标的升级指引（build.sh / doctor.sh 共用，保持口径一致）
node_version_hint() {
  echo "  当前：$(node -v 2>/dev/null || echo '未找到 node')；要求：Node.js >= ${PI_NODE_MIN}" >&2
  echo "  说明：上游构建脚本用 Node 内置类型剥离直接运行 .ts（如 node scripts/check-model-data.ts），" >&2
  echo "        该能力在 22.18+ 才默认开启；仅主版本为 22 并不够，构建中途会以" >&2
  echo "        ERR_UNKNOWN_FILE_EXTENSION 失败。" >&2
  echo "  修复：nvm install ${PI_NODE_MIN_MAJOR}.${PI_NODE_MIN_MINOR} && nvm use ${PI_NODE_MIN_MAJOR}.${PI_NODE_MIN_MINOR}" >&2
  echo "        或从 https://nodejs.org 安装 Node.js ${PI_NODE_MIN} 及以上" >&2
}

# ── 依赖安装的文件系统能力预检 ──────────────────────────────────────────────
# npm 的 workspaces（根 package.json 声明 custom，vendor/pi 声明 packages/*）会把
# 工作区包以符号链接放进 node_modules。exFAT/FAT32 不支持符号链接（Windows 上
# junction 亦不支持），于是 npm 不是报"不支持符号链接"，而是抛出难以定位的
#   npm error Cannot read properties of null (reading 'edgesOut')
# 本项目自身也要求 portable/ 下无符号链接（check-isolation 检查 1，见
# setup-external.sh 用 exec shim 替代 ln -s），因此"依赖树落在不支持符号链接的卷上"
# 与项目理念冲突，应在安装前明确拦截。
#
# 用法：preflight_symlinks <dir>   → 0=支持（或已清理），1=不支持
preflight_symlinks() {
  local dir="$1"
  local probe="$dir/.pi-symlink-probe.$$"
  local rc=0
  rm -rf "$probe" 2>/dev/null || true
  if ! mkdir -p "$probe" 2>/dev/null; then
    echo "✗ 无法在 $dir 创建临时目录（权限/只读？）" >&2
    return 1
  fi
  printf 'pi-probe' > "$probe/target" 2>/dev/null

  # 判定方式：用 **Node 自己的 fs.symlinkSync**，因为 npm 在 Windows 上就是用它来
  # 链接工作区包的。这是唯一与 npm 行为一致的判据：
  #   * `ln -s` 不可用——git-bash/MSYS 默认会**静默退化为复制文件**（实测 NTFS 与
  #     exFAT 都返回 0 且内容可读、-L 为假），既会把不支持误报成支持，也会反过来误伤；
  #     加 MSYS=winsymlinks:nativestrict 后 exFAT 仍能建出"看起来像符号链接"的东西，
  #     依然不可信。
  #   * `mklink` 只存在于 Windows，且与 Node 的调用路径不同。
  # 实测：D:(NTFS) → 成功；H:(exFAT) → EISDIR（正是 npm 报 edgesOut 的根因）。
  # 注意：link 路径**必须尚不存在**，否则 symlinkSync 返回 EEXIST（会被误判成"不支持"）。
  if command -v node >/dev/null 2>&1; then
    if node -e '
      const fs = require("node:fs"), path = require("node:path");
      const dir = process.argv[1];
      const link = path.join(dir, "link");
      try {
        fs.symlinkSync(path.join(dir, "target"), link);
        process.exit(fs.lstatSync(link).isSymbolicLink() ? 0 : 1);
      } catch { process.exit(1); }
    ' "$probe" >/dev/null 2>&1; then
      rc=0
    else
      rc=1
    fi
  else
    # 无 node 时的保守回退：Windows 上用 mklink，其它平台用 ln -s
    if [ -n "${WINDIR:-}" ] && command -v cmd >/dev/null 2>&1; then
      local wdir
      wdir="$(cd "$probe" && pwd -W 2>/dev/null || printf '%s' "$probe")"
      if cmd //c "mklink /D \"${wdir}\\lnk\" \"${wdir}\\target\"" >/dev/null 2>&1; then
        rc=0
      else
        rc=1
      fi
    else
      if ln -s target "$probe/link" 2>/dev/null && [ -L "$probe/link" ]; then
        rc=0
      else
        rc=1
      fi
    fi
  fi
  rm -rf "$probe" 2>/dev/null || true
  if [ "$rc" -ne 0 ]; then
    echo "✗ $dir 所在卷不支持符号链接，无法安装 npm 依赖" >&2
    echo "  原因：npm workspaces 必须把工作区包符号链接进 node_modules；" >&2
    echo "        exFAT / FAT32 既不支持符号链接，也不支持 Windows junction。" >&2
    echo "  典型症状：npm 报 'Cannot read properties of null (reading edgesOut)'。" >&2
    echo "  可选做法：" >&2
    echo "    1) 在 NTFS 卷上构建，再把 vendor/ 与 node_modules/ 复制回本目录" >&2
    echo "       （运行只需读取文件树，不需要符号链接）；" >&2
    echo "    2) 把该卷格式化为 NTFS。" >&2
    echo "  详见 docs/operations/BUILD-PORTABILITY.md" >&2
  fi
  return "$rc"
}

# ── git 仓库可读性 / 干净度（exFAT 属主陷阱的通用判据）──────────────────────
# 为什么需要这组函数：`git diff --quiet` 有**三个**不同结局，而常见写法只分两种：
#   0   干净
#   1   有改动
#   129 git **无法读取**该仓库（用法错误）。在 exFAT/FAT32（不记录文件属主）与网络盘上，
#       git 会拒读并退化为 `--no-index` 用法错误 —— 于是 `if ! git diff --quiet` 把它
#       当成"有改动"，再配上 `2>/dev/null` 连线索都吞掉，最终报出与真实原因完全相反的
#       结论（实测：vendor/pi 其实是干净的，真因是属主检查）。
# 因此：先判「能否读取」，再判「是否干净」；读不了就明确说读不了并给修复命令。
# 注意：git 有意忽略仓库自身的 safe.directory（防恶意仓库自我放行），只能写用户级配置。

# 把仓库路径规范成 git 的 safe.directory 惯用形式（Windows 盘符式）。
# 必要性：同一个目录可以有多种写法 —— `pwd -P` 在 git-bash 下给 `/d/x`（MSYS），
# 而 `git config --global --add safe.directory /d/x` 会被 git 存成 `D:/x`。
# 若用未规范化的路径做"是否已存在"的比较，就会每次构建都重复登记一条（实测踩到）。
# 用法：git_norm_safe_dir <path>
git_norm_safe_dir() {
  local p="${1:-}"
  [ -n "$p" ] || return 1
  if command -v cygpath >/dev/null 2>&1; then
    # git-bash / Cygwin / MSYS：统一成 Windows 盘符式，与 git 的存储形式一致
    cygpath -m "$p" 2>/dev/null && return 0
  fi
  # 无 cygpath：手写 /x/... -> X:/...
  case "$p" in
    /[A-Za-z]/*)
      printf '%s:/%s\n' "$(printf '%s' "${p#/}" | cut -c1 | tr '[:lower:]' '[:upper:]')" \
        "$(printf '%s' "${p#/}" | cut -c3-)"
      ;;
    *) printf '%s\n' "$p" ;;
  esac
}

# 用法：git_repo_readable <repo>  → 0=git 能读该仓库
git_repo_readable() {
  git -C "$1" rev-parse --git-dir >/dev/null 2>&1
}

# 用法：git_dirty_state <repo>  → 0=干净  1=有未提交改动  3=git 无法读取
# 用 `status --porcelain` 而非 `diff --quiet`：前者在 safe.directory 生效后同样可靠，
# 且与干净的判定语义一致（只看有无输出）。
git_dirty_state() {
  local repo="$1" out
  git_repo_readable "$repo" || return 3
  out="$(git -C "$repo" status --porcelain 2>/dev/null)" || return 3
  [ -z "$out" ] && return 0
  return 1
}

# 打印「git 无法读取该仓库」的修复指引。用法：git_unreadable_hint <path>
git_unreadable_hint() {
  local path="$1" norm
  norm="$(cd "$path" 2>/dev/null && pwd -P)" || norm="$path"
  norm="$(git_norm_safe_dir "$norm" 2>/dev/null || printf '%s' "$norm")"
  echo "     原因：该卷不记录文件属主，git 拒绝访问（并非「有改动」）。" >&2
  echo "     修复：git config --global --add safe.directory '$norm'" >&2
  echo "     说明：git 有意忽略仓库自身的 safe.directory，只能写用户级配置。" >&2
  echo "     详见：docs/operations/BUILD-PORTABILITY.md §4" >&2
}

# 判断根目录 node_modules 是否与 package-lock.json 一致
# 用法：deps_ok <dir>  → 0=无需安装，1=需要安装
# 说明：node_modules/.package-lock.json 是 npm 的精简隐藏锁，与 package-lock.json
# 逐字节不同属正常；用 mtime 判断 lock 是否比已安装树更新（npm install 会刷新隐藏锁）。
deps_ok() {
  local dir="$1"
  [ -d "$dir/node_modules" ] || return 1
  [ -f "$dir/node_modules/.package-lock.json" ] || return 1
  [ -f "$dir/package-lock.json" ] || return 0   # 无 lock：按已装处理，避免反复安装
  [ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ] && return 1
  return 0
}

# 兼容旧名（build.sh/doctor.sh 曾用 root_deps_ok）
root_deps_ok() { deps_ok "$1" && [ -f "$1/node_modules/typescript/package.json" ] && [ -f "$1/node_modules/vitest/package.json" ]; }

# 让 vendor 的本地标记文件不出现在 git status（写入 $vendor/.git/info/exclude，不改上游 .gitignore）
vendor_exclude_local() {
  local vendor="$1"
  local exclude="$vendor/.git/info/exclude"
  [ -f "$exclude" ] || return 0
  for name in LAST_SYNC_POINT; do
    grep -qxF "$name" "$exclude" 2>/dev/null || echo "$name" >> "$exclude"
  done
}

# 安装依赖（优先 npm ci 保证可复现，不改动 package-lock）。用法：deps_install <dir> [npm args...]
deps_install() {
  local dir="$1"; shift
  ( cd "$dir" || return 1
    if [ -f package-lock.json ]; then
      npm ci "$@"
    else
      npm install "$@"
    fi
  )
}

# 应用补丁（幂等）。用法：vendor_apply_patches <root> <vendor> [commit]
#   commit=1（默认）：新应用的补丁以本地 commit 落盘（fresh 引导用）
#   commit=0：只改工作树，不提交
# 返回：0=全部就绪；1=有补丁无法应用
vendor_apply_patches() {
  local root="$1" vendor="$2" do_commit="${3:-1}"
  local failed=0 applied=0 skipped=0 base patch
  shopt -s nullglob
  for patch in "$root"/patches/*.patch; do
    base="$(basename "$patch")"
    if git -C "$vendor" apply --reverse --check "$patch" >/dev/null 2>&1; then
      echo "  ✓ 已应用：$base"
      skipped=$((skipped + 1))
      continue
    fi
    if git -C "$vendor" apply --check "$patch" >/dev/null 2>&1; then
      git -C "$vendor" apply "$patch"
      applied=$((applied + 1))
      echo "  ↑ 已应用：$base"
    elif git -C "$vendor" apply --3way "$patch" >/dev/null 2>&1; then
      applied=$((applied + 1))
      echo "  ↑ 三方合并应用：$base"
    else
      # --3way 失败可能在工作树/索引留下冲突，回滚到已提交状态，避免污染 vendor
      git -C "$vendor" reset -q 2>/dev/null || true
      git -C "$vendor" checkout -q -- . 2>/dev/null || true
      echo "  ✗ 应用失败（上游可能已改动相关文件）：$base" >&2
      failed=$((failed + 1))
      continue
    fi
    if [ "$do_commit" = "1" ]; then
      git -C "$vendor" add -A
      git -C "$vendor" -c user.name="${MY_PI_COMMIT_NAME:-my-pi}" \
        -c user.email="${MY_PI_COMMIT_EMAIL:-my-pi@localhost}" \
        commit -q --no-verify -m "local: ${base%.patch}"
    fi
  done
  echo "  补丁：已应用 $applied，已存在 $skipped，失败 $failed"
  [ "$failed" -eq 0 ]
}

# 判断补丁是否已应用（优先看提交历史）。
# 必要性：顺序叠加的多个补丁可能改动同一文件的相邻区域，此时早期补丁的
# `git apply --reverse --check` 会因上下文已被后续补丁改写而失败（误判为“状态未知”）。
# vendor_apply_patches 提交的信息为 `local: <补丁名>`，可据此可靠判定。
# 用法：vendor_patch_applied <vendor> <patch-file>
vendor_patch_applied() {
  local vendor="$1" patch="$2" base subject
  base="$(basename "$patch")"
  subject="local: ${base%.patch}"
  git -C "$vendor" log --format=%s -n 500 2>/dev/null | grep -qxF "$subject"
}

# 报告补丁状态（只读）。用法：vendor_patch_status <root> <vendor>
vendor_patch_status() {
  local root="$1" vendor="$2" patch base bad=0
  shopt -s nullglob
  for patch in "$root"/patches/*.patch; do
    base="$(basename "$patch")"
    if vendor_patch_applied "$vendor" "$patch"; then
      echo "  ✓ 已应用：$base"
    elif git -C "$vendor" apply --check --reverse "$patch" >/dev/null 2>&1; then
      echo "  ✓ 已应用：$base"
    elif git -C "$vendor" apply --check "$patch" >/dev/null 2>&1; then
      echo "  ⚠ 未应用：$base（运行 bash scripts/doctor.sh --fix 或 scripts/build.sh）"
      bad=1
    else
      echo "  ✗ 状态未知（基线与上游不符）：$base"
      bad=1
    fi
  done
  return "$bad"
}
