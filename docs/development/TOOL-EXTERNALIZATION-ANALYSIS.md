# 工具外置为「脚本 + 技能」的可行性分析

> 问题（2026-10-01，用户提出）：像浏览器操作这类**不直接影响项目本身**的工具，能不能包装成外部程序、
> 以 skill 形式按需加载、通过脚本或终端命令直接操作？
> 结论先行：**机制上完全可行，且成本账算得通；但按"稳定运行为主"的要求，本轮不迁移**——
> 用已有的 `lean` 模式覆盖成本诉求，把外置列为有触发条件的备选路径。依据与判据见下文。

## 1. 判据：什么该留在工具面，什么可以外置

外置的收益 = 从 tools 段省下的字节 × 每 epoch 次数；代价 = 可靠性、状态连续性、错误语义、
可审计性。因此"适合外置"需要同时满足：

1. **无状态或可守护进程化**：一次 `bash` 调用一个进程，跨调用状态必须靠文件/服务/daemon 维持；
2. **不改变项目或运行时数据**（仓库文件、记忆库、调度器、会话状态）——只在外部世界产生副作用；
3. **低频**（占总调用 ≲2%）：高频工具外置会把每次调用的延迟与失败面乘上调用次数；
4. **结果不需要结构化渲染/审批**（没有 `renderCall/renderResult`、没有"发送类"二次确认）；
5. **失败可用退出码 + stderr 表达**，且不需要 pi 的按次截断/归档/熔断联动。

反之，凡是"改仓库/改运行时状态、需要审批、需要跨调用连续页面状态"的工具，都应留在工具面。

## 2. 现状事实（可复现）

### 2.1 体积与使用率

工具面构成（守门 `custom/features/context/__tests__/tools-payload.test.ts`）：

| 功能 | 工具数 | 字节 | 占比 |
|---|---|---|---|
| autopilot | — | 6.4 KB | 22% |
| browser | 18 | 6.3 KB | 22% |
| memory | 4 | 5.5 KB | 19% |
| tmux | — | 2.8 KB | 10% |
| plan-mode | — | 2.5 KB | 9% |
| subagent | — | 1.5 KB | 5% |
| web-search | — | 1.1 KB | 4% |
| voice | 3 | 1.0 KB | 4% |
| link | 2 | 0.8 KB | 3% |
| context | — | 0.7 KB | 2% |
| **本仓库合计** | **62** | **28.5 KB** | 100% |

请求里 `toolsBytes` = **63 268 B**（真实无头请求实测），其余约 33 KB 是 pi 内置工具。
真实使用率（`portable/memory/context/usage.jsonl`，1784 次调用）：

| 前缀 | 工具数 | 调用 | 占比 |
|---|---|---|---|
| `browser_` | 18 | 28 | 1.6% |
| `voice_` | 3 | 5 | 0.3% |
| `link_` | 2 | 3 | 0.2% |
| `admin_`（autopilot） | 6 | 17 | 1.0% |
| `ctx_`（记忆） | 4 | 36 | 2.0% |

### 2.2 技能机制的真实成本（pi 原生）

pi 把技能以 `<available_skills>` 段注入 **system prompt**（`vendor/pi/.../core/system-prompt.ts:166`，
格式见 `skills.ts:355`）：每个技能 = name + description + location + XML 开销。
本仓库现有 4 个技能实测估算合计 **≈1.8 KB**（每个 ≈450 B）。加载方式：模型用内置 `read`/`bash`
读取 `SKILL.md`，**不占用 tools 段**。

因此"工具 → 技能+脚本"的成本交换是：**−工具字节 +≈450 B system 段**。
`packs/` 是另一条通路（不注入任何提示词，纯按需读取），代价是发现性弱（要靠 AGENTS.md 或用户指路）。

### 2.3 状态模型（决定可行性）

- **browser**：`cloakbrowser`（playwright 封装）+ 持久 `userDataDir`；**浏览器实例活在扩展进程内**，
  页面/导航状态跨工具调用共享（`impl.ts:157-186`）。CLI 每次调用新进程 → 要么每次重启浏览器
  （每次导航都是冷启动，多步操作无法连续），要么跑一个 CDP daemon（多一个需要守护的生命周期）。
- **voice**：真正的重活在外部进程（`whisper-server.py` 常驻 + espeak 等 CLI），工具只是薄封装，
  天然无状态（文件/文本进出）→ 外置代价最低。
- **link**：出站发送（给手机推消息）且带发送守卫（inflight/去重）→ 需要审批/守卫，不适合外置。
- **autopilot / ctx_* / tmux / memory**：直接改运行时状态（调度器、记忆库、进程、会话）→ 留在工具面。

## 3. 候选逐个结论

