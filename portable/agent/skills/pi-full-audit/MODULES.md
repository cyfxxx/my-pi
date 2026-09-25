# 模块详细步骤

按模块选择执行。每个模块可独立运行，也可组合使用。

---

## A. 代码审查

审查 my-pi 仓库的 git 变更：`custom/`（`adapters/`、`core/`、`features/`、`bootstrap.ts`）与 `scripts/`、`patches/`。确定性检查 + 清单核对 + 分级报告。

### 触发词
"审查""review""看下改动""PR 审查""检查代码"

### 流程

```
确定审查范围 → 确定性检查 → 人工检查清单 → 验证要求 → 分级报告
```

### 步骤

#### A1. 确定审查范围

```bash
# 项目根
cd /root/my-pi

# 技能自检
bash portable/agent/skills/pi-full-audit/review.sh --selfcheck

# 查看变更
git status -sb
git diff --stat
git diff -- custom/ scripts/ patches/ portable/agent/settings.json
git log --oneline -5
```

审查重点：本次改动的 `custom/` 源码、`scripts/` 脚本与 `patches/` 补丁。`vendor/pi/` 是只读上游，**不得直接出现改动**——若有，直接判 HIGH，改动必须改走 `patches/`。

#### A2. 确定性检查

```bash
bash portable/agent/skills/pi-full-audit/review.sh
```

脚本输出：git 卫生（含 vendor/pi 只读、portable 运行时数据误入库）、JSON 合法性、隔离边界、类型检查、可疑模式与密钥模式。完整输出重定向落盘后再分析。

#### A3. 人工检查清单

逐项核对（详见 [CHECKLIST.md](CHECKLIST.md)）：
1. 正确性：边界值、错误处理、类型转换、循环边界
2. 安全：输入校验、鉴权、硬编码密钥、路径穿越
3. 资源：句柄关闭、超时设置、递归深度
4. 并发与状态：竞态条件、异步串联
5. 回归影响：API 调用方、配置变更影响面
6. 可维护性：死代码、命名、过时注释
7. 架构边界：`features/*/logic.ts` 是否零 Pi 依赖；Pi API 是否只出现在 `adapters/`；运行时数据是否只落 `portable/`

#### A4. 验证要求

- 隔离边界：`npm run check`（`scripts/check-isolation.sh`）
- 类型检查：`npx tsc --noEmit -p custom/`
- 单元测试：`npx vitest run`（涉及功能的用例）
- 涉及 `patches/` 时：确认补丁可对 `vendor/PINNED_COMMIT` 基线干净应用

#### A5. 分级报告

按 HIGH/MEDIUM/LOW 分级输出。报告格式见 [REPORT.md](REPORT.md)。

---

## B. 仓库优化

对 my-pi 仓库（目录/存储/架构层面）做完整优化：摸底 → 分级方案 → 用户确认 → 执行落地 → 验证提交。

### 触发词
"仓库优化""结构优化""仓库卫生""存储清理""检查仓库"

### 流程

```
摸底（只读） → 输出分级方案 → 用户确认删除类条目 → 执行与验证 → 收尾汇报
```

### 步骤

#### B1. 摸底（只读）

- **目录树全览**：含隐藏目录，标注每块职责：
  - `vendor/pi/` 上游只读源码（独立 git clone，主仓库已忽略）
  - `custom/` 唯一维护的代码层（adapters/core/features/bootstrap.ts）
  - `portable/` 运行时数据收敛区（agent/{config,skills,agents,modes} + memory/）
  - `packs/` 外部技能包（按需加载，不注入系统提示词）
  - `scripts/` 21 个运维脚本（含共享库 lib-vendor.sh，扁平不建子目录）
  - `patches/` 上游改动补丁
  - `docs/` 项目文档
- **git 状态**：`git status` + `.gitignore` 核对
  - `portable/` 运行时数据（sessions/extensions/memory、config 下 auth/models/trust/pi-link-* 等）是否已忽略
  - `vendor/pi/` 是否已忽略
  - lock 文件、构建产物是否误入库
  - ignore 规则是否重复或冲突
