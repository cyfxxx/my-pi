# 架构决策记录

## 格式

### [2026-10-01] 稳定优先：冻结默认面，明确"不做清单"
**背景**：前几轮把若干"待你决定"的事项挂在台账上（输出侧校验器、VISION §5 阈值、Best-of-N 与记忆合并接线、工具外置）。用户指示："以稳定运行为主，由你决定"。
**决策**：默认面冻结，只做低风险、可回滚的事；下列明确不做（各自保留登记与触发条件）：
- **输出侧校验器**（强制 emoji/长度/风格）：不做——需要拦截模型输出，误报会直接损害可用性，收益（风格一致性）不足以承担。
- **VISION §5 阈值调整**（如把 `recurrence≥5` 降到 3）：不做——那是愿景/方法论层的判据，改动应由数据驱动而非"想看到候选"。
- **Best-of-N 验证**、**记忆合并（`resolveAndApply`/`mergeCandidates`）接线**：不接线——属能力引入，会改变子代理/记忆写入行为，保留在 `scripts/dead-exports-allowlist.txt` A 段（每条有理由）。
- **工具外置为 skill/脚本**（浏览器/语音等）：本轮不迁移，理由与落地路径见 [docs/development/TOOL-EXTERNALIZATION-ANALYSIS.md](docs/development/TOOL-EXTERNALIZATION-ANALYSIS.md)。
- **`lean` 模式**：保持可选，**默认仍 `full`**——不为省钱牺牲"随时可用的能力"，需要时按会话切换。
**理由**：这些项目的共同点是"收益局部、失败面全局"：校验器会挡输出、阈值会松证据链、接线会改行为、外置会引入 daemon 与连接失败。而真正的成本杠杆（前缀体积/命中率）已有守门与可观测指标，且 `lean` 用**零新代码路径**拿到 −39% 工具面——没有理由为边际收益引入新的失败模式。
**代价与约束**：不引入新失败面；代价是放弃部分边际收益（例如工具外置净省 ≈1.5K token/epoch）。重新评估的触发条件写在分析文档第 5 节（browser 使用率、体积逼近上限、上游提供原生 daemon/MCP 通道）。
**验证**：本条不改代码，只冻结范围；`golden` 全绿，决策清单与能力登记表（allowlist A 段）一一对应，避免"以后没人记得为什么不做"。

---

### [2026-10-01] 死导出守门升级：测试引用不算接线
**背景**：查"bash 碎调用"的度量落点时发现 `recordToolCallEvent` / `recordToolCall`（工具事件落盘）**只在单测里被调用**，生产从未接线——这正是"工具调用分布"长期为空的根因。而 `check-dead-exports.mjs` 统计"任何引用"，单测引用使其顺利通过：守门存在盲区（"测试把死接线藏起来"）。
**决策**：给守门加第二条规则——**生产零引用（但存在测试引用）同样报错**；`custom/**/__tests__/**` 与 `test-support/` 不计入生产引用。实测扫出 32 个存量，作为棘轮登记在 `dead-exports-allowlist.txt` C 段（分组理由），新增即失败。
**理由**：`__tests__` 里的调用证明的是"这个函数能跑"，不是"它被用"——两者混淆会让"写了没接线"重新变成常态（历史上 `pruneThinkingBudget` 曾占 50% 上下文却零调用者）。棘轮而不是一次性清零，是因为要逐条确认 32 个存量是接线还是删除（见 `docs/design/UPGRADE-LEDGER.md` B-3），但不该因此让新缺陷继续漏过。
**代价与约束**：白名单里已存在 21 条无理由的历史条目（旧格式），清理时顺手补理由；测试辅助函数（如 `__resetSeedCache`）属于合理白名单项，需在清单里写明"生产不需要接线"。
**验证**：负数测试——临时新增"仅测试引用"导出 → 守门 `exit 1` 并点名文件；删除后 `exit 0`；全量 golden 通过。

---

### [2026-10-01] 工具面前缀：加 `lean` 模式收窄，不改默认
**背景**：`tools` 是请求前缀里最大的构件——`daily-health` 实测 payload `toolsBytes` **62.4 KB**（≈15.6K token），同模型下 DSH 只有它的 1/2.3。台账下一优先项要求"启动期按模式收窄工具面"，先做测量再决策。
**证据**（新增守门 `custom/features/context/__tests__/tools-payload.test.ts`，注册全部 12 个功能后逐工具序列化）：本仓库注册 **62 个工具 = 28.5 KB**；按功能拆分为 `autopilot` 6.4 KB、`browser` 6.3 KB、`memory` 5.5 KB、`tmux` 2.8 KB、`plan-mode` 2.5 KB、`subagent` 1.5 KB、`web-search` 1.1 KB、`voice` 1.0 KB、`link` 0.8 KB、`context` 0.7 KB；其余约 **33 KB 是 pi 内置工具**（bash/read/write/edit/grep/find/ls 等，不在本仓库控制内）。单工具最大 `schedule_task` 1.7 KB，参数 schema 是主要构成（占比 ~80%）。
**选项**：
1. 默认收窄 `full`（去掉低频工具）
2. 收窄工具**描述/参数说明**（不减少能力）
3. 新增可选 `lean` 模式，默认不变
**决策**：选项 3；同时把体积落成守门（总量/单项/数量三个上限），不做选项 1、2。
**理由**：
- 选项 1 会把"缺少工具"变成常态：用户随时可能需要 browser/voice/autopilot，而**会话中途改工具数组会让整段前缀失效**（本项目已实测代价 150K–320K token/次），所以"少了再开"在本项目里是最贵的做法；
- 选项 2 的收益已被上一轮评估过（P2-1：剩余廉价裁剪 ≈5% ≈800 token/epoch），且要牺牲参数说明的清晰度或破坏 TypeBox 原生 schema，性价比不成立；
- 选项 3 零风险且**可用**：模式白名单在启动期过滤功能注册，未注册即 0 字节，且整个会话内工具数组不变（缓存安全）。`lean` 保留 web-search/context/memory/plan-mode/intervention/subagent/tmux，去掉四组；**端到端实测**（真实无头请求写入的前缀指纹）：`toolsBytes` **63 268 → 38 430 B（−39%，≈−6.2K token/epoch）**，`systemBytes` 不变（7 323）。组件级估算（四组 14.5 KB）低于端到端差值，说明按功能过滤还会连带去掉若干条件注册的工具——以端到端数字为准。
**代价与约束**：`lean` 会话内没有 scheduled task（autopilot 未注册）、没有浏览器与语音工具；切回需 `/mode full`（自动重启，见模式条目）。守门只在"无声膨胀"上设限（总量 32 KB / 单项 2 KB / 数量 66），要放宽必须改常量并在 DECISIONS 说明理由。
**验证**：`tools-payload.test.ts` 2 例（构成打印、预算断言、模式收窄断言）；`doctor`/`golden` 全绿。

---

### [2026-10-01] P4 升格通道第一批：6 条软引导硬化 + 原软引导降权
**背景**：VISION §3.1 要求"反复有效的软引导必须逐步硬化、禁止永久滞留在软层"，§6 P4 是唯一未完成的路线阶段，判据是"软层条目不无限增长（注入预算受控）"。而「缓存纪律」「状态不入库」「代码规范」「禁止前台等待」这几条都只写在提示词/AGENTS.md 里，靠模型与操作者自觉——失效代价都已被实测：前缀断裂单次 170K–316K token 全价重算（命中价 1/50）、`modes.json` 的 `current` 被 git 静默回退、`bash` p99 164s。
**决策**：能落到代码或守门的就落，落不下的在台账里写清原因；硬化完成后按 §3.1 **同步降权**软层。
- 硬化 ①：system 注入收敛到 `custom/features/context/budget/system-prompt.ts`（唯一装配入口 `buildSystemPrompt`、8 类易变内容拒绝、三项字节预算常量）。
- 硬化 ②：`scripts/check-conventions.sh`（A 状态不入库 / B 敏感文件含**暂存区** / C 生产代码禁 `any` 与动态 `import(`），接入 golden 第 14 步。
- 硬化 ③：`tmux_wait` 同轮等待 60s 硬上限（`PI_TMUX_WAIT_CEIL_SEC`，≤0 停用），与 `bash` 240s 上限同一约定（显式值原样尊重、随后截断）。
- 降权：删除 AGENTS.md 的「git 提交」「上游隔离」「接口隔离」三条重复条目，压缩已被代码覆盖的描述；**12346 → 11829 B**。
**理由**：软引导的失效模式是**静默**——不报错、不告警，只在账单或数据被回退时才暴露；硬化把"应该"变成"必然"。降权不是附赠，而是硬化的对价：软层只增不减的话，注入预算（system 767 B + APPEND 789 B + 工作区 11.8 KB）迟早失控。
**代价与约束**：新增旋钮与预算常量，超预算的顺序是**先降权删除、再谈硬化**，不得直接抬高上限；`any`/动态 import 检查只覆盖生产代码（测试允许造桩），行首为注释的行不判，避免误报；`tmux_wait` 默认 120s 现在会被截断到 60s。
**验证**：`injection-stability.test.ts` 10 例（装配契约/逐字节确定/8 类模式各有样本/三项预算，负例 `defaced` 不误判为 sha）；tmux 单测 29 例（新增 5 例边界）；`check-conventions.sh` 负数测试（临时 `: any` 文件即失败、`"current"`/`"deviceId"` 即失败、`packs/` 与 `tool-count-localhost.json` 不误伤）；golden `--fast` 14 步全绿；台账与预算基线 `docs/design/UPGRADE-LEDGER.md`。

---

### [2026-10-01] 重试前删除失败的 assistant 投影：保持现状
**背景**：复核"前缀缓存优先"是否该改动 pi 的重试语义——agent 层重试前会写一条 `context_edit` 删除失败的 assistant 投影，这会让投影从该点起分叉（缓存失效）；替代方案是"保留投影 + 标记重试"。
**证据**：实测 `context_edit` **39 次 / 1436 条 assistant 消息 = 2.72%**，其中 **29 次（74%）集中在同一个 provider 故障会话**（2026-09-30）。
**决策**：保持现状（删除失败投影）。
**理由**：删除发生在"请求刚刚失败"之后，那段前缀本身未必已进入 provider 缓存；而保留半截/报错的 assistant 消息会让模型看到自己的残缺输出，污染后续推理——用极小且低频的缓存收益换正确性损失不划算。provider 层重试默认 0 次（原样重发、前缀字节不变）已经覆盖了"纯传输失败"这一类。
**验证**：结论来自会话统计脚本；无需代码改动。

---

### [2026-10-01] 子代理 fork 模式：显式 opt-in，而不是默认
**背景**：DSH 区分 fork（继承历史、复用 KV）与 spawn（空上下文）；my-pi 的子代理只有 spawn。既然我们的成本模型里"暖前缀按 1/50 计价"，继承父会话历史理论上比从零开始更划算——尤其对"需要父上下文"的短任务。
**选项**：
1. 保持只有 spawn
2. fork 作为默认
3. fork 作为显式 opt-in（`context: spawn|fork`）
**决策**：选项 3。`buildSubagentArgs` 在 fork 时用 pi 的 `--fork <父会话>`（且不带 `--no-session`）；拿不到 `ctx.sessionFile` 时静默退回 spawn。
**理由**：
- fork 的便宜**依赖缓存是暖的**：父会话刚发过请求时首请求按 cacheRead 计价；若隔了很久或刚重启，则要为整段历史付全价——比 spawn 贵得多。默认 fork 会把"贵"变成常态；
- 子代理还会继承父会话的全部内容（体积与"无关信息干扰子任务"的代价），只适合确实需要上下文的场景；
- 保留 spawn 为默认，即"最便宜的一次请求"，与"子代理=隔离上下文"的既有语义一致。
**代价与约束**：调用方要自己判断"是否紧接父会话、是否需要父上下文"；提示词里已写明适用场景。判据（新数据起算）：fork 调用的首请求未命中应接近 0。
**验证**：`buildSubagentArgs` 5 例单测（默认 spawn / fork 不带 `--no-session` / 空值退回 / 参数顺序 / 空工具数组不生成 `--tools`）；全量 golden 通过。

---

### [2026-10-01] `bash` 前台硬上限 240s：把"长任务后台化"从软提示变成代码约束
**背景**：为定位"顿挫感"，按工具拆解了 1101 个可归属步（deepseek、自动继续步）：工具执行占步墙钟 **63.6%**，请求处理占 36.4%；再按工具拆——`bash` 568 次占工具时间 **63%**（p50 440ms、p90 **36.4s**、p99 **164s**），`subagent` 3 次共 743s（同步阻塞，p50 277s），`ask_user` 17 次共 1042s（人机等待）。同时用二元最小二乘拟合 `rest_ms ≈ 3307 + 0.0085·未命中 + 3.37·输出`：**前缀重放只占请求处理时间的 0.5%**（300K 未命中 ≈ 3s），生成占 47.5%（≈297 tok/s）。
**推论**：前几轮的缓存工作省的是**钱**，不是时间；"命中率高所以更顺畅"在本项目不成立。顿挫感来自**前台长命令**。
**选项**：
1. 继续靠 `AGENTS.md` 的"长任务后台化"软提示（现状）
2. 给 `bash` 注入默认超时（硬约束）
3. 只加提示/告警，不真正中断
**决策**：选项 2。pi 的 `bash` 参数是 `timeout`（秒，**默认无超时**），且 `ToolCallEventResult` 明确允许"原地改 `event.input`"——故在 `context` 的 `tool_call` 钩子里对**未显式指定 `timeout`** 的 bash 调用注入 `BASH_TIMEOUT_CEIL_S`（默认 240s，`PI_BASH_TIMEOUT_CEIL` 可调，≤0 关闭）。
**理由**：
- 该软提示实测没被稳定遵守（才有 p90 36.4s / p99 164s 的分布）；VISION §3.2 明确要求安全与效率边界硬编码，不依赖模型自觉；
- 240s 取在实测 p99（164s）之上，只影响极少数调用；**显式给了 `timeout` 的调用原样尊重**（那是有意为之的放宽，例如确实需要同步等待的长任务）。
**代价与约束**：把一个本该后台化的命令切成超时，会浪费那部分已做的功——这是有意的压力：让"前台硬撑"变成明确失败，而不是静默占用几分钟。`AGENTS.md`（尾部注入）同步写明上限与改法；如果哪天发现它误伤了合理场景，优先调大 `PI_BASH_TIMEOUT_CEIL` 而不是回退成软提示。
**验证**：单测 5 例（注入默认 / 尊重显式 / 非法值按未给处理 / 非 bash 不动 / `<=0` 可关闭）；全量 golden 718 用例通过。效果判据（新数据起算）：`bash` p90/p99 显著下降、单步墙钟 p90 ≤25s。

---


