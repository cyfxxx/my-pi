# BUG-REPLAYS — 事故 → 复现 → 守门台账

本文件是**使用层面故障**（"代码检查全绿、用起来才炸"）的台账：每条事故记录
**指纹**（怎么发现它）、**复现方式**（可执行的命令/场景）、以及**现在由谁挡住**。
目的是把"实际使用中发现"的一次性成本沉淀成可重复执行的检查——下次同类问题应当由自动化先报，
而不是再靠运气撞上。

约定：新增一行时，**必须**给出可执行命令（不能是"注意一下"）。
`scripts/test-scenario-mode-restart.mjs` 这类慢检查默认不进 pre-push（见
[`scripts/README.md`](../scripts/README.md) 的说明），需要时显式开启。

## 通用排查入口（先看这三处）

| 入口 | 命令 | 看什么 |
|------|------|--------|
| 状态体检 | `node scripts/state-audit.mjs`（或 `bash scripts/doctor.sh`，第 [12] 节） | 配置与运行时状态自相矛盾：人设文件丢失、功能名拼错、会话记录指向不存在的会话、重启请求没落地、通知没被消费、env 硬覆盖按会话模式 |
| 轮次记录 | `portable/agent/recovery/rounds.jsonl`（每轮一行）+ `portable/agent/recovery/rounds/round-<N>-<pid>.log` | 上一次/上几次进程为什么退出、读到什么 admin action、用什么参数重启、是否 `lostRestart` |
| 每日体检 | `node scripts/daily-health.mjs --print` | 成本退化与状态异常（每天由 autopilot 种子自动跑；`结论=alert` 说明有 error 级状态问题） |

## 台账

