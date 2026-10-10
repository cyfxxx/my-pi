# 知识索引（离线编译产物，供人审阅）

> 由 `node scripts/knowledge-compile.mjs --update` 生成；`--check` 用于防漂移。
> **写入判据来自 WikiSkill 附录 E.2**：新建用 `create_patterns`、**不建重复而用新证据更新既有页**、
> **索引总是整份重写**（论文提示词明说"索引是最重要的部分"——它决定下游是否会去读全文）。
> 每页四件事：是什么 / 根因 / **确切命令序列** / **含确切语法的解法**；篇幅 **10–30 行**；只记可泛化的。
> **本产物不自动进模型上下文、不改任何运行时行为**，只供人审阅。

## 失败模式（16 条，来源：`docs/BUG-REPLAYS.md`）

- [bug-001](patterns/bug-001.md): 切了模式、重启后没生效 + `modes.json` 里的全局 `current` 被任何 git 操作（checkout/stash/pull）静默退回 `full` + `check-conventions`（状态不入库）+ 状态体检 `modes-legacy-current`；模式状态已迁到 gitignored 的 `modes-sessions.json`
- [bug-002](patterns/bug-002.md): 模式解析"第 3 轮工厂执行后漂回 full" + `PI_AGENT_MODE_SOURCE` 从 `file` 被翻成 `env`，此后把首轮值当外部注入钉死 + `mode-switch.test.ts` 的三轮回归 + `resolveStartupMode()` 单一写入点
- [bug-003](patterns/bug-003.md): 切模式/切回角色扮演会话时**进程直接退出**、模式没换、还注入了一条"系统已重启"（重启其实没发生） + 未独立记录（见「是什么」原文） + ① `consumeRestartLog()` 只清 `restartLog` 不动 `action`（跨 TS/bash 契约测试）；② supervisor 的 `lost_restart` 实时检测 + `rounds.jsonl`；③ 真 pty 场景；④ 状态体检 `restart-request-stale` / `notice-undelivered`
- [bug-004](patterns/bug-004.md): 重启后**白跑一个模型回合** + 没有在途任务（切模式/换模型/切会话）也被"请继续"唤醒，实测还会让模型凭空开工 + `custom/core/restart-intent.ts`（意图 → 盘面尾部 → `PI_RESTART_RESUME`）+ 两条注入通道 + 接线测试 + 场景断言
- [bug-005](patterns/bug-005.md): 入口漂移 + `dev.sh` 不注入人设（supervisor 注入了），人设文件缺失时**静默**不注入 + 状态体检 `mode-persona-missing`（error，daily-health 会 alert）+ `lib-mode.sh` 共用解析
- [bug-006](patterns/bug-006.md): 重启后**没有任何提示** + `restartLog` 写了但没人读（消费端缺失） + 消费端契约测试 + `rounds.jsonl` 的 `decision`/`adminAction` 字段
- [bug-007](patterns/bug-007.md): 功能名拼错（如 `websearch`）→ 该功能静默不注册，模式看起来"没生效" + 未独立记录（见「是什么」原文） + 状态体检 `mode-feature-unknown` + 三处真值不漂移守门（功能名 ↔ `ALL_FEATURES` ↔ 注册面基线）
- [bug-008](patterns/bug-008.md): **多实例串扰** + 两个 my-pi 同时跑（实测同日出现过两个 supervisor），A 写的重启请求被 B 的 supervisor 执行 → 会话被跨实例重启/续错 + 写入端带 `ownerPid`（pi 的 ppid）+ supervisor 只认自己的请求（无 ownerPid 的老请求照旧认领）
- [bug-009](patterns/bug-009.md): **防环标记单槽互相覆盖** + 两个会话/实例各自自愈时，后写的把先写的防环标记顶掉 → 双方反复放行、来回重启 + 标记改多键 `{ "<会话>::<模式>": ts }`（旧格式兼容迁移）+ 上限/过期裁剪
- [bug-010](patterns/bug-010.md): **写盘失败静默退出** + `admin_restart`/`admin_set_model`/`admin_switch_session` 请求写不下去仍 `shutdown` → 进程没了、配置/会话也没变 + 三个工具 + mode 的 `requestModeRestart` 一律"写失败就不退出 + 明确文案"
- [bug-011](patterns/bug-011.md): **归属判定的误伤** + 加了 ownerPid 隔离后，别人的重启日志在本实例退出时被记成 `lost_restart`（"请求被吞"）→ 每日体检假告警 + `detect_lost_restart` 增加第 5 个判据"日志的 ownerPid 必须是本实例"；`read_admin_action` 多输出一个 `LOWNER` 字段
- [bug-012](patterns/bug-012.md): **续跑静默丢失 / 重启请求被抹掉** + 外部写入端（看门狗、故障转移、另一实例、测试）在进程**启动过程中**写下重启请求时，那个即将被重启的进程先把 `restartLog` 吃掉并注入到自己（马上要死的）会话里 → 重拉起来的新进程无续跑可注入；同源形态更糟——消费端的"整文件读-改-写"把刚写下的 `action` 一并抹掉 → supervisor 读到空 action 直接退出，连重启都没发生 + `core/restart-intent.ts` 的归属判据 `logWrittenAfterStart()`（只消费"写于我启动之前"的日志）+ `logTargetsOtherSession()`（多实例不串扰）；两个消费端（autopilot 与 mode 兜底）都先判归属再消费
- [bug-013](patterns/bug-013.md): **多实例不可见（静默失效）** + `state-audit` 数实例的判据是 `argv` 里含 `cli.js`，而真 pi 启动后 `process.title='pi'` 把 `/proc/<pid>/cmdline` 覆盖成只剩 `pi` → 真机上实例数恒为 0/1（只有假 CLI 或启动早期才数得到），"多实例可见"这条承诺从上线起就没兑现 + `scripts/state-audit.mjs` 的 `countRunningInstances()`：认 `cli.js` **或**标题 `pi`/`pi-rpc` 两种形态，且要求 `exe=node`、排除 `node -e` 助手
- [bug-014](patterns/bug-014.md): **system 加固块静默丢失（进程内前缀漂移）** + `before_agent_start` 处理器返回的 `systemPrompt` 没生效——pi 会**静默吞掉**该处理器的异常（只发给内存 listener，不落盘），于是 my-pi 追加的 772B system 加固块整块消失，请求退回"纯分段渲染"。system 在请求最前，少一块 = 前缀从第 0 个 token 起分叉 → **整段全价重放**。实测一次会话内 `system` 在 8020B/7239B 两变体间来回翻（14:11:22 翻过去、14:25:27 翻回来），两次 = 147,555 + 10,308 token = 该会话**全部未命中的 60.8%** + ① `before_agent_start` 改「关键路径 vs 可选增强」分层：拿 system 文本 + 追加加固块只做纯字符串运算，其余（工具分层/顺序对齐/用量校准/提示）全部就地 try/catch → 增强失败不再牵连前缀；② `prefix-fingerprint.ts` 记 `systemAppend` + `systemSections`/`systemChangedSections`（分段字节表，能区分"某段被改写"与"末尾整块丢了"）+ `system:append-lost`/`system:append-back` 标签；③ 独立台账 + 有 UI 时 `ui.notify`；④ `daily-health` 按**逐条** `systemAppend:false` 一律 alert（不再混进"疑似整段重算"）
- [bug-015](patterns/bug-015.md): **诊断工具自身的盲区 + JSON 转义吃掉分段结构**：`systemTextOf()` 对字符串 `content` 也无条件 `JSON.stringify` → 真实换行被转义成字面量 `\n`、并加上首尾引号 → `systemSectionSizes()` 再也切不开分段，整块 system 被记成一段 `preamble`。后果：第 14 条那类"进程内 system 漂移"**根本没法定位到段**，只能看到 `changed:["system"]`；字节数也整体虚高（7142B 原文 → 7239B） + `systemTextOf()`：字符串**原样返回**，只有非字符串（结构化 content）才 `stable()` 序列化；测试同时钉住"保留真实换行"
- [bug-016](patterns/bug-016.md): **终端层"假卡死" + agent 正常、用户却完全无法交互**：pi 进程健康（事件循环响应、整屏重绘正常、回合已干净收尾），但 14:25:27 之后再没有任何输入到达进程，用户视角就是"卡死"。根因在**终端/输入层**（该 pty 的主端在 Android 侧，`/proc` 里无持有者；当时内存吃紧 swap 4.4G/5.6G），不在 agent 层 + head -1); w1=$(awk '/^wchar/{print $2}' /proc/$P/io); kill -WINCH $P; sleep 2; w2=$(awk '/^wchar/{print $2}' /proc/$P/io); echo "wchar $w1 -> $w2"; ls -l /proc/$P/fd \

