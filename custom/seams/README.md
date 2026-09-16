# custom/seams/ — 能力接缝系统

能力接缝（Capability Seam）系统定义了 14 个能力接口。每个能力由三角色组成：

- **Service Definition** — 声明接口
- **Service Provider** — 实现接口
- **Consumer** — 消费服务（通常是模型工具）

## Root files

| 文件 | 用途 |
|------|------|
| types.ts | 核心接口定义（ServiceDefinition, ServiceProvider, SeamRegistry） |
| registry.ts | 缝隙注册表（注册/查询/切换 Provider） |
| index.ts | 统一导出 |
| index-enhanced.ts | 增强导出（含额外 Provider） |
| adapter.ts | 适配器辅助 |

## 14 seam subdirs

每个子目录是一个小型模块：

| Seam | 用途 |
|------|------|
| shell/ | Shell 命令执行（local-provider） |
| fs/ | 文件系统操作（local-provider） |
| search/ | 网络搜索（tool-consumer） |
| sandbox/ | 沙箱安全（landlock/seatbelt/null-provider） |
| llm/ | LLM 调用（google-provider） |
| subagent/ | 子代理调度 |
| credentials/ | 凭证管理（env-provider） |
| interaction/ | 用户交互（terminal-provider） |
| settings/ | 设置持久化（file-provider） |
| session-log/ | 会话日志 |
| session-title/ | 会话标题生成（llm-provider） |
| webhook/ | Webhook 回调 |
| todo/ | Todo 存储（store-provider） |
| tests/ | 接缝系统测试 |

## Related

- [extensions/](../../.pi/extensions/README.md)
- [events/](../events/README.md)
- [architecture](../../docs/architecture.md)