### [2026-10-01] 工作区指令移出 system 前缀（P1-1）：正文走尾部注入，不变量留在 system
**背景**：缓存差距的定量归因指向**静态前缀的可变性**：763 条指纹里 9 次 `system` 断裂全部是 system 消息被重渲染，而 system 正文里最大的一块正是 `AGENTS.md`（`project_context` 段，1.7–2.1K token；文件 11.8KB 且由 my-pi 自己频繁编辑）。每改一次自己的工作区文档 → 整段前缀作废（近 24h 冷启动 5 次、119,867 token 全价，平均 23,973/次）。对照 DSH：工作区指令以 `<system-reminder>` 包成 **user 消息追加进历史**，append-only，内容变更时追加完整替换（`DSH-RUNTIME-AUDIT.md` §11）。
**选项**：
1. 维持现状（AGENTS.md 留在 system 的 project_context 段）
2. 整体搬到尾部消息（简单，但把**权威性**一起搬走——system > user 的层阶是有意义的）
3. **拆开**：不变量摘要（短、静态）留在 system；体积大、频繁变更的正文走尾部 append-only
**决策**：选项 3。pi 侧加 `--no-context-files` 关掉原生注入；my-pi 在 `context` 功能里复刻同一套发现规则（agentDir 优先 → cwd 向上，宽泛→具体，按路径去重）并注入为 `my-pi-workspace-instructions` 消息；system 层只保留 `HARD_RULES` 常量（上游隔离/接口隔离/缓存纪律/状态不入库/后台任务 五条不变量）与原有的 `APPEND_SYSTEM.md`。
**理由**：
- 选项 1 是那个 9 次断裂的直接来源，且 my-pi 的自我编辑是常态而非例外；
- 选项 2 会让"提交只暂存显式路径""不改写已发送历史"这类硬约束降级为 user 消息——而 VISION §3.2 要求硬约束不依赖模型自觉；
- 选项 3 让**变更代价与权威性解耦**：越常变的内容越靠尾部，越不可动摇的内容越靠 system。这与"append-only + 硬优先"两条既有纪律同源。
**代价与约束**：
- **非 full 模式（roleplay/minimal）不再注入 AGENTS.md**（`context` 不在其功能白名单里）。这是有意的：AGENTS.md 是开发环境说明，与角色扮演人设本就冲突；需要时应显式把 `context` 加进模式白名单。
- 注入按**每次 run** 检查一次（`before_agent_start` 的粒度），run 中途改文件不会当轮刷新；新进程首 run 会再注入一份（内容相同则重复一份，代价是尾部追加 ≈ cacheRead 价，不是断裂）。若将来觉得吵，可改为"从历史里找最后一份并比对 hash"。
- `HARD_RULES` 是常量：**改它 = 所有会话前缀失效一次**（预期内，但要克制）；已纳入 `check-injection-surface.sh` 的指纹。
**验证**（临时工作区 A/B，未触碰真实文档）：
- 跨两次进程：把工作区 `AGENTS.md` 从 VERSION-ONE 改成 VERSION-TWO，两边的 `system` 指纹**完全相同**（`23e6fc3fa017`）；
- 会话内端到端：让模型在自己会话里把该文件改成 VERSION-THREE，指纹为 `changed=['head','messages']`（尾部追加）而**不含 `system`**；
- 会话 `system` 分段里 **`project_context` 已消失**（`preamble/tools/rules/docs/addendum/skills/cwd`）；
- `custom_message` 里出现 `my-pi-workspace-instructions`（7973 字符，含 VERSION-ONE）。
**留待观察**：真实使用中"指令从 system 降到消息层"是否影响遵守度。若观察到退化，退路是把最关键的两三条再抄进 `HARD_RULES`（system 层），而不是整体搬回去。

---


### [日期] [决策标题]
**背景**：
**选项**：
**决策**：
**理由**：

---

### [2026-09-29] 浏览器终端启动时回收孤儿 pty 会话（服务器被强杀后的自清理）
**背景**：`PtySession.dispose()` 只在正常退出时运行。服务器被 `SIGKILL`、崩溃或断电时，`script` → `pi-supervisor.sh` → `pi` 会被 reparent 到 PID 1 后**永不退出**——每发生一次泄漏一个 my-pi TUI（约 20 MB）与一个 pty。这不是假想：本次排查成本问题时，我的探针脚本 SIGKILL 服务器，留下 **12 个孤儿会话（24 个进程）**，是事后手工 `ps` 才发现并清理的。
**选项**：
1. 不管，靠人工发现（现状）
2. 服务器启动时扫描并回收"属主进程已消失"的会话
3. 给 pty 负载加 `PR_SET_PDEATHSIG`（父死即杀）
4. 写一个会话注册表文件，启动时对账
**决策**：选项 2，判据取自临时文件名内嵌的属主 pid（`mypi-web-tty-<serverPid>-<hex>`）。
**理由**：
- 选项 3 在 Node 里不可用（无法在 spawn 的子进程上设 PDEATHSIG），且 `script` 会 `setsid()` 另立会话，父死信号本来就不够；
- 选项 4 要多维护一份可能与实际文件不一致的状态；
- 选项 2 无需新增状态：文件名已经是权威事实，且判据天然保守——**属主 pid 仍存在（含 EPERM）就不动**，于是同机多实例互不干扰，pid 复用只会造成"漏回收"而不会误杀活会话。
- 击杀目标只取自 `ps` 中命令行含该临时文件路径的进程（即那个 `script`）及其后代进程组，不按键名/模糊匹配；批量回收只等一个 `TERMINATE_GRACE_MS`，启动延迟恒为一次 `ps` + 400ms，不随孤儿数量增长。
- 同时提供 `--sweep` 手动入口，并在启动时自动执行（`PI_WEB_TERMINAL_SWEEP=off` 关闭）。

---

### [2026-09-29] 成本差距归因：前缀缓存的"前端变更"，而非命中率或上下文大小
**背景**：加权缓存命中率 94.10%（逐请求中位数 99.65%），但实际费用约 ¥11/亿 token，而 DSH 为 ¥4/亿。用户要求查明原因。逐日拆解 667 次调用后发现：94.10% 被 **2026-09-26 单日**（命中 80.66%、未命中 337 万 = 全部的 57.5%、¥26.11/亿）拖低，而当天踩的是两个已删除的默认值（`7b2a92ed9` 之前每轮擦除默认开启、`68f9bafa9` 之前工具按需加载默认开启）。修复后的 09-27/09-28 为 ¥9.85/¥8.49。
**证据**：
1. 未命中高度集中：≥100K 的 **23 次调用（3.4%）占全部未命中的 78.5%**，≥200K 的 10 次占 41.3%；中位数仅 421。
2. 不是缓存过期：这 23 次大未命中距上次请求的**间隔中位数仅 16 秒**（仅 1 次 >10 分钟）。
3. `prefix-fingerprints.jsonl` 499 条中 **17 条（3.4%）** 的 `system`/`tools`/`head` 发生变化——与 23 次大未命中比例一致，时间戳逐条对齐（如 12:41:32 `tools` 变 → 12:41:41 cacheRead 9,984/246,837）。
4. **切 thinking 档位会使整段前缀失效**：2026-09-27 12:05:59 切 `low`，前一次请求 141,184/141,406（99.8%），下一次 0/142,075（0%），其间其它分段指纹无变化、空闲仅 7.2 秒。切换到 `deepseek-flash` 会被自动解析成 `max`（实测 4/4 次）。
5. 记忆注入的"删旧插新"占全部未命中 **39.0%**：注入后 83 次请求命中率仅 61.1%（其余 567 次 96.2%）；09-26 12:41–12:52 连续 10 次命中率 4%–25%。
6. 剩余差距的第二个来源是输出强度：09-28 的缓存读成本/亿（$0.293）已与 DSH 持平（$0.297），差距 84% 落在输出 token（$0.721 vs $0.186）；单位上下文输出是 DSH 的 3.88 倍。
**选项**：
1. 追求更高命中率（调大/调小擦除、压缩阈值）
2. 只修"改写已发送历史"的动作，并对请求前部加不变量
3. 归因为工作量差异，不改
**决策**：选项 2，并区分两类驱动——**长会话由未命中主导、短会话由输出强度主导**。
**理由**：命中价是全价的 1/50，因此"省 token 的剪枝"几乎总是净亏（剪 100K 需 ≥75 次后续请求才回本，实测占单会话 67% 成本）。真正要守住的不变量是：**已发送的历史只追加、请求前部（system/tools/thinking 档位）不中途改变**。据此落地四项修复（注入 append-only、切档默认关闭 + 档位钳制、工具集空操作防护、探针补盲区）与一项度量修复。

---

### [2026-09-29] 注入序列改为 append-only（撤销"只保留最新一条注入"）
**背景**：`filterInjectedMessages` 每轮移除除最新一条外的全部 `my-pi-memory-injection` 消息，原意是防注入累积。
**选项**：
1. 保持"只保留最新"（省 token，但改写历史中段）
2. 改为 append-only，块首声明"以最新一块为准"，旧注入随压缩折叠
3. 保留最新 + 把注入移到请求尾部
**决策**：选项 2。
**理由**：选项 1 的位移点在**旧注入所在位置**（会话头部附近），使其后整段前缀缓存失效，实测占全部未命中 39%、单次 150K–320K 全价重算；选项 2 的代价是每轮多几百 token 的 cacheRead（≈1/50 全价），且注入随压缩折叠所以有界。选项 3 仍需删除旧项，不解决问题。`filterInjectedMessages` 保留导出供离线分析，并有源码级回归测试禁止生产路径再次调用。

---

### [2026-09-29] 自动切 thinking 档位默认关闭 + 运行时档位钳制到 `high`
**背景**：`thinking-level.ts` 原注释断言"档位是运行时 provider 设置、不进注入面，切换不破坏缓存前缀"，据此自动切档默认开启。实测该断言为假（见上条证据 4）。另：切换到 `deepseek-flash` 会被自动解析成 `max`，而 `max` 只增加 reasoning token。
**选项**：
1. 保留自动切档（它省 thinking token）
2. 自动切档默认关闭，运行时档位夹到 `PI_THINKING_MAX_LEVEL`（默认 `high`）
3. 只在压缩后允许切档
**决策**：选项 2，并在 `thinking_level_select` 钩子上夹档（模型切换本身已使缓存失效，故夹档不产生额外代价）。
**理由**：一次切档 ≈ 整段全价重算（实测 140K–250K token）；而降一档省下的 thinking token 远小于该代价，且只在切换后的剩余轮次里才可能回本。选项 3 复杂度高、收益不确定。手动 `/thinking`、`thinking_level` 工具、`/mode` 不受影响，但工具描述与返回值会明确提示缓存代价。

---

### [2026-09-29] 成本度量改读每轮用量，并把"前缀前端变更"纳入每日告警
**背景**：`daily-health.mjs` 读 `context/usage.jsonl`（工具级台账，只有 `outputTokens`），而每轮用量在 `context/.usage-diag.jsonl`。结果 2026-09-26..29 的日报连续写 `命中=n/a(无数据)`，命中率跌到 80.66% 也没有任何告警。同时 `prefix-fingerprint.ts` 有两处盲区：`total` 算了却从不比较、`messages` 仅在条数变化时标记，导致"中段内容被改写但条数不变"记为 `changed: []`；且未记录 thinking 档位，切档导致的失效看起来"无原因"。
**选项**：
1. 只改数据源路径
2. 改数据源 + 补齐探针盲区 + 每日告警纳入前端变更次数 + 合成数据守门
**决策**：选项 2。
**理由**：度量失效是这次退化长期未被发现的直接原因——没有可观测性，阈值告警等于不存在。新增 `scripts/test-usage-metrics.mjs`（13 项，零 LLM）用合成数据驱动真实脚本，锁定"命中率取自每轮用量""前端变更会告警""缺数据记 n/a 而非瞎算"，并接入 `golden-tasks.sh` 第 13 步。探针补 `total` 兜底标记与 `level` 分段。

---

### [2026-09-20] 允许 import type 作为隔离边界例外
**背景**：修复方案 F-03 禁止在 adapters/ 之外 import vendor/pi。但 feature 的 index.ts 需要 ExtensionAPI 类型来注册工具/钩子。
**选项**：
1. 完全禁止 import，在 index.ts 中使用 any 类型
2. 允许 import type { ExtensionAPI }（编译后擦除，无运行时依赖）
3. 创建本地 ExtensionAPI 类型定义
**决策**：选项 2，允许 import type 作为唯一例外
**理由**：import type 在编译后完全擦除，不产生运行时依赖，符合逻辑隔离原则；使用本地类型定义会导致类型与上游不一致，维护成本高。

---

