#!/bin/bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🔨 构建 vendor/pi..."
cd "$ROOT/vendor/pi"
npm install
npm run build

echo "🔨 构建 custom/..."
cd "$ROOT"
npx tsc -p custom/ --outDir custom/dist

echo "✅ 构建完成"