## 被否提案（7 条，来源：`docs/CHANGES.jsonl` 的 rejected）

> 判据第 ② 条：**成功与失败都记**。这些是"试过但被否"的提案，留着是为了**不被重复提出**。

- [rej-e5395b](patterns/rej-e5395b.md): [2026-10-08] 三个未迁移子系统：**都不迁移**（用户批复第 3 项），但理由各不相同且都是实测 + 听起来很合理，**一验就被否掉**（剥掉前缀后 47 → 46 对，最高相似度仍 0.58–0.63）。 + 未实施（被否）
- [rej-a77055](patterns/rej-a77055.md): [2026-10-07] fork 池化实测不成立：`new_session {parentSession}` 会"收下但不分叉" + `new_session {parentSession}`）需要各自验证，且复用键得带上父会话路径，本轮不做。 + 未实施（被否）
- [rej-0ba1a6](patterns/rej-0ba1a6.md): [2026-10-07] 调研：重型工具"只给子代理"与 `deferred` + `tool_search` 两条路的实测结论（**暂不采用**） + 并防止缓存失效。要求先分析可行性。查证过程分四步，最后一步的实测把方案否掉了。 + 未实施（被否）
- [rej-0f516a](patterns/rej-0f516a.md): [2026-10-01] 稳定优先：冻结默认面，明确"不做清单" + **决策**：默认面冻结，只做低风险、可回滚的事；下列明确不做（各自保留登记与触发条件）： + 未实施（被否）
- [rej-f597d3](patterns/rej-f597d3.md): [2026-09-22] 不迁移 auto-compact 控制器与 task-summarizer 流水线（口径） + **背景**：pi-tools `pi-context/auto-compact-controller.ts` 与 `task-summarizer.mjs` 依赖 `.usage-diag.jsonl`、task-record、thinking-level、warm-prefix、prune-dump 等一整条未迁移的数据/编排链。 + 未实施（被否）
- [rej-38ab10](patterns/rej-38ab10.md): [2026-09-22] task-record/task-summarizer 改为适配迁移（取代同日"不迁移"口径） + **背景**：先前以"依赖整条未迁移数据链"为由暂缓；实际 `task-record` 生产者可确定性重建（agent_settled 写结构化记录），总结层可去掉 spawn 强依赖。 + 未实施（被否）
- [rej-1d6971](patterns/rej-1d6971.md): [2026-09-25] 通知与入站通道：出站用 webhook、入站用 link（不迁移 notify.json / ntfy-relay） + **决策**：两者均**不迁移**，由既有能力取代： + 未实施（被否）

## 反复失败的错误指纹（0 条，来源：`portable/memory/logs/error-fingerprints.jsonl`）

> 判据第 ⑤ 条：**只记可泛化的**。这里只收 `remind===true`（已按 `REPAIR_THRESHOLDS {3,5,8}` 触发过修复提醒）或 `attempts>=3` 的指纹；**一次性手误不入库**。同一指纹一页（取最新一条）。

- （该来源**已接线但当前没有达到收录门槛的记录**——指纹日志只在工具调用失败时追加，且要反复出现才入库）

## 明确未接线的来源

- **前缀缓存指纹**（`portable/memory/logs/prefix-fingerprints.jsonl`）：它是**前缀缓存**指纹、不是错误指纹，**与"经验→知识"无关**，故不接入。
