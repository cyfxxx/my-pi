# custom/events/ — 事件总线系统

模块间通过类型化事件通信，支持 5 种调度模式。

## 文件结构

| 文件 | 用途 |
|------|------|
| types.ts | 事件类型定义（FrameworkEventMap） |
| bus.ts | 事件总线实现（emit/waterfall/parallel/serial/bail） |
| adapter.ts | 事件适配器 |
| index.ts | 统一导出 |
| tests/bus.test.ts | 事件总线测试 |

## 5 种调度模式

| 模式 | 行为 | 用途 |
|------|------|------|
| emit | 通知型，无返回值 | 观察者 |
| waterfall | 中间件链，可短路 | 请求拦截/策略 |
| parallel | 并发执行 | 多 provider 竞争 |
| serial | 顺序执行，有返回值 | 管道式处理 |
| bail | 首个成功即返回 | 短路求值 |

## Related

- [seams/](../seams/README.md)
- [extensions/](../../.pi/extensions/README.md)
- [architecture](../../docs/architecture.md)