| # | 事故（现象） | 指纹（怎么认出来） | 复现（可执行） | 现在由谁挡住 |
|---|---|---|---|---|
| 1 | 切了模式、重启后没生效：`modes.json` 里的全局 `current` 被任何 git 操作（checkout/stash/pull）静默退回 `full` | `git status` 后模式变了；`modes.json` 里出现 `current` 字段 | `node scripts/state-audit.mjs` → `modes-legacy-current`（info）；`bash scripts/check-conventions.sh`（运行时状态不入库） | `check-conventions`（状态不入库）+ 状态体检 `modes-legacy-current`；模式状态已迁到 gitignored 的 `modes-sessions.json` |
| 2 | 模式解析"第 3 轮工厂执行后漂回 full"：`PI_AGENT_MODE_SOURCE` 从 `file` 被翻成 `env`，此后把首轮值当外部注入钉死 | 同一进程内多轮工厂执行（/reload、/new、会话切换）后模式与磁盘不一致 | `npx vitest run custom/features/mode/__tests__/mode-switch.test.ts -t '多轮工厂执行不漂移'` | `mode-switch.test.ts` 的三轮回归 + `resolveStartupMode()` 单一写入点 |
| 3 | 切模式/切回角色扮演会话时**进程直接退出**、模式没换、还注入了一条"系统已重启"（重启其实没发生） | 会话文件里有 `系统已重启` 注入但**后面没有 assistant 回复**；`rounds.jsonl` 里 `lostRestart: true`；终端留下未读的 OSC/DA1 应答乱码 | `bash scripts/test-supervisor.sh`（含 stub CLI 复刻该时序的端到端用例）；`PI_SCENARIO_KEEP=1 node scripts/test-scenario-mode-restart.mjs` | ① `consumeRestartLog()` 只清 `restartLog` 不动 `action`（跨 TS/bash 契约测试）；② supervisor 的 `lost_restart` 实时检测 + `rounds.jsonl`；③ 真 pty 场景；④ 状态体检 `restart-request-stale` / `notice-undelivered` |
| 4 | 重启后**白跑一个模型回合**：没有在途任务（切模式/换模型/切会话）也被"请继续"唤醒，实测还会让模型凭空开工 | 会话文件在重启后多出 user/assistant 条目；`daily-health` 里冷启动与未命中异常 | `npx vitest run custom/core/__tests__/restart-intent.test.ts`；真 pty 场景的"切模式零回合"断言（`PI_GOLDEN_SCENARIO=1 node scripts/test-scenario-mode-restart.mjs`） | `custom/core/restart-intent.ts`（意图 → 盘面尾部 → `PI_RESTART_RESUME`）+ 两条注入通道 + 接线测试 + 场景断言 |
| 5 | 入口漂移：`dev.sh` 不注入人设（supervisor 注入了），人设文件缺失时**静默**不注入 | 同一模式在 dev 与 my-pi.sh 下行为不同；人设文件被改名/删除 | `node scripts/state-audit.mjs` → `mode-persona-missing`（error）；`bash scripts/test-supervisor.sh` 的人设注入用例 | 状态体检 `mode-persona-missing`（error，daily-health 会 alert）+ `lib-mode.sh` 共用解析 |
| 6 | 重启后**没有任何提示**：`restartLog` 写了但没人读（消费端缺失） | 重启后模型完全不知道环境变了，继续用旧工具/旧假设 | `npx vitest run custom/features/autopilot/__tests__/restart-log.test.ts` | 消费端契约测试 + `rounds.jsonl` 的 `decision`/`adminAction` 字段 |
| 7 | 功能名拼错（如 `websearch`）→ 该功能静默不注册，模式看起来"没生效" | 该模式下少了预期工具，但没有任何报错 | `node scripts/state-audit.mjs` → `mode-feature-unknown`（error） | 状态体检 `mode-feature-unknown` + 三处真值不漂移守门（功能名 ↔ `ALL_FEATURES` ↔ 注册面基线） |
| 8 | **多实例串扰**：两个 my-pi 同时跑（实测同日出现过两个 supervisor），A 写的重启请求被 B 的 supervisor 执行 → 会话被跨实例重启/续错 | `rounds.jsonl` 里出现不属于本实例的 session；用户"重启后跑到了别的会话" | `npx vitest run custom/features/autopilot/__tests__/restart-log.test.ts`；`bash scripts/test-supervisor.sh`（ownerPid 认领/不认领两侧） | 写入端带 `ownerPid`（pi 的 ppid）+ supervisor 只认自己的请求（无 ownerPid 的老请求照旧认领） |
| 9 | **防环标记单槽互相覆盖**：两个会话/实例各自自愈时，后写的把先写的防环标记顶掉 → 双方反复放行、来回重启 | `mode-restart-guard.json` 里只剩一条 key；`rounds.jsonl` 同一会话短时间内多次 restart | `npx vitest run custom/features/mode/__tests__/mode-switch.test.ts -t '多会话/多实例'` | 标记改多键 `{ "<会话>::<模式>": ts }`（旧格式兼容迁移）+ 上限/过期裁剪 |
| 10 | **写盘失败静默退出**：`admin_restart`/`admin_set_model`/`admin_switch_session` 请求写不下去仍 `shutdown` → 进程没了、配置/会话也没变 | 无 state.json 变化却退出了；下一次启动配置未生效 | `npx vitest run custom/features/autopilot/__tests__/admin-tools.test.ts -t '写盘失败'`；`npx vitest run custom/features/mode/__tests__/mode-autopilot-restart.test.ts -t '写盘失败'` | 三个工具 + mode 的 `requestModeRestart` 一律"写失败就不退出 + 明确文案" |
| 11 | **归属判定的误伤**：加了 ownerPid 隔离后，别人的重启日志在本实例退出时被记成 `lost_restart`（"请求被吞"）→ 每日体检假告警 | `rounds.jsonl` 里 `lostRestart:true` 而 `adminAction` 为空、且会话属于别的实例 | `bash scripts/test-supervisor.sh`（"别人的日志 → 不算丢"三例） | `detect_lost_restart` 增加第 5 个判据"日志的 ownerPid 必须是本实例"；`read_admin_action` 多输出一个 `LOWNER` 字段 |
| 12 | **续跑静默丢失 / 重启请求被抹掉**：外部写入端（看门狗、故障转移、另一实例、测试）在进程**启动过程中**写下重启请求时，那个即将被重启的进程先把 `restartLog` 吃掉并注入到自己（马上要死的）会话里 → 重拉起来的新进程无续跑可注入；同源形态更糟——消费端的"整文件读-改-写"把刚写下的 `action` 一并抹掉 → supervisor 读到空 action 直接退出，连重启都没发生 | 真 pty 场景 round-3 的会话文件里没有 `my-pi-restart-resume`；`rounds.jsonl` 里该轮 `decision=exit` 且 `adminAction` 为空（但请求确实写过）；`state.json` 的 `action` 在写入后很快变 `none` | `npx vitest run custom/features/mode/__tests__/mode-autopilot-restart.test.ts -t '启动之后'`；`PI_SCENARIO_KEEP=1 node scripts/test-scenario-mode-restart.mjs`（round-3 必须出现 `my-pi-restart-resume`） | `core/restart-intent.ts` 的归属判据 `logWrittenAfterStart()`（只消费"写于我启动之前"的日志）+ `logTargetsOtherSession()`（多实例不串扰）；两个消费端（autopilot 与 mode 兜底）都先判归属再消费 |
| 13 | **多实例不可见（静默失效）**：`state-audit` 数实例的判据是 `argv` 里含 `cli.js`，而真 pi 启动后 `process.title='pi'` 把 `/proc/<pid>/cmdline` 覆盖成只剩 `pi` → 真机上实例数恒为 0/1（只有假 CLI 或启动早期才数得到），"多实例可见"这条承诺从上线起就没兑现 | 两个 my-pi 明明同时在跑，`node scripts/state-audit.mjs` 却没有 `multiple-instances` 发现（或实例数不对） | `node scripts/test-state-audit.mjs`（`process.title='pi'` 的假进程 + `cli.js` 形态各进程，断言 detected=3）；`node scripts/test-scenario-two-instances.mjs`（真链：断言实例数 ≥2） | `scripts/state-audit.mjs` 的 `countRunningInstances()`：认 `cli.js` **或**标题 `pi`/`pi-rpc` 两种形态，且要求 `exe=node`、排除 `node -e` 助手 |
| 14 | **system 加固块静默丢失（进程内前缀漂移）**：`before_agent_start` 处理器返回的 `systemPrompt` 没生效——pi 会**静默吞掉**该处理器的异常（只发给内存 listener，不落盘），于是 my-pi 追加的 772B system 加固块整块消失，请求退回"纯分段渲染"。system 在请求最前，少一块 = 前缀从第 0 个 token 起分叉 → **整段全价重放**。实测一次会话内 `system` 在 8020B/7239B 两变体间来回翻（14:11:22 翻过去、14:25:27 翻回来），两次 = 147,555 + 10,308 token = 该会话**全部未命中的 60.8%** | `portable/memory/logs/prefix-fingerprints.jsonl` 里**同一进程内**出现 `changed:["system",…,"messages@0-7"]` 且 `systemBytes` 差值 ≈ 772B；新字段 `systemAppend:false` + `changed:["system:append-lost"]`；独立台账 `portable/memory/logs/system-append-lost.jsonl`；`daily-health` 的 `加固块丢失=N` 字段 | `npx vitest run custom/features/context/__tests__/prefix-fingerprint.test.ts -t '加固块丢失'`；`node scripts/test-usage-metrics.mjs`（`加固块丢失=1` → alert）；真数据核对：`node -e "const l=require('fs').readFileSync('portable/memory/logs/prefix-fingerprints.jsonl','utf8').trim().split('\n').map(JSON.parse);const s=new Set(l.map(r=>r.system));console.log('system 变体数',s.size,'丢失次数',l.filter(r=>(r.changed||[]).includes('system:append-lost')).length)"` | ① `prefix-fingerprint.ts` 记 `systemAppend` + `systemSections`/`systemChangedSections`（分段字节表，定位到"是哪一段变了"，且能区分"某段被改写"与"末尾整块丢了"）；② `system:append-lost` 标签 + 独立台账 + 有 UI 时 `ui.notify` 告警；③ `daily-health` 把它当**确定事件**一律 alert（不再混进"疑似整段重算"） |
| 15 | **诊断工具自身的盲区：JSON 转义吃掉分段结构**：`systemTextOf()` 对字符串 `content` 也无条件 `JSON.stringify` → 真实换行被转义成字面量 `\n`、并加上首尾引号 → `systemSectionSizes()` 再也切不开分段，整块 system 被记成一段 `preamble`。后果：第 14 条那类"进程内 system 漂移"**根本没法定位到段**，只能看到 `changed:["system"]`；字节数也整体虚高（7142B 原文 → 7239B） | `prefix-fingerprints.jsonl` 里 system 相关记录只有 `preamble` 一段、`systemChangedSections` 恒为全部段名或空；`systemBytes` 比 `wc -c` 出来的 system 原文大（每换行 +1B） | `npx vitest run custom/features/context/__tests__/prefix-fingerprint.test.ts -t '字符串原样返回'` | `systemTextOf()`：字符串**原样返回**，只有非字符串（结构化 content）才 `stable()` 序列化；测试同时钉住"保留真实换行" |
| 16 | **终端层"假卡死"：agent 正常、用户却完全无法交互**：pi 进程健康（事件循环响应、整屏重绘正常、回合已干净收尾），但 14:25:27 之后再没有任何输入到达进程，用户视角就是"卡死"。根因在**终端/输入层**（该 pty 的主端在 Android 侧，`/proc` 里无持有者；当时内存吃紧 swap 4.4G/5.6G），不在 agent 层 | ① 0 CPU / 20s 内 0 输出、无 socket、无子进程；② `kill -WINCH` 后 `wchar` 有增长、`stty rows` 触发整屏重绘（数千字节）→ 事件循环活着；③ 回合**已收尾**：`aborted` 消息后毫秒级写入 `pi-link-state.json` 的 `status:idle`（= `agent_settled` 触发过）；④ `pi-link-active.json` 的 `lastActiveAt` 停在最后一条输入，之后无更新 | `P=$(pgrep -x pi \| head -1); w1=$(awk '/^wchar/{print $2}' /proc/$P/io); kill -WINCH $P; sleep 2; w2=$(awk '/^wchar/{print $2}' /proc/$P/io); echo "wchar $w1 -> $w2"; ls -l /proc/$P/fd \| grep -c socket`（wchar 增长 + socket=0 → TUI 活着，卡的是终端/输入层）；输入侧核对：`node -e "console.log(require('/root/my-pi/portable/agent/pi-link-active.json').lastActiveAt)"` 与 `date +%s%3N` 比 | **不做自动重启**（按 2026-10-07 定的口径）：supervisor 只在 crash/admin action 时重拉，这类"终端层卡死"的处置是**关掉该 my-pi 所在的终端会话**再重开——不引入看门狗误伤在飞会话 |

## 相关

- 设计与取舍：[`DECISIONS.md`](../DECISIONS.md) 的"使用层面错误的检测与预防"与"重启后要不要继续执行任务"两条
- 脚本索引与运行成本：[`scripts/README.md`](../scripts/README.md)
- 系统化排障流程：[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