- **大文件扫描**：`*.bak.*`、`.artifacts/`、测试生成的二进制、迁移遗留
- **两类文件区分**：
  - 入库共享：`custom/` 源码、`scripts/`、`patches/`、`docs/`、`portable/agent/` 下被白名单跟踪的配置与 `portable/agent/skills/`、`packs/`
  - 运行时本地：`portable/agent/sessions/`、`portable/memory/`、`portable/agent/{extensions,npm,git}/`、`portable/agent/` 下的 auth/models/state 文件

#### B2. 仓库体积审计

```bash
# 本地体积（最准确）
git count-objects -vH

# 按大文件排查
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | sed -n 's/^blob //p' | sort -rnk2 | head -20
```

> **注意**：GitHub API `size` 字段有缓存延迟，重写后仍显示旧值；本地 `size-pack` 才是准的。pack 减幅可能小于被删 blob（delta 重算吸收）。
>
> **my-pi 特有**：`vendor/pi/` 是独立 git 仓库且被主仓库忽略，不计入主仓库体积；评估其体积时单独在 `vendor/pi` 内跑 `git count-objects -vH`。`packs/` 是外部技能包仓库，是主要体积增量来源，逐包评估文档与附带资源大小。

#### B3. 输出分级方案

| 级别 | 定义 | 处理 |
|------|------|------|
| **H1 必改** | 结构错误、gitignore 冲突、丢数据/覆盖风险、vendor/pi 被直接修改 | 必须修 |
| **H2 建议** | 仓库卫生（忽略规则、去重、残留清理）、文档同步、packs 体积 | 建议修 |
| **H3 可选** | 重构迁移、长期演进 | 可选 |

每条附：位置、问题、改法、影响/风险。

#### B4. 删除类条目用户确认

涉及删除运行时数据、`packs/` 内容或跨设备文件的条目单列，执行前逐项确认"移除/保留"。

#### B5. 执行与验证

- 按确认方案批量修改，一轮内完成同类改动
- 验证：`npm run check` + `npx tsc --noEmit -p custom/` + `npx vitest run`
- 文档同步：`README.md`/`AGENTS.md`/`STRUCTURE.md` 的目录与功能清单与实际一致
- `patches/` 有变动时同步更新 `patches/README.md` 的补丁表
- 提交推送前检查 remote 无 token

#### B6. 收尾汇报

按 H1/H2/H3 分级汇报落地情况，标注未执行项及原因。未确认的删除类条目保持原样。

### 关键要点

- **分析阶段只读，方案先行**
- **运行时数据与入库数据的边界是优化重点**；`portable/` 是唯一允许存放运行时数据的地方
- **vendor/pi 只读**：体积或源码问题只能通过 `patches/` 与 `scripts/sync-upstream.sh` 处理
- **packs 按需加载**：保持每个包的 `SKILL.md` 精简，大资源不入库
- **一次优化会话产出 1 个提交粒度**，避免碎提交

### 常见问题

| 问题 | 回答 |
|------|------|
| 如何区分入库共享和运行时本地？ | 入库共享 = 源码/脚本/补丁/文档/白名单配置；运行时 = sessions/extensions/memory 与 config 下本地状态 |
| 删除类需要确认吗？ | 是，涉及删除运行时数据、packs 或跨设备文件必须确认 |
| vendor/pi 可以改吗？ | 不可以。任何改动经 `patches/*.patch`，由 `scripts/build.sh` / `scripts/sync-upstream.sh` 应用 |
| 优化后如何验证？ | `npm run check` + `npx tsc --noEmit -p custom/` + `npx vitest run` |

---

## C. 确定性检查

`review.sh` 自动化检查，覆盖 git 卫生、JSON 合法性、隔离边界、类型检查、可疑模式与密钥模式。

### 步骤

```bash
# 项目根
cd /root/my-pi

# 自检
bash portable/agent/skills/pi-full-audit/review.sh --selfcheck

# 默认：审查 git 工作区变更
bash portable/agent/skills/pi-full-audit/review.sh

# 全量：扫描项目根
bash portable/agent/skills/pi-full-audit/review.sh --all /root/my-pi
```

- 保存完整输出到 /tmp 再分析（终端输出会截断）
- **"失败"项先定性再报告**，见 [references/ERROR-CHECKLIST.md](references/ERROR-CHECKLIST.md)
- 可疑模式逐条人工确认；密钥命中先 `git ls-files` + `git check-ignore -v` 判是否入库
- 退出码恒为 0（只报告，不阻断）；判定以阶段汇总计数为准

