# .pi/core — Layer 0 基础层（零依赖）

## 目录结构

```
core/
├── config.ts         — 配置加载/合并/监听
├── registry.ts       — 服务注册/清理统一封装
├── hook-registry.ts  — 扩展钩子注册表（on/once/emit）
├── secrets.ts        — 密钥脱敏工具（日志/错误中脱敏 API key）
└── index.ts          — 统一导出
```

## 文件说明

| 文件 | 用途 |
|------|------|
| `config.ts` | 配置加载/合并/监听 |
| `registry.ts` | 服务注册/清理统一封装 |
| `hook-registry.ts` | 扩展钩子注册表（on/once/emit） |
| `secrets.ts` | 密钥脱敏工具（日志/错误中脱敏 API key） |
| `index.ts` | 统一导出 |

## 相关链接

- [.pi/ 总览](../README.md)
- [services/](../services/README.md)
- [extensions/](../extensions/README.md)
