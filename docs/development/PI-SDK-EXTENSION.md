# Pi 扩展深度定制参考

> 扩展 API 不够用时，如何在 my-pi 的隔离约束下安全地使用 SDK 做更深层定制。

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 更新日期 | 2026-09-20 |
| 适用范围 | Pi 扩展深度定制、SDK 使用（`custom/adapters/`、`custom/features/`） |
| 相关文档 | [PI-EXT-DEV-NOTES.md](./PI-EXT-DEV-NOTES.md), [SKILLS-MAINTENANCE.md](./SKILLS-MAINTENANCE.md) |

---

## 目录

- [一、背景：扩展 API 与 SDK 的关系](#一背景扩展-api-与-sdk-的关系)
- [二、深度定制总览](#二深度定制总览)
- [三、方案详解](#三方案详解)
- [四、不能做什么](#四不能做什么)
- [五、决策树：应该用哪个方案](#五决策树应该用哪个方案)
- [六、总结与注意事项](#六总结与注意事项)

---

## 一、背景：扩展 API 与 SDK 的关系

Pi 的扩展系统有两层能力来源：

| 来源 | 入口 | 说明 |
|------|------|------|
| **扩展 API** | `pi.on()` / `pi.registerTool()` / `pi.registerCommand()` | Pi 进程内安全发起的"插件接口"，生命周期和权限受控 |
| **SDK** | `@earendil-works/pi-agent-core` / `@earendil-works/pi-coding-agent` | Pi 核心能力的库导出，可在扩展中直接 import |

**为什么可以结合：** Pi 的扩展加载器已内置 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`（含 `/compat`、`/oauth`、`/providers/all`）、`@earendil-works/pi-tui`、`typebox`（含 `typebox/compile`、`typebox/value`）作为虚拟模块。扩展代码可以直接 `import` 它们，无需额外 `npm install`。

```typescript
// 扩展里可以直接写（不报错，不需要 npm install）：
import { estimateTokens, createBashToolDefinition, SessionManager }
  from "@earendil-works/pi-coding-agent"
```

### my-pi 的落地约束

my-pi 的功能模块不是散落在扩展目录里的脚本，而是受"三隔离一收敛"约束的代码。SDK 使用必须落进这个结构：

| 层 | 位置 | 允许的 Pi 依赖 |
|----|------|----------------|
| 纯逻辑 | `custom/features/<name>/logic.ts` | **零**（不 import Pi，也不 import adapters） |
| 功能入口 | `custom/features/<name>/index.ts` | 只 `import type` Pi 类型；注册一律调用 `custom/adapters/` |
| 适配层 | `custom/adapters/*.ts` | **唯一**允许 import `vendor/pi` 的层（类型与运行时） |
| 装配 | `custom/bootstrap.ts` + `custom/core/registry.ts` | 顶层入口，`--extension` 加载它 |

因此本文件所有"在扩展里 import SDK"的示例，在 my-pi 中一律落地为：**SDK import 放进 `custom/adapters/` 的新适配器，功能模块 `index.ts` 经适配器注册，`logic.ts` 只保留纯计算，最后在 `custom/bootstrap.ts` 的 `FEATURES` 清单加一行**。功能改动后由 `npm run check`（`scripts/check-isolation.sh`）校验边界。

**类型解析：** `@earendil-works/pi-coding-agent` 等包名在 my-pi 中不是 `node_modules` 依赖，而是由 `custom/tsconfig.json` 的 `paths` 映射到 `vendor/pi` 的类型产物：

```jsonc
// custom/tsconfig.json（节选）
"paths": {
  "@earendil-works/pi-coding-agent": ["../vendor/pi/packages/coding-agent/dist/index.d.ts"],
  "@earendil-works/pi-coding-agent/*": ["../vendor/pi/packages/coding-agent/dist/*.d.ts"],
  "@earendil-works/pi-agent-core": ["../vendor/pi/packages/agent/dist/index.d.ts"],
  "@earendil-works/pi-agent-core/*": ["../vendor/pi/packages/agent/dist/*.d.ts"],
  "@earendil-works/pi-ai": ["../vendor/pi/packages/ai/dist/index.d.ts"],
  "@earendil-works/pi-tui": ["../vendor/pi/packages/tui/dist/index.d.ts"]
}
```

也就是说，`import ... from "@earendil-works/pi-coding-agent"` 在编辑器与 `npx tsc --noEmit -p custom/` 下解析到 `vendor/pi/packages/coding-agent/dist/`；**运行时并不需要这个包**——my-pi 以 pi 扩展方式运行（启动参数 `--extension custom/bootstrap.ts`），`pi` 对象由宿主注入，所以 `index.ts` 里的 `import type` 在运行前已被擦除。若适配器确实需要在运行时调用 SDK（工厂函数、`SessionManager` 写方法等），放在 `custom/adapters/` 中动态 import vendor 构建产物：

```typescript
const { createBashTool } = await import(
  '../../vendor/pi/packages/coding-agent/dist/index'
)
```

---

## 二、深度定制总览

```
浅（安全）                   深（有风险）
┌──────────────────────────────────────────────┐
│  扩展 API 已有                 SDK 可达         │
│                                              │
│  pi.on("context")              import + cast    │
│  pi.registerTool()             import 工厂函数    │
│  pi.registerCommand()          import 纯工具函数  │
│  pi.registerProvider()         globalThis 共享   │
│  ctx.ui.*                                          │
│  ctx.sessionManager (只读)     突破只读限制       │
│  ctx.compact()                 compact() 全参数   │
└──────────────────────────────────────────────┘
```

| 层级 | 能做 | 安全 | 需要 SDK |
|------|------|------|---------|
| 事件拦截 | 读写 prompt/消息/工具参数和结果 | ✅ | 不需要 |
| 纯函数增强 | token 估算/裁剪/压缩/串化 | ✅ | 需要 |
| 工具工厂 | 创建自定义版内置工具 | ✅ | 需要 |
| 类型突破 | 调用 SessionManager 写方法 | ⚠️ | 需要 |
| 全局共享 | 功能间共用状态 | ⚠️ | 不需要 |
| 新 Provider | 运行时添加模型供应商 | ✅ | 不需要 |

在 my-pi 中，"需要 SDK"的三行（纯函数、工具工厂、类型突破）都必须在 `custom/adapters/` 落地，功能模块只通过适配器暴露的稳定接口调用。

---

## 三、方案详解

### 方案 A：导入 SDK 纯函数增强功能（✅ 安全）

**适用场景：** 功能需要在事件处理中做更精细的计算，比如裁剪 context、估算 token、做压缩。

**可用函数清单：**

| 函数 | 用途 | 来源包 |
|------|------|--------|
| `estimateTokens(message)` | 估算单条消息 token 数（字符/4 保守估算） | `pi-coding-agent` |
| `estimateContextTokens(messages)` | 用最后一条 usage 计算总 context token（返回 `{ tokens, usageTokens, trailingTokens, lastUsageIndex }`） | `pi-agent-core` |
| `calculateContextTokens(usage)` | 从 usage 计算 context token | `pi-coding-agent` |
| `compact(preparation, model, ...)` | 执行压缩（全参数控制） | `pi-coding-agent` |
| `shouldCompact(contextTokens, contextWindow, settings)` | 判断是否需要压缩 | `pi-coding-agent` |
| `prepareBranchEntries(entries, tokenBudget)` | 预计算分支摘要条目 | `pi-coding-agent` |
| `serializeConversation(messages)` | 将消息串化为文本 | `pi-coding-agent` |
| `findCutPoint(entries, startIndex, endIndex, keepRecentTokens)` | 找到截断点（作用于 session 条目，返回 `firstKeptEntryIndex`） | `pi-coding-agent` |
| `findTurnStartIndex(entries, entryIndex, startIndex)` | 找到最近 turn 起点 | `pi-coding-agent` |
| `convertToLlm(messages)` | AgentMessage → LLM Message | `pi-coding-agent` |
| `parseFrontmatter(text)` | 解析 frontmatter | `pi-coding-agent` |
| `parseSessionEntries(content)` | 解析 session 条目 | `pi-coding-agent` |
| `getLatestCompactionEntry(entries)` | 取最近一份 compaction 摘要 | `pi-coding-agent` |

**示例（示意）：按实际 token 数决定是否压缩**

第一步，新增一个只做 SDK 计算的适配器：

```typescript
// custom/adapters/context-sdk-adapter.ts（新增；SDK 运行时 import 只能出现在 adapters）
import { estimateContextTokens } from "@earendil-works/pi-agent-core"
import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import { findCutPoint } from "@earendil-works/pi-coding-agent"

/** 估算当前上下文 token（纯计算，不改变 Pi 状态） */
export function estimateContext(messages: unknown[]): number {
  return estimateContextTokens(messages as never).tokens
}

/** 按 keepRecentTokens 预算求截断点；注意入参是 session 条目，不是消息数组 */
export function cutPoint(entries: SessionEntry[], keepRecentTokens: number): number {
  return findCutPoint(entries, 0, entries.length, keepRecentTokens).firstKeptEntryIndex
}
```

第二步，阈值常量放纯逻辑层：

```typescript
// custom/features/context/logic.ts（节选；纯逻辑，零 Pi 依赖）
export const CONTEXT_LIMIT = 80_000        // 自定义阈值
export const KEEP_RECENT_TOKENS = 20_000
```

第三步，功能入口经 hook-adapter 注册事件：

```typescript
// custom/features/context/index.ts（节选）
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { registerHook } from "../../adapters/hook-adapter"
import { estimateContext } from "../../adapters/context-sdk-adapter"
import { CONTEXT_LIMIT } from "./logic"

export function register(pi: ExtensionAPI): void {
  registerHook(pi, {
    event: "context",
    handler: async (event, ctx) => {
      const messages = (event as { messages: unknown[] }).messages
      if (estimateContext(messages) > CONTEXT_LIMIT) {
        ctx.compact()          // 触发压缩，不等待完成
      }
    },
  })
}
```

`findCutPoint` 返回的是 `firstKeptEntryIndex`，而 `context` 钩子操作的是消息数组——两者索引口径不同，需要自行做条目到消息的对齐；只有需要自定义裁剪逻辑时才用它，默认压缩路径交给 `ctx.compact()`。

**限制：** 这些是纯函数，只能计算不能改变 Pi 内部状态。

---

### 方案 B：用 SDK 工厂函数创建自定义工具（✅ 安全）

**适用场景：** 要在内置工具（bash/read/write/edit/grep/find/ls）基础上加安全校验、日志、拦截。

**可用工厂函数：**

```typescript
import {
  createBashToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
} from "@earendil-works/pi-coding-agent"
```

**示例（示意）：安全版 bash 工具（阻止危险命令）**

SDK 工厂函数与 `pi.registerTool` 都只能出现在适配层：

```typescript
// custom/adapters/safe-bash-adapter.ts（新增）
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent"
import type { ExtensionAPI, ToolDefinition as PiToolDefinition } from "@earendil-works/pi-coding-agent"

const BLOCKED = ["rm -rf", "dd if=", ":(){ :|:& };:", "> /dev/sda"]

export function registerSafeBash(pi: ExtensionAPI): void {
  const bashDef = createBashToolDefinition({ timeout: 30_000 })

  const tool = {
    ...bashDef,
    name: "safe_bash",
    execute: async (id, params, signal, onUpdate, ctx) => {
      const { command } = params as { command: string }
      if (BLOCKED.some((b) => command.includes(b))) {
        return {
          content: [{ type: "text", text: "Blocked: command matched deny pattern." }],
          details: { blocked: true },
          isError: true,
        }
      }
      return bashDef.execute(id, params, signal, onUpdate, ctx)
    },
  } as unknown as PiToolDefinition

  pi.registerTool(tool)
}
```

功能入口只负责调用适配器：

```typescript
// custom/features/<name>/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { registerSafeBash } from "../../adapters/safe-bash-adapter"

export function register(pi: ExtensionAPI): void {
  registerSafeBash(pi)
}
```

最后在 `custom/bootstrap.ts` 的 `FEATURES` 清单里加一行，否则功能不会被加载。

**限制：**
- 只能创建**新**工具（`registerTool` 不能覆盖同名），不能改 Pi 内置的 `bash`/`read`/`write` 等
- TypeBox schema 必须与工厂函数返回的一致

---

### 方案 C：类型转换突破只读限制（⚠️ 有风险）

**适用场景：** 需要在功能中写 session 元数据、追加扩展条目、切分支等——扩展 API 没暴露写方法时。

**原理：** `ctx.sessionManager` 运行时是完整的 `SessionManager` 实例，但静态类型是只读的 `ReadonlySessionManager`（只 `Pick` 出 `getCwd`/`getEntries`/`getTree`/`getLabel` 等读方法）。通过类型转换可以绕过。

在 my-pi 中，这个转换必须收敛在单个适配器文件里：

```typescript
// custom/adapters/session-write-adapter.ts（新增；as 转换只允许出现在 adapters 层）
import type { ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent"

export function writableSessionManager(ctx: ExtensionContext): SessionManager {
  return ctx.sessionManager as unknown as SessionManager
}
```

功能里经适配器调用：

```typescript
// custom/features/<name>/index.ts（节选）
import { registerHook } from "../../adapters/hook-adapter"
import { writableSessionManager } from "../../adapters/session-write-adapter"

registerHook(pi, {
  event: "agent_end",
  handler: async (_event, ctx) => {
    const mgr = writableSessionManager(ctx)
    mgr.appendSessionInfo("auto-named-session")
    mgr.appendCustomEntry("my-feature", { reviewed: true })
  },
})
```

**`SessionManager` 可额外调用的写方法（以当前 vendor 版本为准）：**

| 方法 | 用途 |
|------|------|
| `appendMessage(message)` | 追加消息条目 |
| `appendCustomEntry(customType, data?)` | 追加扩展自定义条目（不进入 LLM 上下文） |
| `appendCustomMessageEntry(customType, content, display, details?)` | 追加进入 LLM 上下文的自定义消息 |
| `appendSessionInfo(name)` | 设置会话显示名 |
| `appendLabelChange(targetId, label)` | 给条目打/清标签 |
| `appendModelChange(provider, modelId)` / `appendThinkingLevelChange(level)` | 记录模型/思考档位切换 |
| `appendCompaction(summary, firstKeptEntryId, tokensBefore, ...)` | 追加压缩摘要条目 |
| `branch(branchFromId)` / `resetLeaf()` | 移动 leaf 指针形成新分支 |
| `branchWithSummary(branchFromId, summary, ...)` | 带摘要的分支 |
| `setSessionFile(path)` | 切换会话文件 |
| `createBranchedSession(leafId)` | 抽出单条路径为新会话文件 |
| `newSession(options?)` | 新建会话 |

该方法集随上游版本变化，落地前以 `vendor/pi/packages/coding-agent/dist/core/session-manager.d.ts` 为准；session 条目本质是**只追加**的（不能修改或删除已写条目）。

**⚠️ 风险：**
- **版本耦合：** `ReadonlySessionManager` 的 `Pick` 列表随版本变化，写方法名也随之变化
- **状态不一致：** 绕过扩展 API 直接修改 session，Pi 内部可能没收到通知
- **调试困难：** Pi 不保证这些内部方法的稳定性

---

### 方案 D：命令上下文深入（基本安全）

**适用场景：** `/foo` 命令需要在 session 间切换、fork、发送消息。

`ExtensionCommandContext`（给 `registerCommand` handler 使用）比 `ExtensionContext` 多出：

```typescript
ctx.newSession(options)     // 创建新 session
ctx.fork(entryId, options)  // 分叉 session
ctx.navigateTree(targetId)  // 导航到 session 树节点
ctx.switchSession(path)     // 切换到其他 session 文件
ctx.waitForIdle()           // 等待 agent 空闲
ctx.reload()                // 重新加载扩展/技能/配置
```

命令注册同样要走适配层：当前 `custom/adapters/` 只提供 tool-adapter / hook-adapter，要注册命令需先新增命令适配器，不要把 `pi.registerCommand` 直接写进功能模块。

**`sendUserMessage` 的 `deliverAs` 参数：**

| 值 | 效果 |
|----|------|
| `"steer"` | 插入为 steering 消息，在当前 turn 执行完后立即处理 |
| `"followUp"` | 插入为 follow-up 消息，在 agent 自然结束后处理 |
| `"nextTurn"` | 下一个用户输入时处理 |

---

### 方案 E：globalThis 跨功能状态共享（⚠️ 有风险）

**适用场景：** 两个功能模块需要共享内存状态，不想通过文件系统或 `pi.events` 的字符串频道。

```typescript
// 功能 A：写
globalThis.__pi_shared_state ??= {}
globalThis.__pi_shared_state.lastSearchResults = results

// 功能 B：读
const results = globalThis.__pi_shared_state?.lastSearchResults
```

**⚠️ 风险：**
- 命名冲突（建议用 `__pi_` 前缀）
- 无类型安全
- `ctx.reload()` 重载后不会自动清理

**替代方案：** `pi.events` EventBus

```typescript
// 功能 A
pi.events.on("my-channel", handler)

// 功能 B
pi.events.emit("my-channel", data)
```

---

### 方案 F：自定义 Provider（✅ 安全）

**适用场景：** 添加非标准 API 兼容的模型供应商，需要自定义 baseUrl、HTTP headers、认证方式、流式解析。静态供应商配置通常写进 `portable/agent/models.json`；`registerProvider` 适合需要在运行时动态注册或覆盖的场景。

```typescript
pi.registerProvider("my-provider", {
  baseUrl: "https://my-api.example.com/v1",
  models: [
    { id: "my-model", maxTokens: 128_000, contextWindow: 128_000 }
  ],
  login: async (ctx) => {
    const key = await ctx.ui.input({ prompt: "API Key:" })
    return { apiKey: key }
  }
})
```

在 my-pi 中这段调用同样放在适配器（或由适配器包装后供功能入口调用），不要在 `logic.ts` 里接触 `pi`。

---

## 四、不能做什么

以下操作即使结合 SDK 也无法在扩展中完成：

| 操作 | 原因 |
|------|------|
| 改 `beforeToolCall` / `afterToolCall` / `shouldStopAfterTurn` / `prepareNextTurn` | 这些是 `createAgentSession()` 的配置参数，由宿主 pi 在启动时用（my-pi 以扩展方式运行，不自行建 session），会话创建后已固定 |
| 改 agent loop 的 retry/compact/continue 逻辑 | agent loop 内部硬编码 |
| 改扩展加载机制 | 加载器在功能运行前已完成；my-pi 的功能清单固定在 `custom/bootstrap.ts` 的 `FEATURES` |
| 改会话文件格式 | SessionManager 的序列化/反序列化硬编码 |
| 改终端渲染框架 | ink/reconciler 在扩展之外 |
| 替换 Pi 内置工具（bash/read/write） | `registerTool` 不能覆盖已有工具名 |
| 访问或修改用户输入队列 | steering/follow-up 队列只读 |

**要改这些，走 `patches/`：** 对上游的改动写入 `patches/`（`vendor/pi/` 是只读 clone，永不直接修改），随上游更新由 `bash scripts/sync-upstream.sh` 重新应用。补丁机制承载不了的，才考虑 fork 上游。

---

## 五、决策树：应该用哪个方案

```
你想做什么？
│
├─ 拦截/修改 LLM 看到的 prompt 或消息？
│   └─ 扩展 API 事件：before_agent_start / context / message_end → 不需要 SDK
│
├─ 拦截/修改工具调用或结果？
│   └─ 扩展 API 事件：tool_call / tool_result → 不需要 SDK
│
├─ 注册新工具？
│   ├─ 完全自定义 → 经 tool-adapter 注册 → 不需要 SDK
│   └─ 基于内置工具加安全层 → 方案 B（createBashToolDefinition + registerTool）
│
├─ 做数据计算（token 估算/裁剪/压缩）？
│   └─ 方案 A（import estimateTokens / compact 等纯函数）
│
├─ 注册新命令 / 快捷键 / provider？
│   └─ 扩展 API：registerCommand / registerShortcut / registerProvider → 不需要 SDK
│
├─ 在命令中切换/分叉 session？
│   └─ 方案 D（registerCommand 的 ExtensionCommandContext）
│
├─ 写 session 元数据 / 追加扩展条目？
│   ├─ 先尝试 ctx.compact() / portable/agent/APPEND_SYSTEM.md 等配置手段
│   └─ 还不够 → 方案 C（类型转换，有风险）
│
├─ 功能间共享状态？
│   ├─ 优先用 pi.events EventBus
│   └─ 需要大量数据传输 → 方案 E（globalThis，有风险）
│
└─ 以上都不够？
    └─ 通过 patches/ 修改上游，或 fork Pi 源码 / 构建独立 SDK 应用
```

所有分支最终都要回到 my-pi 的落点：`custom/adapters/`（Pi 交互）+ `custom/features/<name>/`（逻辑与注册）+ `custom/bootstrap.ts`（装配）。

---

## 六、总结与注意事项

### 优先顺序

1. **能用配置解决的**：`portable/agent/settings.json` / `portable/agent/APPEND_SYSTEM.md` / `portable/agent/AGENTS.md` 优先
2. **能用扩展 API 解决的**：`custom/adapters/hook-adapter.ts` 的 `HookEvent` 事件 + `registerTool` + `registerCommand` 第二优先
3. **需要 SDK 纯函数**：方案 A / B（安全，推荐）
4. **需要突破限制**：方案 C / E（有风险，尽量少用）

### 注意事项

- **SDK 版本锁定：** SDK 行为随 `vendor/PINNED_COMMIT` 锁定的上游版本变化。`bash scripts/sync-upstream.sh` 之后如果导入的函数签名变了，适配器会在编译期或运行时 break，需要同步回归。
- **隔离纪律：** 任何 SDK import（含 `import type`）只允许出现在 `custom/adapters/`，`logic.ts` 保持零 Pi 依赖；改动后跑 `npm run check`。
- **类型安全优先：** 能用 `import type` 就别 cast `as any`。方案 C 的 cast 应该集中在一个适配器文件里，方便排查。
- **测试：** 类型检查 `npx tsc --noEmit -p custom/`，单测 `npx vitest run`（`npm test`），隔离边界 `npm run check`；用到 SDK 导入的功能要在上游同步后做回归测试。
- **热重载行为：** 功能通过 `ctx.reload()` 重载时，`globalThis` 上残留的状态不会自动清理。
- **不要依赖内部 API：** 方案 C 突破的类型方法不被上游保障稳定，升级时会随 `vendor/pi` 一起变。
