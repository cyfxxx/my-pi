#!/bin/bash
# scripts/apply-patches.sh - 应用所有补丁

set -e

echo "=== 应用补丁 ==="

for patch in patches/*.patch; do
    if [ -f "$patch" ]; then
        echo "应用: $patch"
        git apply --check "$patch" 2>/dev/null && git apply "$patch" || {
            echo "补丁冲突: $patch"
            echo "需要手动解决"
            exit 1
        }
    fi
done

echo "=== 补丁应用完成 ==="