### [2026-09-20] tsconfig paths 映射到 vendor/pi/dist 而非 src
**背景**：TypeScript 编译 custom/ 时，如果 paths 指向 vendor/pi/src，会把整个 vendor/pi 源码纳入编译，导致大量 TS6059 错误。
**选项**：
1. 在 tsconfig 中 exclude vendor/pi
2. paths 映射到 vendor/pi/dist/*.d.ts（仅类型声明）
3. 不使用 paths，直接用相对路径 import
**决策**：选项 2，paths 映射到 dist 目录
**理由**：dist 目录只有 .d.ts 声明文件，不会引入源码编译错误；且符合上游发布的类型包结构。

---

### [2026-09-20] 适配器层使用动态 import 且指向 dist
**背景**：agent-adapter.ts 需要调用 createAgentSession，原代码 import src/index，导致编译错误。
**选项**：
1. 静态 import vendor/pi 源码
2. 动态 import vendor/pi/dist/index
3. 在 adapter 中定义本地接口，运行时再转换
**决策**：选项 2，动态 import dist
**理由**：避免顶层 import 副作用；dist 是稳定的编译产物，不受源码变动影响；动态 import 便于延迟加载。

---

### [2026-09-20] check-isolation.sh 允许 import type
**背景**：原 check-isolation.sh 检查 F-03 时会误报 features/index.ts 中的 import type。
**选项**：
1. 修改 features 不使用 ExtensionAPI 类型
2. 修改 check-isolation.sh 识别 import type 并放行
3. 删除 check-isolation.sh 中的 F-03 检查
**决策**：选项 2，修改脚本识别 import type
**理由**：import type 符合方案允许的例外；删除检查会降低验证效力；使用 any 类型失去类型安全。

---

### [2026-09-20] tool-adapter.ts 适配新版 ToolDefinition 接口
**背景**：vendor/pi 新版 ToolDefinition 要求 execute 函数签名包含 toolCallId、signal、onUpdate 等参数。
**选项**：
1. 完全照搬上游接口，logic.ts 返回标准格式
2. 在 adapter 中做适配转换，logic.ts 保持简单 Promise<string>
**决策**：选项 2，adapter 做转换
**理由**：logic.ts 保持零 Pi 依赖、简单纯函数；adapter 层吸收上游 API 变化，符合接口隔离原则。

---

### [2026-09-20] hook-adapter.ts 扩展 HookEvent 类型覆盖所有使用的事件
**背景**：各 feature 使用不同的钩子事件（session_start, before_agent_start, context 等），原 adapter 只定义了 5 个。
**选项**：
1. 每个 feature 自己定义 HookEvent
2. 在 hook-adapter.ts 中集中定义所有项目用到的事件
**决策**：选项 2，集中定义
**理由**：统一管理，避免重复；新增事件只需在一处添加；类型安全。

---

### [2026-09-20] web-search logic.ts 直接返回格式化字符串
**背景**：原 web-search logic 返回 SearchResult[]，再由 formatResponse 格式化。上游工具 execute 要求返回字符串。
**选项**：
1. logic 返回结构化数据，index.ts 中格式化
2. logic 直接返回格式化后的字符串
**决策**：选项 1，保持结构化数据，index.ts 负责格式化
**理由**：logic.ts 复用性更强，可被其他功能调用；格式化属于表现层逻辑，属于 index.ts。

---

### [2026-09-20] 删除 custom/config/ 和 custom/prompts/ 目录
**背景**：方案目标结构中 custom/ 仅包含 adapters、features、core、bootstrap.ts。
**选项**：
1. 保留作为共享工具
2. 按方案删除
**决策**：选项 2，删除
**理由**：custom/core/config.ts 已提供路径解析；prompts 未被使用；遵循方案最小化原则。

---

### [2026-09-20] my-pi.sh 使用构建产物而非 tsx
**背景**：方案阶段五要求便携启动脚本使用 node dist/cli.js。
**选项**：
1. 优先 tsx（开发便利）
2. 仅 node dist/cli.js（生产标准）
**决策**：选项 2，仅使用构建产物
**理由**：方案明确要求便携版运行编译后的 JS；tsx 依赖额外工具，不符合便携性要求。

> **已被取代（2026-09-20）**：该决策的前提不成立——`vendor/pi` 只构建 coding-agent 自身，my-pi 的自定义层以 **pi 扩展**方式运行，pi 的扩展加载器内置 jiti，可直接加载 `custom/bootstrap.ts`（TypeScript），无需 tsx 也无需预先编译。因此 `custom/dist` 已删除、`scripts/build.sh` 不再编译 custom/。见下方「删除 custom 构建产物」。合并本文件时保留此条以记录决策演进。

---

### [2026-09-20] vendor/pi 保留由主仓库追踪（偏离独立 clone）
**背景**：第三轮方案要求 vendor/pi 作为独立 git clone 并由主仓库 .gitignore 排除。但当前环境 GitHub clone 超时（仅 ls-remote 元数据可用），且项目需在 Termux/Android、WSL2、Linux 多设备间同步。
**选项**：
1. 严格按方案：git init vendor/pi + .gitignore 排除，移除 1689 个已追踪文件
2. 保留 vendor/pi 由主仓库追踪，修正补丁/脚本/文档并记录偏离
**决策**：选项 2，保留主仓库追踪
**理由**：独立 clone 离线不可行；移除追踪会导致新克隆的仓库缺少 vendor/pi 而无法构建/运行；多设备同步会因此失效。`sync-upstream.sh` 已增加保护：vendor/pi 非独立仓库时拒绝执行，避免误操作主仓库。待网络支持完整 clone 时可再切换。

---

### [2026-09-20] 品牌化仅保留在 patches/，vendor/pi/package.json 保持 pristine
**背景**：001-branding.patch 已应用于 vendor/pi/package.json（name=my-pi、piConfig），导致 `git apply --check` 失败；且运行时 piConfig 实际读取的是 `vendor/pi/packages/coding-agent/package.json`（configDir=.pi，无 name），vendor/pi/package.json 的 piConfig 不被使用。
**选项**：
1. 保持 vendor 已品牌化，删除补丁
2. 将 vendor/pi/package.json 恢复为上游 pristine，重生成并仅保留最小品牌化补丁
**决策**：选项 2
**理由**：符合「vendor 只读、改动经 patches 管理」的原则；补丁可被 `git apply --check` 验证；恢复 pristine 不影响运行时（配置目录由 `PI_CODING_AGENT_DIR` 重定向，品牌名对运行时无影响）。

---

### [2026-09-20] vendor/pi 转为独立 git clone（取代前一决策）
**背景**：先前因 GitHub clone 超时选择保留 vendor/pi 由主仓库追踪。后确认网络可用（SSH 认证成功、clone 成功），且主仓库 `main` 就是 pi 源码（提交作者 Armin Ronacher），canonical 上游 `earendil-works/pi-mono` 亦可达。
**选项**：
1. 继续由主仓库追踪
2. 转为独立 clone，上游指向 `earendil-works/pi-mono`，锁定 `71dca871b`（= 原 vendored 基线对应的 canonical upstream），本地改动抽为 patches
**决策**：选项 2
**理由**：恢复 `sync-upstream.sh` 自动同步能力；上游使用官方 pi 源而非自身快照；`71dca871b` 为 canonical SHA，便于后续 fetch/merge。代价：fresh checkout 需引导 vendor（已由 `scripts/build.sh` + `vendor/PINNED_COMMIT` 自动化）；已在稳定分支 `fix/vendor-independent` 上完成并验证。

---

### [2026-09-20] 删除 .pi/，配置收敛到 portable/agent（方案 B）
**背景**：第一轮方案的目标结构不含 `.pi/`，核心原则是"所有运行时数据收敛到 `portable/`"；但实际配置仍在 `.pi/`，而 `my-pi.sh` 已把 `PI_CODING_AGENT_DIR` 指向空的 `portable/agent`，导致启动器读不到 provider/model 配置。
**选项**：
1. 保留 `.pi/` 作为配置目录，改回启动器指向 `.pi`
2. 把 `.pi/` 全部迁入 `portable/agent/`，删除 `.pi/`
**决策**：选项 2
**理由**：与文档/脚本已声明的设计一致；pi 的 `AGENTS.md` 全局加载和 `APPEND_SYSTEM.md` 回退路径都能落到 `agentDir`（= `portable/agent`），因此无需改 vendor、无需符号链接即可彻底去掉 `.pi/`。`models.json`（含 apiKey）此前被误跟踪，迁移时一并停止跟踪并 gitignore；`settings.json`/`keybindings.json`/`AGENTS.md`/`APPEND_SYSTEM.md` 仍跟踪，其余每环境独立/状态文件忽略。

---

### [2026-09-20] pi-tools 迁移策略：优先纯逻辑 + 可测试模块，不整体搬运
**背景**：pi-tools 的 12 个扩展实现约 4 万行，多数依赖旧扩展 API 与私有 services/lib；一次性整体移植无法逐个验证，违背原方案"逐个迁移、每步验证"的纪律，且有破坏当前可用项目的风险。
**选项**：
1. 整体移植全部扩展实现
2. 按依赖与可验证性分批：先移植纯逻辑、可单测、且契合当前架构的模块
**决策**：选项 2
**理由**：当前项目目标是"可维护的私人助手硬分叉"，不是一次性快照。批次顺序：先无 Pi 依赖的纯逻辑（token 预算、note-store、脱敏、原子写、子代理角色），它们能直接落到 `logic.ts`/`custom/core` 并用 vitest 验证；涉及 Pi API 编排（autopilot/browser/link/voice/tmux 等）留待后续逐个按 adapter 迁移并验证。

---

### [2026-09-20] 技能放到 portable/agent/skills/（而非 portable/skills/）
**背景**：迁移 pi-tools 的 `agent/skills/` 时需确定目标目录。my-pi 文档与 `my-pi.sh` 声明技能目录为 `portable/skills/`（`PI_SKILLS_DIR`），但需要确认 pi 是否识别该变量。
**选项**：
1. `portable/skills/`：与现有文档/`PI_SKILLS_DIR` 声明一致，但需验证 pi 是否读取
2. `portable/agent/skills/`：pi 的 `agentDir/skills` 路径（`agentDir` = `PI_CODING_AGENT_DIR` = `portable/agent`），与 `settings.json` 中 `+skills/<name>/SKILL.md` 覆盖模式一致
3. 顶层 `skills/`：独立技能仓库，需启动器 `--skill` 显式加载
**决策**：选项 2
**理由**：核对 vendor/pi 源码后确认 pi v0.85.1 只识别 `PI_CODING_AGENT_DIR` 与 `PI_PACKAGE_DIR`，**不存在 `PI_SKILLS_DIR`**；技能由 `agentDir/skills` 自动发现，`settings.json` 的 `skills` 数组是相对 `agentDir` 的匹配模式（`package-manager.ts` 以 `globalBaseDir = agentDir` 做 pattern match）。因此只有 `portable/agent/skills/` 会真正被加载；`portable/skills/` 当时暂留为占位目录。（该占位目录已于同日「删除 portable 下三个占位目录」决策中移除。）

---

### [2026-09-20] packs 整目录迁移，skills/docs 精选改写后迁移
**背景**：pi-tools 的 `packs/`（外部技能包）、`agent/skills/`（4 个内置技能）、`docs/`（18 篇）内容形态不同：packs 是自包含的按需技能包；skills 与 docs 大量引用 pi-tools 专有结构（`agent/extensions`、`agent/services`、`scripts/rebuild.sh`、`searxng`、wrapper/systemd、92/106 等 pi-tools 用例数），整体搬运会引入失效路径与错误描述。
**选项**：
1. 三类内容一律原样复制
2. packs 原样迁移；skills 与 docs 逐篇检查、按 my-pi 结构改写后迁移（丢弃 pi-tools 专有内容）
**决策**：选项 2
**理由**：packs 与仓库结构耦合弱且内含本地经验沉淀（`EXPERIENCE.md`），原样保留并用 `diff -r` 校验；skills/docs 与项目结构强耦合，原样迁移会产生误导性文档。docs 精选 9 篇保留可迁移价值（pi 扩展/SDK 开发、技能维护、多环境/Termux/终端运维，另有 `design/VISION.md`），丢弃 9 篇 pi-tools 专有报告与路线图，清单记录在 `docs/README.md`。技能仅更新路径/命令/子系统引用，保留原有方法论与纪律，frontmatter `name` 不变。

---

### [2026-09-20] 根目录文档收敛为 6 个，项目愿景置于 docs/design/VISION.md
**背景**：作为个人项目，根目录 9 个文档中混有上游/历史遗留：`CHANGELOG.md` 记录的是 pi-tools 迁移期日志（条目指向 my-pi 已不存在的 rebuild.sh/pi-wrapper.sh/setup-*.sh）、`CONTRIBUTING.md` 面向不存在的协作者且内容与 AGENTS 重复、`SECURITY.md` 是上游 pi 模板（报告入口指向 earendil 安全邮箱）。同时用户指出 pi-tools 的 `VISION.md` 即其开发目标，需迁移并按现状更新。
**选项**：
1. 全部保留，仅更新内容
2. 移除三个不适用文档；VISION 放根目录
3. 移除三个不适用文档；VISION 放 `docs/design/VISION.md`
**决策**：选项 3
**理由**：`CHANGELOG.md`/`CONTRIBUTING.md`/`SECURITY.md` 对个人项目无实际作用且会误导（脚本清单、报告入口均不成立），删除后根目录只保留 README/AGENTS/STRUCTURE/DECISIONS/PROGRESS/LICENSE。VISION 是设计类文档而非入口文档，放 `docs/design/` 并在 README 与 `docs/README.md` 显著链接，既保持根目录精简又便于发现；其原 §4「度量体系」在 pi-tools 记为全部落地，在 my-pi 实为整体缺失，改写为现状差距表并把执行跟踪并入 §6 落地路线（不再单设 ROADMAP，避免与 PROGRESS 重复）。§1–§3、§5 属用户确认范围，迁移时只做落点映射与状态标注，不改愿景本身。

---

### [2026-09-20] 删除 portable 下三个占位目录，运行时数据统一收敛到 agentDir
**背景**：`portable/{skills,extensions,sessions}/` 是骨架期创建的占位目录。核对 vendor/pi 源码后确认：pi 只识别 `PI_CODING_AGENT_DIR` 与 `PI_PACKAGE_DIR`，技能来自 `agentDir/skills`、会话来自 `agentDir/sessions`（可用 `PI_CODING_AGENT_SESSION_DIR`/`--session-dir` 覆盖）、扩展来自 `agentDir/extensions`，三者都不读 `portable/{skills,extensions,sessions}`。启动器导出的 `PI_SKILLS_DIR`/`PI_EXTENSION_DIR`/`PI_SESSION_DIR` 全部无效，会话此前实际写在 `portable/agent/sessions/`。
**选项**：
1. 保留目录，会话改用 `--session-dir` 指向 `portable/sessions`，把运行时数据与配置分离
2. 删除三个占位目录；运行时数据统一由 agentDir（`portable/agent/`）承载，启动器只导出有效变量
**决策**：选项 2
**理由**：选项 1 的收益只是目录语义更整齐——两种布局都在 `portable/` 下，便携性保证同样成立，却要额外迁移现有会话并引入一个启动参数；用户明确表示会话目录无移动必要。选项 2 只删除零引用的空目录、去掉误导性的无效变量导出，改动面小且无需迁移数据。收敛后的规则更简单：**agent 的配置/技能/会话/扩展都在 `portable/agent/`（agentDir）下，`portable/memory/` 只放 my-pi 自定义功能的数据**（`PI_MEMORY_DIR` 由 `custom/core/config.ts` 的 `getMemoryDir` 读取）。若将来确需分离会话，再按选项 1 加 `--session-dir` 即可。

---

### [2026-09-20] agentDir 改名为 portable/agent，并修复 custom 层接线
**背景**：上一决策把技能/会话/扩展统一收敛到 `agentDir` 后，目录名 `portable/config` 与实际内容（配置 + 技能 + 会话 + 扩展）不符，文档中"config 只放配置"的表述自相矛盾。同时在核对改动面时发现 custom 层存在更深的问题：实测 `./my-pi.sh` 报 `Extension does not export a valid factory function` 并退出码 1，即 12 个功能一个都没有真正加载。
**选项**：
1. 只改文档措辞，保留 `portable/config` 名字
2. 物理分离：sessions/skills/extensions 移出 agentDir，用 `--session-dir`/`--skill`/`--extension` 加载
3. 把 agentDir 改名为 `portable/agent`，内容与加载方式不变，同时修复接线缺陷
**决策**：选项 3
**理由**：
- 选项 2 做不到彻底分离——pi 的 `pi install` 安装路径硬编码在 agentDir 下（`getManagedNpmInstallPath()` = `agentDir/npm/node_modules/<name>`，`getGitInstallRoot()` = `agentDir/git`），扩展必然分裂在两处，还要长期维护 2-3 个上游 CLI 契约。
- 选项 1 无法消除命名与内容的冲突；改名对 pi 零语义代价（`PI_CODING_AGENT_DIR` 指向任意目录均可），且项目尚小（28 个跟踪文件、2 个会话文件），是成本最低的时机。
- 接线缺陷必须一并修：`bootstrap.ts` 需按 pi 约定**默认导出**工厂函数；`config.ts` 不得再引用已删除目录；以扩展方式运行时 session 由 pi 创建，`agent-adapter.ts` 属旧设计遗留且实现有误（`cwd` 误用会话目录），故删除；`tool-adapter` 的 `parameters` 需编译为 TypeBox schema。
结果：`portable/agent/`（pi 运行时根）+ `portable/memory/`（my-pi 自定义数据），`./my-pi.sh` 可实际启动并注册全部 12 个功能。

---

### [2026-09-20] 删除 custom 构建产物，custom/ 一律以 TypeScript 源码加载
**背景**：`custom/dist/` 由 `scripts/build.sh` 编译产生，但运行路径从不使用它——`my-pi.sh` 与 `dev.sh` 都以 `--extension custom/bootstrap.ts` 加载，pi 的扩展加载器内置 jiti，原生支持 TypeScript（实测 12 个功能注册、工具被调用，全程无 dist 参与）。该产物反而造成误导：其中残留已删除的 `agent-adapter.js`；其编译命令还与 `custom/tsconfig.json` 的 `noEmit: true` 自相矛盾（命令行强行 `--outDir custom/dist --noEmit false`）。
**选项**：
1. 删除 `custom/dist`，`build.sh` 不再编译 custom/，运行统一加载 `.ts`
2. 保留产物，改 `my-pi.sh` 加载 `custom/dist/bootstrap.js`（运行前必须先 build）
3. 保留产物但不使用（现状）
**决策**：选项 1
**理由**：选项 2 会引入"源码/产物两份、必然漂移"的经典问题（本次踩到的就是它），并要求每次运行前构建、fresh checkout 更繁琐，收益仅是省去启动时的即时编译；选项 3 是自相矛盾的状态。选项 1 收敛为单一事实来源：`vendor/pi` 需要构建（独立 clone，我们消费其 dist），`custom/` 只需 `tsc --noEmit` 类型检查。可行性上无损失——TS 支持来自 pi 自带的 jiti，不引入 tsx 等额外工具，与便携性要求一致。旧决策「my-pi.sh 使用构建产物而非 tsx」的前提（运行 TS 需要额外工具）对扩展路径不成立，已在该条下标注取代。
---

### [2026-09-21] 度量/防退化/记忆治理的落点（VISION P1–P3）
**背景**：12 个功能迁移完成后，VISION §4 指出的最大缺口是度量层：干预率、token 成本、缓存命中率均无法测量；记忆治理只停留在目标设计；结构性改动缺少行为级回归网。pi-tools 以 `usage-stats`/`task-metrics`/`golden-tasks`/`memory-lifecycle` 分散承载这些能力。
**选项**：
1. 新建一个 `metrics`/`observability` feature 集中承载
2. 就近落点：度量入各功能现有文件（context 存用量、autopilot 汇仪表盘、memory 出治理报告），防退化入 `scripts/`
3. 只做文档，不落地程序
**决策**：选项 2
**理由**：
- 选项 1 会打破"12 个扩展"的清晰身份，且指标天然属于对应功能（干预属 intervention、用量属 context、任务属 autopilot）。
- 选项 2 的耦合以**数据文件**为边界（`interventions.jsonl`/`usage.jsonl`/`telemetry.json` 都在 `portable/memory/` 下），不引入 feature 间代码依赖；`/auto metrics` 只做只读聚合，符合 §3.4「执行-知识分离」——度量用于观察，不进入生产解题路径。
- 防退化用 `scripts/golden-tasks.sh` + `scripts/check-injection-surface.sh` + `scripts/check-doc-links.mjs` 承载，`npm run golden` 一键守门；`check-injection-surface` 以 system prompt 前缀指纹防缓存回归（§3.2 硬优先）。
- 记忆治理报告（`/memory lifecycle`）与教训闭环（`/memory mine [--ingest]`）只读幂等；写入须用户显式 `--ingest`，符合 §5「任何写操作先报告/确认」。
结果：VISION §2 三项判据均可测量（`/auto metrics`），P1/P2/P3 达成，测试 208 用例 + golden 七项守门。

---

### [2026-09-21] 功能迁移的完成口径与 N.A. 边界
**背景**：逐批迁移 pi-tools 12 个扩展时，部分能力与 my-pi 架构前提冲突，需要明确"完成"的口径，避免为对齐而引入不必要复杂度。
**决策**：按"逻辑可移植则移植、平台/编排依赖则替代或标注 N.A."处理：
- **N.A.（不迁移）**：`pi-wrapper.sh`/crash-recovery/L4 源码缓存——my-pi 直启（`my-pi.sh`）无 wrapper 层；离线 cron 由 autopilot 会话内 tick 承担；Windows 原生 tmux 模拟不迁移（目标平台 Linux/Termux）。
- **替代**：TUI 补丁由 `patches/*.patch`（源码级）替代 dist 级 `patch-*.mjs`；外部服务安装由 `scripts/setup-external.sh` 文档化。
- **逻辑移植并补测试**：其余一律进入 `custom/features/*/{logic}.ts`，保持零 Pi 依赖。
结果：12/12 功能核心与运行编排层落地；N.A./替代项在各 feature 头注释与 PROGRESS 记录，避免"看似缺漏"的误解。

---

### [2026-09-21] 钩子事件名从 Pi 类型派生，杜绝手写清单漂移
**背景**：全面审查发现 `custom/adapters/hook-adapter.ts` 的 `HookEvent` 是手写清单，含 `before_tool_call`/`after_tool_call` 两个 Pi 并不派发的事件（Pi 实际为 `tool_call`/`tool_result`）。后果是 context 的工具用量计时与 plan-mode 的只读强制从未触发，而 `check-features.sh` 又用同一错误清单"校验"，无法发现；`pi.on` 经 `as unknown` 双重断言，`tsc` 也拦不住。
**选项**：
1. 维持手写清单，靠人工同步 Pi 事件
2. 从 Pi 的 `ExtensionEvent` 派生 `HookEvent = ExtensionEvent['type']`，并让适配器按该联合收窄 `on`
3. 适配器直接暴露 Pi 的 `on` 原始类型，features 各自 import 事件类型
**决策**：选项 2
**理由**：
- 选项 1 已被证明会漂移，且守门脚本会继承错误清单，失去防护意义。
- 选项 3 会让 feature 层接触 Pi 类型细节，违背"接口隔离"（features 只依赖适配器稳定接口）。
- 选项 2 让事件名成为编译期契约：写入不存在的事件名直接 `tsc` 报错；事件名由上游类型自动更新。同时把 `plan-mode`/`context` 的事件与字段（`input`/`content`）修正到真实契约。
结果：`check-features.sh` 现在既校验事件被 feature 注册，又反向校验事件名存在于 vendor 类型中；隔离脚本改按包名 `@earendil-works/*` 校验，真正约束 runtime import。

---

### [2026-09-21] 功能目录两层化：根层放 index/logic，实现按职责下沉子包
**背景**：功能迁移完成后，部分功能目录堆积 10+ 个平铺文件（memory/voice/autopilot），可读性下降；但项目既有约定要求每个功能根目录必须有 `index.ts` 与 `logic.ts`（守门脚本 `check-features.sh` 依赖），且"数据收敛到 `portable/`"。
**选项**：
1. 保持全平铺，仅靠命名区分
2. 允许功能根下按职责建一层子包，`logic.ts` 作 barrel 保持对外出口不变
3. 把功能内的代码再拆成独立顶层包
**决策**：选项 2
**理由**：
- 选项 1 在 10+ 文件时阅读成本高，无法表达 `storage/retrieval/inject` 这类职责分组。
- 选项 3 会破坏"一个扩展一个目录"的迁移映射，且增加跨包依赖。
- 选项 2 保留 `index.ts`（注册）与 `logic.ts`（纯逻辑出口）在根层，守门脚本与跨功能引用不受影响；仅多一层目录，符合"同功能文件放一起、嵌套不深"。子包内互引用用相对路径，跨功能只走对方 `logic.ts`，维持分层。
- 数据仍在 `portable/` 收敛（项目硬约束优先于"代码/配置/数据同目录"的个人偏好）；仅将 autopilot 的配置/状态从 agentDir 根收拢到 `portable/agent/autopilot/`，并保留旧路径读取回退。

### [2026-09-22] 崩溃自愈重新引入 supervisor（推翻此前 N.A.）
**背景**：此前以"my-pi 直启无 wrapper"为由把 crash-recovery 标为 N.A.。用户澄清：最新 pi-tools 已改为「用 pi 修复 pi」，轻度崩溃（external）用屏蔽扩展/技能的当前 pi 自修复，重度（pi_self）用源码编译的 pi 修复损坏的 pi，且 `/tmp` 有最新 clone。
**决策**：按该设计重新引入轻量 supervisor（`scripts/pi-supervisor.sh`），`my-pi.sh` 默认经它启动。
**理由**：崩溃时只有外部进程能重启/救援，直启无法自愈；my-pi 的 vendor 即源码，`pi-source-build.sh` 构建并缓存 dist 作为"好 pi"，无需再 clone 上游。保留熔断/最大轮数/健康检查/审计，避免"越修越坏"。

### [2026-09-22] 长期记忆只做精选迁移，不整库导入
**背景**：pi-tools 记忆库 982 条含 PAT 泄露记录、Tailscale/SSH 主机信息与大量旧路径。
**决策**：过滤敏感/旧路径/设备专属/新闻/测试垃圾后迁移 139 条，不迁移 summaries/notes/interventions/extract-sessions。
**理由**：长期记忆价值在可移植的经验，而非旧项目运行日志与安全敏感清单；整库导入会把误导与泄露一并带入。

### [2026-09-22] 命令面去冗余与"少手动、多自动"
**背景**：顶层描述内联长 usage，子命令无说明；`/autopilot` 整体重复 `/auto`+`/schedule`，`/usage-diag` 重复 `/context`。
**决策**：删冗余命令，顶层短描述 + 子命令补全说明；砍掉与自动行为重复的手动子命令（`/context reset`、`/voice on|off`、`/plan on|off|toggle`），自动切换交由 hook/快捷键（Ctrl+Alt+R / Ctrl+Alt+P）。
**理由**：命令是低频入口，手动开关不符合"智能化"，且每多一个命令都增加认知与维护成本。

### [2026-09-22] web_search 端点解析与无 SearXNG 降级
**背景**：web-search 迁移后仅认 `SEARXNG_URL`，而 my-pi 运行环境无该变量、且本机未装 SearXNG，导致 web_search 恒不可用。
**决策**：端点按 `SEARXNG_URL` → `PI_WEB_TOOLKIT_SEARXNG_URL`（pi-tools 兼容名）解析；两者皆无时自动降级为免配置 HTTP 搜索（`web_fetch` 同源 Bing 直连）并在结果前注明。
**理由**：搜索是高频能力，不应因可选外部服务缺失而不可用；显式配置仍优先，降级不隐藏（结果首行说明）。

### [2026-09-22] 不迁移 auto-compact 控制器与 task-summarizer 流水线（口径）
**背景**：pi-tools `pi-context/auto-compact-controller.ts` 与 `task-summarizer.mjs` 依赖 `.usage-diag.jsonl`、task-record、thinking-level、warm-prefix、prune-dump 等一整条未迁移的数据/编排链。
**决策**：本轮只保留已迁移的阈值判定器；快照/任务门控/思考档切换/暖前缀回放与技能草稿流水线暂不迁，在 PROGRESS 记录依赖缺口。
**理由**：为对齐而引入整条数据链会使改动面远超收益，且与"逻辑可移植则移植、编排依赖则替代或标注"的既有口径一致。

### [2026-09-22] web_search 三层端点解析 + 失败降级
**背景**：本机无 docker，SearXNG 需原生部署；且所在网络对部分搜索引擎直连受限，SearXNG 可能返回空结果。
**决策**：端点按 `SEARXNG_URL` → `PI_WEB_TOOLKIT_SEARXNG_URL` → 本地 `127.0.0.1:8889` 解析；当 SearXNG 返回失败/超时/未找到结果时，自动降级为 `web_fetch` 同源 HTTP 搜索（Bing），结果首行注明降级。
**理由**：搜索是高频能力，本地实例是首选但不应成为单点；降级对用户可见，不静默改变语义。

### [2026-09-22] 外部服务安装位置：SearXNG 用 /opt 而非 portable/
**背景**：`check-isolation` 规定 `portable/` 不放运行时依赖（node/chromium/ffmpeg 等），且 `portable/` 禁符号链接。
**决策**：SearXNG 原生装到 `/opt/searxng`（可用 `SEARXNG_HOME` 覆盖），由 `scripts/setup-external.sh web` 管理启动；工具 shim 写入 `portable/agent/bin` 用 exec 脚本而非 `ln -s`。
**理由**：保持"portable/ 仅运行时数据"的边界与无符号链接约束，同时外部服务可复现安装。

### [2026-09-22] 压缩前快照落点迁移到 portable/memory/checkpoints
**背景**：pi-tools 快照写 `~/.pi/logs/compact-snapshots`；my-pi 已有 `portable/memory/checkpoints/`（memory 功能使用）且无 `portable/agent/logs`。
**决策**：`snapshotBeforeCompact` 统一写 `portable/memory/checkpoints/`，保留最近 8 份/7 天。
**理由**：运行时检查点数据集中一处，便于 memory 治理与清理；避免为日志再开一个目录。

### [2026-09-22] task-record/task-summarizer 改为适配迁移（取代同日"不迁移"口径）
**背景**：先前以"依赖整条未迁移数据链"为由暂缓；实际 `task-record` 生产者可确定性重建（agent_settled 写结构化记录），总结层可去掉 spawn 强依赖。
**决策**：迁移为 `context/budget/task-record.ts`（写 `portable/memory/task-records.jsonl`）+ `scripts/task-summarizer.mjs`（游标聚合 → digest 写 `portable/memory/daily-results/`；`--dry-run` 列表；`--spawn` 才调用 `my-pi.sh -p` 并行入库/起草 SKILL）。默认不 spawn，避免无 provider/管道场景挂起。
**理由**：保留"即时记录 + 批量总结"的自主学习闭环，同时把编排依赖降为可选。

### [2026-09-22] 网络搜索可用性修复（对齐 pi-tools 注意事项）
**背景**：本机 SearXNG 用默认引擎集，google/duckduckgo/brave/wikipedia 等全部 timeout 拖垮整次搜索（空结果）；`web_fetch`（Bing 直搜）因 HTML 结构变化（`<h2 class=...><a target=... href=...>`，属性在 href 前）旧正则匹配不到，恒返回"无结果"；`fetch_url` 在受限出口仅部分主机可达。
**决策**：(1) 迁移 `scripts/searxng-config.sh`，只启可达引擎并令 bing 走 `cn.bing.com`；(2) `searchDirect` 放宽为"h2 内任意属性顺序的 a[href]"，加实体解码与 `/ck/a` 跳转还原；(3) `resolveSearxngUrl`/`resolveSearchTimeout` 增加 `settings.json`（`pi-web-search`）读取，默认超时 30s（原项目口径）。
**理由**：这三项是原项目 README/CHANGELOG 明确记录的网络搜索注意事项；修复后本地 SearXNG 与 Bing 直搜均可用。

### [2026-09-22] 工具分层"常驻配置"同步 pi-tools，并按已注册工具过滤
**背景**：需将 pi-tools `tool-groups.ts` 的常驻（CORE_TOOLS）与休眠组名单同步到 my-pi，但其中 `plan_*`/`ctx_*`/`admin_*`/`verify_*`/`ask_user`/`thinking_level`/`autopilot_policy`/`schedule_task` 对应功能尚未迁移。
**决策**：完整同步原项目名单以保持一致；新增 `groupsWithTools(presentTools)`，`buildSleepingSummary(present)`、`/tools` 补全与报告、`enableGroup` 均只暴露"当前已注册工具"所属的组，未迁移组不注入 system prompt、不可启用。
**理由**：既保持与上游常驻配置同源、后续迁移自动生效，又避免向模型宣传不可用工具导致无效调用。

### [2026-09-22] 迁移 thinking 档位自适应切档（含模型建议 tool）
**背景**：pi-tools `thinking-level.ts` 是 auto-compact 控制器的一环：按真实窗口比例在 low/medium/high 间自动升降档（critical→降档省 token、回落→升回基准），并提供 `thinking_level` 工具让模型"建议"、规则审批（死区/压力方向）。
**决策**：迁移为 `context/budget/thinking-level.ts`（纯逻辑 + 审计 JSONL 落 `portable/memory/logs/level-changes.jsonl`），在 `agent_settled` 依据 `getContextUsage()` 的 tokens/window 驱动，注册 `thinking_level` 工具；用 `PI_CONTEXT_THINKING_AUTO=off` 关闭自动切档，`PI_LEVEL_CHANGE_FILE`/`PI_DISABLE_LEVEL_AUDIT` 控制审计。
**理由**：上下文压力与思考预算争抢是剪枝/缓存断裂主因，自适应档位收益明确；比例分母用真实窗口（非 256K 压缩阈值），压缩后自然回落可升回。副作用：内核会持久化 `settings.defaultThinkingLevel`（合法值 off/low/medium/high，无 max），属预期。

### [2026-09-22] 迁移工具失败熔断与错误脱水（tool-health）
**背景**：NEW 已有 token 预算截断（`budget.pruneToolOutput`），但缺 pi-tools `tool-truncation.ts` 的两项确定性健康逻辑：同一工具连续失败 3 次的熔断提示，以及错误输出的重复行折叠/超长行截断；且 `tool_result` 钩子此前截断后只返回单个 text 块，会丢弃图片等非文本块。
**决策**：新增 `context/budget/tool-health.ts`（`updateFailStreak`/`dehydrateErrorOutput`/`rebuildTextContent`），在 `tool_result` 钩子接线：失败计数→熔断提示、错误脱水、`rebuildTextContent` 原位回写文本并保留非文本块。不迁移 ORIG 的字节级 `truncateToolContent`（与 token 预算截断重复）。
**理由**：逐工具 `pruneToolOutput` 与中心钩子互补；熔断/脱水是低成本的无效重试抑制与 token 收敛；修复丢块是明确缺陷。

### [2026-09-22] 迁移 autopilot 会话列表/切换与 admin 重启
**背景**：pi-tools `pi-autopilot/sessions.ts` + `admin_*` 工具（列表/切换会话/重启）未迁移；NEW 的 admin state（`writeRestartRequest`）此前只写无人消费，且 `tool-adapter` 不向工具透传 ctx，无法做 UI 确认/主动关机。
**决策**：① `tool-adapter` 增加 `ToolExecuteContext`（hasUI/confirm/notify/shutdown）并从 Pi ctx 提取；② 新增 `adapters/session-adapter.ts` 封装 vendor `SessionManager.list/listAll`（替代 ORIG 手写文件扫描，拿到 cwd/messageCount 等结构化字段）；③ `autopilot/store/sessions.ts` 纯格式化；④ autopilot 注册 `admin_list_sessions`/`admin_switch_session`/`admin_restart`（名称与 ORIG 一致，落入 admin 休眠组/核心）；⑤ `pi-supervisor.sh` 正常退出时消费 admin state，`restart` 重拉、`switch_session` 以 `--session <path>` 重拉并清理请求。
**理由**：会话编排是 autopilot 运维核心；用 vendor 结构化 API 比手写扫描更稳；supervisor 消费请求是让 admin 工具真正生效的最后一环。

### [2026-09-22] 补全 auto-compact 门控（背景任务/环境阈值/上下文回退/重启提示）
**背景**：NEW 的自动压缩仅在 turn_end 按阈值 + 计划任务门判定；缺 pi-tools 控制器的背景任务门、环境比例/绝对阈值、真实 usage 缺失时的上下文回退与重启提示阈值。
**决策**：新增 `context/budget/task-gate.ts`（`ABSOLUTE_TOKENS`/`RESTART_TOKENS`/`COMPACT_COOLDOWN_MS`/`TASK_GATE`、`readEnvRatio`、`resolveContext`、`hasBackgroundTask`）。turn_end 改用 `resolveContext`（真实 usage → provider token 回退），加背景任务门；`compactDecider` 注入环境比例/绝对阈值/冷却；`before_agent_start` 在 tokens > `RESTART_TOKENS` 时注入"先 /compact 再重启"提示。
**理由**：三重门（阈值/任务/后台）避免压缩打断进行中的多步/后台任务；回退保证真实 usage 缺失时仍能判定；重启提示减少重启后首轮全量重发。`hasBackgroundTask` 仅在 `PI_SESSION_ID` 可归属且 tmux 会话存活时生效（否则门惰性安全）。

### [2026-09-22] 自动化整理：子包化 web-search/link + 系统提示补全 + knowledge-ingest 可移植
**背景**：用户授权持续迁移并按便携化/模块化要求整理目录；同时修掉此前引入的缓存不友好注入。
**决策**：
1. `web-search` 拆分 `config/search/fetch/concurrency`、`link` 拆分 `types/config/net/card/guards/state/display` 并把 `link.ts` 更名 `protocol.ts`，两侧 `logic.ts` 改为 barrel（跨功能引用仍只走 `logic.ts`）。
2. `context` 的 `before_agent_start` 补全压力分档（75%/90%）+ 委派/效率建议；重启提示改为**静态文本**（移除精确 token 数值，遵守"注入禁止精确数值"的缓存纪律）。
3. `scripts/knowledge-ingest.mjs` 改为基于 `import.meta.url` 解析 ROOT 的可移植实现，条目 `environments:['all']` 跨设备可见；正式入库（脚本总数 18）。
4. 新增 `deploy/systemd/pi-searxng.service`（原生 venv 托管）；`pi-whisper.service` 按语音暂缓的既有口径不迁移。`deploy/tmux`（终端配置）后于 2026-09-23（提交 `d39c8bc94`）迁移，见 `deploy/README.md`。
5. Best-of-N 的 LLM 集成不迁移：原项目 `judgeCandidates` 为随机占位、`bestOfN` 依赖外部编排；纯评分逻辑（parseJudgeScores/selectBest/shouldVerify）已在 `autopilot/run/verifier` 迁移。
6. `docs-check.mjs`/`docs-freshness.mjs` 不迁移：与本仓库 `check-doc-links.mjs` 重叠，且其"元信息表/目录导航"模板与本项目文档风格不符，会产生大量误报。
**理由**：在不引入 vendor 核心补丁风险的前提下完成目录模块化与闭环；未能闭环或属环境专属的项以决策记录明确边界。

### [2026-09-22] 深度检查：死代码清理、运行时数据归位、packs 索引补全
**背景**：自主深度检查发现若干不一致：未用导入/死代码、`portable/memory/daily-results` 单文件被 force-add 与 `.gitignore`（运行时数据不入库）冲突、`packs/INDEX.md` 漏 `reverse-skill`、`packs/drafts` 目录缺失。
**决策**：
1. 删除 `context/logic.ts` 死代码（暖前缀/未用状态与函数）与各文件未用导入；`custom/tsconfig.json` 开启 `noUnusedLocals`/`noUnusedParameters` 防回归。
2. 运行时产物归位：`git rm --cached portable/memory/daily-results/...`，遵守 `portable/memory/*` 忽略策略（文件保留在磁盘）。
3. 补全 `packs/INDEX.md` 的 `reverse-skill`（入口 `skills/SKILL.md`）；新增 `packs/drafts/.gitkeep` 并在 `.gitignore` 忽略草稿内容，闭合 task-summarizer 起草落点。
**理由**：深度检查的目标是消除死代码、文档/策略不一致与运行时数据入库，保证便携与可维护。

### [2026-09-22] 重建脚本优化与 pi 更新自动修复
**背景**：用户要求对比本地环境与远程仓库，确保新设备能顺利重建、更新 pi 后能自动修复。审查发现多处“本地可用但新设备不可复现”的缺口：根依赖从未安装、补丁模型自相矛盾（本地为 commit，脚本按未提交处理，而 check-isolation 要求 vendor 干净）、同步后不重建/刷缓存、dev.sh 依赖未安装的根 tsx、check-features 把每环境独立的 auth.json 当必检项。
**决策**：
1. 新增 `scripts/lib-vendor.sh` 作为 build/sync/doctor 的共享逻辑：补丁**幂等**应用（reverse-check 跳过已应用，新应用提交为本地 commit 使 vendor 保持干净），依赖一致性用 `node_modules/.package-lock.json` 的 mtime 判断（逐字节比较会因 npm 精简隐藏锁而误报）。
2. `build.sh` 重写为“一键重建”：Node 检查 → 根 `npm ci`（不改 lock）→ vendor 引导（clone/checkout/幂等提交补丁）→ vendor 根 `npm ci` + 构建 → 可选 shim/自愈缓存；用 `PI_SKIP_*`、`PI_CN_MIRROR`、`PI_CLONE_TIMEOUT` 控制。
3. `sync-upstream.sh` 升级为“更新即修复”：fetch 超时保护 → merge（冲突 abort 回滚并列出文件，不留半完成态）→ 幂等补齐补丁 → 重建 dist → 刷新自愈缓存 → 类型检查；`PI_SYNC_DRY_RUN=1` 只读预演。
4. 新增 `scripts/doctor.sh`（本地 vs 仓库体检 + `--fix`），作为“对比本地环境与远程仓库”的常驻工具；`pi-source-build.sh` 增 `--no-build` 以免递归构建。
5. 修正可复现性阻碍：`dev.sh` 用 vendor 内置 tsx；`check-features` 的每环境独立文件降级为警告；golden 补丁标签改为动态计数。
**理由**：把“重建”和“更新”都收敛为幂等、可重复、无锁污染的单一入口；补丁以 commit 形式与本地一致，使 merge 自然工作且满足隔离检查；doctor 让缺口可见且可一键修复。

### [2026-09-22] 更新 pi 上游至 v0.87.0 + sync/build 自愈式重建
**背景**：用户要求“更新项目中的 pi”。基线为 v0.85.1（`71dca871b`），上游最新 `d201760ff`（v0.87.0，+134 commits）。旧 `sync-upstream.sh` 采用“merge 后再 apply 补丁”，在补丁改动与上游改动重叠时会产生语义错误（实测 002 的 `google-shared.ts` hunk 与上游新增的 `TOO_MANY_TOOL_CALLS` case 合并成重复 case）；旧 `build.sh` 只构建 coding-agent，而 v0.87.0 的 coding-agent 依赖工作区其它包与 `packages/ai` 联网生成的模型数据。
**决策**：
1. **补丁栈重建语义**：`patches/` 为唯一真值，vendor 分支 = 上游基线 + 每补丁一个 commit。`sync-upstream.sh` 在临时 worktree 中 checkout 目标基线 → 幂等应用并提交全部补丁 → 成功才移动 `main` 并写 `LAST_SYNC_POINT`；失败则 vendor 完全不变。避免依赖 git merge 对补丁漂移作隐式判断。
2. **补丁随上游维护**：移除 002 中上游已修复的 hunk；按 biome 重新生成 004。补丁现对新基线 plain-apply。
3. **构建全工作区**：`build.sh` 改用 `npm run build:offline` 按依赖顺序构建（含 `durable`/`session-backends`），并仅在模型数据缺失时联网 `generate-models`。
4. **规避 Node IPv6 超时**：构建/生成默认注入 `--dns-result-order=ipv4first --no-network-family-autoselection`（本机 undici 对双栈域名超时，curl 正常）。
5. **本地维护提交绕过上游钩子**：补丁 commit 加 `--no-verify`，并把 `LAST_SYNC_POINT` 加入 vendor `.git/info/exclude`。
**理由**：上游更新必须可复现、可回滚、语义正确；确定性重建比隐式 merge 更安全，且与 fresh bootstrap 完全一致。

### [2026-09-25] 成本审计：默认关闭压缩空闲门，并加运行时前缀指纹
**背景**：用户反馈同一模型/同一思考档下，my-pi 的费用接近 deepseekharness 的 2 倍。实测对照（同一模型价目估算，harness 130 请求 vs my-pi 主会话 159 请求）：费用 $0.774 → $1.566（**2.02x**）；prompt 计费量 23.75M → 43.01M（1.81x），平均上下文 182,722 → 271,428（1.49x），起始上下文 8,250 → 179,746（21.8x），未命中 input 205,456 → 1,136,626（5.53x）。增量分解：**65% 来自平均上下文更大、33% 来自整段缓存失效**、2% 输出。
根因有三：① 压缩空闲门（门3）在结构上恒不过——判定点只有 `turn_end`，而它总是紧跟一次用户输入，`now - lastUserActivityTs` 恒为本回合耗时（秒级）< 10 分钟，导致 10 小时 / 341K 上下文会话零压缩；② 每轮重建记忆注入消息（旧注入被 `filterInjectedMessages` 移除 + 新注入追加）使消息序列在注入点位移，配合 `_preparePromptAndLoadToolout` 的更新消息被 unshift 到最前，出现单次 170K–316K 全价重算；③ 长生命周期会话 + `--continue` 恢复把大上下文反复带回。
**决策**：
1. **门3 默认关闭**（`PI_CONTEXT_IDLE_MS` 默认 0）。打断风险由门1（进行中计划任务）与门2（本会话后台任务）承担。若仍要保守行为，设 `PI_CONTEXT_IDLE_MS>0`。
   > **更正（同日，价目修正）**：当初据以论证的"压缩可省 61%、12 个请求回本"是按 `cacheRead = input/10` 估的。
   > 核对 `models.json` 的 override 后真实比例为 **1/50**（input 0.15 / cacheRead 0.003 / output 0.60 per M），
   > 于是压缩一次 256K 的自身开销约 $0.038，而省下的命中 token 仅值约 $0.0007/请求 → **回本需约 55 个后续请求**。
   > 结论修正：**擦除（免费）才是主力，压缩只在高阈值/长会话下划算**；门3 默认关闭仍保留（可避免超窗与冷缓存后的大额重算），但不再是主要收益来源。
   > 详见 [docs/development/CONTEXT-MANAGEMENT-COMPARISON.md](docs/development/CONTEXT-MANAGEMENT-COMPARISON.md) 第六节。
2. **修正门3 语义**：新增 `passesIdleGateAtTurnEnd`，按「本回合开始**之前**的空闲」（`input` 钩子在覆盖前捕获 `preTurnIdleAnchor`）或「本回合已持续 ≥ IDLE_MS」放行，避免原判定恒假。
3. **记忆注入去抖**：新增 `shouldInjectMemory`，注入块内容未变时不再重插（旧注入仍在历史中，模型照常可见）；`session_compact` 时重置以确保压缩后重新注入。
4. **运行时前缀指纹**（`budget/prefix-fingerprint.ts` + `logs/prefix-fingerprints.jsonl` + `/context fingerprint`）：逐请求对 system/tools/消息头/总序列分段哈希并记录变化段，用于定位后续整段失效的确切来源（静态版 `check-injection-surface.sh` 只覆盖 system prompt）。
**理由**：成本大头是"每请求都按 270K 上下文计费"，任何"为保缓存而不压缩"的取舍在该规模下都是净亏；同时需要一个运行时归因工具，避免再次靠推测定位缓存失效。

### [2026-09-25] 上下文管理对比 DSH：让确定性擦除真正生效
**背景**：对比 DeepSeek Harness（DSH，0.1.5-rc.2）的上下文管理后发现，my-pi 的多层擦除子系统**大半写了但没生效**。实测 10 小时 / 341K 上下文会话的构成：`assistant:thinking` **155,142（50.1%）**、`toolResult` **143,410（46.3%）**、assistant text 10,950、user 389。而 `pruneThinkingBudget` **无任何调用者**、`pruneToolResults` 因阈值 120K/80K 过高在该会话中**从未触发**（`[pruned:` 出现 0 次）；回收压力全落在有损的写入时截断上（308/562 条被截断，会话后期工具输出均值仅 155 token）。另发现 `read` 也受全会话 20K 输出预算约束 → 预算耗尽后 read 只剩 300 token，`output-archive` 承诺的"凭路径读回原文"失效。
对照 DSH：其压缩阈值是 0.8×窗口（1e6 → 800K，实测不触发），工具输出走"read 上限 2000 行/50KB → spill >50KB 可恢复（排除 read）→ 压缩触发后才做 8,192 字符中段裁剪 → 摘要压缩"四级；DSH **没有** thinking 专用回收。my-pi 的擦除层（尤其 thinking）在机制上是 DSH 的超集，但实现未接线/阈值失准。
**决策**：
1. **接通 thinking 擦除**：`context` 钩子在工具擦除后调用 `pruneThinkingBudget`，默认保留最近 64K thinking（`PI_CONTEXT_KEEP_THINKING_TOKENS`）。
2. **下调工具擦除阈值**：`PRUNE_PROTECT_TOKENS` 120K→**60K**、`PRUNE_MINIMUM_TOKENS` 80K→**30K**（env 可覆盖），使擦除在压缩之前真正回收。
3. **`read` 豁免会话输出预算**：只受单次 5K 上限约束，恢复归档可读回（与 DSH spill 排除 `read` 一致）；另加 `PI_CONTEXT_OUTPUT_BUDGET_TOKENS` 供调参。
4. **顺序固定为"先擦除、后压缩"**：擦除与压缩同样断裂一次前缀缓存，但擦除**无 LLM 调用**，压缩要发一次全价摘要请求。
5. **压力分档改以压缩阈值为基准**：`setCompactThreshold` 此前从未被调用，分档一直按窗口算（1M 窗口下高档 850K），模型在 256K 压缩前收不到任何预警。现在 `before_agent_start` 写入阈值，`getBudgetReport` 用 `budgetBase`/`pressureRatio` 判定，`/context usage` 同时显示窗口占比与阈值占比。
6. **易变运行时提示移出 system prompt**：压力档/休眠工具摘要/重启提示改为 `my-pi-context-advice` 消息，**仅在内容变化时追加**（append-only）；system prompt 只保留静态常量，避免前缀最前处变化导致整段缓存失效（对齐 DSH 的 change-only volatile context）。
7. **归档目录加清理**：`tool-outputs` 此前无任何清理（实测 442 文件/2.8MB 无上限），新增 `sweepArchive`（14 天/200MB，递归两层），`session_start` 执行。
8. **截断改头+尾保留**：命令/测试的错误在尾部，`truncateHeadTail`（头 40%/尾 60%）替代只留头部。
**理由**：预计稳态上下文由 ~310K 降至 ~144K（**-53.6%**，用真实会话消息序列复刻两套擦除算法测得），且零额外 LLM 调用；不依赖上游补丁、不改动会话语义，是当前性价比最高的优化。
**仍待办**（见 [docs/development/CONTEXT-MANAGEMENT-COMPARISON.md](docs/development/CONTEXT-MANAGEMENT-COMPARISON.md)）：压缩摘要的暖前缀重放仍是死代码（补丁点已定位在 `core/sdk.ts` 的 `buildRequestOptions`，但需改 vendor 关键路径，收益已因擦除生效而下降）；subagent 缺 fork（KV 复用）模式；压缩阈值是否降到 150K 待观察。

### [2026-09-25] 长期维护基建：把"静默退化"变成"守门失败"
**背景**：审计发现本项目的主要风险不是设计，而是**缺少发现问题的手段**：① 死导出扫描出 **28 个无任何引用的导出**（context 的压力/紧急提示 API、watchdog 的 `isTurnBusy`/`isBackgroundBusy`、plan-mode 的 `replaceState`/`getNextId` 等），其中 `pruneThinkingBudget`（占上下文 50%）与 `setCompactThreshold` 都曾长期"有测试无调用"；② `check-features.sh` 的工具/命令清单是**手写**的，漂移过 18 个工具；③ `.github/` 已删且 `.git/config` 的 `core.hooksPath` 悬空过，**提交时守门实际失效**（`tsc` 曾红数日无人察觉）；④ 补丁只验证"可应用"，**语义漂移不会失败**；⑤ `vendor/pi` 无离线兜底，上游改写历史即无法引导；⑥ `footer.ts` 被 3 个补丁叠加，是最高漂移面。
**决策**：
1. **`check-dead-exports.mjs`**：扫描 `custom/` 导出符号的跨文件引用，零引用即失败；`dead-exports-allowlist.txt` 作为**棘轮**（登记历史死导出并写明理由，禁止新增）。只剥注释、不剥字符串/模板，宁可漏报不可误报。
2. **`gen-registrations.mjs` + `registration-baseline.json`**：注册面基线改由代码生成；`check-features.sh` 对照基线而非手写清单，变更需显式 `--update`（进 diff 可审）。
3. **`.githooks/` + `install-hooks.sh`**：`pre-commit` 跑 `golden --fast`（秒级结构守门），`pre-push` 跑全量（tsc+vitest）。本地无 CI，钩子是唯一自动防线；`golden-tasks.sh` 新增 `--fast`。
4. **`check-patches-behavior.mjs`**：断言补丁关键符号/自标记确实存在于 vendor 源码（004/005/006 用自带的 `Patch (…)` 标记，001/002/003 用显式符号表），补上"应用成功≠行为还在"的空缺。
5. **`vendor-bundle.sh`**：`create/restore/status` 归档 PINNED_COMMIT；bundle 体积大（实测 66MB）**不入库**（`.gitignore` 忽略 `vendor/*.bundle`，遵守"大文件不入库"教训），`doctor.sh` 增加"离线归档缺失"告警。
**理由**：这五项的收益都是"让问题在下一次显形"——把此前的静默退化（未接线、清单漂移、红状态入库、补丁漂移、上游不可达）转成守门失败或显式告警，且都不改变运行行为、风险低。

### [2026-09-25] 平台范围：Linux/Termux 为主，Windows 原生便携部署不再支持
**背景**：pi-tools 在 `portable/` 下提供 Windows 单目录便携部署：`start.ps1`/`start.bat`、`bin/*.ps1|.js`（setup/verify/diag/sync/update-*/check-*/repair-junctions/searxng-setup/whisper-setup）、`tools/tmux/tmux.cmd`、`ca-bundle.crt`。my-pi 把 `portable/` 改为运行时数据根目录（agentDir + memory），这些产物随之移除，但**此前没有任何决策记录**（只记了 Windows 原生 tmux 后端不迁移，见 `[2026-09-20]`）。
**决策**：
1. **支持范围**：Linux（含 Termux/Android，`scripts/patch-playwright-core.mjs` 做 playwright-core android 适配）与 macOS 为一等目标；Windows 仅经 **WSL2** 使用，不提供原生单目录便携启动。
2. **不携带 Windows 启动器/管理器**：仓库根只保留 POSIX 启动器 `my-pi.sh`（经 `scripts/pi-supervisor.sh`）；不维护 `.ps1`/`.bat`/`.cmd`（已核实主仓库除 `packs/` 外无此类文件）。
3. **保留的 Windows 感知**是有意的最小兼容：`features/link/net.ts` 的 WSL 检测（走 `ipconfig.exe` 取物理网卡 IP）、`features/voice` 的 Windows 录音分支判定（能力缺失时明确报错而非静默）。
4. **Windows 原生能力不再补齐**：dshow 录音、PowerShell 引导、原生 tmux 后端、`ca-bundle.crt`（Windows GIT_SSL_CAINFO）均不迁移；Windows 下如需自签 CA，配置系统级 `GIT_SSL_CAINFO`。
**理由**：单人维护 + 实测环境是 Linux/Termux，保留一条**未经测试**的 Windows 启动链路是负债（发布前无法验证、坏了无人知）。WSL2 覆盖 Windows 用户且只需维护一套启动器；把"不支持"写明，比留一堆半坏脚本更诚实。
**代价**：Windows 用户首次使用需自行装 WSL2 + Node ≥22；`my-pi.sh` 是 bash 脚本，不适用于原生 Windows shell。