| 候选 | 判据 | 结论 |
|---|---|---|
| browser（18 工具 / 6.3 KB / 1.6%） | 违反 1（有状态、需 daemon）、5（缺结构化渲染与按次截断联动） | **不迁移**；收益虽最大（净 ≈−5.9 KB ≈−1.5K token/epoch），但代价是多一个 daemon 与整条交互链路的可靠性 |
| voice（3 / 1.0 KB / 0.3%） | 满足 1/2/3/5，仅"渲染"无需求 | **可外置但收益≈0.55 KB**，不足以单独承担工程量；若将来做 browser 外置，可顺带带上 |
| link（2 / 0.8 KB / 0.2%） | 违反 4（出站副作用 + 发送守卫） | 保留 |
| autopilot admin（6 / — / 1.0%） | 违反 2（改调度器与重启） | 保留 |
| ctx_/memory/tmux | 违反 2 | 保留 |

## 4. 方案对比

| 方案 | 收益 | 代价 | 稳定性 |
|---|---|---|---|
| A 维持现状 | 0 | 0 | 最高 |
| B 全部外置为 skill + CLI | −6.3 KB 工具 +0.45 KB system | 需 daemon/连接管理、错误语义降级、无结构化渲染、并行与超时需自建、能力发现依赖提示词 | 低 |
| C 放 `packs/`（零注入）+ 脚本 | 同上，且 system 段 0 | 发现性最弱（模型不知道有什么），只在用户指路时可用 | 中 |
| D 混合分期（保留核心 5 个交互工具，长尾走 daemon+CLI） | −3 KB 左右 | 两套入口并存、需长期对账 | 中（但需先建 daemon） |
| **E 用 `lean` 模式按会话取舍（现状）** | **−24.8 KB（实测 −39%）** | 该会话内没有 browser/voice/autopilot，切回需 `/mode full`（重启） | 高（零新代码路径） |

## 5. 决策（稳定优先）

1. **本轮不迁移任何工具到 skill/脚本**（方案 A + E）；`lean` 保持可选、默认仍 `full`。
2. 理由：真正的成本杠杆是"哪些功能被注册"（启动期、缓存安全），而不是打包形式；
   `lean` 已用**零新代码路径**拿到 −39% 的工具面，且失败模式只有"该会话缺工具"；
   browser 外置则引入 daemon、连接失败、超时/并行、审计缺失等一整套新的失败面——与"稳定优先"相悖。
3. **重新评估的触发条件**（任一命中再做，且必须先满足第 6 节前置条件）：
   - `browser_` 类工具占比继续低于 2% 且**交互式会话想省前缀**成为高频诉求；
   - 工具面总量逼近守门上限（32 KB）而又不愿削减功能；
   - 上游 pi 提供**原生 daemon 化/MCP 通道**（届时外置成本大幅下降，可优先走 MCP 而不是自建 CLI）。

## 6. 将来若要做：可复用的落地路径与前置条件

1. **先并存、后移除**：先加 `scripts/browser-cli.mjs` + `packs/browser/SKILL.md`，**保留全部现有工具**，
   用真实任务对账两条通路的结果；只有对账通过、CLI 使用率稳定，才谈移除长尾工具（移除是用户可见变更，需明确决定）。
2. **状态必须守护化**：用现有 `tmux` 通路起一个带 `--remote-debugging-port` 的常驻浏览器，CLI 以 CDP 连接；
   生命周期交给 `features/tmux/watcher.ts` 的既有机制，不新造守护进程。
3. **错误契约**：stdout 输出 JSON（成功）／stderr 输出原因 + 非零退出码；文档写进 SKILL.md，模型据此判断。
4. **超时与并行**：受 `bash` 240s 上限约束，长操作要么后台化、要么在 CLI 内实现等待与轮询；
   并行调用必须串行化到同一 CDP 端点（页面级锁）。
5. **保留核心交互工具**：`navigate/click/type/extract/evaluate` 留在工具面，长尾（cookies/dialog/download/
   upload/pdf/network/select_option/wait_for/scroll/find/help/close）才走 CLI——避免"多步交互变慢 + 状态丢失"。
6. **审计**：CLI 必须自己记日志（与 `usage.jsonl` 同源格式），否则外置后这段调用会从度量里消失。

## 7. 复现命令

```bash
# 工具面构成与预算（含模式收窄断言）
npx vitest run custom/features/context/__tests__/tools-payload.test.ts
# 真实使用率
python3 - <<'PY'
import json,collections
c=collections.Counter(json.loads(l)['tool'] for l in open('portable/memory/context/usage.jsonl') if l.strip())
print(sum(c.values()), c.most_common(12))
PY
# 真实请求的前缀体积（跑一次真实无头请求后读最后一条指纹）
./my-pi.sh -p "回复 OK" && tail -1 portable/memory/logs/prefix-fingerprints.jsonl
```
