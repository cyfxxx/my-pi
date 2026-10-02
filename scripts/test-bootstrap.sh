#!/bin/bash
# test-bootstrap.sh — 引导包（方案 A）守门：打包/校验/安装/拒绝非法成员，全程用临时密钥，不碰真实私钥
#
# 覆盖：
#   1. 私钥在仓库内 → pack 拒绝
#   2. recipient 模式 pack → verify 通过（成员白名单、指纹核对、元信息）
#   3. 口令模式 pack（script 伪终端喂口令）→ unpack 安装 → 权限 600 + 指纹一致
#   4. 已存在私钥时 unpack 拒绝覆盖（除非 --yes），覆盖时留 .bak
#   5. 夹带非白名单成员的引导包 → verify 拒绝（防"引导包被替换"）
# 用法：bash scripts/test-bootstrap.sh
set -u
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BS="$ROOT/scripts/bootstrap-key.sh"
PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS + 1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  - $1（跳过）"; }
check(){ if [ "$2" = "1" ]; then ok "$1"; else bad "$1${3:+ — $3}"; fi; }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP" "$ROOT/.bootstrap-test-inside.key" 2>/dev/null || true; }
trap cleanup EXIT
command -v age-keygen >/dev/null 2>&1 || { echo "跳过：未安装 age"; exit 0; }

KEYREAL="$TMP/age.key";      age-keygen -o "$KEYREAL" 2>/dev/null
KEYOTHER="$TMP/age2.key";    age-keygen -o "$KEYOTHER" 2>/dev/null
PUBTMP="$TMP/age.pub";       age-keygen -y "$KEYREAL" > "$PUBTMP"
FP="$(age-keygen -y "$KEYREAL" | tr -d '[:space:]')"
export MY_PI_BOOTSTRAP_BUNDLE="$TMP/bootstrap.age"
export MY_PI_BOOTSTRAP_META="$TMP/bootstrap.meta.json"
export MY_PI_BOOTSTRAP_PUB="$PUBTMP"

echo "=== 1. 私钥在仓库内 → 拒绝 ==="
cp "$KEYREAL" "$ROOT/.bootstrap-test-inside.key"
out="$(MY_PI_AGE_KEY="$ROOT/.bootstrap-test-inside.key" bash "$BS" pack 2>&1)"; rc=$?
check "私钥在仓库内时 pack 拒绝" "$([ $rc -ne 0 ] && echo 1 || echo 0)" "$out"
rm -f "$ROOT/.bootstrap-test-inside.key"

echo ""
echo "=== 2. recipient 模式 pack → verify（成员白名单 / 指纹 / 元信息）==="
out="$(MY_PI_AGE_KEY="$KEYREAL" MY_PI_BOOTSTRAP_MODE=recipient MY_PI_BOOTSTRAP_RECIPIENT="$FP" bash "$BS" pack 2>&1)"; rc=$?
check "recipient 模式打包成功" "$([ $rc -eq 0 ] && echo 1 || echo 0)" "$out"
check "引导包文件已生成" "$([ -s "$MY_PI_BOOTSTRAP_BUNDLE" ] && echo 1 || echo 0)"
check "元信息含成员白名单与 contains_ssh_key=false" \
  "$(grep -q '"contains_ssh_key": false' "$MY_PI_BOOTSTRAP_META" && grep -q 'age.key' "$MY_PI_BOOTSTRAP_META" && echo 1 || echo 0)"
out="$(MY_PI_AGE_KEY="$KEYREAL" MY_PI_BOOTSTRAP_MODE=recipient bash "$BS" verify 2>&1)"; rc=$?
check "verify 通过且指纹与 age.pub 一致" "$([ $rc -eq 0 ] && echo "$out" | grep -q '一致' && echo 1 || echo 0)" "$out"

echo ""
echo "=== 3. 指纹不一致 → verify 拒绝 ==="
out="$(MY_PI_AGE_KEY="$KEYOTHER" MY_PI_BOOTSTRAP_MODE=recipient bash "$BS" verify 2>&1)"; rc=$?
check "用另一把私钥解密时 verify 拒绝" "$([ $rc -ne 0 ] && echo 1 || echo 0)" "$(echo "$out" | tail -1)"