### [2026-09-25] 语音服务脚本随仓库分发（修复迁移审计 G1）
**背景**：迁移审计把"语音 STT 服务脚本缺失"列为 P0：`config.ts` 的 `whisperScript`/`sherpaScript` 指向
`portable/memory/voice/pi-*.sh`，但该目录下**从来没有脚本**（pi-tools 把它们放在扩展目录、由 `rebuild.sh` 安装到 `~/.pi/scripts/`，
my-pi 没有对应安装步骤）。后果是 `voice_transcribe` 必然失败（会话日志有实证：`No such file or directory`），
而 `output-archive` 式的"能力缺失应显式报错"在这里退化成了路径错误。
**决策**：
1. 4 个脚本（`pi-whisper.sh` / `whisper-server.py` / `pi-sherpa.sh` / `pi-sherpa-server.py`）放在
   `custom/features/voice/scripts/`——对应 pi-tools 的扩展内位置，**随仓库分发，fresh checkout 即可用**，
   不再依赖安装步骤。
2. 路径按脚本自身位置解析：`PI_HOME` 由 `SCRIPT_DIR` 上溯 4 层得到仓库根；配置读 `<agentDir>/pi-voice.json`；
   日志/pid 落 `portable/memory/logs/voice/{whisper,sherpa}/`（`PI_VOICE_LOG_DIR` 只覆盖父目录，子目录固定，避免两个后端撞车）；
   `SERVER` 指向同目录的 `.py`；venv 仍可 `PI_WHISPER_VENV`/`PI_SHERPA_VENV` 覆盖。
