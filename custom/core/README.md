# custom/core — 核心服务层

纯逻辑底座，**零 Pi 依赖**：任何 feature 都可以 import，但本层不得 runtime import `@earendil-works/*`（`import type` 编译后擦除，例外）、不得 import feature。
所有路径都动态解析，支持从任意位置调用。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `config.ts` | 路径解析（项目根 / portable / agentDir / memoryDir / vendor） | `getProjectRoot`、`getPortableRoot`、`getAgentDir`、`getSkillsDir`、`getSessionDir`、`getExtensionDir`、`getMemoryDir`、`getVendorPiDir`、`ensureDirectories`、`getEnv` |
| `registry.ts` | 功能注册表 | `defineFeature`、`registerAll` |
| `atomic-write.ts` | 原子写（write-tmp + rename） | `writeTextSync`、`writeJSONSync`、`writeJSONAtomic` |
| `fs-json.ts` | JSON/JSONL 读写基元（容错读取、追加、轮转追加） | `ensureDir`、`readJSONSync`、`readJSONOr`、`readJSONL`、`appendJSONL`、`appendJSONLRotating` |
| `text.ts` | 通用文本/数值格式化 | `localDay`、`truncateChars`、`oneLine`、`formatTokens` |
| `cli.ts` | 命令参数与补全解析 | `parseSubcommand`、`filterCompletions` |
| `secrets.ts` | 敏感信息脱敏 | `scrubSecrets`、`SECRET_PATTERNS` |
| `net-guard.ts` | SSRF 防护 | `isBlockedHost`、`isUrlAllowed` |
| `index.ts` | 统一 barrel | 汇总以上导出 |

## 约定

- 读取失败一律不抛：`readJSONSync` 返回 `null`、`readJSONL` 返回 `[]`、`readJSONOr` 返回 fallback。
- 追加写入不吞错：`appendJSONL` 写失败会抛，度量类调用方自行 `try/catch` 做 fail-open；轮转阈值由调用方传入。
- 带单位/精度/省略号差异的格式化**不要**强行归一（如 KB/MB 精度、截断标记），避免改变用户可见输出。
- 「读到 → 合并 → 原子写」的读改写临界区不在本层，仍由各 feature 的锁 + `atomic-write` 组合。

## 测试

`__tests__/`：`net-guard.test.ts`、`secrets.test.ts`、`fs-json.test.ts`、`text.test.ts`、`cli.test.ts`。

## 相关

- 上层：[../README.md](../README.md)
- 适配层（唯一接触 Pi）：[../adapters/README.md](../adapters/README.md)
- 功能层：[../features/README.md](../features/README.md)