echo ""
echo "=== 4. 口令模式 pack（生产路径）→ unpack 安装 ==="
if command -v script >/dev/null 2>&1; then
  rm -f "$TMP/bootstrap-pass.age"
  out="$(printf 'bootstrap-test-pass\nbootstrap-test-pass\n' | \
        script -qec "MY_PI_AGE_KEY='$KEYREAL' MY_PI_BOOTSTRAP_BUNDLE='$TMP/bootstrap-pass.age' MY_PI_BOOTSTRAP_META='$TMP/bootstrap-pass.meta.json' bash '$BS' pack" /dev/null 2>&1)"; rc=$?
  check "口令模式打包成功" "$([ $rc -eq 0 ] && [ -s "$TMP/bootstrap-pass.age" ] && echo 1 || echo 0)" "$(echo "$out" | tail -2)"
  TARGET="$TMP/install/age.key"
  out="$(printf 'bootstrap-test-pass\n' | \
        script -qec "MY_PI_AGE_KEY='$TARGET' MY_PI_BOOTSTRAP_BUNDLE='$TMP/bootstrap-pass.age' MY_PI_BOOTSTRAP_META='$TMP/bootstrap-pass.meta.json' MY_PI_BOOTSTRAP_PUB='$PUBTMP' bash '$BS' unpack" /dev/null 2>&1)"; rc=$?
  check "unpack 安装成功" "$([ $rc -eq 0 ] && [ -f "$TARGET" ] && echo 1 || echo 0)" "$(echo "$out" | tail -2)"
  perm="$(stat -c '%a' "$TARGET" 2>/dev/null)"
  check "安装后权限 600" "$([ "$perm" = "600" ] && echo 1 || echo 0)" "实际 $perm"
  fp2="$(age-keygen -y "$TARGET" 2>/dev/null | tr -d '[:space:]')"
  check "安装的私钥指纹与源一致" "$([ "$fp2" = "$FP" ] && echo 1 || echo 0)"
  out="$(printf 'bootstrap-test-pass\n' | \
        script -qec "MY_PI_AGE_KEY='$TARGET' MY_PI_BOOTSTRAP_BUNDLE='$TMP/bootstrap-pass.age' MY_PI_BOOTSTRAP_META='$TMP/bootstrap-pass.meta.json' MY_PI_BOOTSTRAP_PUB='$PUBTMP' bash '$BS' unpack" /dev/null 2>&1)"; rc=$?
  check "已存在私钥时 unpack 拒绝覆盖" "$([ $rc -ne 0 ] && echo 1 || echo 0)" "$(echo "$out" | tail -1)"
  out="$(printf 'bootstrap-test-pass\n' | \
        script -qec "MY_PI_AGE_KEY='$TARGET' MY_PI_BOOTSTRAP_BUNDLE='$TMP/bootstrap-pass.age' MY_PI_BOOTSTRAP_META='$TMP/bootstrap-pass.meta.json' MY_PI_BOOTSTRAP_PUB='$PUBTMP' bash '$BS' unpack --yes" /dev/null 2>&1)"; rc=$?
  check "unpack --yes 覆盖并留 .bak" "$([ $rc -eq 0 ] && ls "$TARGET".bak.* >/dev/null 2>&1 && echo 1 || echo 0)" "$(echo "$out" | tail -1)"
else
  skip "口令模式（缺 script，无法伪终端喂口令）"
fi

echo ""
echo "=== 4b. 公开仓库红线：引导包必须是密文且无明文私钥 ==="
if [ -f "$TMP/bootstrap-pass.age" ]; then
  check "引导包头部是 age 密文" "$(head -c 200 "$TMP/bootstrap-pass.age" | grep -q 'age-encryption.org/' && echo 1 || echo 0)"
  check "引导包内无明文私钥残留（AGE-SECRET-KEY-1）" "$(grep -qa 'AGE-SECRET-KEY-1' "$TMP/bootstrap-pass.age" && echo 0 || echo 1)"
fi

echo ""
echo "=== 5. 夹带非白名单成员 → 拒绝 ==="
EVIL="$TMP/evil"; mkdir -p "$EVIL/bootstrap"
cp "$KEYREAL" "$EVIL/age.key"; echo "hi" > "$EVIL/bootstrap/README.txt"; echo "PRIVATE" > "$EVIL/id_ed25519"
( cd "$EVIL" && tar -czf "$TMP/evil.tar" . )
MY_PI_AGE_KEY="$KEYREAL" age -r "$FP" -o "$TMP/evil.age" "$TMP/evil.tar" 2>/dev/null
out="$(MY_PI_AGE_KEY="$KEYREAL" MY_PI_BOOTSTRAP_BUNDLE="$TMP/evil.age" MY_PI_BOOTSTRAP_MODE=recipient bash "$BS" verify 2>&1)"; rc=$?
check "夹带 id_ed25519 的引导包被拒绝" "$([ $rc -ne 0 ] && echo "$out" | grep -q '非白名单' && echo 1 || echo 0)" "$(echo "$out" | tail -1)"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 引导包守门通过（$PASS 项）"
  exit 0
fi
echo "❌ 引导包守门失败 $FAIL 项（通过 $PASS）"
exit 1
