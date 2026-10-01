# 升格通道台账（VISION §3.1）

> 依据：[VISION.md](VISION.md) §3.1「反复有效的软引导必须逐步硬化，禁止永久滞留在软层」与 §6 P4。
> 通道：教训记忆（recurrence≥5 且验证有效）→ 提示词/AGENTS 条目（半硬）→ 功能逻辑或守门测试（硬）→ **原软引导降权/删除（控注入预算）**。
> 本文件是 P4 的执行台账：每条须写明硬化落点、降权动作、验收证据；未硬化的写清原因，不许留白。

## 判据与预算基线（§6 P4：软层条目不无限增长、注入预算受控）

| 注入面 | 位置 | 上限常量 | 实测（2026-10-01） |
|---|---|---|---|
| system 追加段 | `custom/features/context/budget/system-prompt.ts` → `HARD_RULES` + `EFFICIENCY_ADVICE` | `SYSTEM_INJECTION_MAX_BYTES` = 4096 | **767 B** |
| system 原生追加 | `portable/agent/APPEND_SYSTEM.md` | `SYSTEM_APPEND_MAX_BYTES` = 2048 | **789 B** |
| 工作区指令（尾部 append-only 消息） | `portable/agent/AGENTS.md` | `WORKSPACE_INSTRUCTIONS_MAX_BYTES` = 65536 | **11829 B**（本批降权前 12346 B，−517 B） |
| 稳定前缀指纹 | 上述三个文件 + `system-prompt.ts` | `scripts/check-injection-surface.sh` 基线 | `a09e666c…` |

守门：`custom/features/context/__tests__/injection-stability.test.ts`（10 例：装配契约 / 逐字节确定 / 易变内容拒绝 / 三项预算）。
超预算时的顺序是**先降权删除、再谈硬化**，不得直接抬高上限。

## 已完成：第一批（2026-10-01）

| # | 软引导（硬化前） | 硬化落点 | 降权动作 | 证据 |
|---|---|---|---|---|
| 1 | AGENTS.md「system prompt 注入禁止时间戳/精确数值」 | `budget/system-prompt.ts` 唯一装配点 + 8 类易变模式 + 预算常量；`injection-stability.test.ts` | 该条改为指向装配点，删去散落的解释 | 10 例单测；`check-injection-surface` 基线更新 |
| 2 | AGENTS.md「运行时状态不入库」 | `scripts/check-conventions.sh` A 段（`settings.json` 禁 `deviceId`、`modes.json` 禁 `current`）+ golden 第 14 步 | 两行长背景压成两句 + 守门指针 | 负数测试：注入 `"current"`/`"deviceId"` 即失败 |
| 3 | AGENTS.md「git 提交：不提交 `auth.json` 等敏感配置」 | `check-conventions.sh` B 段（已跟踪 + **暂存区**，含 `*-state.json`/会话/扩展安装位/私钥/`.env`） | **删除**该条（与「开发规范 · Git 规范」重复） | 430 个入库文件扫描通过；regex 负样本命中 `auth.json`/`modes-state.json`，不误伤 `packs/` 与 `tool-count-localhost.json` |
| 4 | AGENTS.md「不使用 `any`；禁止内联导入，只使用顶层导入」 | `check-conventions.sh` C 段（生产代码禁 `any` 与动态 `import(`；测试与 `node_modules` 排除） | 两条并一条，指守门 | 现状 0 违规；负数测试：临时 `: any` 文件即失败 |
| 5 | AGENTS.md「同轮内禁止 `tmux_wait`…`timeout≤60s`」 | `clampWaitTimeout` + `PI_TMUX_WAIT_CEIL_SEC`（默认 60s，≤0 停用）落到 `tmux_wait` 执行路径 | 删去手写 `timeout≤60s` 与实测数字，只留规则与旋钮 | tmux 单测 29 例（新增 5 例边界：默认值/显式值/截断/非法回落/停用） |
| 6 | AGENTS.md「上游隔离 / 接口隔离」两条 | 早已有 `check-isolation.sh` + HARD_RULES + 下文「架构原则」 | **删除**两条重复条目 | `check-isolation` 全绿 |

