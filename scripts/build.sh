#!/bin/bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🔨 构建 vendor/pi (coding-agent)..."
cd "$ROOT/vendor/pi/packages/coding-agent"
npm install
npm run build

echo "🔨 构建 custom/..."
cd "$ROOT"
npx tsc --project custom/ --outDir custom/dist --noEmit false

echo "✅ 构建完成"
