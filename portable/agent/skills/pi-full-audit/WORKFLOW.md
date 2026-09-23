# 详细步骤

## 第 0 步：准备

- 确认项目根与 git 状态（`cd /root/my-pi && git status -sb`），有他人/并行会话的未提交改动时先辨明归属，不覆盖
- 跑 `review.sh --selfcheck` 确认技能自身文件完整、`settings.json` 已启用本技能
- 用 todo 建立完整流程计划
- **基线测试提前并行**：`npx vitest run` 与后续所有步骤无依赖，本步完成后立即后台启动

## 第 1 步：确定性检查（机器先跑）

```bash
bash portable/agent/skills/pi-full-audit/review.sh --all /root/my-pi
```

- 保存完整输出到 /tmp 再分析（终端输出会截断）
- **"失败"项先定性再报告**，见 `references/ERROR-CHECKLIST.md`
- 可疑模式（阶段 E）逐条人工确认；密钥命中先判是否被 git 跟踪
- 隔离边界与类型检查分别对应 `npm run check` 与 `npx tsc --noEmit -p custom/`；日志被截断时单独复跑

### 第 1c 步：文档一致性检查（与确定性检查同批并行）

范围 = 项目自有 .md（排除 `node_modules/`、`vendor/pi/`、`custom/dist/`）。方法：按对象分组委派 scout 并行做「文档陈述 vs 实际」**可证伪核对**：

```text
组A: README.md/STRUCTURE.md/PROGRESS.md/DECISIONS.md + docs/ —— 对照实际目录树/脚本清单/功能清单/git log
组B: portable/agent/AGENTS.md（唯一注入）+ APPEND_SYSTEM.md —— 对照 custom/features/、package.json scripts、patches/ 清单
组C: custom/ 各模块注释与文档 vs 源码 —— grep 注册工具名/process.env 读取/配置键
组D: packs/INDEX.md + packs/*/SKILL.md vs 实际 packs/ 目录
```

## 第 2 步：基线回归测试（审查前必跑）

- 全量测试：`npx vitest run`（或 `npm test`）
- **命令一律重定向落盘并保留收尾标记**：
  ```bash
  npx vitest run > /tmp/my-pi-test.log 2>&1; echo "EXIT=$?" >> /tmp/my-pi-test.log
  ```
- 判读结果前先确认 `EXIT=` 收尾标记存在；缺失说明进程被提前终止，需分段补跑
- 测试**全绿**再进入深度审查；有红项先记录为问题，不阻塞后续步骤
- 回归结论标注运行时间点；跨时段比较前先重跑（并行改动会改变结果）

## 第 3 步：subagent 并行深度审查（核心）

按模块分组委派 scout（`custom/features/subagent/`），**每组独立上下文**，主会话只消费压缩报告：

```text
分组参考（my-pi）：
  组1: custom/adapters/ + custom/core/（Pi API 接触点、路径解析、密钥、原子写）
  组2: custom/features/ 业务模块（autopilot/browser/intervention/link/tmux/voice/mode）
  组3: custom/features/ context + memory + plan-mode + subagent（状态/注入/预算/委派）
  组4: custom/bootstrap.ts + scripts/ + patches/ + portable/agent/（入口/脚本/补丁/配置）
```

**委派 prompt 要点**：
- 明确角色与只读："以 scout 角色只读审查，不修改任何文件"
- 明确维度：正确性/安全/资源/并发与状态/回归影响/可维护性/架构边界
- **输出精简约束**："只列问题，每条 文件:行号 + 一句话描述 + 级别（HIGH/MEDIUM/LOW），LOW 最多 5 条；总输出控制在 2500 字内"

## 第 4 步：复核子代理逐条核实（防过度自信，必做）

**为什么**：初次审查/优化建议必然含缺陷（完美不可能）：行号引用错误、机制描述错误、设计权衡当 bug、定级偏高、遗漏同类问题。

- 按建议归属模块分组委派（沿用第 3 步分组），**每组一个子代理**，任务 = 逐条核实
- **文档一致性发现（第 1c 步产出）豁免本步**
- **复核子代理同时负责发现同类遗漏**：核实某条时留意同模块是否存在同一类问题
- scout 无写权限，需实测的条目交主会话（或委派 worker）补验

## 第 5 步：主会话终审 + 分级报告

主会话消费复核结论（每模块一行汇总），不再逐条读代码（上下文保护）：

1. **汇总表**：真实命中 / 部分属实（细节偏差）/ 误报 / 行号或位置错误 / 同类遗漏
2. **争议项终审**：复核结论与审查建议冲突、或 HIGH 定级有争议的，主会话亲自验证
3. **定级调整**：审查标 HIGH 但机制描述错误/触发面窄的降级
4. **修复方案细化**：核实后给出比审查建议更优的方案
5. 产出分级报告（HIGH 标注"主会话已验证"），格式见 [REPORT.md](REPORT.md)

## 第 6 步：修复执行闭环（用户要求时）

1. **先列修复计划**（todo 按 HIGH/MEDIUM 分批），用户批准后动手
2. **修复分层执行模式**：
   - HIGH/MEDIUM 核心项：主会话亲自修
   - LOW 项：批量委派 worker 并行修
   - **worker 修复报告不可全信**：主会话抽查关键 diff
3. 每个修复点**至少一个回归测试**
4. 行为/语义变化的修复同步更新 `README.md`/`STRUCTURE.md`/`docs/`
5. 全量回归：`npm run check` + `npx tsc --noEmit -p custom/` + `npx vitest run`
6. 涉及 `patches/` 的改动：确认补丁仍可对基线应用，并同步 `patches/README.md`
7. **正则/多层转义类精确修改用 write 写独立 .mjs 脚本执行最可靠**
8. **修复逐项销账**
9. 提交：只 add 本次改动清单的显式路径，绝不 `git add -A`；提交信息格式 `{feat,fix,docs}: <消息>`
