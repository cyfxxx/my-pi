# 补丁管理

本目录包含对 `vendor/pi/` 的修改补丁。每个补丁记录一个明确的修改。

## 文件结构

```
patches/
├── README.md              # 本文件
└── 001-branding.patch     # 品牌化补丁（name/configDir）
```

## 补丁命名规范

```
{序号}-{功能描述}.patch
```

## 现有补丁

| 补丁 | 作用 | 目标文件 |
|------|------|----------|
| `001-branding.patch` | 将上游 monorepo 名称改为 `my-pi` 并写入 `piConfig` | `vendor/pi/package.json` |

## 验证补丁

在 `vendor/pi/` 目录下检查补丁是否可应用（要求 `vendor/pi/package.json` 保持 pristine）：

```bash
cd vendor/pi
git apply --check ../../patches/001-branding.patch
```

## 使用方法

补丁由 `scripts/sync-upstream.sh` 在同步上游后自动应用：

```bash
bash scripts/sync-upstream.sh
```

> 注意：当前 `vendor/pi/` 由主仓库追踪，`sync-upstream.sh` 会拒绝执行；此时补丁仅作为
> 修改记录保留。详见 `STRUCTURE.md` 的「已知偏离」与 `DECISIONS.md`。

## 最佳实践

1. **最小化修改**：只修改必要的代码
2. **清晰描述**：每个补丁都有清晰的作用说明
3. **及时更新**：上游同步后及时更新补丁
4. **定期清理**：删除不再需要的补丁
