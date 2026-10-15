#!/usr/bin/env bash
# dsh-build.sh — 把 my-pi 的 DSH 插件打成**可安装产物**，并用纯 node 冒烟
#
# 为什么需要打包：DSH 的 profile 通过 `cordis.patch.yml` 的条目 `name:` 加载插件模块；
# 它加载的是 **JS 模块**，而本仓是 TS（无扩展名导入 + 依赖 tsx）。所以要产出一个自包含
# 的 ESM 文件，DSH 侧不需要 tsx、也不需要本仓的 node_modules。
#
# 外部化策略：**所有裸包名都 external**（esbuild `--packages=external`），只有本仓 TS 进产物。
#   - `@deepseek-ai/*`：**宿主提供**（DSH 自己就是这些包的宿主）
#   - `@earendil-works/*`：由部署别名到 `custom/adapters/dsh/pi-shims/`（见 pi-shims/README.md）
#   - typebox / ws / tinyglobby 等：由 `dsh/plugin/package.json` 声明，profile 安装时解析
# 这样产物只含我们自己的代码（小、可读），依赖关系显式写在 package.json 里。
# 为什么不用"只 external @deepseek-ai/*"：那会把 playwright-core 的**可选**依赖
# （chromium-bidi 等未安装的包）也拖进打包并直接报错 —— 浏览器能力本就该按需安装。
#
# 用法：
#   bash scripts/dsh-build.sh              # 构建 + 纯 node 冒烟（需 dsh/spike/node_modules）
#   bash scripts/dsh-build.sh --no-smoke   # 只构建
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

OUT_DIR="$ROOT/dsh/plugin/dist"
OUT="$OUT_DIR/my-pi-plugin.mjs"
ESBUILD="$ROOT/node_modules/.bin/esbuild"
NO_SMOKE=0
for arg in "$@"; do case "$arg" in --no-smoke) NO_SMOKE=1 ;; *) echo "用法: $0 [--no-smoke]" >&2; exit 2 ;; esac; done

[ -x "$ESBUILD" ] || { echo "❌ 缺少 esbuild（$ESBUILD）" >&2; exit 2; }
mkdir -p "$OUT_DIR"

echo "=== 构建 DSH 插件产物 ==="
"$ESBUILD" "$ROOT/dsh/plugin/entry.ts" \
  --bundle --platform=node --format=esm --target=node22 \
  --packages=external \
  --banner:js='/* my-pi DSH 插件（由 scripts/dsh-build.sh 从 dsh/plugin/entry.ts 打包；勿手改） */' \
  --outfile="$OUT" --log-level=warning || { echo "❌ esbuild 失败" >&2; exit 2; }
echo "✓ 产物：$OUT（$(du -h "$OUT" | awk '{print $1}')）"

# 产物自检：
#   ① 依赖**不得内联**（出现 playwright/chromium-bidi 之类第三方内部实现 = 策略失效）
#   ② 入口符号必须在（`apply`/`name`/`inject`）——DSH 的 loader 就是按这三样加载插件的
#   ③ 体积上限（产物只该含本仓代码；>3 MB 说明误内联了依赖）
# 注：产物里**不该**出现 `from "@deepseek-ai/…"` —— 插件是 `apply(ctx)` 接收宿主传入的
#     ctx，不 import DSH 包（这正是解耦点；若哪天需要 import，是设计变化，要显式改这里）。
if grep -q 'chromium-bidi\|playwright-core/lib' "$OUT"; then
  echo "❌ 产物内联了第三方实现（应保持 external）" >&2
  exit 2
fi
# esbuild 会把导出聚成一个 `export { … }` 块（多行）⇒ 用 node 真正 import 一次来核对符号，
# 比 grep 可靠（也顺带证明产物可被 ESM 加载）。
missing="$(node --input-type=module -e "
import('$OUT').then((m) => {
  const need = ['apply', 'name', 'inject'];
  const miss = need.filter((k) => !(k in m));
  if (miss.length) { console.log(miss.join(',')); process.exit(0); }
  console.log('');
}).catch((e) => { console.log('IMPORT_FAIL:' + e.message); });
" 2>/dev/null)"
case "$missing" in
  '') : ;;
  IMPORT_FAIL:*) echo "❌ 产物无法被 ESM 加载：${missing#IMPORT_FAIL:}" >&2; exit 2 ;;
  *) echo "❌ 产物缺少入口符号：$missing" >&2; exit 2 ;;
esac
size_kb=$(du -k "$OUT" | awk '{print $1}')
if [ "$size_kb" -gt 3072 ]; then
  echo "❌ 产物异常大（${size_kb}KB）⇒ 可能误内联了依赖" >&2
  exit 2
fi
echo "✓ 产物自检通过（external 生效、入口符号齐、${size_kb}KB）"

if [ "$NO_SMOKE" = "1" ]; then
  echo "（--no-smoke：跳过冒烟）"
  exit 0
fi

echo "→ 纯 node 冒烟（不含 tsx）…"
if node "$ROOT/dsh/spike/smoke-built.mjs"; then
  echo "🎉 DSH 插件产物冒烟通过"
  exit 0
else
  rc=$?
  echo "❌ DSH 插件产物冒烟失败（退出码 $rc）" >&2
  exit "$rc"
fi
