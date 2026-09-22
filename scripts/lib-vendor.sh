#!/usr/bin/env bash
# lib-vendor.sh — vendor/pi 补丁与依赖的共享逻辑（被 build.sh / sync-upstream.sh / doctor.sh source）
#
# 设计要点：
#   * 补丁应用幂等：已应用（reverse-check 通过）跳过，不改动；可应用才应用。
#   * fresh 引导时把补丁提交为本地 commit，使 vendor 工作树保持干净
#     （check-isolation 要求 vendor 干净），且与主仓库现有 vendor 模型一致，
#     从而 sync-upstream 的 merge/rebase 能自然工作。
#   * 不产生副作用时可安全重复调用。

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
        commit -q -m "local: ${base%.patch}"
    fi
  done
  echo "  补丁：已应用 $applied，已存在 $skipped，失败 $failed"
  [ "$failed" -eq 0 ]
}

# 报告补丁状态（只读）。用法：vendor_patch_status <root> <vendor>
vendor_patch_status() {
  local root="$1" vendor="$2" patch base bad=0
  shopt -s nullglob
  for patch in "$root"/patches/*.patch; do
    base="$(basename "$patch")"
    if git -C "$vendor" apply --check --reverse "$patch" >/dev/null 2>&1; then
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
