# custom/src/adapters/ — 适配器层

隔离 pi API 变化，提供稳定接口。

## 文件结构

| 文件/目录 | 用途 |
|-----------|------|
| api.ts | ExtensionAPI 适配（将 pi 原生 API 转为自定义接口） |
| types.ts | 适配器类型定义 |
| index.ts | 统一导出 |

### tools/ — 工具系统适配

| 文件 | 用途 |
|------|------|
| tool-adapter.ts | 工具注册适配 |
| interceptor.ts | 工具拦截适配 |
| layering.ts | 工具分层适配 |

### session/ — 会话管理适配

| 文件 | 用途 |
|------|------|
| session-adapter.ts | 会话管理适配 |
| export-adapter.ts | 会话导出适配 |

## Related

- [.pi/extensions/](../../.pi/extensions/README.md)
- [services/](../services/README.md)
- [TOOL-SYSTEM-SINKING](../../custom/docs/TOOL-SYSTEM-SINKING.md)