3. `config.ts` 新增 `voiceScriptsDir()`，两个默认路径改指该目录；Python 服务端保持纯 env 驱动（无需改路径）。
4. `custom/.gitignore` 的 `scripts/` 规则**放行** `features/voice/scripts/`，并在 `check-features.sh` 增加
   "存在且未被 ignore" 的守门——这正是本次踩到的坑（文件放对了位置但被 ignore，fresh clone 仍会缺）。
**理由**：脚本是"运行 voice 功能所必需、但内容不随环境的资产"，与 `packs/` 同类，应入库；
把路径解析绑定到脚本自身位置，使目录重构不会再次悄悄失效。依赖（faster-whisper/sherpa-onnx 的 venv）仍属外部，由 `setup-external.sh whisper` 指引。
**验证**：脚本 `bash -n` / Python `py_compile` 通过；`pi-whisper.sh start` 在真实 venv 上启动成功，
`/health` 返回 `{"ok":true,"model":"base","device":"cpu"}`，随后 stop 恢复；新增回归测试断言默认路径存在且可执行。

### [2026-09-25] 补 G2 快照缺口 + G4 救援 playbook + 修 vitest 门抖动
**背景**：迁移审计剩余项里挑出三项确定性收益：① 手动 `/compact` 不产生快照（`snapshotBeforeCompact` 只挂在自动阈值路径，pi-tools 挂在 `session_before_compact` 覆盖所有压缩）；② rescue prompt 未迁移，`run_fix_pi` 只有 5 行内联指令；③ `golden-tasks.sh` 的 vitest 步骤**偶发假红**（`Projects "" and "" have different 'maxWorkers' but same 'sequence.groupOrder'` → `Test Files no tests / Errors 1`），而 pre-commit 依赖该门，假红会误拦提交。
**决策**：
1. **快照覆盖所有压缩**：`context` 注册 `session_before_compact` 钩子，手动 `/compact` 与 pi 内置溢出压缩都会落快照；用 `snapshotDoneForCompact` 标记避免与自动路径重复；`snapshotBeforeCompact` 的 `reason` 增加 `'manual'`。
2. **救援 playbook 入库并接线**：新增 `portable/agent/recovery/rescue-prompt.md`，按 my-pi 事实重写（`vendor/pi` 只读/改动走 `patches/`、好 pi 在 `recovery/cache/dist/cli.js`、`scripts/build.sh` 回退、`doctor.sh`+`golden --fast` 验证、`portable/memory/` 不可删、不提交）；`run_fix_pi` 存在该文件时以 `--append-system-prompt` 追加，`-p` 只留最短任务陈述。`.gitignore` 放行该文件（`recovery/` 下其余运行数据仍忽略）。未迁移 `rescue-config.json`——my-pi 直接引用固定路径，无需该配置。
3. **门抖动显式消除**：`vitest.config.ts` 固定 `name`/`maxWorkers`/`sequence.groupOrder`，使该内部断言不再触发；`check-features.sh` 把"随仓库分发的资源文件（4 个语音脚本 + rescue prompt）存在且未被 ignore"纳入守门。
**理由**：前两项补齐能力缺口（快照覆盖手动压缩、修复者拿到可操作 playbook）；第三项保证"守门可信"——一个会假红的 pre-commit 比没有守门更糟（会被习惯性 `--no-verify` 绕过）。
**验证**：vitest 连续 6/6 通过；`golden-tasks.sh` 连续 3/3 全绿（十项）；supervisor 测试 29 项（新增 rescue prompt 存在性与关键路径断言）；`tsc` 通过。

