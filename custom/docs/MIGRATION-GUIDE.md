# 扩展迁移指南

## 导入路径更新

### 旧路径 → 新路径

| 旧路径 | 新路径 |
|--------|--------|
| `../../services/prune.ts` | `../../src/services/token-budget/prune.ts` |
| `../../services/context-budget.ts` | `../../src/services/token-budget/context-budget.ts` |
| `../../services/auto-compact.ts` | `../../src/services/token-budget/auto-compact.ts` |
| `../../services/task-record.ts` | `../../src/services/diagnostics/task-record.ts` |
| `../../services/usage-diag.ts` | `../../src/services/diagnostics/usage-diag.ts` |
| `../../../services/token-budget/prune.ts` | `../../../src/services/token-budget/prune.ts` |
| `../../../services/token-budget/context-budget.ts` | `../../../src/services/token-budget/context-budget.ts` |
| `../../../services/token-budget/auto-compact.ts` | `../../../src/services/token-budget/auto-compact.ts` |
| `../../../services/diagnostics/task-record.ts` | `../../../src/services/diagnostics/task-record.ts` |
| `../../../services/diagnostics/usage-diag.ts` | `../../../src/services/diagnostics/usage-diag.ts` |

### 更新方法

```bash
# 使用 sed 批量更新
find custom/extensions -name "*.ts" -exec sed -i 's|../../services/|../../src/services/|g' {} +
find custom/extensions -name "*.ts" -exec sed -i 's|../../../services/|../../../src/services/|g' {} +
```

### 注意事项

1. 测试文件中的导入路径也需要更新
2. 确保更新后 TypeScript 编译通过
3. 运行测试验证功能正常
