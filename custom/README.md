# custom — 自定义层

自定义层，通过适配器与 pi 交互，保持与上游隔离。

**关键原则：** custom → adapter → packages（单向依赖）

## 目录结构

```
custom/
├── bootstrap.ts        — 启动引导流程
├── extension-loader.ts — 扩展加载器
├── integration.ts      — 集成层（增强 API）
├── cordis.yml          — 声明式配置
├── tsconfig.json       — TypeScript 配置
├── src/                — 源代码（adapters/ + services/）
├── seams/              — 能力接缝系统（14 个能力接口）
├── events/             — 事件总线系统
├── session-log/        — 会话日志实现
├── config/             — 配置管理
├── docs/               — 内部项目文档
└── tests/              — 测试文件
```

## 文件说明

| 文件/目录 | 用途 |
|-----------|------|
| `bootstrap.ts` | 启动引导流程 |
| `extension-loader.ts` | 扩展加载器 |
| `integration.ts` | 集成层（增强 API） |
| `cordis.yml` | 声明式配置 |
| `tsconfig.json` | TypeScript 配置 |
| `src/` | 源代码（adapters/ + services/） |
| `seams/` | 能力接缝系统（14 个能力接口） |
| `events/` | 事件总线系统 |
| `session-log/` | 会话日志实现 |
| `config/` | 配置管理 |
| `docs/` | 内部项目文档 |
| `tests/` | 测试文件 |

## 相关链接

- [.pi/](../.pi/README.md)
- [packages/](../packages/README.md)
- [docs/](../docs/README.md)