**预备样本**（本轮之前已硬化、但当时未同步降权，随本批一并降权）：`bash` 前台 240s 上限（P3-6）、AGENTS.md 移出 system 前缀（P1-1）、headless 调度网关（P3-5）、工具面中途变更默认关闭（P1-3/P2-2）。

## 已完成：第二批（2026-10-01，同日续做）

本批由第一批的"待评"项倒逼出来：要硬化"bash 优先合并碎调用"，先查度量落点，结果查出一个真实缺陷。

| # | 问题 | 硬化落点 | 发现 | 证据 |
|---|---|---|---|---|
| 7 | 死导出守门把**测试引用**算作接线 | `scripts/check-dead-exports.mjs` 新增"仅测试引用"规则（零生产引用即失败，棘轮白名单 C 段）；golden 第 3 步 | **32 个导出生产零接线**，其中 10 个是工具事件/用量子系统（`recordToolCallEvent`、`recordToolCall`、`recordToolEnable`、`loadToolCallRecords`、`recomputeToolUsage`…），即"工具调用分布"度量长期为空的根因；旧规则因单测引用而放行 | 负数测试：临时"仅测试引用"导出立即报错并 exit 1；存量 32 个棘轮登记（`dead-exports-allowlist.txt` C 段） |
| 8 | 注入面纪律只在 CI 检查 | `auditSystemInjection` 在扩展注册时跑一次（超预算/易变内容即 `console.warn`），使三个预算常量进入**生产路径** | 会话中改注入文本的人不会先跑 golden，静默失效；现在启动即可见 | `injection-stability.test.ts` 14 例（新增 4 例：当前内容零告警 / 超预算告警 / 易变内容告警 / 缺文件不报错） |

## 待评（明确未硬化，附原因与前置条件）

| 软引导 | 状态 | 原因 / 前置条件 |
|---|---|---|
| APPEND_SYSTEM.md「bash 优先合并碎调用」 | 未硬化（原料已具备） | 更正第一批的判断：**每次工具调用其实已落盘**——`portable/memory/context/usage.jsonl` 每行含 `ts`/`tool`/`ok`/`durationMs`（1784 行），子系统的 `recordToolCallEvent` 才是没接线的那条路。现在只差"按回合配对"：用 `.usage-diag.jsonl` 的 usage 记录作回合边界，统计每回合 bash 调用数与单命令占比，再定阈值 |
| APPEND_SYSTEM.md「我提出的问题必须先回答再执行」 | 保持软（有意） | 用户对话纪律，硬化等于用代码替用户决定何时执行；与 P3-1 结论一致 |
| AGENTS.md「不要在会话中途改工具集」 | 部分硬化 | 已硬化的是**默认行为**（工具分层默认关、模式切换走重启）；剩余"模型主动 `enable_tool`"属模型行为，正确硬化形态是**启动期按模式收窄工具面**（P2-1 记录的方向，未做） |
| APPEND_SYSTEM.md「禁止 emoji / 简短精炼」 | 暂缓 | 硬化需输出侧校验器（成本高、误报多）；收益低于成本 |
| §5「升格候选（recurrence≥5）」 | 通道就绪、尚无转正 | `/memory lifecycle` 已产出候选，但"候选 → 规则"这一步仍是人工判断；下一批候选来源 |
| AGENTS.md「回答先于编辑」 | 保持软（有意） | 同"先回答再执行" |
| **B-3**：32 个"仅测试引用"导出 | 已由守门棘轮锁住（禁止新增），存量待清 | 下一步：确认 `tool-events`/`tool-use-*` 确无消费方后**整族删除**（10 个），其余按"接线或删除"逐条处理；清单见 `scripts/dead-exports-allowlist.txt` C 段 |

## 下一批复核

- 每次日报（`node scripts/daily-health.mjs --print`）顺带看四项注入字节数；接近上限即启动降权评估。
- 优先候选：① **回合内 bash 调用分布**（`usage.jsonl` × `.usage-diag.jsonl` 回合边界；解锁"碎调用"硬化，同时给 P3-2 延迟分解补上"每回合工具数"维度）；② 启动期按模式收窄工具面（解锁"工具数组中途变更"硬化，并直接减小 tools 段 62 KB 的前缀开销）；③ B-3 存量清理（先确认消费方，再整族删除）。
