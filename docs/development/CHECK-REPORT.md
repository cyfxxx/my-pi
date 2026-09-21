# my-pi 功能检查与脚本检查报告

**检查时间**：2026-09-21（第二轮修正）
**检查分支**：main（工作区）
**检查依据**：功能检查.md + 脚本检查.md + pi-tools 原项目（`scripts/rebuild.sh`）
**本轮范围**：聚焦"最近迁移波次"补漏（修复坏补丁、补齐 /命令 与快捷键、修正检查脚本与误报）

---

## 一、修正说明（上一版报告的误报）

上一版报告声称"所有问题已修复"，经与 pi-tools 原项目逐项比对，以下为**不实/未完成**项，本轮已修正：

| # | 上一版声称 | 实际 | 本轮处理 |
|---|-----------|------|---------|
| 1 | `patches/003-tab-completion-fix.patch` 为有效新补丁 | 路径前缀错误（`vendor/pi/...`，在 vendor/pi 内应为 `packages/...`）、index 行伪造、hunk 上下文不足，`git apply` 必败；且 vendor/pi 工作区存在同处未提交改动 | 由 `git -C vendor/pi diff` 重新生成有效补丁；vendor/pi 内提交为本地 commit，隔离检查恢复通过 |
| 2 | 隔离边界验证通过 | `vendor/pi` 有未提交修改，`npm run check` 实际 **失败**（exit 1） | 提交 vendor/pi 本地改动；`check-isolation.sh` 现通过 |
| 3 | "命令注册正常（10个）" | 实际仅 **5 个**（autopilot/context/mode/plan/voice） | 补齐至 **12 个**：新增 `/auto`、`/schedule`、`/memory`、`/link`、`/intervention`、`/usage-diag`、`/tools` |
| 4 | "工具注册 14 个"，memory/subagent/tmux 标为"工具型 ✅" | 实际 **9 个**；memory/subagent/tmux 均为 **0 工具**的桩 | 报告据实修正；工具移植属"全面移植"范围，本轮不动 |
| 5 | 快捷键 API 已修复 | `registerShortcut` 全项目 **0 调用**，voice/plan 快捷键缺失 | 新增 voice `Ctrl+Alt+R`、plan `Ctrl+Alt+P`；适配器导出 `Key` 供功能层使用 |
| 6 | `check-features.sh` 已新增 | 仅统计关键字，抓不到任何上述缺漏 | 重写为对照注册面清单的逐项校验，缺项即 ❌ 且 exit 1 |

---

## 二、修正后验证结果

### 2.1 隔离边界（`bash scripts/check-isolation.sh`）
```
🎉 所有隔离边界验证通过
```
9 项全通过，含 `vendor/pi/ 干净`。

### 2.2 TypeScript 类型检查
```
npx tsc --noEmit -p custom/   ✅ 通过（无错误）
```

### 2.3 功能完整性（`bash scripts/check-features.sh`）
```
🎉 所有功能检查通过（⚠️ 0 项警告）
```
- feature 目录：**12/12**（index.ts + logic.ts 齐备）
- 工具注册：**9**（web_search、link_status、browser_navigate/close、voice_transcribe/speak、autopilot_start/stop/status）
- 命令注册：**12**（autopilot、auto、schedule、context、usage-diag、tools、mode、plan、voice、memory、link、intervention）
- 快捷键注册：**2**（voice Ctrl+Alt+R、plan Ctrl+Alt+P）
- 钩子注册：**21**
- 补丁：001/002/003 均可应用或已应用

### 2.4 单元测试
```
npm test   ✅ 4 个文件 / 27 用例通过
```
（顺手修复：`npm test` 原为裸 `vitest run`，会误扫 vendor 内多个 vitest 配置而报错；改为显式 `--config vitest.config.ts`。）

---

## 三、与原项目的真实差距（本轮未覆盖）

本轮仅补"最近迁移波次"的注册面缺漏。以下为对照 pi-tools 后确认的**系统性差距**，属"全面移植 / 脚本编排"范围：

### 3.1 扩展实现深度（12 个 feature 多为骨架）
- **0 工具**：memory（原 9 个工具 + `/memory`）、subagent（原 `subagent` 工具 + renderCall/renderResult）、tmux（原 6 个工具）
- **大幅缺工具**：browser 2/18、autopilot 3/16、web-search 1/3、link 1/2、plan-mode 0/4、context 0/2
- **缺命令子域**：`/auto`、`/schedule` 目前为壳（无 scheduler/failover/watchdog/telemetry）；`/memory`、`/link`、`/intervention` 为壳
- 其余缺子系统：intervention 中止快照、mode 的 thinking/extensions 门控、plan-mode 的 todo/overlay/只读、voice 的录音/STT/TTS/wake、context 的 warm-prefix/auto-compact/prune/thinking-level

### 3.2 脚本与外部服务（pi-tools `rebuild.sh` 覆盖，my-pi 缺失）
- 配置注入、SearXNG（venv/repo/settings.yml）、whisper、CloakBrowser、systemd/cron、wrapper、tmux.conf、link keys、packs-sync、fd/rg、tsconfig.local
- 12 个 TUI 补丁（my-pi 目前仅 003 对应 `patch-tab-arg-completion`）
- 度量/防退化：daily-health、pi-bench、golden-tasks、smoke-test、verify-patches、doc-lint、npm-missing-deps
- 服务层：hook-registry（含 3 条内置安全 hook）、auto-compact、prune、shadow-review、usage-diag、task-record、config merge
- 目录：deploy/、.github/、.githooks/、searxng/、agent/recovery/、agents/、prompts/

### 3.3 配置
- `settings.json`：my-pi 为超集，无缺项
- `modes.json`：`light.skills` 被简化为 `!ALL`、`light.thinking` 由 `low`→`medium`
- `keybindings.json`、`scheduled-seeds.json`：与源逐字节一致

---

## 四、结论

**本轮（最近迁移波次补漏）**：✅ 完成
- 修复坏补丁 003，恢复 `npm run check` 通过
- 命令 5 → 12，快捷键 0 → 2，补齐 pi-tools 命令面
- `check-features.sh` 重写为真实注册面校验
- 修正上一版报告的误报，并订正文档脚本计数（4→5）

**后续（按需另开轮次）**：
1. 按 `rebuild.sh` 清单迁移脚本/服务编排
2. 按扩展逐项移植完整实现（参见对比分析）
