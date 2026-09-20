# 会话运行检查 + 每日快速巡检

> 按需加载：仅触发词「运行检查」「会话检查」「健康巡检」或每日巡检时读取本文件。
> 主流程 SKILL.md 只保留引用行，减少技能加载时的读取次数。

模块 D 对**当前 my-pi 运行态**做健康检查——区别于代码审计（审运行态而非代码态）。随时可单独执行（只读、无依赖）。触发词："运行检查""会话检查""健康巡检"。

> **检查运行态时勿改动配置**：修改 `portable/config/settings.json` 或启用/禁用工具会改变 system prompt 前缀与工具列表，直接污染所测的运行态；只读文件 + 状态工具即可完成检查。

## 检查清单（按序）

1. **运行态状态**
   - `autopilot_status`：自主运行开关、任务数、遥测、预算
   - `link_status`：链路状态
   - 模型/provider/思考层级：读 `portable/config/settings.json`（`defaultProvider`/`defaultModel`/`defaultThinkingLevel`）
   - 会话文件位置与大小：`ls -lS portable/sessions/`（pi 使用 agentDir 默认时也可能位于 `portable/config/sessions/`）

2. **token 预算与压力档位**（`custom/features/context/`）
   - 预算源：`budget.ts` 以真实 `contextWindow` 校准总预算，未校准时默认 128K
   - 压力档位阈值：`medium ≥ 0.70`、`high ≥ 0.85`、`critical ≥ 0.95`；`getBudgetReport()` 给出 `used/total/remaining/ratio/pressure/topConsumers`
   - 固定文案仅在 `high`/`critical` 注入（`getTokenPressureTag()`/`getUrgencyHint()`）：文案固定、无时间戳/精确数值，保证 system prompt 字节级稳定 → 缓存前缀稳定
   - 异常判据：压力长期停在 `critical`（压缩未触发或预算被低估）；tool 用量榜单一两个工具长期霸榜 → 对应工具输出未收敛

3. **工具输出归档**（`custom/features/context/output-archive.ts`）
   - 归档目录：`portable/memory/tool-outputs/`（`PI_OUTPUT_ARCHIVE_DIR` 可覆盖），路径 = `<前2hex>/<sha256(原文)前16hex>-<字符数>.txt`，内容相同即同路径（幂等、缓存友好）
   - 检查：目录体积与文件数是否异常增长；占位符中的归档路径是否真实可读回（`read` 抽查 1-2 个）
   - 异常判据：归档目录体积远超会话体积、存在大量重复内容（说明调用方未走归档路径）

4. **memory 笔记与注入块**（`custom/core/note-store.ts` + `custom/features/memory/`）
   - 笔记文件：`portable/memory/notes.json`（损坏时自动备份为 `notes.json.corrupt-<时间戳>`）；checkpoints 目录 `portable/memory/checkpoints/`
   - 注入块构建 `buildInjectionBlock`，注入标记 `INJECT_TAG = 'pi-memory-inject'`
   - 检查注入内容无时间戳/精确数值（缓存友好）；内容无重复摘要、无空条目、无半句硬截断（截断走 `truncateByTokens` 的句子边界 + 标记预算）
   - 若会话文件中可见 `INJECT_TAG` 落盘标记，可统计其出现次数（应≈请求轮数）；注入不落盘时改以「前缀稳定性」反证（同一会话相邻请求的 system prompt 段应字节一致）

5. **数据收敛边界**
   - `portable/` 下无符号链接（`npm run check` 覆盖）
   - 运行时数据只写 `portable/`（sessions/memory/extensions 与 config 下本地状态），不写仓库根或 `custom/`
   - 会话、笔记、归档不在 git 跟踪列表中

6. **自动执行与残留状态**
   - `autopilot_status` 与 `portable/config/.pi-autopilot-telemetry.json`（遥测）、`.pi-autopilot-crash.json`（崩溃记录）、`.pi-autopilot-lastgood.json`（最近正常点）、`.pi-admin-state.json`（管理状态）
   - 异常判据：遥测失败率高、崩溃记录持续增长、lastgood 长期未更新；异常状态文件存在 = 对应路径触发过，结合内容判断是否需要处理

## 判定基准

| 指标 | 正常 | 异常 |
|---|---|---|
| token 压力档位 | `low`/`medium`，偶发 `high` | 长期 `critical` → 压缩未触发/预算低估 |
| 工具输出归档 | 占位符路径可读回，体积随会话温和增长 | 体积失控增长 → 归档未生效或重复归档 |
| 注入块 | 无时间戳/精确数值、无重复/空条目 | 含时间戳 → 缓存前缀不稳定 |
| 会话体积 | 与消息数相称 | 异常膨胀 → 上下文失控，转 context 预算排查 |
| autopilot 遥测 | 与配置一致、lastgood 新鲜 | 任务缺失、遥测失败率高、崩溃记录增长 |
| `portable/` 边界 | 无符号链接、运行时数据不入库 | 出现符号链接或运行时数据被跟踪 → HIGH |

## 输出格式

```
## 会话运行检查报告
**会话**: <文件> | **模型**: <provider/model>
1. 运行态状态: ✓/✗ + 依据
2. token 预算: used xxK / total xxK（pressure: low/medium/high/critical）
3. 工具输出归档: ✓/✗（目录体积、抽查路径可否读回）
4. memory 注入: ✓/✗（无时间戳/重复/空条目；前缀稳定性）
5. 数据收敛边界: ✓/✗
6. 自动执行: ✓/✗（autopilot 遥测/崩溃记录/lastgood）
结论: 正常 / N 项异常（附修复建议）
```

## 与代码审计的关系

运行检查发现问题需要改代码时：小改动走模块 A（代码审查，审查 diff 后修），系统性改动转修复闭环（WORKFLOW 第 6 步）。运行检查不替代审计，两者互补。

## 每日快速巡检模式（轻量只读）

每日整体复检 my-pi 前一日运行情况，**只读为主、不深入探索**（防 token 浪费，参考一轮工具调用 6-12 个、out ~500 tokens）。不改配置，工作目录 `/root/my-pi`。

1. **会话水位**：`ls -lS portable/sessions/ | head`（或 `portable/config/sessions/`）看最大会话文件与增长
2. **归档水位**：`du -sh portable/memory/tool-outputs portable/memory 2>/dev/null` 看工具输出归档与笔记体积
3. **自动执行**：`autopilot_status`；读 `portable/config/.pi-autopilot-lastgood.json` 与 `.pi-autopilot-crash.json` 时间戳
4. **收敛边界**：`npm run check`（隔离边界，含符号链接与 vendor/pi 干净度）
5. **汇总**：一条 bash 聚合完成全部检查项；输出仅"ok / 异常项清单"两类结论；异常项创建后续任务处理，不在当轮深挖