### [2026-09-25] headless 定时任务的能力边界：种子提示词只走脚本，不走扩展工具
**背景**：迁移审计 G5 追查 `daily-review` 提示词丢步骤时发现更深的问题：**定时任务的执行环境与交互会话不同**。
`custom/features/autopilot/run/runner.ts` 的 `buildRunArgs` 固定传 `--no-extensions`——因为带扩展的 `-p` 一次性运行
在本环境**不退出**（实测：`--no-extensions` 25s 干净退出 exit 0；带 `--extension` 60s 超时被 kill）。
pi-tools 依赖 `agentDir/extensions` 自动发现，my-pi 没有该目录，于是"提示词里可用扩展工具"这一前提**在 my-pi 不成立**：
`memory_store`、`/memory`、`tmux_*`、`ctx_*` 等在那次运行中根本不存在，任务只会静默失败或空转。
同时发现 pi-tools `pi-memory/scripts/memory-lifecycle.mjs`（237 行只读治理报告）**完全未迁移**，而 `daily-review`
的第 5 步正是靠它；my-pi 只有 `/memory lifecycle` 命令，在 headless 里同样不可用。
**决策**：
1. **headless 入口统一为脚本**：新增 `scripts/run-ts.sh`（以 vendor tsx 运行需加载 my-pi TS 逻辑的脚本——
   `custom/` 用无扩展名导入，`node scripts/*.mjs` 裸跑会报 `Cannot find module`）、`scripts/memory-store.mjs`（`storeEntry` 零 LLM 入库）、
   `scripts/memory-lifecycle.mjs`（`analyzeLifecycle` 只读报告，`--json`/`--limit`）。提示词只引用仓库内脚本。
2. **补齐生命周期治理信号**：`mine/lifecycle.ts` 增 `junkSuspects`（无实义内容/噪声标题）与 `aggregationCandidates`
   （同主题 solutions/procedure 聚类，组内 ≥3 且 Σrecurrence ≥8），并让垃圾嫌疑**不进升格候选**——
   这正是 pi-tools 2026-08-29 修过的缺陷，未迁移该脚本会让它复发。不迁移「空壳心跳」（无 `tools`/`hit` 字段）
   与「环境标签冲突」（`environments` 非标签集）。
3. **明确不迁移 Voyager 课程/workticket 提案步骤**：它依赖 pi-tools `SELF-OPTIMIZING-ROADMAP.md` 与运行时状态
   `~/.pi/logs/lesson-course.json`（两仓库均无此文件），提示词里写的落点 `docs/OPTIMIZATION-LOG.md` 在 pi-tools 里也是错的
   （实际为 `docs/maintenance/OPTIMIZATION-LOG.md`）。my-pi 用 `/memory mine` + `task-summarizer.mjs` + `packs/drafts/` 预留位替代。
4. **种子改版需显式应用**：autopilot 的种子对账是"只补缺失、不覆盖"（`store/seeds.ts`），改提示词不会传播到已注册任务；
   新增 `scripts/reseed-seeds.mjs`（默认预演，`--apply` 备份后写入，保留 id/enabled/lastRun/runCount/history）。
5. **守门**：新增 `scripts/check-seeds-headless.mjs` 扫描所有 `task.prompt`，命中扩展工具/斜杠命令即失败
   （放行"不要用 X"这类否定说明），接入 `golden-tasks.sh` 步骤 11——把这条隐性约束变成显式失败。
**理由**：任务失败的最坏形态是"看起来跑了"。把可用面收敛到"随仓库分发、可离线测试的脚本"，既让 headless 可靠，
也让提示词里的能力在 `--fast` 守门里可验证；顺带消除 LLM 手搓统计导致的结果不可复现。
**代价**：脚本是受限入口（没有记忆检索/思考能力），提示词只能表达确定性流程；需要判断的环节仍由任务内的 LLM 完成。

### [2026-09-25] 通知与入站通道：出站用 webhook、入站用 link（不迁移 notify.json / ntfy-relay）
**背景**：迁移审计 G6 指出 pi-tools 的两类配置在 my-pi 无对应物：① `agent/notify.example.json`——模板命令通道
（Bark/ServerChan 各一条 `curl` 模板 + `rateLimitMinutes` 去重 + 静默失败），由 `pi-autopilot/scripts/pi-notify.sh` 驱动；
② `agent/ntfy-relay.json`（`{"injectMode":"rpc"}`）+ `ntfy-relay.js/.sh`——手机 ntfy app → 订阅轮询 → 注入本机
（`rpc` 模式是 tmux 故障时的兜底远控）。
**决策**：两者均**不迁移**，由既有能力取代：
1. **出站**：`autopilot/store/webhook.ts`（`PI_SCHEDULER_WEBHOOK` 优先，其次 `settings.json` 的 `webhookUrl`）在任务完成时
   POST JSON（`task/type/schedule/result/time/output`，output 截断 1000 字符，10s 超时，失败静默）。
   Bark/ServerChan/ntfy 都提供 HTTP 端点，直接填 webhook URL 即可；不再支持"任意 shell 模板"这一**注入面**，
   也不需要 my-pi 侧实现去重（去重属推送服务的职责）。
2. **入站**：`link` 功能（`link_send` 工具 + `/link send|status|watch|inbox|attach`，SSH 传输层 + 跨进程文件锁 + 并发/去重防抖）
   覆盖"手机/另一台设备远程给 pi 下指令"的场景，且**不依赖第三方中继**；`/link attach` 可在 tmux 之外接入会话，
   正是 `injectMode: rpc` 想解决的 tmux 故障场景。
**理由**：两项取代都减少了面（少一个 shell 模板通道、少一个常驻轮询守护进程与第三方主题密钥），能力不减；
`notify.json`/`ntfy-relay.json` 含 token/topic（等同密钥），不进仓库反而是好事。
**代价**：需要"同一通知发多个渠道"时要靠服务端转发或自建 webhook 汇聚；link 需先配置设备清单与 SSH 凭据。