### 检查项对照

| 阶段 | 内容 | 失败定性 |
|------|------|----------|
| A | git 卫生：空白错误、vendor/pi 只读、portable 运行时数据误入库、大文件/二进制 | 误入库=HIGH；vendor/pi 改动=HIGH |
| A2 | 密钥/凭据模式（脱敏，仅报位置） | 被跟踪才算 HIGH；gitignore 的本地配置属正常 |
| B | JSON 合法性 + Shell 语法 | 语法错误=HIGH |
| C | 隔离边界 `npm run check` | 违规=HIGH |
| D | 类型检查 `npx tsc --noEmit -p custom/` | 类型错误=HIGH |
| E | 可疑模式（debugger/TODO/eval/child_process/rm -rf 等） | 供人工判断，不直接定级 |

---

## D. 运行态巡检

完整清单见 [references/RUNTIME-CHECK.md](references/RUNTIME-CHECK.md)（按需加载）。

覆盖：`portable/agent/sessions/` 会话体积与消息数、`portable/memory/tool-outputs/` 工具输出归档、`custom/features/context/` 的 token 预算与压力档位、memory 注入块稳定性、autopilot/link 运行态。

---

## E. 深度并行审查

subagent 功能（`custom/features/subagent/`）并行委派分组审查 + 复核核实 + 主会话终审。内置角色：**reviewer**（盲审，只读代码证据）、**scout**（只读侦察，禁止写操作）、**worker**（修复执行，改动需抽查）。

### 步骤

#### E1. 并行深度审查（委派 scout 分组）

按模块分组委派 scout，每组独立上下文，主会话只消费压缩报告：

```
分组参考（my-pi）：
  组1: custom/adapters/ + custom/core/（Pi API 接触点、路径解析、密钥、原子写）
  组2: custom/features/ 业务模块（autopilot/browser/intervention/link/tmux/voice/mode）
  组3: custom/features/ context + memory + plan-mode + subagent（状态/注入/预算/委派）
  组4: custom/bootstrap.ts + scripts/ + patches/ + portable/agent/（入口/脚本/补丁/配置）
```

**委派 prompt 要点**：
- 明确角色与只读："以 scout 角色只读审查，不修改任何文件"
- 明确维度：正确性/安全/资源/并发与状态/回归影响/可维护性/架构边界（logic.ts 零 Pi 依赖、adapters 唯一接触 Pi API）
- **输出精简约束**："只列问题，每条 文件:行号 + 一句话描述 + 级别（HIGH/MEDIUM/LOW），LOW 最多 5 条；总输出控制在 2500 字内"
- scout 无写权限，需实测的结论标注"未实测"，交主会话补验

#### E2. 复核子代理逐条核实（必做）

- 按建议归属模块分组委派，每组一个子代理，任务 = 逐条核实
- 文档一致性发现（文档专项产出）豁免本步
- 复核子代理同时负责发现同类遗漏

#### E3. 主会话终审 + 分级报告

1. **汇总表**：真实命中 / 部分属实 / 误报 / 行号错误 / 同类遗漏
2. **争议项终审**：复核结论与审查建议冲突的，主会话亲自验证
3. **定级调整**：机制描述错误/触发面窄的降级
4. **修复方案细化**：给出比审查建议更优的方案
5. 产出分级报告（HIGH 标注"主会话已验证"）

---

## 文档一致性检查（可独立于代码审查执行）

范围 = 项目自有 .md（排除 `node_modules/`、`vendor/pi/`、`custom/dist/`）。按对象分组委派 scout 并行做「文档陈述 vs 实际」可证伪核对：

```
组A: README.md/STRUCTURE.md/PROGRESS.md/DECISIONS.md + docs/ —— 对照实际目录树/脚本清单/功能清单/git log
组B: portable/agent/AGENTS.md（唯一注入）+ APPEND_SYSTEM.md —— 对照 custom/features/、package.json scripts、patches/ 清单
组C: custom/ 各模块注释与文档 vs 源码 —— grep 注册工具名/process.env 读取/配置键
组D: packs/INDEX.md + packs/*/SKILL.md vs 实际 packs/ 目录
```

文档类发现豁免子代理复核（核实只需一条 grep，主会话直接定论）。
