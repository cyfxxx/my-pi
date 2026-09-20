# Pi 扩展开发注意事项

pi（earendil-works/pi-coding-agent）扩展开发实测经验汇总（2026-08，含上游 pi 扩展排障复盘教训）。与 `portable/config/AGENTS.md` 全局约定配套，本文件聚焦扩展开发的隐性契约与踩坑点。my-pi 的功能模块位于 `custom/features/`，经 `custom/adapters/` 注册到 Pi，下文"扩展"即指这类功能模块。

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 更新日期 | 2026-09-20 |
| 适用范围 | Pi 扩展开发、踩坑记录 |
| 相关文档 | [portable/config/AGENTS.md](../../portable/config/AGENTS.md), [PI-SDK-EXTENSION.md](./PI-SDK-EXTENSION.md) |

---

## 目录

- [一、注册与加载](#一注册与加载)
- [二、命令注册](#二命令注册)
- [三、快捷键](#三快捷键踩坑重灾区)
- [四、参数补全语义](#四参数补全语义)
- [五、UI API](#五ui-api)
- [六、缓存友好](#六缓存友好跨扩展约定)
- [七、测试与验证](#七测试与验证)
- [八、黑盒系统开发流程](#八黑盒系统开发流程)
- [九、Git 约定](#九git-约定)

---

## 一、注册与加载

- **my-pi 的功能模块在 `custom/features/<name>/`**（每个含 `index.ts` 注册入口 + `logic.ts` 纯逻辑；`logic.ts` 零 Pi 依赖），Pi API 只允许出现在 `custom/adapters/`（tool-adapter / hook-adapter / agent-adapter）
- **加载入口唯一**：`--extension` 指向 `custom/bootstrap.ts`，由其 `FEATURES` 清单配合 `custom/core/registry.ts` 统一注册。新增功能必须在 `FEATURES` 里加一行，否则不会被加载；上游 pi 的"扫描扩展目录自动发现"机制在 my-pi 中不适用
- 上游 pi 0.83+ 从 `agentDir/extensions/` 自动发现扩展，`settings.json` 的 `extensions` 数组仅作覆盖模式（`+` 强制 / `-`、`!` 排除），裸路径条目无效。my-pi 不使用该机制：`portable/config/settings.json` 不配置 `extensions`，功能一律经 `custom/features/` + `custom/adapters/` 注册
- 扩展代码改动后需重启 pi（或 `/reload`）生效
- 隔离边界由 `npm run check`（`scripts/check-isolation.sh`）校验：`custom/features/*/logic.ts` 不得依赖 Pi API，`custom/adapters/` 之外不得 runtime import `vendor/pi`

---

## 二、命令注册

- **整合规范**：同一扩展 slash 命令 ≤2 个，功能用子命令参数（终端程序风格），支持 `help`/`-h`/`--help`；description 简短并附 `/xxx help` 提示；子命令补全用 `getArgumentCompletions`
- 命令与钩子的注册统一经 `custom/adapters/` 暴露的稳定接口，功能模块不直接接触 Pi API

---

## 三、快捷键（踩坑重灾区）

- **`enter` 是保留键**：`tui.input.submit` 默认绑 enter，且在 `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS` 列表（`vendor/pi/packages/coding-agent/dist/core/extensions/runner.js`）——扩展注册 **enter 会被静默丢弃，无任何警告**！用 `Key.return`（matchesKey 的 case enter/return 同一分支，`\r` 命中）或 `shift+enter` 等非保留键
- **注册前查保留列表**：`grep -A20 "RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS" vendor/pi/packages/coding-agent/dist/core/extensions/runner.js`
- **handler 返回 false = 放行**：快捷键 handler 返回 `false` 时事件继续交给内置处理；返回 `true` 或不返回会吞掉该按键
- **上游补丁会被同步覆盖**：若某个按键行为依赖对上游的补丁，补丁会在 `scripts/sync-upstream.sh` 之后失效。注册这类快捷键前先探测补丁是否生效，未生效就不要注册该键（否则会吞掉全部回车，导致输入提交与菜单失效）。对上游的改动统一放 `patches/`，不要直接改 `vendor/pi/`
- 按键原始数据排查：临时在 `vendor/pi/packages/coding-agent/dist/modes/interactive/interactive-mode.js` 的 `onExtensionShortcut` 打日志可看到 `{data, keys:[...]}`——确认按键是否到达、注册是否被丢弃；这类临时日志不要提交（`vendor/pi/` 已 gitignore）

---

## 四、参数补全语义

- **`getArgumentCompletions(prefix)` 的 value 是整体替换参数前缀**（pi-tui `applyCompletion`：`beforePrefix + item.value`），不是追加当前单词！
- 三级命令补全 value 必须含完整参数：用户输入 `/xxx sub ` 时 prefix=`"sub "`，value 应为 `'sub on'` 而非 `'on'`（否则命令变成 `/xxx on`）
- prefix 参数含多级与空格（`prefix.trim().split(/\s+/)[0]` 取第一级分发）

---

## 五、UI API

- `ctx.ui.setStatus(key, text)` / `setWidget` / `setFooter`：**纯展示，无点击回调**，不能做可交互按钮
- `ctx.ui.custom()` 对话框：仅键盘交互（Enter/Escape）
- 编辑框：`getEditorText()` / `setEditorText()` / `pasteToEditor()` 可用（按键处理里区分"有内容=发送/空=续录"这类交互要主动确认用户心智模型）
- notify 级别：info / warning / error
- 终端专属 UI 用 `ctx.hasUI` 或 `ctx.mode === 'tui'` 守卫，避免在 rpc/json/print 模式下渲染交互组件

---

## 六、缓存友好（跨扩展约定）

- system prompt 注入禁止时间戳与精确数值；压力/效率提示用固定文案常量（如 `custom/features/context/logic.ts` 的 `EFFICIENCY_ADVICE`），同一档位对应同一段文本
- 注入面就是缓存前缀：文案、顺序、条数的任何漂移都会使 KV 缓存失效；涉及注入的改动（注入文案、消息变换阈值）须显式评审确认后再落地
- token 估算统一用 `custom/features/context/budget.ts` 的 `estimateTokens`，不要各功能自行估算
- **排序类注入加 banding**（上游 pi-memory 踩坑先例）：候选按分数排序时，高分前缀（与 top 差 <15%）锚定原序不参与重排——数据增量（新条目）不触发整体顺序变化，KV 缓存前缀保持稳定；多样性/重排只作用于分数相近的尾部 band
- **停止模型生成用 `ctx.abort()`**（上游 plan-mode 先例）：工具执行中需要"结束当前生成、交还输入权"时调用 `ctx.abort()`（等价用户按 Esc 的生成中止信号）；不要在返回文本里依赖模型自觉停止——模型读到"请停止"仍可能继续输出

---

## 七、测试与验证

```bash
# 全量单测（vitest，配置见 vitest.config.ts）
npm test
# 类型检查
npx tsc --noEmit -p custom/
# 隔离边界（logic.ts 零 Pi 依赖 / adapters 外无 vendor/pi runtime import / portable 无符号链接）
npm run check
```

- **单测的局限**：mock 验证"实现符合假设"，不验证"假设符合真实"——平台集成行为（按键分发、补全语义、硬件行为）必须运行时验证或集成冒烟
- 扩展事件（经 `custom/adapters/hook-adapter.ts` 的 `HookEvent` 暴露）：`before_agent_start` / `message_end` / `input`（返回 `{action:'handled'|'continue'|'transform'}` 可拦截或改写输入）/ `session_shutdown`（清理兜底）

---

## 八、黑盒系统开发流程（上游 pi 扩展排障教训）

涉及外部系统（硬件、Android API、daemon）时按 5 阶段走：

```
0 侦察：通读依赖链每层源码/脚本/文档（如 termux-api、pi-tui keys/autocomplete）
1 观测：先建持久日志（系统日志落盘 / dist 临时日志），先于一切修改
2 基准：最小集成冒烟脚本跑通，记录正常行为基线
3 假设显式化：把隐含假设写成文档并实验验证（如"进程退出≠录制结束"——用状态查询接口验证）
4 修改：每次改动跑冒烟对比基线；修复会揭开掩盖层，主动复查观察信号变化
```

- **以真实状态为权威信号**，不以中间进程/中间层推断
- **归因必须验证**：复现不了不修；修之前先抓到根因日志（滚动日志要持续落盘，否则关键行会被冲掉）
- 用户反馈索取量化信息（如"提前结束"→ 要求附实际秒数），缩短诊断循环
- 平台隐性契约（保留键、补全语义、补丁机制）踩过即入文档，避免重复

---

## 九、Git 约定

- remote 含 token 时推送后立即恢复无凭证 URL；token 内联一次性使用不落盘
- 勿提交 `portable/config/` 下的每环境机密与状态文件：`auth.json` / `models.json` / `models-store.json` / `modes.json` / `trust.json` / `pi-link-*.json` / `scheduled-seeds.json`（均已 gitignore）；`settings.json`、`keybindings.json`、`AGENTS.md`、`APPEND_SYSTEM.md` 是跟踪文件，改动需有意提交。`portable/memory/`、`portable/sessions/`、`portable/extensions/` 为运行时数据，不入库
- **上游 vendor 同步约定**：`vendor/pi/` 是独立 git clone（已 gitignore）、永不直接修改；对上游的改动写入 `patches/`，上游更新用 `bash scripts/sync-upstream.sh`（或 `bash scripts/sync-upstream.sh <commit>`）合并，锁定点见 `vendor/PINNED_COMMIT` 与 `vendor/pi/LAST_SYNC_POINT`
- 提交纪律：只提交本次会话更改的文件，暂存显式路径（永远不要 `git add -A`）；提交消息格式 `{feat,fix,docs}: <消息>`
- **pi-link 运行时文件约定**：跨设备共享类状态（活跃时间戳/远程状态/信箱）放 `portable/config/pi-link-*.json`，**gitignore + 每设备独立**；设备间信息交换走 ssh 文件读取，不引入 HTTP daemon
- 多环境网络与配置差异见 [ENVIRONMENTS.md](../operations/ENVIRONMENTS.md) 与 [TERMUX-DEV-NOTES.md](../operations/TERMUX-DEV-NOTES.md)