### [2026-09-25] 不信任 dirent 的 d_type：守门与目录遍历一律以 stat 为准
**背景**：文档校订时发现 `check-doc-links.mjs` 只扫到 **79 篇** md，而树内实际有 **88 篇**。
根因是 `readdirSync(dir, { withFileTypes: true })` 返回的 `Dirent` 在本环境的文件系统（overlayfs/沙箱）上
**d_type 不可靠**：新建的普通文件被报成 `DT_LNK`——`isFile()` 与 `isDirectory()` 都为 `false`，
`isSymbolicLink()` 为 `true`，而 `lstat` 明确显示是普通文件。依赖这些标志的遍历会**静默跳过**这些文件：
当时被漏掉的有 `portable/agent/recovery/rescue-prompt.md`、`docs/operations/alacritty-tmux-setup.md`、
4 篇技能文档与 2 篇新增 README（`autopilot/tools/`、`voice/tts/`）。
**影响面**（审查后确认）：
- `check-doc-links.mjs`：**已在漏扫**（链接失效不会被发现）。
- `check-dead-exports.mjs` / `gen-registrations.mjs` / `check-patches-behavior.mjs`：同类写法，当前恰好没有
  受影响文件，但一旦命中即**守门假绿**（死导出漏报、注册面漏登记、补丁行为标记漏检）。
- `context/budget/output-archive.ts` 的 `sweepArchive`：被误报的归档文件**永远不会被清理**（磁盘只增不减）。
- `plan-mode/core/plans.ts` 的 `listPlans`、`subagent/core/agents.ts` 的角色发现：会静默丢失计划/角色。
**决策**：凡需要判断"是文件还是目录"，**以 `statSync`/`stat` 为权威**（跟随符号链接），
不依赖 `Dirent.isFile()/isDirectory()/isSymbolicLink()`；`Dirent` 只用于取名字。
- 守门脚本：新增本地 `entryKind(full)` 辅助（`statSync` → `'dir' | 'file' | 'other'`），四个 walker 全部改用它。
- 运行时：`sweepArchive` 的收集、`listPlans`、`loadAgentsFromDir` 同样改为 `stat` 判定。
**理由**：这些都是"看起来在工作"的静默失效——守门漏扫比守门不存在更危险（会给出虚假安全感），
归档不清理则是慢性的资源泄漏。用一次 `stat` 换取确定性，代价可忽略（遍历规模都是几百个条目）。
**验证**：`check-doc-links.mjs` 扫描数 79 → **88**（全绿，新文档链接有效）；`tsc` 通过；vitest **44 文件 514 用例**；
`golden-tasks.sh` 全绿。

### [2026-09-25] 移除 wechatide-skill 与 repo-size-audit 两个技能包
**背景**：`packs/` 原本整目录迁移 pi-tools 的 16 个技能包（863 文件，逐字节一致）。复核后确认其中两个对本项目无实用价值：
① `wechatide-skill`（微信开发者工具，27 文件）——通过官方 `wechatide` CLI 驱动 IDE，而该 CLI 只在 **Windows/macOS** 侧运行
（WSL 需 interop），本项目一等目标是 Linux/Termux；且只服务微信小程序/小游戏场景；
② `repo-size-audit`（1 文件）——「git 仓库体积审计」的能力已由 `scripts/doctor.sh`（vendor/dist/缓存/离线归档体检）
与 `git count-objects -vH` 直接覆盖，且该技能收尾要求把结论 `memory_store` 入库，在 headless 与「执行-知识分离」约定下都不合适。
**决策**：
1. 删除两个包目录（共 28 个文件），`packs/` 收敛为 **13 个技能包 + `drafts/`**（837 个跟踪文件）。
2. `packs/INDEX.md`、`packs/README.md` 同步移除条目；顺带修正 README 中被误置于末尾的两行表格
   （`repo-size-audit`/`skill-integration`），并把 `skill-integration` 正式列入「当前包」。
3. **删除不改变其余包**：`diff -rq` 反向验证除有意编辑文件外与 pi-tools 逐字节一致，保留"外部包可重新拉取比对"的能力。
**理由**：packs 是**按需读取**的仓库（不注入提示词，只占磁盘与检索成本），但仍应只留真正会用到的能力——
依赖不可用平台（微信 CLI）与已被自有脚本覆盖（体积审计）的包，只会稀释索引、误导后续选择。
**替代**：仓库体积/卫生检查用 `bash scripts/doctor.sh`、`git count-objects -vH`、`.gitignore` 纪律；
如需重新引入，从 pi-tools `packs/` 目录取回即可（git 历史亦保留本次删除）。

### [2026-09-26] 每轮历史擦除默认关闭（缓存计费下的成本反转）
**背景**：用户报告 my-pi 的 API 消耗与 DSH 相比"明显不正常"（本机后台 ¥8.04 / 544 请求 / 42.3M tokens，
DSH ¥18.01 / 1765 请求 / 472.9M tokens）。用本机会话记录复原真实调用序列后定位到：单个真实会话
（`2026-09-26T11-31-12`，105 请求、约 250K 上下文、自动压缩 1 次）计费 $0.645，其中 **16 个请求**
的输入缓存命中率 < 50%，它们贡献了 **$0.481（75%）**；若这些请求按正常命中率计费，只需 $0.048。
离线重放这些请求（把真实会话喂给 `pruneToolResults`/`pruneThinkingBudget`，逐条比对相邻请求变换后的消息序列）
证明：`context` 钩子每轮都从未改写的历史重算擦除计划，而擦除边界随会话增长前移，
于是**每轮**请求都在一个更靠后的位置与上一轮分叉 → 其后 190K–250K token 全价重发（单次约 $0.03）。
**选项**：
1. 保留现状（擦除省 token 数量，TUI 的 `Σ` 好看）
2. 提高擦除阈值（少擦几次，但每次仍要付一次全量重算）
3. 只在压缩时擦除（压缩本就要重建前缀）
4. 每轮擦除默认关闭，`PI_CONTEXT_ERASE=on` 保留旧行为
**决策**：选项 4，并在 `budget/task-gate.ts` 写明盈亏平衡推导。
**理由**：缓存命中价是未命中价的 1/50（$0.003 vs $0.15 每 M）。擦除 F token 每请求只省
`F×0.003/M`，断裂一次却付 `S×0.15/M`（S≈上下文长度）→ 回本需 `49×S/F` 次后续请求
（S=200K、F=10K → 约 1000 次），真实会话不可达。**在缓存计费下，"减少 token 数量"与"降低费用"
是两个目标**：擦除改善前者、恶化后者。回收上下文交给压缩（一次全价摘要 + 前缀重建）。
无前缀缓存的 provider（本地 llama 等）仍可用环境变量恢复。
**验证**：`tsc` 通过；vitest 48 文件 565 用例全绿（新增 `PER_TURN_ERASE` 三例）；
`bash scripts/golden-tasks.sh --fast` 全绿；离线重放脚本见 `docs/development/CONTEXT-MANAGEMENT-COMPARISON.md`。

### [2026-09-26] 重启续接参数跨轮保留 + 重启通知注入（对齐 pi-tools）
**背景**：用户报告"模型调用重启工具后回不到之前的会话，重启后也没有自动注入重启信息"。
排查确认两处迁移缺口：
① `scripts/pi-supervisor.sh` 主循环在**每轮开头**执行 `EXTRA_ARGS=()` 重置，而重启/切换会话分支
是在**轮末**把 `--session`/`--continue` 写入 `EXTRA_ARGS` 后 `continue` → 下一轮开头被清空，
pi 永远以空参启动（新建会话）。原项目 `pi-wrapper.sh` 是在启动前同一处重置+赋值，故无此问题。
② `consumeRestartLog()` 在 my-pi 里**只有定义没有调用**（pi-tools 在 `session_start` 消费并注入
"系统已重启。操作: … | 原因: …"），所以即使续接成功，模型也无从得知进程重启过。
**决策**：
1. 主循环改为 `EXTRA_ARGS=("${PENDING_ARGS[@]}")` 后立即清空 `PENDING_ARGS`，各分支写入 `PENDING_ARGS`；
   参数映射抽成纯函数 `build_admin_args`（`ADMIN_ARGS` 全局数组）。
2. `custom/features/autopilot/index.ts` 的 `session_start` 消费 `consumeRestartLog()`，`ctx.ui.notify` +
   `sendUserMessage` 注入恢复提示（仅交互会话消费，避免 headless `-p` 子进程抢先吃掉）。
3. supervisor 增加 `MY_PI_CLI` / `MY_PI_AGENT_DIR` 覆盖点，供端到端回归测试用 stub CLI 跑**真实主循环**。
**理由**：这是"功能看起来在工作（重启确实发生了）但契约断裂"的静默失效——必须由测试锁死：
`test-supervisor.sh` 新增 9 例 `build_admin_args` 单测 + 6 例端到端断言（去掉修复后第 2 轮启动
确实丢失 `--session`，已验证测试会失败）。
**验证**：`bash scripts/test-supervisor.sh` 44 项通过（原 29 项）；`tsc` 通过；vitest 全绿
（新增 `restart-log.test.ts` 4 例，覆盖 supervisor 清 action 后 restartLog 仍可消费的跨语言契约）。

### [2026-09-26] 关闭工具按需加载，全部工具常驻
**背景**：承接同日"每轮历史擦除默认关闭"。工具 schema 位于请求**最前处**，`enable_tool` 一改
工具列表就让整段前缀缓存失效。实测 `2026-09-26T11-31-12` 会话：3 次工具集变化（11:50 启用组、
12:41 启用组、12:52 重启后重新启用）分别造成 $0.0107、$0.0361、$0.0382+$0.0370 的冷缓存请求；
且启用状态是**进程内存态**，重启即复位，等于每次重启都要再付一次。
**选项**：
1. 保持休眠分层（省 schema token，但每会话付 1–3 次整段重算）
2. 关闭按需加载，全部工具常驻
3. 常驻但保留 enable_tool 供极端场景
**决策**：选项 2+3：`applyToolLayering` 默认下发全部工具（`TOOL_LAYERING=off`），
`enable_tool` 保留注册但为无操作、`/tools` 汇报"全部常驻"，`PI_CONTEXT_TOOL_LAYERING=on`
可恢复旧行为。休眠组摘要不再注入易变提示（否则会误导模型去 enable）。
**理由**：这是一次**成本口径反转**——分层优化的是"token 数量"，而按 1/50 的命中价计费，
常驻 schema 的开销几乎为零：保守上限（休眠 schema 20K token、上下文 250K、100 请求）
常驻成本 ≈ 20K×0.003/M×100 = **$0.006**，而一次中途 enable 就是 250K×0.15/M = **$0.0375**，
即一次 enable 就抵消整场会话的常驻成本（约 6 倍）。此外还消除了"忘了启用导致功能不可用"的失败模式。
**验证**：tsc 通过；vitest 全绿（新增 `effectiveActiveTools` 4 例、`TOOL_LAYERING` 3 例）；
`check-injection-surface.sh --update` 刷新（AGENTS.md 的 `web_fetch` 说明不再要求 enable）；
`golden-tasks.sh` 全量通过。

### [2026-09-29] 浏览器接入通道选 pty + xterm.js，不移植 DSH WebUI
**背景**：需求是"能远程/移动端用 my-pi"。同时评估了"把 DSH 的 WebUI 移植过来"。先把 DSH 那套
量清楚（源码 MIT、公开，npm 包可读未压缩）：dist 4.71 MB + 55 个 `dsh-client-*` 浏览器插件
10.6 MB ≈ **15.3 MB 资产**；宿主侧是 **140 包闭包**（宿主半 ~50K 行），域契约含 ~45 个 RPC 方法、
56 个会话事件类型、20+ 投影键；浏览器对每个结果用**生成的 strict zod codec** 解码。关键的是
WebUI **不是自包含应用**：`/plugins/??…&rev=…` 组合包路由与 `window.__DSH_BOOT__` 启动图全部由宿主
进程产出，且 `assertEntriesActive` 会让任一行 bundle 缺失或 `inject` 服务无人提供时**整页失败**
（实测：起静态服务器 + headless Chromium 加载原始 dist，唯一报错是
`web boot: window.__ModuleLoader__ bootstrap facade is missing`，随后只有失败卡，不重试、无降级）。
**选项**：
1. 移植 DSH 前端（C1 最小 17 包闭包 / C2 全量 53 行 roster + 全部 remotes）
2. 自建 Web GUI，跑在 pi 的 `--mode rpc` 上（33 命令 + 9 个扩展 UI 方法，双向 JSONL，官方支持接口）
3. pty + xterm.js：服务在 pty 里拉起**原样的 TUI**，浏览器接管该终端
4. 反向平台化：把 pi 接成 DSH 的 agent 后端，或把 my-pi 改写成 cordis 插件
**决策**：选项 3（`custom/web-terminal/`）。选项 2 保留为"要 GUI 质感而非终端质感"时的后续路径。
**理由**：
- 需求是"远程能用 my-pi"，不是"要 DSH 那套界面"。选项 1 要 1–2 个月换来一个 DSH 界面，而 my-pi 的
  12 个功能里 context 成本仪表、记忆注入、autopilot 会话管理、plan-mode、tmux 在 DSH 界面里**没有槽位**，
  仍要另写 UI；选项 4 等于放弃 my-pi 身份（全部 hook 重写成 cordis 插件）。
- 选项 3 的保真度是 100%：跑的就是同一个 TUI，没有第二套渲染路径、没有契约翻译层，因此不存在
  "DSH 升版即碎"的维护面。接线量为零架构债——它是独立进程，不碰 `features/`，也不需要 Pi 扩展。
- 这正是"少一层抽象"的判断：`--mode rpc` 方案（选项 2）虽有现成 `RpcClient`，但要重写 127 处
  `ctx.ui` 的渲染语义；而 pty 方案把它们原样带给浏览器。
**实现要点（两条硬结论都来自实测）**：
- **不用 node-pty**：Node 无分配 pty 的 API，而 node-pty 需本地编译（平台范围含 Termux/PRoot）。改用
  util-linux `script(1)` 分配 pty；prelude 把 tty 路径写进临时文件并设置初始行列，之后改尺寸用
  `stty -F <pts> rows R cols C`——实测内核会对该 pty 前台进程组发 SIGWINCH，TUI 随之重绘
  （初始 0×0 → 28×90 → 外部改 50×132 全部生效）。
- **鉴权对齐 dsh-client-connection**：进程级随机 token 随 URL 打印 → `GET /?token=` 换 HMAC-SHA256
  签名 cookie（`v1.<payload>.<mac>`，`HttpOnly; SameSite=Strict; Path=/`，按 authority 摘要命名）
  → 每请求过 Host/Origin 栅栏。**只绑 127.0.0.1**：cookie 刻意不带 `Secure`（回环 HTTP 下浏览器会
  丢弃带 Secure 的 cookie），故不得暴露到非回环网络；远程走 SSH 隧道。
**验证**：vitest 56 文件 621 用例全绿（新增 4 文件 33 例，含真实 pty 的 resize/SIGWINCH 集成测试）；
新增 `scripts/test-web-terminal.mjs` 22 项进程级守门并接入 `golden-tasks.sh` 第 12 步（鉴权/cookie
属性/穿越防护/Host 栅栏/方法限制/WS 双向数据/resize/未授权升级拒绝/restart，零 LLM 消耗）；
`golden-tasks.sh` 全量通过；真实 my-pi TUI 经此通道在 headless Chromium 中渲染成功（截图确认）。

### [2026-09-29] xterm 锁 5.5.0：v6 移除了滚动占位元素，移动端滑不动
**背景**：浏览器终端上线后用户反馈"滑动屏幕不顺畅"。先在真实触摸事件下量清楚，而不是按现象猜。
**诊断**（每一步都做了可证伪的实验）：
1. 先怀疑是自家接线：滚动时反复 `fit()`／`visualViewport` 抖动。装上探针后测得滚动期间
   `resize` 帧为 0、静置重绘约 7 次/秒，**排除**。
2. 再看 DOM：`.xterm-viewport` 的 `scrollHeight === clientHeight`（806/806），且
   `.xterm-scroll-area` 不存在、viewport 子元素数为 0 —— **根本没有可滚动区域**。
3. 隔离到纯 xterm 页面（不带本项目 CSS/JS）复现同样结果；换 5.5.0 则 `scrollHeight` 7014 /
   `clientHeight` 476、`.xterm-scroll-area` 存在。确认是 xterm 版本差异，不是本项目接线。
4. 排除测量手段本身的假象：`Input.synthesizeScrollGesture` 走合成器识别，**绕过**页面触摸监听
   （在朴素可滚动 div 上也测不出滚动），故改用 `Input.dispatchTouchEvent` 逐帧投递真实触摸事件。
