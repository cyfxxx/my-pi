# 补丁管理

本目录包含对 `vendor/pi/` 的修改补丁。每个补丁记录一个明确的修改。

## 文件结构

```
patches/
├── README.md                  # 本文件
├── 001-branding.patch         # 品牌化（name/piConfig）
└── 002-local-pi-mods.patch    # 本地 pi 源码改动
```

## 补丁命名规范

```
{序号}-{功能描述}.patch
```

## 现有补丁

| 补丁 | 作用 | 目标 |
|------|------|------|
| `001-branding.patch` | 将上游 monorepo 名称改为 `my-pi` 并写入 `piConfig` | `vendor/pi/package.json` |
| `002-local-pi-mods.patch` | 本地 pi 源码改动：项目级 `.pi` 发现、secrets 脱敏、Google `TOO_MANY_TOOL_CALLS`、离线跳过 model-data 校验、tsconfig 排除 `src/custom`、`packages/README.md` | `vendor/pi/packages/**` |

## 验证补丁

要求 `vendor/pi/` 处于对应基线（`vendor/PINNED_COMMIT`）：

```bash
for p in patches/*.patch; do
  git -C vendor/pi apply --check "$p"
done
```

## 使用方法

补丁由 `scripts/sync-upstream.sh` 在同步上游后自动应用，或在引导时由 `scripts/build.sh` 应用：

```bash
bash scripts/sync-upstream.sh
```

## 最佳实践

1. **最小化修改**：只修改必要的代码
2. **清晰描述**：每个补丁都有清晰的作用说明
3. **及时更新**：上游同步后及时更新补丁
4. **定期清理**：删除不再需要的补丁
