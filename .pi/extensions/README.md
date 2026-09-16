# .pi/extensions/ — 扩展层

Layer 2 扩展层，包含 12 个独立扩展。每个扩展是一个独立的 TypeScript 模块，通过 pi 的自动发现机制加载（扫描含 `index.ts` 的子目录）。

## 目录结构

```
extensions/
├── pi-autopilot/             # 自主运行（定时任务 + 自管理 + 失败自愈）
├── pi-browser/               # 浏览器自动化（CloakBrowser）
├── pi-context/               # Token 优化中枢（路由/thinking 剪枝/compaction 去重/输出截断）
├── pi-intervention/          # 干预捕获（abort 快照/corrective prompt）
├── pi-link/                  # 多设备互联（SSH 通道 + 远程 RPC）
├── pi-memory/                # 跨会话持久记忆（自主学习闭环）
├── pi-mode/                  # 模式切换（full/light/quick）
├── pi-tmux/                  # tmux 会话管理（后台任务/长任务）
├── pi-voice/                 # 语音交流（Termux：录音转写 + TTS）
├── pi-web-search/            # 网络搜索（SearXNG 私密搜索）
├── plan-mode/                # 计划模式（TUI 计划/任务管理）
├── subagent/                 # 子代理（delegate 给专门 agent）
├── tests/                    # 跨扩展测试工具
│   └── [README](tests/README.md)
├── types/                    # 共享 TypeScript 类型声明
│   └── [README](types/README.md)
├── tsconfig.json             # 扩展 TypeScript 配置
└── tsconfig.local.json       # 本地 TypeScript 配置
```

## 扩展一览

| 扩展 | 用途 | 相关文档 |
|------|------|---------|
| [pi-autopilot](pi-autopilot/) | 自主运行：定时任务调度 + 自管理 + 失败自愈（failover/看门狗/遥测/预算） | [README](pi-autopilot/README.md) |
| [pi-browser](pi-browser/) | 浏览器自动化：CloakBrowser 无头浏览器集成 | [README](pi-browser/README.md) |
| [pi-context](pi-context/) | Token 优化中枢：路由策略 + thinking 剪枝 + compaction 去重 + 输出截断 + 缓存统计 | [README](pi-context/README.md) |
| [pi-intervention](pi-intervention/) | 干预捕获：abort 快照 + corrective prompt 关联 + interventions.jsonl | [README](pi-intervention/README.md) |
| [pi-link](pi-link/) | 多设备互联：SSH 通道 + 远程 pi RPC（link_send/link_status） | [README](pi-link/README.md) |
| [pi-memory](pi-memory/) | 跨会话持久记忆：提取/存储/检索/合并，自主学习闭环 | [README](pi-memory/README.md) |
| [pi-mode](pi-mode/) | 模式切换：full（完整）/light（轻量）/quick（极简） | [README](pi-mode/README.md) |
| [pi-tmux](pi-tmux/) | tmux 会话管理：后台任务/长任务执行和监控 | [README](pi-tmux/README.md) |
| [pi-voice](pi-voice/) | 语音交流：Termux 录音转写（Whisper/Sherpa）+ TTS 朗读 | [README](pi-voice/README.md) |
| [pi-web-search](pi-web-search/) | 网络搜索：SearXNG 私密搜索 + Bing 备选 + HTTP 抓取 | [README](pi-web-search/README.md) |
| [plan-mode](plan-mode/) | 计划模式：TUI 计划/任务管理 + plan/todo 跟踪 | [README](plan-mode/README.md) |
| [subagent](subagent/) | 子代理：delegate 给专门 agent（scout/worker/reviewer） | [README](subagent/README.md) |

## 扩展加载流程

1. **发现**：扫描 `extensions/` 目录，查找含 `index.ts` 的子目录
2. **加载**：通过 jiti 运行时加载 TypeScript
3. **初始化**：调用扩展工厂函数，注册工具和事件
4. **绑定**：`ExtensionRunner.bindCore()` 替换 stub 方法
5. **激活**：扩展进入活跃状态，响应事件

## 扩展接口规范

```typescript
// 每个扩展必须遵循的模式
export default function (pi: AdaptedExtensionAPI): void {
  // 注册工具
  pi.tool({ ... })
  
  // 注册命令
  pi.command({ ... })
  
  // 监听事件
  pi.on('tool_call', handler)
}
```

## 相关链接

- [.pi/ 总览](../README.md)
- [自定义层](../../custom/README.md)
- [能力接缝系统](../../custom/seams/README.md)
- [事件系统](../../custom/events/README.md)
- [packs 技能包](../../packs/README.md)