5. 最终判据（原始触摸序列：touchStart → 14×touchMove → touchEnd）：6.0.0 `scrollTop` 恒 0、
   缓冲区不动；5.5.0 `scrollTop` 4900 → 4840、首行前移。**触摸滚动在 v6 上完全无效。**
**决策**：`@xterm/xterm` 锁 `5.5.0`、`@xterm/addon-fit` 锁 `0.10.0`（5.x 兼容线）。
**理由**：v6 没有滚动占位元素 → 浏览器侧不存在可滚动区域 → 触摸滑动没有作用对象，回滚只存在于
xterm 内部 buffer，只能靠它自己的手势模拟（移动端实测无效）。5.x 保留占位元素，走原生滚动，
手机上是系统级惯性滑动——"顺畅"这件事上没有比原生更好的实现。社区亦有项目因同类问题从 v6 回退
5.5.0。
**代价与约束**：放弃 v6 的改动；升级 xterm 前必须复验 `/assets/xterm.js` 里仍能搜到
`xterm-scroll-area`（`scripts/test-web-terminal.mjs` 不覆盖滚动，故写进 README 提醒）。
**验证**：真实应用（第二实例）触摸下滑后首行 350 → 348 再滑回；`tsc` 通过；
`scripts/test-web-terminal.mjs` 22 项通过。

---

### [2026-10-01] footer 第一行的常驻模式标识：`badge:` 前缀（vendor 补丁 009）
**背景**：进入计划模式后，edit/write/非只读 bash 全部被拦截，但 TUI 底部**没有任何标识**。用户只能靠记忆或主动跑 `/plan status` 判断自己在不在这个模式里——而"误以为有写权限"的代价是白跑一轮，反过来误以为只读会不敢动手。
**现状约束**：footer 第一行是硬编码的 `pwd (branch) • sessionName`（`footer.ts` 的 render 里字符串拼接），扩展**没有任何入口**能写进去；扩展的 `ctx.ui.setStatus(key, text)` 全部落到第三行状态行（按 key 排序、可被其它状态挤占），只有 `tps` 被补丁 005 特判进了第二行 stats 行。
**选项**：
1. 用第三行状态行（纯 custom，零 vendor 改动）
2. 新增 vendor 补丁，把特定 key 的状态渲染到第一行
3. 扩展自建 `setFooter()` 自定义 footer 组件，完全接管三行
**决策**：选项 2，且做成**通用前缀约定**（key 以 `badge:` 开头）而非计划模式白名单；消费方是 `plan-mode` 的 `badge:plan`。
**理由**：
- 选项 1 不满足需求（用户明确要求"第一行、`~/my-pi (main)` 旁边"），而且第三行本来就拥挤；
- 选项 3 要复刻 usage 汇总、上下文百分比、着色、模型右对齐等全部逻辑，之后每次上游改 footer 都会形成**无补丁可依的分叉**，维护成本远高于一个 30 行的补丁；
- 前缀约定让后续模式（roleplay 等）零改动复用，且不改变其它 key 的现有行为（`tps` 特判、其余走第三行）；
- `applyPlanMode()` 已是计划模式状态的**唯一变更出口**，标识同步挂在这里就不会出现"改了一处漏一处"（`/plan enter|exit`、`Ctrl+Alt+P`、模型 `plan_enter/plan_exit`、`/plan resume` 全覆盖）；`/plan resume` 里那处直接赋值 `planModeEnabled = false` 也一并收口。
**代价与约束**：需要重建 vendor dist 才生效；补丁与 004–009 同改 `footer.ts`，上游动这个文件时维护成本叠加（`check-upstream.sh` 会先报出来）。badge 段必须放在 `theme.fg("dim", pwd)` **之后**单独着色——反过来拼进 pwd 再整体 dim，高亮会被一起吃掉（补丁注释里写了）。
**验证**：`npx tsc --noEmit -p custom/` 通过；`check-patches-behavior.mjs` 靠 `Patch (009-footer-badge)` 自标记断言行为存在；`scripts/golden-tasks.sh` 全绿。

---

### [2026-10-01] 每日任务用独立 `/daily` 命令，而不是给 `/schedule` 加子命令
**背景**：用户要"查看每日任务的情况：有哪些、执行情况、关闭/开启"。现有 `/schedule list` 只输出一行原始信息（`● 名 [cron:…] next=… runs=… last=success`），没有今日进度、没有失败数、没有一键全开关；用户也不知道"每日任务"就是 `tags` 含 `daily` 的调度任务。
**选项**：
1. 什么都不加，只补文档讲清 `/schedule list` 的用法
2. 给 `/schedule` 加 `daily`/`overview` 子命令
3. 新增独立 `/daily` 命令
**决策**：选项 3。
**理由**：
- 选项 1 不解决"执行情况"——`fmtTask` 里没有 `failCount`/上次执行时间/今日完成数，补文档变不出来；
- 选项 2 会让 `/schedule` 的子命令从 10 个涨到 12 个，而两者的读者意图不同：`/schedule` 是**管理**（增删改查 cron），`/daily` 是**巡检**（今天跑到哪了、有没有失败）——分开后各自的 help 都能一眼看完；
- 渲染逻辑独立成 `custom/features/autopilot/daily.ts`（纯函数、零 Pi 依赖），命令层只做筛选与派发，符合本仓库"逻辑层零 Pi 依赖"的分层。
**口径约定**（写进 README，因为这几点错了就会误导排查方向）：
- 无任何 `daily` 标签时**降级显示全部调度任务**并在标题里说明，避免用户自建的 cron 任务"凭空消失"；
- 今日完成/失败按 `lastRun` 的**本地日期**判定（cron 的自然日语义），昨天的成功不计入今天；
- cron 只在 `M H * * *` 时显示 `HH:MM`，含步进/区间/星期限定则原样显示表达式（`cronClock` 返回 null，不硬猜）；
- `on` 只改 `enabled`、**不重算 `nextRun`**：已错过的触发点会在下一轮立即补跑（与 `/schedule enable` 一致）。
**验证**：`__tests__/daily.test.ts` 17 例（筛选/降级、cron 边界、今日口径、失败提示、详情渲染）；
`gen-registrations.mjs --update` 刷新注册面基线（命令 11 → 12）。

---

### [2026-10-01] 上游更新前必须体检；不想要的变更**不回退基线，而是加补丁**
**背景**：2026-09-30 把 vendored pi 从 v0.87.0 一次跳到 v0.99.1（130 提交 / 744 文件 / +90664-24881），**同步后**才发现默认主题改了 `system`、工具链换成 TS7 + ES2024、多了 `mcp`/`codemode` 两个包、`--no-extensions` 语义变成"连内置扩展一起禁用"。这些变化 `git apply` 不报错、`tsc` 也不报错，只有人事后看 changelog 才知道。用户随即提出两个问题：以后更新前怎么先看变化？上游出现不需要/不喜欢的变更怎么办？
**选项**：
1. 维持现状（同步后靠人读 changelog）
2. 同步前跑一次只读体检，给出"可同步 / 需先改补丁"的结论
3. 只写文档流程，每次手工敲 `git diff` / `git log`
**决策**：选项 2 —— 新增 `scripts/check-upstream.sh`（只读），并把决策与补丁策略写成 `docs/operations/UPSTREAM-UPDATE.md`。
**理由**：
- 体检能自动化的部分恰好是**最费人力的部分**：各包 churn 排行、新增包、逐个补丁的"目标文件是否被上游改过"、adapters 依赖的 API 面是否变动。这些用 30 行 `git diff --name-only` 就能算出来，但要人肉做一遍得十几分钟且容易漏；
- 结论必须可执行（`已最新` / `可同步` / `需先改补丁`），而不是又输出一堆 diff 让人自己判断；`PI_CHECK_STRICT=1` 时风险即 `exit 2`，将来可以直接挂进钩子；
- 补丁风险用**提交历史**判定（`vendor_patch_applied` 语义）而非 `git apply --reverse --check`：004–009 全改 `footer.ts`，顺序叠加后单片反查会假失败——这是仓库里已经踩过的坑。
**"不想要的变更"的四档手段**（写进文档，按代价递增）：① 用配置/环境变量关掉 → ② 补丁改默认值 → ③ 补丁删入口/整段 revert → ④ `sync-upstream.sh <commit>` 跳过整版。硬约束：不手改 vendor 工作树（会被同步冲掉）、不手写 `LAST_SYNC_POINT`/`PINNED_COMMIT`（会导致引导基线与补丁不同源）、每条不接受的上游变更都要在本文件留一条记录（否则半年后没人知道那个补丁为什么存在）。
**顺带的实测收获**：脚本首次真跑就发现上游已到 `v0.99.2`（+40 提交 / 217 文件），且**本地 9 个补丁的目标文件全部未被上游改动**（只有 `002` 的 `config.ts` 变了），API 符号一个没少——即"补丁风险 1 个"，是一次低风险升级。这正说明体检的价值：不必读 40 条 changelog 就知道成本落在哪。
**验证**：离线路径（`PI_CHECK_NO_FETCH=1` + 指定旧 tag，验证反向告警与失配检测）、在线路径（fetch 到 v0.99.2）均实跑；逐符号 API 核对修掉了两个假阳性（`as` 别名取错侧）。

---

### [2026-10-01] tsx 由 my-pi 自己声明，不再借 vendor/pi 的依赖
**背景**：`scripts/run-ts.sh` 此前从 `$ROOT/vendor/pi/node_modules/.bin/tsx` 取 tsx（`custom/` 的 TS 用无扩展名导入，Node 内置类型剥离解析不了，必须走 tsx；headless 的 `memory-store.mjs`/`knowledge-ingest.mjs`/`memory-lifecycle.mjs` 全走这里）。上游 v0.99.0 改用 Node 内置类型剥离，**删除了 `tsx` 依赖**；查证本地 `vendor/pi/package-lock.json` 已无任何 `tsx` 条目、`vendor/pi/package.json` 也不再声明它——本地那份 `4.23.15` 纯粹是升级前的残留。由于 `build.sh` 只在 `deps_ok` 判定需要时才跑 `npm ci`，残留会一直在，**故障只在换机 / 重新引导 / `npm ci` 之后才暴露**，表现为 autopilot 的 `daily-review`、`knowledge-subscribe` 静默失败。
**选项**：
1. 维持现状（继续祈祷 vendor 的 node_modules 不被动）
2. 把 `tsx` 加进 my-pi 自己的依赖（`custom/package.json`），从根 `node_modules` 取，vendor 那份仅作兜底
3. 放弃 tsx，改写 `custom/` 的导入为带扩展名的 ESM，用 Node 内置类型剥离
**决策**：选项 2。
**理由**：
- 选项 1 是隐性依赖：我们借的是**上游的 devDependency**，而上游没有任何义务替我们保留它——本次就是活例；
- 选项 3 看似更干净，但要改动整个 `custom/` 的导入风格（几百处 `from './x'`），且 pi 自身用 jiti 加载扩展、不受 Node 剥离规则约束，改了只有坏处；
- 选项 2 把工具链归属说清楚：my-pi 运行自己的 TS 逻辑，就自己声明运行器；`custom/package.json` 是唯一工作区依赖出口，`npm install` 会提升到根 `node_modules/.bin/tsx`。
**代价与约束**：`package-lock.json` 增加 tsx + esbuild 及其 26 个平台可选包（约 480 行）；`run-ts.sh` 保留"根 → vendor 残留 → npx"三级回退，但后两级都会打印显式告警，避免再次出现"看起来能用"。
**验证**：`bash scripts/run-ts.sh scripts/memory-lifecycle.mjs --limit 1` 正常输出（走根 tsx）；`doctor.sh --no-net` 依赖检查通过。

---

### [2026-10-01] 模式：`current` 移出入库文件，切换改为自动重启
**背景**：用户报告"用 `/mode` 切到角色扮演，重启后没生效"。逐条核查后确认**机制没问题**：supervisor 的模式解析（`--append-system-prompt` + `PI_MEMORY_NAMESPACE`）用临时 agent 目录实测正确，`bootstrap.ts` 也按同一文件过滤功能。真正的问题在数据落点——`current`（当前模式）被写在**入库**的 `portable/agent/modes.json` 里（`.gitignore` 用 `!portable/agent/modes.json` 特意放行），于是切模式只是把入库文件改脏，**任何 git 操作（checkout/stash/restore/pull，含另一台设备的版本）都会把它静默退回 `full`**。旁证两条：该文件现在是 `full` 且工作区干净；`portable/memory/` 下从来没有过 `roleplay/` 命名空间目录。顺带发现第二处缺陷：模式应用逻辑只写在 `pi-supervisor.sh` 里，`scripts/dev.sh` 直接 exec pi，**静默不注入人设**。
**选项**：
1. 维持现状（继续把运行时选择放进库文件）
2. `current` 移到 gitignored 的 `modes-state.json`，并对 `/mode` 切换加自动重启 + 启动一致性校验
3. 改做热重载（`/reload`）切模式，不重启进程
**决策**：选项 2；热重载明确不做默认路径，只留路口。
**理由**：
- 选项 1 的问题不是洁癖：**每次切模式都会让工作区变脏**，而这在一个"频繁 commit/push、还有多设备"的仓库里必然被某次 git 操作回退；同一类错误上一轮已经出现过一次（上游新增的 `deviceId` 会写进入库的 `settings.json`）。原则统一为：**运行时/每环境状态不入库**。
- 选项 3 的可行性我查实了：`/reload` 会走 `session.reload()` → `resourceLoader.reload()` → `clearExtensionCache()`（`loader.ts:131-141`），扩展工厂确实会重跑，**功能白名单这一层可热切**。但另外三件不行或不该：① 人设是 CLI 启动参数 `--append-system-prompt`，扩展 API 只有只读的 `getSystemPrompt()`；热切必须改用 `context_with_system` 自行拼 system prompt；② 记忆命名空间热切会让同一会话前半段写 full、后半段写 roleplay，而历史里已注入的记忆块还是旧命名空间的，破坏记忆治理（VISION §5）与执行-知识分离（§3.4）；③ **热重载在缓存上没有收益**——模式切换必然改变工具数组，无论重启还是 reload，下一轮整段前缀都按全价重算。省下的只是"进程/pty/scrollback 重建"的体验，却要额外处理半切换状态与 `session_start(reason: reload)` 下各钩子的幂等性。
- 而重启的成本极低：复用**既有**的 admin restart 通道（`writeRestartRequest('restart', { targetSession })` + `ctx.shutdown()`），supervisor 用 `--session` 精确续接，这条路已有 44 项测试兜底。
**代价与约束**：
- config/state 分离带来的迁移：`modes.json` 里遗留的 `current` 仍被识别（`normalizeModesFile` 处理），新写入一律进 `modes-state.json`；已把入库文件的 `current` 字段删除。
- 顺带修好了"热重载切模式此前不成立"的隐性原因：`bootstrap` 会把解析结果回写 `PI_AGENT_MODE`，而 `resolveEffectiveMode()` 又优先读它，于是 `/reload` 重跑时永远读到上一次的旧值。现在由 `PI_AGENT_MODE_SOURCE`（`env`/`file`）区分"外部注入"与"自己回写"，只有前者才优先。
- 模式应用逻辑抽到 `scripts/lib-mode.sh`，`pi-supervisor.sh` 与 `dev.sh` 共用——入口漂移（dev 无人设）一并修掉。
**验证**：新增 26 例 vitest（含"切模式**不得**改动 modes.json"的回归断言、旧格式迁移、来源区分、自动重启接线、一致性告警）；`test-supervisor.sh` 44 → **54 项**（新增 apply_mode 的 bash 侧契约：状态文件优先、旧格式兼容、人设缺文件不注入、外部 env 覆盖优先）；`tsc` 与全量 golden 通过。runtime 实测 `lib-mode.sh`：无状态 → `full`；写 `{"current":"roleplay"}` → 模式/命名空间/人设绝对路径三者齐备。
