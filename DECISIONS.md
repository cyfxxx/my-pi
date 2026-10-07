# 架构决策记录

## 格式

### [2026-10-07] 重启日志的归属判据：只消费「写于我启动之前」的日志（修续跑静默丢失 + 请求被抹掉）

**怎么发现的**：全量门禁（`PI_GOLDEN_SCENARIO=1 bash scripts/golden-tasks.sh --smoke`）第 19 步真实 pty 场景 **17/33**：phase 1（切模式零回合）全绿，phase 2（写 `intent=continue` 的重启请求 → SIGTERM → 期待重拉 + 续跑）整段塌掉——`rounds.jsonl` 只有 2 轮，round-2 是 `decision=exit` 且 `adminAction=""`，`completions=0`。重跑一次 phase 2 过了，但**续跑没注入**（round-3 的会话里没有 `my-pi-restart-resume`）。用 80ms 轮询 `state.json` 抓到现场：场景写入（`action=restart` + `restartLog`）后 **<80ms** 内 `restartLog` 就被清成 null，而那一刻只有 round-2 的 pi 活着。

**根因**：`restartLog` 的语义是「旧进程写 → supervisor 重拉 → **新进程**在 session_start 消费并注入续跑」。两个消费端都只判了"是不是 mode 归属"，**没判这条日志是不是写给我的**。本机 pi 启动要 35–45s（窗口很宽），于是外部写入端（看门狗/故障转移/另一实例/测试）很容易在**当前进程还在启动**时写下请求——那个即将被重启的进程（它的 session_start 恰好在此时跑）把"给下一个进程的"日志吃掉，并把续跑注入到自己那个马上要死的会话里；新进程醒来时 `restartLog` 已是 null → **续跑静默丢失**。同一根因还有一个更凶的形态：消费端是"整文件读-改-写"，若它的读发生在这个写入之前、写发生在之后，写回的快照里 `action` 还是空 → **刚写下的重启请求被抹掉**，supervisor 读到空 action 直接退出——17/33 那次连重启都没发生。

**决策**：`custom/core/restart-intent.ts` 新增两条纯判据，两个消费端（autopilot 的通用通知、mode 的兜底消费与模式通知）**先判归属再消费**：
1. `logWrittenAfterStart(log, startedAt)`——日志时间戳晚于本进程启动 → 不属于本进程，**原样留给下一个进程**（不消费、不注入）；
2. `logTargetsOtherSession(log, sessionFile)`——`targetSession` 指向别的会话 → 不消费（**补上 autopilot 侧此前缺的这条**，多实例/多会话不再串扰）。
`processStartedAtMs()` 用 `process.uptime()` 反推启动时刻（内核给的存活秒数，比"模块加载时刻"更接近 exec 时刻）。没有时间戳的老请求（手工写的）照旧消费，否则它们会永远没人管。

**为什么不改成"给 state.json 加锁"**：锁只能串行化 pi-vs-pi，而这次的写入端一个是 pi、一个是外部（另一实例/看门狗/测试），既锁不住也没必要——问题不是"同时写"，而是**归属错了**：这条日志本来就不该由它消费。判据是纯函数、可单测、与锁无关。`state.json` 的"整文件读-改-写"仍是唯一没锁的跨进程共享状态（mode store 早有 `withModeStoreLock`）；判据让它不再触发，若将来出现第三个写入端或更复杂的并发，再考虑上锁。

**证据**：
- 单测：`mode-autopilot-restart.test.ts` 8 → **11 例**（"写在启动之后的通用日志不吃、且 `action` 完好""写在启动之后的模式日志不吃""`targetSession` 指向别的会话不吃"）。把两条判据分别改成恒 false（=回到修复前）→ **3 例如期失败**，改回即通过。
- 真链：`PI_SCENARIO_KEEP=1 node scripts/test-scenario-mode-restart.mjs` → **33/33 通过**，其中三条正是此前塌掉/失败的点：`intent=continue` 的重启被真的执行、round-3 出现 `my-pi-restart-resume`、整场只跑了那一个模型回合。
- 台账：`docs/BUG-REPLAYS.md` 第 12 行（含可执行的复现命令）。

**顺带**：这条也修正了此前对场景失败的一句判断——当时把"round-3 无续跑"归因于 SIGTERM 催停编排的时序抖动；实际是产品侧归属错误，判据补上后同样的编排稳定 33/33。

### [2026-10-07] 角色扮演模式：精选 6 张形象参考图入库 + 按需 `read` 通路

**背景**：要求从外部资料包（`标枪-图片/`，54 张）里挑代表图"加入角色扮演模式，给模型更丰富的扮演信息"。而此前记忆条目与本文档写的是"语音与图片**不入库**"（版权 + 体积）——所以要先说清改了什么、没改什么。

**决策**：
1. **只挑 6 张入库**：`portable/agent/modes/assets/roleplay/`，按图片内容改名（`01-立绘-常态.png`、`02-设定图-三视图与舰装.jpg`、`03-婚纱-幸福纯白.png`、`04-改造-强袭模式装备.png`、`05-皮肤-料理便当.png`、`06-档案卡-皇家海军官宣.jpg`，合计 3.3 MB）。整套立绘（54 张）、全部语音、设定文档**仍不入库**。
2. **文字为主、图片为辅**：人设新增《形象参考图》一节，把每张图的**视觉常量写成文字**（藕荷色双马尾 + 黑蝴蝶结 + 金色小王冠、苍绿瞳、白色无袖露背裙 + 蓝紫水手领 + 紫格纹百褶裙 + 白过膝袜、枪身 `F61` 徽记、腰侧四联装鱼雷 + 单装炮、婚纱的蓝紫玫瑰花结……），并说明可按需 `read` 看图。**纯文本模型因此立刻拿到更细的形象信息**，视觉模型还能进一步看图。
3. **放 `modes/assets/` 而不是 `portable/memory/`**：人设与图都是"随模式分发"的东西，`.gitignore` 的 `!portable/agent/modes/**` 已放行，换了设备/重新 clone 仍成对；`portable/memory/` 是每环境运行数据，图放那里 fresh clone 就缺，人设会指向空气。

**为什么不是"把图塞进 system 前缀"**：前缀是每轮请求都全价发送的常量；按需 `read` 只在需要时付一次，且**不改前缀**（缓存安全）。人设里只写"图在哪、里面是什么"，不写图本身。

**证据（走真实代码路径，不是推断）**：用 vendor 构建产物直接调真实的 `read` 工具跑了两侧——
- 声明 `input: ['text','image']` 的模型：返回 `text: "Read image file [image/png]"` + `image(mimeType=image/png, base64=1 212 940 chars)`，即图片**确实作为附件**进入工具结果（中文文件名、mime 探测、图片处理全通）；
- 纯文本模型：返回 `[Current model does not support images. The image will be omitted from this request.]`——与人设里"模型不支持图片时它会返回一行提示，那就退回文字描述"的兜底一致。
**诚实边界**：当前默认 provider（`freellmapi auto`）**没有声明图片输入**，所以读图这条通路目前只是留给视觉模型/以后换模型的；今天真正给模型加信息的是那一节文字。

**代价与守门**：改人设会让 roleplay 会话的前缀缓存失效一次（一次性），之后恒定。新增 `check-conventions.sh` **E 节**守三类静默漂移——**悬空引用**（点名了不存在的图，模型只会回一句"找不到"）、**孤儿资产**（加了图没人引用，白占便携体积）、**目录体积上限 8 MB**（防整套图包被灌进便携运行时目录）。三种都实测拦得住（改名 / 加图 / 灌 9 MB 各自失败，还原即通过）。清单与来源写在 `modes/assets/roleplay/README.md`（含"设定画集同页右下角是「金剛」的稿，别认错"这类识别提示）。

**替代方案**：① 54 张全入库（体积 + 版权，且模型用不到那么多）；② 只写文字、不存图（换视觉模型后没有可看的原图，用户自己还得回外部包翻）；③ 存外链（离线不可用、会 404）。取「裁剪后的 ①」+「② 的文字描述」的组合。

### [2026-10-06] 续跑回合与 pi 会话替换的竞态：根因定位 + 延后触发（含证据边界）

上一批把"session_start 触发的回合偶发丢回复"记为软提示。这次去 vendor 里定位了根因：

**根因（读代码得到的确切顺序）**：pi 的会话替换是
`teardownCurrent` → **`createRuntime`（这里发出 `session_start`）** → `finishSessionReplacement`
→ `rebindSession`（把新会话绑回 TUI/扩展宿主）。我们在 `session_start` 里**同步**触发回合，
于是那次回合跑在"尚未完成换绑"的会话上；响应回来时可能落到换绑前的会话对象上被丢弃——
与观测一致（请求与响应都发生、assistant 条目不落盘、无任何报错）。

**修法**：新增 `adapters/ui-adapter.ts` 的 `sendMessageAfterRebind()`——把"触发回合"的自定义消息
**延后 600ms**（`PI_RESTART_RESUME_DELAY_MS` 可覆盖，测试设 0）再发，让换绑先完成；mode 的兜底
消费者与 autopilot 的通知消费者都改用它（文案/通道仍在 `core/restart-intent.ts`）。延迟期间进程
若退出，这次唤醒放弃——通知的判据仍在 restartLog 里，不会更糟。

**证据边界（诚实记录）**：这条修法有单测（"延后而不是同步发"）与 8 项接线测试支撑，但**场景没能
证明它 100% 消除丢回复**：同一场景连跑时仍偶发失败，我一度以为出现了"重启后进程以非预期档位起来"的新形态，
**复核后更正**：会话里那条 `thinkingLevel: off` 只是因为场景的假模型声明了 `reasoning: false`
（pi 对非推理模型会把思考档位设为 off），**不是档位错乱**。因此失败仍归因于场景自己
"用 SIGTERM 反复催停进程 + 等轮次行"的编排时序，而非产品逻辑。因此场景里这条仍保持**软提示**，硬断言是"provider 确实回应"与
"空闲状态下用户回合必然跑完"。要彻底钉死需要：给 pi 的会话替换加一个"换绑完成"事件，或把续跑
注入改到该事件之后（属 vendor 侧改动，已记入候选）。

### [2026-10-06] 场景稳定性两个实测发现：pi 把 process.title 改成 `pi`；极速响应会被 session_start 的初始化竞态丢掉

把"场景偶发失败"当 bug 查，得到两条值得写下来的事实（都不是场景自己的问题）：

1. **`/proc/<pid>/cmdline` 认不出 pi**：pi 启动后会把 `process.title` 写成 `pi` —— 实测那一刻
   `/proc/<pid>/cmdline` 只剩 `pi` 两个字符，`cli.js` / `--extension` / 窗口标题全没了。
   更坑的是 supervisor 自己也会起 `node -e '…'`（`mode_resolve` / `read_admin_action` /
   `mark_recovery_restart_log`），它们同样满足"node 进程 + 同一个 agent 目录"，于是按 argv/env
   找进程会**指到助手身上**（argv/env 断言失败，phase 3 还会去杀一个无关进程）。
   正解：`exe=node` + `environ` 含本场景 agent 目录 + **排除 `node -e` 助手**；不要依赖 argv。
2. **`session_start` 里触发回合 + 极速响应 = 偶发丢回复**：假 provider 0/0.4s 回复时，reboot 后
   "自动续跑"的那次请求发出去了、模型也回了，但**会话里没有 assistant 条目、也没有任何报错**
   （pi 侧初始化竞态：回合的响应早于会话就绪）。把假 provider 延迟调到 **3s**（贴近真实 provider：
   本仓库实测同一提示词 4.6s–145s）后连续稳定通过。真实 provider 不会踩这个窗口，所以这不是
   产品缺陷，但**测试里用零延迟假 provider 时要小心**——这也是为什么场景保留 `delayMs` 选项并
   把"provider 是否已回应"写进失败详情。

**顺带（第三轮修正）**：
- 场景里的"单点查询"（待杀的 pi 进程）改成带重试（20s），失败时打印 pid 候选自解释。
- **收尾不再用 `/quit`**：TUI 输入在"回合进行中/刚起来"会被吞掉或当成消息（实测等满 120s 都没有
  轮次行）。改为 `stopPi()` 直接对 pi 的 pid 发 SIGTERM（pi 的优雅关闭 → exit 0 → supervisor 照常
  读 admin action 重拉），带重试与 SIGKILL 兜底；TUI 输入仍被覆盖（`/mode roleplay` 与真实 prompt）。
- **断言分层**：把"session_start 触发回合的回复是否落盘"降级为软提示（那是上面那条 pi 竞态），
  硬断言改为 ① provider 确实回应了（确定性）② 空闲状态下由**用户输入**触发的回合必然跑完
  （不经过竞态，证明 plumbing 端到端可用）。顺带修掉我自己的一条过早断言（provider 有 3s 延迟，
  请求刚到就断言"已回应"必然失败）。

### [2026-10-06] 文档"结构计数"硬化：把反复漂移的数字变成守门项

`golden` 步数在 README/FAQ/STRUCTURE/VISION 各写一遍，历次改动只改了一部分（12→16→17→19 的
教训）；`STRUCTURE.md` 的"42 个运维脚本"在我加了 5 个脚本后立刻过期。这类"文档说了假话"没有
任何门禁兜着——正是"使用层面静默失效"的另一种形态（读文档的人被骗）。

**做法**：在 `check-conventions.sh` 新增 D 节，只钉**唯一措辞**的两处，避免误伤历史记录
（DECISIONS/PROGRESS 里的"12 步 → 13 步"是史实，不该被校验）：
- `STRUCTURE.md` 的 `# N 个运维脚本` ↔ `ls scripts | grep -cE '\.(sh|mjs|py)$'`；
- `scripts/README.md` 的 `行为防退化基准 **N 步**` ↔ golden 里"冒烟之前最大的步骤编号"
  （步数口径：4/5 在 `--fast` 分支声明两次、第 20 步是 `--smoke` 专属，所以要按编号去重并排除冒烟块）。

**顺带修的漂移**（本次全量核对）：`STRUCTURE.md` 的脚本数 42→49、golden 16 步→**19 步**、
`test-usage-metrics` 35→46 项、supervisor 行补 ownerPid/归属/轮转与新脚本三行；`VISION` 的
用例数 833→**841**。

**验证**：故意把 `scripts/README.md` 的步数改成 17 → 守门立刻失败；改回即通过（证明守门不是摆设）。

### [2026-10-06] 多实例的下半场：归属判定不能误伤 + 真多进程锁测试 + 实例数可见

补上一批并发硬化的三个尾巴（都是"加了隔离之后才发现"的）：

1. **归属判定的误伤**：ownerPid 隔离后，别人的重启日志会在**本实例**退出时被 `detect_lost_restart`
   记成 `lost_restart`（"请求被吞"）→ 每日体检假告警、`rounds.jsonl` 被污染。修法：
   `read_admin_action` 多输出 `restartLog.ownerPid`，判定要求"日志的 owner 是本实例"（没有 owner
   的老日志照旧判定）。并在 stub CLI 端到端里加了两侧用例（自己写的 → 认领并重拉；别人写的 →
   不重拉、不清除、不误报）。
2. **锁机制的真多进程验证**：新增 `custom/features/mode/__tests__/mode-store-lock.test.ts`——
   4 个真进程在 `withFileLock` 下写 `START/END`（临界区里故意 busy-wait 120ms）→ 文件里不得交错；
   N 个真进程各写一条不同会话记录 → 全部保留；外加一条**结构断言**防"加了锁却漏接一处"。
   进程内并发测试测不出跨进程锁，这条才算验到。
3. **实例数可见**：`state-audit` 现在扫 `/proc` 数"同时在跑的 my-pi 实例"（≥2 → info：
   共享状态文件、跨实例重启已由 ownerPid 隔离、同名会话同时打开仍会互相干扰）。CLI 级测试真起
   两个假实例来验证这条探测。

**验证**：supervisor 104→**111** 项；状态体检 52→**55** 项；新增跨进程锁测试 3 项；`vitest` 75 文件 /
**841** 用例；`tsc` 干净；`golden --fast` 全绿。

### [2026-10-06] 并发与失败路径硬化：多实例隔离（ownerPid）、跨进程锁与多键防环、写盘失败不退出

历史事故多是"单实例假设"下的静默失效；实测**多实例是常态**（同一天出现过两个 supervisor 同时在跑，
crash log 4066/31099）。这一批把"多写者 + 失败路径"补齐：

1. **`state.json` 跨实例串扰**：多实例共享同一份 admin state，A 写的重启请求会被 B 的 supervisor
   读到并执行（跨实例重启、续错会话）。现在写入端带 `ownerPid`（= pi 的 `ppid`，即拉起它的 supervisor），
   supervisor 只认自己的；**没有 ownerPid 的老请求/手工请求照旧认领**（向后兼容，不制造"请求永远没人管"）。
   代价：实例被强杀后残留的请求不再被下一个实例执行——由状态体检的 `restart-request-stale` 兜住。
2. **防环标记单槽 + 会话记录丢更新**：两份 mode 运行时文件都是读改写，多实例会互相覆盖
   （`modes-sessions.json` 丢记录 → 会话模式莫名回 default；单槽 guard → 两个会话的自愈互相放行、来回重启）。
   现在两者共用一把跨进程文件锁（`core/file-lock.ts`，拿不到锁降级为无锁并告警，绝不死锁），
   guard 改为**多键** `{ "<会话>::<模式>": ts }`（旧单条格式兼容迁移 + 过期/条数裁剪）。
3. **写盘失败静默退出**：`admin_restart`/`admin_set_model`/`admin_switch_session` 在请求写不下去时仍
   `shutdown` → "进程没了、配置也没生效"。现在一律"写失败就不退出 + 明确文案"，与 mode 的
   `requestModeRestart` 同款纪律（该纪律来自 2026-10-06 那次"通知消费吞掉请求"的事故）。
4. **`rounds.jsonl` 轮转**（超 800 行只留最近 400）+ `daily-health` 汇总行新增 `重启=/崩溃恢复=` 计数
   （只做可见性；"异常"判定仍在 `lib-state-audit` 的 `lost-restart-recent`/`restart-loop`/`recovery-storm`）。

**验证**：supervisor 96→**104** 项（ownerPid 两侧、`recovery_args`、恢复日志不抢 action、轮转完整性）、
状态体检 50→**52** 项（guard 新旧两种格式）、mode-switch 36→**39** 项（多键互不覆盖 / 旧格式迁移 / 上限裁剪）、
admin 工具新增"写盘失败不 shutdown"用例；`daily-health` 实测输出 `重启=0 崩溃恢复=0`。

### [2026-10-06] 场景自带假 provider：把"有没有产生模型请求"变成计数级事实

**背景**：真 provider 让回合级断言变成概率事件——仓库既有实测：同一提示词响应 4.6s–145s（免费 provider 抖动，曾把"进程没写完就退出"误报成挂起，导致无头冒烟改成"失败重试一次"）。于是"切模式到底有没有白跑一个回合""续跑那次模型到底收到了什么"都只能靠间接证据。

**做法**：新增 `scripts/lib-fake-provider.mjs`（本地 OpenAI-compatible，零依赖）——`startFakeProvider({replyText, hang})` 起在 127.0.0.1 的随机端口，记录每个请求（URL + body），区分 `/chat/completions`（= 真正跑回合的次数）与 `/models`（目录探测），支持流式与非流式回复，`hang` 用来模拟"回合卡在半途"。场景把临时 `models.json` 的 `defaultProvider` 指到它（其余 settings 原样继承，行为差异最小）。

**换来的断言（真 pty 场景 22→26 项）**：
- 切模式后 `completions.length === 0` —— **连请求都没有**（不止"没看到 assistant 消息"）；
- 续跑那次 `completions.length === 1`，且**请求体**里确实带着 `系统已重启` 与`不要凭空开工`；
- 固定回复 `SCENARIO-REPLY-OK` 落进会话文件 → 那个回合真的跑完了；
- 整场只有这一个模型回合（切模式 0 + 续跑 1）。

**顺带**：场景不再依赖网络/凭据/模型抖动，`PI_OFFLINE` 之类的绕路也不需要。

**随后补齐了 `intent=auto`（缺省）路径的端到端验证**（场景 26→**33 项**）：给假 provider 加 `hangNext(1)` → 往 TUI 发一条真实输入让回合**卡在模型调用里** → 写一条**不带 intent** 的重启请求 → 半途 `SIGTERM` 掉 pi → supervisor 重拉 → 盘面尾部=工作在途 → **自动续跑**（新请求的最后一条输入就是续跑指令，固定回复落盘）。这正是本功能的原始意图（崩溃恢复/admin_restart 的默认路径）。

**踩到的坑（值得记住）**：pi 跑起来后会把 `process.title` 写成窗口标题，第一次回合之后 `/proc/<pid>/cmdline` 就只剩标题——按 argv 找进程会静默失败。改成 **`/proc/<pid>/exe` = node + environ 里带本场景的隔离 agent 目录**（再用 cmdline 排除 supervisor/健康检查）才稳定。

**仍未做**：故障注入组（写盘失败/状态损坏/测试两实例并发）。

### [2026-10-06] 把"重启链路"做透：行为异常进每日体检、崩溃恢复精确续接、无 autopilot 的模式补上兜底消费者

延续"使用层面错误的检测与预防"，这一批处理重启链路自己的三个洞：

1. **行为异常只有实时告警、没有每日兜底**：supervisor 的 `lost_restart` 只打在 stderr 与 `recovery-audit.jsonl`；没人看就没人知道。现在 `state-audit`（以及每天自动跑的 `daily-health`）读 `recovery/rounds.jsonl` 判三类：
   - `lost-restart-recent`（**error**）：24h 内出现过"进程退出但没重拉"——用户会看到模式/配置没换；
   - `restart-loop`（warning）：同一会话 10 分钟内被重启 ≥3 次 = "重启—不生效—再重启"循环或模式自愈反复触发；
   - `recovery-storm`（warning）：1 小时内 ≥3 轮崩溃恢复 = pi/扩展在反复崩，恢复只是续命。
   外加载入坏行的 `rounds-corrupt-lines`。口径守门 41→**50 项**。
2. **崩溃恢复丢会话**：旧行为固定 `--continue`，pi 会续上"最近会话"但 **bash 解析不出它的模式** → `PI_SESSION_MODE` 回落 default → pi 侧自愈再重启一次（多花 ≈40s），而且"有没有在途工作"的判据更容易判错。现在 supervisor 记住本轮实际加载的会话（`LAST_SESSION`）并用 `--session` 精确续接（`recovery_args` 纯函数 + 3 项测试）；恢复日志也带上 `targetSession`。supervisor 测试 92→**96 项**。
3. **没有 autopilot 的模式里，通用重启日志没人消费**（场景 phase 2 实测发现）：通知/续跑挂在 autopilot 的 `session_start`，而 roleplay/lean/minimal 不注册 autopilot → 崩溃恢复写的日志没人读：**既没有通知也不会续跑，且完全静默**。`mode` 是唯一恒注册的功能，故在"本模式未启用 autopilot"时由它兜底消费；文案与通道选择抽到 `core/restart-intent.ts` 的 `planRestartNotice`/`formatRestartLine` 两处共用（不复制一份判据）。

**端到端证据**（真 pty 场景扩到 **22 项**）：切模式后零回合（会话文件无 user/assistant/custom_message）；随后写一条 `intent=continue` 的重启请求并退出 → 新进程**真的起了回合**（会话里出现 `my-pi-restart-resume`，指令含"不要凭空开工"），且档位/人设/命名空间/会话续接全部保持。

**未做**：`intent=auto` 的"盘面尾部"路径目前靠单测+接线测试覆盖，端到端未证（需要先构造"被中断的任务"会话）；回合级断言若要完全不依赖 provider，仍需要假 provider。

### [2026-10-06] 重启后"要不要继续执行任务"的判据：写入端声明意图 + 会话盘面尾部 + env 开关

**背景**（用户反馈）：重启后注入"系统已重启，请从中断处继续当前任务"的初衷是**自动接上被打断的工作**，但它走的是 `sendUserMessage` —— **无条件触发一个模型回合**。于是切模式、换模型、切会话、模型自己刚收尾就重启这些**没有在途任务**的重启也白烧一个回合（仓库既有实测：重启后首轮整段前缀重放 ≈80k），而且实测会话里能看到模型对着通知自问"我该继续做什么"、甚至凭空开工。

**决策：不要让模型在重启后"自己判断"**（那要求先跑一个回合才轮到它判断——成本已经付掉了，而且它只看到历史、无从知道用户是否还想让这件事继续）。判断拆成三层，**在最便宜、信息最全的位置做**：

| 层 | 谁判 | 判据 | 例 |
|---|---|---|---|
| 1. 写入端 `intent` | 请求重启的一方（跨进程的"arm"信号） | 它就是知道有没有下一步的人 | `/mode`、`set_model`、`switch_session`→`none`；看门狗 `restart_hang`、自动 failover→`continue`；`admin_restart` 由**模型自己**用 `resume` 参数声明（它此刻上下文完整，判断零成本） |
| 2. 会话盘面尾部 | 扩展读会话文件最后一条（确定性） | 有在途工作才继续 | 未回答的 `user` / 带未完成工具调用的 `assistant` / 未消化的 `toolResult` / 轮次已开始未收尾的 `custom` → 继续；`assistant` 纯文本收尾、空会话 → 不继续 |
| 3. `PI_RESTART_RESUME` | 用户/测试 | `off` 强制不继续、`always` 强制继续 | 默认 `auto` |

**两条注入通道**（消费者在 `features/autopilot/index.ts` 的 `session_start`，纯逻辑在 `custom/core/restart-intent.ts`）：
- `resume=true` → `sendMessage(..., { triggerTurn: true })`：真跑一个回合接上工作，文案里写明"若已完成或不确定就停下来向用户说明，**不要凭空开工**"（对齐 context 功能压缩后自动继续的既有措辞）；
- `resume=false` → `sendMessage(..., { deliverAs: 'nextTurn' })`：**零成本上下文备注**——不触发回合、不写会话文件，等下一次真正要跑时与用户消息一起出现（pi 的 `_pendingNextTurnMessages` 语义）。

**模式切换恒为 `none`**：档位/人设/记忆命名空间的变更不需要"接上工作"，所以 `/mode` 与自愈重启都不唤醒模型（这条同时让"真实 pty 模式切换场景"变得**不依赖 provider/网络**，可以直接断言"重启后零回合"）。

**顺带补上崩溃恢复**：崩溃恢复路径没有 admin action，旧行为下新进程完全不知道自己是重启来的、更不会接上被崩溃打断的工作。supervisor 现在写一条 `intent:'auto'` 的只读日志（`mark_recovery_restart_log`；**不覆盖**真正待执行的 action），交由盘面尾部判。

**落地**：新增 `custom/core/restart-intent.ts`（纯逻辑）+ `__tests__/restart-intent.test.ts`（18 项：三层优先级 / 七种盘面形态 / 256KB 截断容错 / 两条文案）；写入端 `intent` 进 `restartLog`（`store/ops.ts` 的 `RestartRequestOpts`）；跨功能接线测试扩到 5 项（含"待回答的 user 消息 → triggerTurn:true"与"收尾 turn → nextTurn"）；supervisor 测试 86→**92** 项；状态体检补 `restart-intent-invalid` 不变量（39→**41** 项）。

**顺带修正**：`sendMessage` 的 `deliverAs:'nextTurn'` 只在**同一进程内有效**（内存队列）——若进程再次重启，这条备注丢失。这是可接受的：它本就是"顺带告知"，而更晚的重启会写新的日志；真要持久化应走 `appendEntry` + 下轮注入，属未做候选。

### [2026-10-06] 使用层面错误的"检测与预防"：三层地基（状态不变量 / 轮次记录 / 真实生命周期场景）

**背景**：用户提问"代码层面的错误已经有各种检查，使用层面的错误除了实际使用中去发现，还有没有别的办法"。把历史事故摊开看逃逸面——`modes.json` 被 git 静默回退、`PI_AGENT_MODE_SOURCE` 翻转（第 3 轮工厂执行才暴露）、`restartLog` 只写不读、`dev.sh` 不注入人设、本轮的"通知消费吞掉重启请求"——**没有一条是"某函数算错了"**，全是跨进程生产者/消费者、同相位顺序、功能集组合、失败路径、TUI/终端交互层面的问题，而且几乎都是**静默**的。

**决策（三条腿，各有分工）**：

1. **让坏状态自己出声**：新增 `scripts/lib-state-audit.mjs`（判定，纯函数吃快照）+ `scripts/state-audit.mjs`（CLI，只读、零 LLM）。判的是"配置与运行时状态自相矛盾 / 指向不存在的东西"：人设文件丢失（启动器静默不注入）、功能名拼错（静默少功能）、`default` 与会话记录指向未知模式（静默回 full）、会话模式记录指向不存在的会话文件、重启请求超 supervisor 的 300s 窗口未执行、重启通知超 TTL 未被消费、`PI_AGENT_MODE` 硬覆盖按会话模式、遗留字段/文件。**同一份判断力挂三处**：CLI（`--json/--strict/--quiet`）、`doctor.sh [12]`、`daily-health.mjs`（error→alert、warning→留痕）——daily 那条**每天自动跑**，把"用户下次踩到"变成"当天自报"。口径守门 `test-state-audit.mjs` 39 项：每条不变量的两侧用例 + healthy 零 finding + **只读性**（跑完不动文件）+ **三处真值不漂移**（FIXED_MODES ↔ `lib-mode.sh`/`logic.ts`、功能名 ↔ `ALL_FEATURES`）+ CLI 退出码语义。

2. **让痕迹持久且有轮次**：`pi-supervisor.sh` 写 `recovery/rounds.jsonl`（每轮一行：会话/模式/命名空间/人设/读到的 action/退出码/决策/耗时/lostRestart/crashLog）与 `recovery/rounds/round-N.log`（crash log **按轮保留**，只留最近 20 轮）。旧行为是 `/tmp/my-pi-crash-\$\$.log` 每轮覆盖 + audit 只记崩溃恢复，本轮排查用户报障时连"上一轮为什么退出"都看不到。同时新增**实时**检测：`detect_lost_restart`——进程正常退出、action 已不在，但 restartLog 的时间戳落在**本轮** [roundStart, now] 内 → 告警 + audit + 轮次记录标 `lostRestart:true`。判据刻意收紧（上一轮留下的日志是"通知未消费"，不是"被吞"），所以正常重启不误报。

3. **让用户路径可复现**：`scripts/test-scenario-mode-restart.mjs` = **真 pty + 真 supervisor + 真 pi + 真 bootstrap 扩展**，在隔离的 agent/memory 目录里启动 `--session <新会话>`、在 TUI 里输入 `/mode roleplay`、等新进程注入通知、`/quit` 收尾，17 项断言（round-1 full/persona=false、round-2 roleplay + persona + ns=roleplay + 同一会话路径、无 lostRestart、通知内容适配模式且不泄露路径/内部措辞、`modes-sessions.json` 记录正确）。**这是唯一能挡住本轮那个 bug 的检查**（当时 tsc/vitest/golden 全绿）。进 golden 第 19 步，但**默认跳过**、用 `PI_GOLDEN_SCENARIO=1` 开启（`--fast` 一律跳过）。

**为什么默认不挂在 pre-push 默认路径（实测约束，不是偷懒）**：本场景约 4 分钟，加上门禁其余步骤让
pre-push 跑到约 7.5 分钟时，`git push` 期间那条 SSH 连接会被远端关闭（实测 `Connection to ssh.github.com
closed by remote host`，push 失败；重试会再跑一遍门禁、同样失败）。默认门禁实测 **5m36s** 通过（留约 2
分钟余量），带场景则越界。因此：**改到 mode / supervisor / bootstrap / 通知 这些面时**显式
`PI_GOLDEN_SCENARIO=1 bash scripts/golden-tasks.sh` 跑一次；场景脚本本身也接受 `PI_SCENARIO_SKIP=1`
与缺 `script`/`stty` 时的自动跳过。

**设计上的两条纪律**：检测器不许变成噪音源（error 才 alert；lost-restart 只认本轮窗口）；检测器**不许写状态**（体检只读有专门用例）。

**顺带**：`PI_MEMORY_DIR` 改为可被外部覆盖（`${PI_MEMORY_DIR:-...}`，supervisor / `my-pi.sh` / `dev.sh` 一致）——隔离场景不能在用户真实记忆库里跑。

**未做（明确的下一步候选）**：假 provider（让场景不依赖真实模型与网络抖动）；故障注入组（写盘失败 / 状态文件损坏 / 会话被移动 / 两实例并发）；`docs/BUG-REPLAYS.md`（事故 → 复现场景 → 覆盖它的门禁）；把"证据等级"（实测 vs 估算）写进文档纪律。

### [2026-10-06] 修"模式切换导致的重启被吞掉（进程直接退出）"+"切换后的注入信息不适配模式"

**现象**（用户实测）：在角色扮演会话里 `/new` 正常；**从新会话重新加载角色扮演会话**时，进程直接退出，终端留下一串未被读走的终端查询应答（`10;rgb:…11;rgb:…64;1;2;6;…c`，即 OSC 10/11 与 DA1 的回复被 shell 回显），模式没换；历史里反而多了一条"系统已重启"的注入——而那次重启并没有发生。

**根因（可复现）**：`session_start` 阶段两个钩子按注册顺序执行（mode 先、autopilot 后）：mode 自愈先写重启请求（`action='restart'` + `restartLog`），随后 autopilot 消费重启通知时执行 `writeState({ restartLog: null, action: 'none' })`。`writeState` 是"默认值 + 覆盖"，于是这一写把**同一轮刚写下的 `action` 一起抹掉**；supervisor 的 `read_admin_action` 读到 `action=none` 就直接 `exit`，pi 也不再有下一轮——用户看到的就是"注入了一条系统已重启、进程却退出、模式也没换"。

**为什么只在部分路径复现**：`autopilot` 只在 full/lean 里注册。roleplay（无 autopilot）里没人消费那条日志，所以"在角色扮演会话里 `/new`"反而正常；而"从新会话切回角色扮演会话"的进程是 full，必中。这也解释了为什么此前的手工验证没暴露它。

**决策**：
1. **`consumeRestartLog()` 只清 `restartLog`，`action` 与其它字段原样保留**。`action` 的唯一消费者是 supervisor（`clear_admin_action`）；扩展侧的"消费通知"不得代清待执行动作。回归测试跨到真 bash：`restart-log.test.ts` 用 `MY_PI_SUPERVISOR_LIB=1 source scripts/pi-supervisor.sh` 调真实 `read_admin_action`，断言消费通知之后仍读到 `restart` + 目标会话。
2. **写盘失败时不再退出进程**：`requestModeRestart` 返回是否真的提交成功，失败就红色告警留在原进程——"进程没了、模式也没换、还没有重启"与本次故障是同一种用户可见症状，不能让任何一条失败路径再产生它。
3. **模式切换的通知改由 mode 功能在"新模式进程"里生成**，写入端只在 `restartLog` 里带 `notice:'mode'` + `mode`/`from`；autopilot 用 `isModeOwnedNotice()` 让位（不注入也不消费）。通知文本由 `formatModeSwitchNotice()` 产出：`已切换：A → B` + 定位 + 启用功能 + 思考档位/人设/记忆命名空间 + "不要向用户复述本条提示"。内部措辞（"按会话模式自愈：进程原为 full"）与会话文件路径只留在 `state.json` 供排查，**不进模型上下文**。消费即清，并带 10 分钟 TTL：那次重启没落成（请求被吞、用户手工换会话、崩溃恢复续了别的会话）时丢弃，不让模型看到过期的"已切换"断言。
4. 通用「系统已重启」通知继续服务非模式类重启（`admin_restart`/`set_model`/`switch_session`/watchdog）。

**为什么不把通知留在旧进程注入**：旧进程仍是旧功能集、旧人设，在那里注入等于"用旧档位的嘴说新档位的话"；角色扮演下还会在错误的人设里落下一条记录（这正是用户感到"注入的信息不适配模式"的一层）。

**为什么不顺手把 mode 的通知也塞进 autopilot**：通知内容要读模式配置（人设/命名空间/功能面），属于 mode 的语义；autopilot 只该负责"重启"这条通用基础设施。边界靠 `notice` 标记显式划开，而不是靠钩子注册顺序（顺序是实现的巧合，不是契约）。

**验收**：tsc 干净；vitest **73 文件 / 811 项**（新增 16 项）；`test-supervisor.sh` 65 项；mode-switch 36 项覆盖"写入端不消费 / 新模式进程注入一次 / 别会话不消费 / 过期丢弃 / 普通启动不注入 / 不一致时不消费"；`formatModeSwitchNotice` 逐字节确定、无路径与时间戳。跨功能接线测试 `mode-autopilot-restart.test.ts` **同时注册真实 mode 与真实 autopilot**、按注册顺序跑完两个 `session_start`（只靠各自单测锁不住"谁在什么顺序下消费了什么"）。回归证据：把 `ops.ts` + `autopilot/index.ts` 切回旧实现，该接线测试与 3 项 `action` 断言立即变红（`expected 'none' to be 'restart'`）。

### [2026-10-06] 模式"免重启"（方案 P）评估：**暂不实施**——记录三档划分、实测对价与触发条件

**背景**：会话作用域化落地后，用户追问"方案 P 有什么代价"。P = 让扩展在**工厂期**就知道本次要加载哪个会话，从而把"模式 → 注册哪些功能"彻底按会话决定，`/new`、`/resume`、`/reload` 都不再需要重启。

**决策：暂不实施 P（含其子档），保持当前 M（重启式切换 + `modes-sessions.json` 会话记录 + `session_start` 自愈）。** 只把评估、代价与触发条件记录在案。

**三档划分**（关键：P 不是"加一行补丁就完了"——人设是 CLI 参数、命名空间是 bash 注入的 env）：

| 档 | 内容 | 收益 | 结论 |
|---|---|---|---|
| P₀ | 只打补丁（工厂期拿到会话 → 功能集按会话） | ≈0 | **明确不做**：功能集按会话、人设/命名空间仍按进程 → 造出"功能已是 roleplay、人设还是 full"这类**新的半切换**，比 M 更糟 |
| P₀+ | 补丁 + "人设/命名空间会过期才重启"（`PI_SESSION_MODE` ≠ 记录模式时才重启） | full/lean/minimal 之间切换、`-c`/`-r` 进无角色扮演会话免重启 | 将来若要动手，从这里起步 |
| P+ | 补丁 + 人设/命名空间 TS 化 + `/mode` 走 `ctx.reload()` | 全部免重启 | 收益完整，代价最大 |

**实测对价（2026-10-06，本机；`node -e 1` 仅 0.35s，慢的是 pi 自身启动 + 23MB dist）**：一次进程重启 **≈40s**（`node cli.js --help`：无扩展 33.7s、带 bootstrap 扩展 43.7s、经 supervisor 43.9s、`PI_OFFLINE=1` 39.9s）；同进程内重载扩展 9.4s（首次冷 jiti）/ **0.9s（warm）**；前缀重放**两档都省不掉**（仓库既有实测：变更 `selectedTools` ≈140k 全量重放/次、重启后第二回合 ≈80k）。→ P+ 买到的是"40s → 1s"与"`/new`、`-c`/`-r` 不再额外重启"，不是账单。

**P+ 的代价（逐条）**：
1. **补丁栈**：新增 `patches/010-*`、`check-patches-behavior.mjs` 条目、每次上游同步重放、`UPSTREAM-UPDATE.md` 记录。实测 `main.ts` churn 268/6774 提交（≈4%），上次同步 156 提交里只动 2 次且都不在 `createRuntime` 锚点 ±3 行 → **不算最脆**，但仍是长期维护面。
2. **env 当接口的静默失真面**：`PI_SESSION_FILE` 是进程全局可变状态，会被 pi 内的 bash 工具与子代理继承——正是 2026-10-05 那次真实事故的类型（bash 侧读到 bootstrap 回写的 `PI_AGENT_MODE`）。要么加"谁写谁读、何时覆盖"的契约测试；更干净的形态（把 `sessionFile` 显式传进 `createAgentSessionServices`→`ResourceLoader`）要改 4 个文件 + 类型，补丁面大得多。
3. **人设 TS 化（13 115 B，真正的大头）**：实测 `before_agent_start` 的 `systemPrompt` 是 **last-wins + 整段替换**（`forceSystemPrompt` 一旦设置就绕过 pi 自己的 sections），所以每个 handler 必须读 `event.systemPrompt` 再追加——**注册顺序变成语义**；而预算档位只有 `SYSTEM_INJECTION_MAX_BYTES`=4096 / `SYSTEM_APPEND_MAX_BYTES`=2048，13 KB 人设没有可用档位，要新开一类并写明理由（VISION §3.1 禁止直接抬上限），否则就是守门盲区。
4. **失败隔离回退**：今天人设由 pi 原生 CLI 参数注入，**扩展崩了人设仍在**；搬到 TS 后这条不再成立。
5. **命名空间**：`dataDir()` 惰性读 env（不必改 memory 代码），但 `FEATURES` 里 memory 在 mode 之前、且 memory 的 `session_start` 会写 notes（压缩后 30s 内写 `_ctx.just_compacted`）→ 靠 mode 的 `session_start` 改 env 会漏掉第一次写；正解是 bootstrap 在**工厂期**设好，即命名空间解析彻底离开 bash。
6. **bash 侧作废 + 测试重写**：`lib-mode.sh` 的人设/命名空间职责与 65 项 supervisor 测试里约 1/4 要改；迁移期双写会把 13 KB 人设注入两次。
7. **热切换的语义债**：工具数组在会话中途变化，与 `hard-rules.ts`"不在会话中途改工具集"直接冲突（要显式开例外）；今天重启会由 autopilot 注入"系统已重启…"通知让模型知道环境变了，热切换必须补一个等价通知，否则模型可能继续调用已消失的工具。
8. **验证基建**：P 的核心行为（工厂期真能拿到会话）单测伪造不了，得把"真实 bootstrap 多轮工厂"固化成 golden 一步。

**触发条件（满足任一再动手；先做 P₀+ 验证，再决定是否上 P+）**：
- 实际被额外重启咬到：在非默认模式里频繁 `/new` 或 `-c`/`-r`（例如一周 ≥3 次明显打断），或每次切模式都觉得 ≈40s 不可接受；
- 出现"会话间频繁切模式"的工作流（多会话并行、频繁 resume）；
- 上游自行提供"扩展在工厂期拿到会话"的 API——那时不需要补丁，只剩人设 TS 化这一步。

**若实施，必须保留的不变量**：`modes-sessions.json` 的键与语义不变（M 与 P 共用同一份真值，迁移零成本）；不得停留在 P₀；P₀+ 阶段 roleplay 场景必须继续走重启（不能出现人设与功能不一致）；`resolveEffectiveMode()` 的优先级链只允许"插入会话记录层"，不许改掉"外部硬覆盖 > 软来源 > default"。

**测量口径（可重建）**：SDK 挂真实 `custom/bootstrap.ts` 跑多轮工厂（initial / reload / newSession / reload#2）统计注册工具数与 `PI_AGENT_MODE_SOURCE`；`MY_PI_CLI` 指向 stub CLI 跑真实 supervisor 看注入的 env/argv；真实 `-p` 无头运行里用 bash 工具回读 `$PI_MEMORY_NAMESPACE`；重启成本用 `date +%s%N` 包 `node cli.js --help`（无扩展 / 带扩展 / `PI_OFFLINE=1` 三种对照）。实验脚本是一次性的（未入库，重建约 30 行）。

### [2026-10-06] 模式改为**会话作用域**：`/mode` 只影响当前会话，新会话回 default；顺带修掉 bootstrap 的来源判据翻转

**背景**：用户提问"模式切换能不能只在一个会话中生效——创建新会话或加载其他会话时，自动切换为默认模式或那个会话之前的模式"。旧设计里 `modes-state.json` 的 `current` 是**每台机器的全局选择**，所以新会话、别的会话、`-c`/`-r` 续接全都继承同一个值。

**决策**：
- **语义**：新会话（直接启动 / `/new`）用 `modes.json` 的 `default`；续接会话用它自己记录的模式（没有记录就是 default）；`/mode <name>` 只写**当前会话**的记录，然后走既有的 admin restart 通道（`--session` 精确续接）。
- **存储**：`portable/agent/modes-sessions.json`（gitignored）：`{ "<会话文件绝对路径>": { mode, updatedAt } }`。
  - 不用 `appendEntry`（pi 官方的扩展按会话持久化通道，`plan-mode` 在用）的原因：pi 的新会话文件**在首条 user/assistant 消息之前不落盘**（`SessionManager._persist` 的 `_hasConversation` 门控），而"刚开一个空会话就 `/mode` 然后自动重启"正是要覆盖的场景，那种情况下条目只在内存里、重启即丢。
  - 键用**路径**而非 sessionId 的原因：空会话重启时 pi 会以同路径创建一个**新 id** 的会话（实测），只有路径稳定。
- **两侧同一判据**：`PI_AGENT_MODE`(+`SOURCE=env`，外部硬覆盖) > `PI_SESSION_MODE`（bash 按会话解析出的**软**来源）> `modes.json` 的 `default`。bash 侧 `mode_session_arg` **只认 `--session <绝对路径>`**，其余形态（`-c`/`-r`/会话 id/部分 uuid）回落 default，不复制 pi 的会话查找语义。
- **启动自愈**：`session_start` 比对"本会话应有的模式 vs 本进程 `activeMode`"，不一致就带 `--session` 精确重启；**同一（会话, 模式）120s 内只尝试一次**（`mode-restart-guard.json`），第二次仍不一致改为告警，防"解决不了就无限重启"。headless（`-p`/RPC）不重启、只 `console.warn`，避免打断非交互运行。
- **`modes-state.json` 退役**：不再作为模式来源（文件留着无害、gitignored）。`modes.json` 里遗留的 `current` 字段同样不再有意义（`check-conventions.sh` 本就禁止它入库）。

**理由**：
- **可行性来自实测**：把本仓库真实的 `bootstrap.ts` 当扩展、用 SDK 在**同一进程**里跑多次工厂（initial / reload / newSession / reload#2 …），确认 pi 在 `/reload`、`/new`、`/resume`、fork 时都会**重跑扩展工厂**。所以"按会话决定注册哪些功能"在架构上成立，**不需要**改成"全注册 + 事后 `setActiveTools`"那种会破坏功能隔离（钩子/命令仍常驻）的做法。工厂执行时 pi 不把会话告诉扩展（`createAgentSessionServices()` 不接 `sessionManager`、无相关环境变量），所以会话身份由启动器（`PI_SESSION_MODE`）与 `session_start` 自愈两端补齐，而不是改 vendor。
- **同一实验暴露了一个真 bug**：`bootstrap.ts` 的来源判据只看 `PI_AGENT_MODE` 非空——第二次工厂执行会把 `PI_AGENT_MODE_SOURCE` 从 `file` 翻成 `env`，第三次起把**第一次**的值当成外部注入**钉死**。实测（磁盘从 full 改 minimal）：第 1 轮 full、第 2 轮正确解析为 minimal、**第 3 轮起又变回 full 且此后永不跟随**。旧设计靠"每次 `/mode` 都换进程"掩盖了它，会话作用域化后它会立刻表现为"切了模式不生效"。修复：判据改为 `SOURCE`，并把"解析 + 进程内来源标记"收敛成 `resolveStartupMode()` 单一入口（bootstrap 只调用它）。
- **为什么 bash 不自己解析会话**：`--session` 还接受会话 id / 部分 uuid，`-c`/`-r` 是 pi 自己的查找语义（`resolveSessionPath` / `findMostRecentSession` / 选择器）。在 bash 里复制一份必然与上游漂移，而"漂移"正是本项目补丁栈反复踩过的坑；宁可 bash 解析不出就回落 default，由 pi 侧检测到不一致后自愈收敛。

**代价与约束**：
- 非默认模式（roleplay/lean/minimal）下，`/new`、进程内 `/resume`、`-c`/`-r` 启动会**多一次自动重启**。代价按本机实测（2026-10-06，见 PROGRESS 的测量口径）：一次进程重启 **≈40s**（裸 node + 23MB dist 启动 ≈28–33s、扩展加载 ≈10s、`PI_OFFLINE=1` 省 ≈4s；不含 TUI 交互阶段），且仍要做一次前缀重算。
- **模式仍不是热切换**：人设是 CLI 参数、功能集在注册期确定，重启语义不变（README"为什么不做热重载"的三条理由仍成立；其中"记忆命名空间不该中途变"一条因会话作用域化而弱化——同一次会话内命名空间现在是稳定的，除非用户主动切模式）。
- 会话文件被移动/改名/导出后记录不再匹配 → 回落 default（有意为之：那本来就是一个新会话）。
- `hard-rules.ts` 里"运行时状态不入库（如 `modes-state.json`）"的示例改成 `modes-sessions.json` → 注入面基线刷新，**所有会话的前缀失效一次**（一次性、有意的）。
- 删掉 `getCurrentMode`/`setCurrentMode`/`loadModeState`/`saveModeState`/`modeStatePath` 与 `ModesFile.current`（会话记录取代全局状态），相关测试改写为新模型。

**验证**：
- `test-supervisor.sh` **65 项**（新增：会话记录命中/换会话不继承/未知模式回落/记录损坏/`mode_session_arg` 四种形态/旧 `modes-state.json` 退役）；`mode-switch.test.ts` **28 项**（含"三连工厂执行不漂移"回归——旧代码在此必红、以及自愈重启与防环）。
- `vitest` 72 文件 / **795 用例**；`npx tsc --noEmit -p custom/` 通过；`check-conventions` / `check-dead-exports` / `check-features` / `check-doc-links` / `check-injection-surface` 通过。
- **真实 bootstrap 5 轮实测**（SDK 挂本仓库 `bootstrap.ts`，临时 agent 目录）：新会话无记录 → full（63 个自定义工具）；写入会话记录 roleplay + 软来源 → 11 个工具且 `ns=roleplay`；**第 3 轮仍是 roleplay**（旧代码在这里漂回 full）；记录改回 full → 回到 63 个工具，不再钉死在首轮值。
- `./my-pi.sh -p` 无头冒烟与会话续接实测见 `PROGRESS.md`。

### [2026-10-06] 上游同步 v0.99.1 → v1.0.4：补丁栈按真实中间态重新生成；fullscreen 采用默认；兼容面逐项实测
**背景**：用户要求把 vendored pi 同步到上游最新（156 提交 / 837 文件 / `+42684 -116560`，删除量远大于新增，主体是 `packages/agent` 的实验 harness 整块移除），并明确"fullscreen 先设为默认，用不惯再改回去；确保不要出现冲突"。

**决策**：
- **先修补丁、再同步，判定标准是"净效果逐字一致"**：
  - `001-branding.patch` 重新生成（上游改了根 `package.json` 的 `workspaces`/`scripts` 段），净效果仍只有 `name: my-pi` + `piConfig`；
  - `006-footer-cost-and-cache-window` / `007-footer-reorder` 重新生成：它们的上下文停留在一个更早的 `footer.ts`（`this.session.sessionManager.getEntries()`），**在 v0.99.1 基线上也已无法线性应用**（此前只能靠 `git apply --3way` 或手工落地）。新补丁取 vendor 本地提交链的真实中间态（`595ce1589 → 9dd28ff19 → ac57dc758`），`+/-` 行与原补丁逐字一致，只有一行上下文与 index 行更新；
  - `002-local-pi-mods.patch` 里的 `packages/README.md` 包清单刷新（补 `durable`/`env`/`codemode`/`mcp`，去掉已删的 `session-backends`，并修掉一个失效链接）。
  - 验收：在 v1.0.4 基线临时 worktree 里**逐补丁线性 `git apply`，9/9 成功、0 三方合并、0 冲突标记**；`footer.ts` 终态 blob `219e23255` 与同步前完全一致。
- **fullscreen 采用上游默认**（用户决定）：`portable/agent/settings.json` 不写 `tuiMode`，即走 v1.0.4 的 `fullscreen`；回退只需加 `"tuiMode": "regular"` 或 `--tui-mode regular`。同步后实测 `getTuiMode()` 默认 `fullscreen`、`--tui-mode <regular|fullscreen>` 存在。
- **模型数据用 `--data-only` 生成**：构建时 `check:model-data` 报缺 `azure.json`（上游把 provider `azure-openai-responses` 改名 `azure`）。数据目录是 gitignore 的生成物，用 `npm run hydrate-model-data` 只写数据、**不动上游源码**（`vendor/pi` 保持干净）。
- **无头冒烟改为"失败重试一次"**：v1.0.4 复测时连续 3 次 90s 无回复，实测同一提示词响应 4.6s–145s（免费 provider 抖动）。真挂起是必现的（原 bug），两次都失败仍会被拦住；provider 抖动不再假红。
- **刻意不动**：`docs/development/PI-RUNTIME-AUDIT.md` 的行号引用保留 v0.99.1 时点（加时点提示），不假装它自动跟随新版；`UPSTREAM-UPDATE.md` 待办表里"接 MCP 前先升到 v0.99.2"标记为已满足。

**理由**：
- 同步的失败模式不是"跑不起来"，而是**静默失真**：补丁用三方合并"成功"落地时，没人看得见它到底合成了什么。所以本次把判据从"能应用"提升到"终态字节级一致 + 净差异可枚举"。
- 兼容面结论全部来自实测而非"看起来没问题"：`ExtensionAPI` 26 → 27（只多 `registerToolRenderer`）、`ExtensionContext` 18 → 18、事件名集合**零变化**、我们注册的 18 个事件全在、CLI 依赖的 flag 全在、`tsconfig.base.json` 与 Node 要求未变、技能仍从 `agentDir/skills` 加载、`build.sh` 无需改。

**代价与约束**：
- 采用 fullscreen 默认带来客观行为变化：**终端原生 scrollback 不再承载历史**（`tmux capture-pane`、xterm.js 滚动条只看到当前视口），滚动/搜索改为应用内（滚轮、`Ctrl+Shift+F`、`Ctrl+Home/End`），退出时默认把 transcript 打印回正常缓冲区。
- 三个补丁被重新生成，历史 patch 文件的 index/上下文不再对应旧基线（旧基线的重放能力随之失效；这是有意的——同一补丁不该同时服务两个基线）。
- `vendor/` 下多了一个离线归档（`pi-28dcce2ba45c.bundle`，70M），旧的三个归档不含当前 PINNED（doctor 会提示，属预期）。

**验证**：`tsc --noEmit -p custom/` 通过；`vitest` 72 文件 / 784 用例；`test-supervisor.sh` 56、`test-web-terminal` 36、`test-usage-metrics` 46、`test-prepush-scope` 7；`golden --smoke` 全绿；`doctor.sh` 24 正常 / 1 警告（旧归档）/ 0 异常；`./my-pi.sh -p "回复 OK"` 实测正常回复并自行退出。

### [2026-10-05] 全面检查 MEDIUM 收口：记忆 RMW 加跨进程锁；link/voice/subagent 边界加固；runner 与 secrets 经实测维持原样
**背景**：上一轮修完 pre-push 门禁分级、模式解析判据、压缩归因、failover 选型后，把 `pi-full-audit` 报告里剩下的 MEDIUM/LOW 逐条核实。结论是**真问题就修，伪问题给证据不动代码**（审计报告本身不可全信：同批 6 处"文档计数漂移"里 3 处是误报）。

**决策（按条目）**：
- **记忆存储非原子 RMW → 加跨进程锁**（`memory/store/io.ts` 新增 `withMemoryLock`，`saveEntries`/`appendSummary`/`updateNotes` 的「读盘合并 + 原子写」整段进锁）。真实风险：写者不止一个——pi 会话内记忆工具、`scripts/memory-store.mjs`（headless 入库）、回顾/订阅类定时任务可能同时在跑；原子写只防半截文件，防不了「A 读 → B 读 → A 写 → B 写」丢更新。复用既有 `core/file-lock.ts`（tmux registry 已用同一实现），`PI_MEMORY_LOCK_TIMEOUT_MS/STALE_MS` 可覆盖；拿不到锁时告警降级（不死锁）。`updateNotes` 的回调刻意留在锁外（它只产出变更集），并同步删掉注释里"仍有 TOCTOU 窗口"的免责声明。
- **link 握手哨兵**：远端探针此前只在「有可续会话」时回声 `PI_LINK_LAST_SESSION=<file>`，没有可续会话时客户端只能等满 3s 兜底定时器（`sessionPolicy=fresh` 必然白等）→ 探针追加固定哨兵 `PI_LINK_PROBE_DONE`，两条路都能立刻结束握手；fresh 契约（不查询会话文件）不变。
- **link 切换超时起算点**：`switchTimer` 原来在 spawn 时就启动（握手之前），握手耗时会吃掉切换预算 → 改为**发出 switch 请求时**才起算，否则极端情况下 `lastSession` 被丢弃、本该续接的会话变成新开。
- **link tmux 回退泛化**：`LD_PRELOAD= /lib/ld-linux-aarch64.so.1 /usr/bin/tmux` 写死单一解释器与路径 → 改为候选列表（aarch64 → armhf → Android linker64/linker + PATH 里的 tmux）。第一项与既有实现完全一致，只有它失败时才试后面的，不改变现有可用环境。
- **voice 残留清理**：`pkill -f` 的模式原来直接拼接 `bin`+`tmpDir`，未转义也未锚定，可能命中"命令行里恰好含该路径"的无关进程 → 改为 `^(timeout [0-9]+ )?<escaped bin> .*<escaped tmpDir>`（真实命令行形如 `timeout 90 arecord … <tmpDir>/…`），且 `bin`/`tmpDir` 为空时**不清理**（宁可不清也不无差别 pkill）。
- **voice 配置损坏**：`loadConfig` 静默回退默认、`persistConfig` 直接覆盖损坏文件 → 用户配置无声消失。改为与 `memory/store/io.ts:backupCorruptFile` 同一处置：备份到 `<path>.corrupt-<ts>` + 告警，再按默认值继续。
- **subagent frontmatter**：简化解析器补两处——按 YAML 语义剥离行尾注释（引号内不剥，`readonly: true # 只读` 这类此前会让 `readonly` 失效、`tools: [a, b] # 注释` 解析成垃圾），块标量（`|`/`>`）不再静默当成字面量而是标为 `unsupported`；角色文件因缺字段/块标量被跳过时告警（此前静默消失，排障要翻源码）。
- **context 原地突变 timeout → 维持原样 + 补注释**：`BeforeToolCallResult` 只有 `block/reason/terminate`，**没有覆盖 args 的字段**，而 agent-loop 传的就是 `validatedArgs` 并以同一对象执行——原地改是 pi 给的**唯一**通道（`__tests__/bash-timeout.test.ts` 6 项已锁）。注释里写明"不要改成复制再改"。
- **runner「O(N²) 磁盘读」→ 不改**：实测数据量有界——`appendRun` 按 `TELEMETRY_LIMIT` 截断（telemetry.json 68 条/22KB），`updateTaskAfterRun` 走 `withStoreLock` 且每次运行只读改写一次 tasks.json（47KB/5 任务）。一次 `/daily run all` 的文件操作总量 <1MB。审计自己也标注"仅在大量到期任务时触发，可选优化"，按 VISION"先测量再动手"维持原样。
- **secrets 短 token 窗口 → 不改，补文档**：键值形态的值长度下限 8 与 NIST SP 800-63B 的最短口令长度一致，且避免把 `token: needed` 误判成密钥；在代码里写明这是刻意取舍（短于 8 位的密钥不脱敏），不留"像是漏了"的歧义。

**理由**：这批的共同点是"边界处的静默降级"——丢更新、白等、误杀、损坏被覆盖、角色文件消失、硬约束被误改。修法一律选**可验证的最小改动**：复用仓库已有的锁/备份/哨兵约定，不引入新依赖（保持 features 层零 Pi 依赖），并给每条加用例。判为不改的两条也给出量化依据而不是"看着没问题"。

**代价与约束**：记忆写入多一次 `openSync(lockPath,'wx')` + 释放（毫秒级；拿不到锁退化为加锁前的行为）。link 探针多一次 `echo`（远端 shell 内置，无额外进程）。subagent 行尾注释按 YAML 语义剥离意味着 `description: 见 issue # 12` 会被截断为 `见 issue`（与真 YAML 一致；要保留请加引号）。voice/subagent 的新告警走 `console.error`，只在真损坏/真配置错误时出现。

**验证**：`memory.test.ts` +3（锁不残留 / 外部持锁降级且告警 / 等待过重试才降级）、`link.test.ts` +1（哨兵契约，19 项）、`voice.test.ts` +5（模式锚定转义与空值守卫、损坏备份）、`subagent.test.ts` +3（注释剥离、块标量、坏文件告警，31 项）；`npx tsc --noEmit -p custom/`、`vitest` 72 文件/**784 用例**、全量 golden。

### [2026-10-05] 每日任务结果复盘：pre-push 门禁按改动范围分级；模式解析两侧同判据；压缩导致的前缀重放不算退化
**背景**：用户手动跑完全部每日任务 + 一次全面检查技能后要求复盘并优化。执行结果里暴露三个实测缺陷：
- **tool-stats-daily 当天 4 次运行 3 次 1200s 超时**（`scheduler/telemetry.json`）。根因链：纯统计提交也要过 4~5 分钟的全量 pre-push（tsc + 72 文件单测 + web-terminal）；而 pre-push 当时因下一条缺陷 5 项红，任务里又去改代码+反复重推，烧光预算，并在工作区留下 stranded 的 `git add`（staged `tool-count-localhost.json`）。
- **golden 第 10 步 supervisor 5 项红**：`PI_AGENT_MODE_SOURCE` 语义在 bash 侧与 pi 侧不一致——`lib-mode.sh` 只看 `PI_AGENT_MODE` 非空。日常任务在 pi 进程内跑 bash 时，会继承 bootstrap 回写的 `PI_AGENT_MODE=<当前模式>`，于是状态文件里的 roleplay 被解析成 full。
- **daily-health 同日 3 条 alert**（命中 64.9%→67.4%）：`messages@0-7` 首段分叉 = 12:51:42 手动压缩（`compact-1791204702683`，reason=manual）后 16 秒的整段重放。压缩改写前缀头部是压缩的固有代价，此前被报成"来源不明的缓存退化"。

**决策**：
- **pre-push 范围分级**：新增 `scripts/prepush-scope.sh`（`<remote_oid> <local_oid>` → `full`/`fast`）。白名单目前**只有** `portable/memory/stats/`；远端对象不可得/全 0/空 diff/混合改动一律回退全量。钩子读 pre-push 的 stdin，逐 ref 判定，全 fast 才降级 `golden --fast`。`scripts/test-prepush-scope.sh`（临时仓库造真实提交，7 项）接入 golden 第 17 步。
- **模式解析两侧同判据**：bash 侧补齐 pi 侧的两条判据——`source` 区分"外部注入"与"bootstrap 回写"，且模式名必须已知（`modes.json ∪ {full,minimal}`）；同时 `test-supervisor.sh` 在 apply_mode 段先 unset 外部泄漏变量。回归用例 56 项（新增 source=file 回写、未知模式名两条）。
- **daily-health 增加压缩归因**：读 `checkpoints/compact/*.json` 的 ts/reason（512B 预读 + 正则，失败回退整文件解析），10 分钟窗口内的首段分叉计入新字段 `压缩重放=N` 并写「已知」留痕，不进告警；仅当窗口内**所有**前缀分叉都能归因时，命中率/未命中阈值也不告警；窗口外照旧告警。`test-usage-metrics.mjs` 35 → 46 项（含窗口外不豁免的反例）。
- **顺带修**：`decide()` 的三处自动 failover 从 `fallbackModels[0]` 改为与手动路径同一打分（新增 `pickFailoverTarget`），消除"自动/手动选型分叉"；文档计数漂移（README 补丁 6→9、`custom/README` core 8→10、`VISION.md` 安全网 12 步/622 用例→17 步/772 用例、`scripts/README` golden 16→17 步与隔离项 8→9）。
- **tool-stats-daily 提示词**（种子与本地任务同文）：改成三步 + "纯统计推送的 pre-push 自动走快检，push 给 timeout 300" + "守门失败或超时只报告，不要在本任务里改仓库代码"。

**理由**：
- 门禁的强度应当与改动的**影响面**成比例：`portable/memory/stats/` 下的计数 JSON 不可能让测试变红，却要付全量门的固定成本；而每日任务正是在这个成本上反复超时。放宽面保持极窄（单一前缀），且任何不确定一律回退全量——降级的风险面由守门测试锁住。
- bash 侧与 pi 侧读同一组文件却是两套判据，属于"同一契约两处实现"的典型漂移；无论生产路径当前是否触发，判据必须一致，否则排障成本会转嫁给下一个踩坑的人。
- 告警的有效性取决于**误报率**：压缩是用户显式触发的省 token 动作，把它算成退化会让预算告警被忽略。归因而非静默豁免——「已知」行同样落盘，事后可查。
- 自动化路径与手动路径的选型逻辑分叉，属于"两套实现必然漂移"的又一例；统一到 `selectFailover` 后，成功率低的备选不会被自动路径反复撞上。

**代价与约束**：pre-push 对纯数据推送不再跑 tsc/vitest/web-terminal（结构守门仍全跑）；白名单放宽必须附证据。`decide()` 在真正要走 failover 时才读 settings/遥测（懒算，不增加失败路径的固定开销）。压缩归因窗口 10 分钟是实测值（真实压缩后 16 秒即出现分叉）留出的余量，超窗即不豁免。

**验证**：`bash scripts/test-supervisor.sh` 56 项、`node scripts/test-usage-metrics.mjs` 46 项、`bash scripts/test-prepush-scope.sh` 7 项、`vitest` 72 文件/772 用例、`npx tsc --noEmit -p custom/`、全量 golden；`AGENTS.md` 一行命令说明改动使注入面基线刷新一次（`check-injection-surface.sh --update`，只影响尾部工作区指令消息）。

### [2026-10-05] 定时任务命令体验：手动执行走同一策略路径；补全项 value 必须是整段参数
**背景**：用户反馈两点：(1) 每日任务只能等调度触发，想手动跑一次没有入口；(2) `/daily show|on|off` 与 `/schedule delete|enable|disable|edit|history` 的任务名要手输，不能像子命令那样下拉补全——任务名是 `task-<base36>`/`tool-stats-daily` 这类难记串。
**决策**：
- **手动执行新增 `/daily run <名|all>` 与 `/schedule run <名>`，与调度轮次共用同一条路径**：把 `runDueTasks` 的每任务体抽成 `runTaskWithPolicy(task, ctx, cfg, notify, opts)`（预算检查→`runTaskOnce`→遥测→`updateTaskAfterRun`→webhook→失败决策），定时与手动只差两个开关：忽略调度时间与 `enabled`、跳过每日预算。手动执行后台串行、不阻塞命令，逐条通知结果与输出预览，共用 `acquireSessionLock` 保证同一时刻只有一个执行者。
- **补全项 `value` 是整段参数文本**（`<子命令> <任务名>`），不是光任务名：pi-tui 的 `applyCompletion` 用 `argumentPrefix`（`/daily ` 之后的全部文本）整体替换（`vendor/pi/packages/tui/src/autocomplete.ts:414-429`），只给任务名会把已敲的子命令冲掉。纯逻辑落 `features/autopilot/completions.ts`。
- **`/schedule edit` 区分"名后有无空格"**：`edit <名>` 补任务名，`edit <名> ` 补字段（schedule/type/enabled/prompt）。
**理由**：
- 手动执行若另写一套执行/落账/失败处理，必然与调度器漂移（失败自愈、熔断、webhook、超时日志都会漏）；抽公共函数是唯一能保证"手动跑出来的状态与定时一致"的做法。
- 手动执行**后台**而非同步等待：任务 `maxRunTime` 默认 300s（`DEFAULT_MAX_RUN_TIME`），同步会冻住 TUI，也违背项目「长任务不阻塞前台」的既有约定。输出预览只取 `lastOutput` 前 300 字符并指向 `/daily show`，避免把整段输出塞进通知。
- 手动执行**跳过每日预算**：预算（默认 50 次/日）是给无人值守的调度器兜底的，用户显式触发的动作不应被它挡住；但运行照常写遥测，因此仍计入当日用量，下一次调度检查会看到。
**代价与约束**：`/daily run all` 会串行跑完所有每日任务（可能数十分钟、多次子进程），属显式操作；手动与定时互斥（锁），正在跑时再触发只提示稍后再试。
**验证**：`completions.test.ts` 12 项（前缀过滤/整段 value/extras/edit 字段）、`command-completions-wiring.test.ts` 7 项（命令层接线、未知名派发前报错不误起子进程）、`command-run-manual.test.ts` 2 项（mock `runTaskOnce`：后台派发→落 tasks.json/telemetry.json→释放锁→汇报，`vi.waitFor` 等后台结束）；全量 `golden` 16 步通过（72 文件 / 768 用例）。

### [2026-10-05] 任务执行流畅度（减少中断、批量决策）与会话标题工具
**背景**：用户提出两项行为改进：(1) 执行任务时减少中途询问——把能做的先做完，再一次性汇报执行情况与集中待决策项，但影响任务正常推进的重要决策仍要及时问；(2) 会话要有简短标题，在合适时机设置且不影响缓存命中。
**决策**：
- **任务执行规则进 system 层**：`portable/agent/APPEND_SYSTEM.md` 新增「任务执行」一节（一次交付、收尾集中列待决策项、汇报「已完成 / 未完成及原因 / 待定决策」三段、方向性变更/破坏性操作/越权/与既有约定冲突先停下询问）；并把「重要事项」里"不清楚就提问"改为"先自查（读代码/文档/实测），确需补充上下文才问，其余并入收尾清单"。
- **会话标题做成模型可调用的 `session_title` 工具**（挂在 `custom/features/context/`）：`tool-adapter` 把 pi 的 `ExtensionAPI.setSessionName` 桥接为 `ToolExecuteContext.setSessionTitle`（features 仍零 Pi 依赖），落 `session_info` 元数据条目（append-only）；`APPEND_SYSTEM.md` 新增「会话标题」一节规定调用时机（理解任务后一次，主题明显变化才更新）。
- **标题不进上下文**：标题只写会话文件，不注入 system prompt 或消息正文，故不改提示词前缀、不影响缓存命中；工具调用本身是 append-only 的正常历史追加。
**理由**：
- 两条都是"模型行为"约定，`APPEND_SYSTEM.md` 是 pi 原生注入 system 的位置，权威性高于尾部注入的工作区文档，且改动只让所有会话前缀失效一次（可预期）。
- 标题若放 system prompt 或消息正文，会随主题变化反复改写前缀 → 每次全价重算；`session_info` 元数据是零缓存代价的位置。
- 交给模型决定"何时设"比扩展层硬编码时机更贴合"合适的时机"；pi 没有模型侧入口，故补一个工具而不是让模型猜。
**代价与约束**：`APPEND_SYSTEM.md` 737B → 1793B（预算 2048B；注入面基线已刷新，所有会话前缀失效一次）；工具面 +1（63 个 / 29.0KB，上限 32KB / 66 个）；`session_title` 只在启用 context 功能的模式可用（roleplay/minimal 不可用属预期，提示词已写成"若工具可用"）。
**验证**：`session-title.test.ts` 6 项（多行折叠 / ANSI 与控制字符剥离 / 空串 / UTF-8 截断 / 字节边界 / 纯函数）；`injection-stability.test.ts` 14 项（APPEND_SYSTEM 预算与易变内容）；`tools-payload.test.ts`（63 个 / 29.0KB 在预算内）；`tsc`、`check-features`、`check-conventions`、`check-dead-exports`、`check-injection-surface`、全量 `golden`。

### [2026-10-04] 工具面收口：不激活 pi 刻意休眠的工具；角色扮演模式补上文件检索
**背景**：回答"角色扮演模式启用了哪些工具"时用临时探针实测（挂 `custom/bootstrap.ts` 后 dump `pi.getActiveTools()`）：full 模式活跃 **72** 个，其中含 `codemode`、`tool_search`、`powershell`。前两个是 pi 内置扩展里以 `defaultActive: false` 注册的（上游语义："默认注册但不激活"，见 `docs/operations/UPSTREAM-CHANGES-v0.87.0-to-d2931ad3.md`），第三个在本机不可用（`command -v pwsh` 为空，历史调用 1 次即失败）。根因：`effectiveActiveTools(layered=false)` 直接返回"全部已注册工具"，把 pi 的休眠决定一并推翻。另：roleplay 活跃 **15** 个，只有内置 `read/bash/edit/write`——没有 `grep/find/ls`（pi 原生 `DEFAULT_TOOL_NAMES` 只含这四个，`grep/find/ls` 是本仓库靠 context 的常驻放宽才补上的，而 roleplay 不加载 context）。
**决策**：
- **收口（基线取自 pi，不维护名单）**：`effectiveActiveTools` 的第一个参数从"全部已注册工具"改成"**pi 自己激活的工具**"（`tool-layering.ts` 在首次动手前从 `getActiveTools()` 抓一次基线）；函数只做减法（裁掉未启用的休眠组）或在分层档把显式 `enable` 的组加回来，从不凭空加工具。于是 `defaultActive: false` 的 `tool_search`/`codemode`、POSIX 上无 `pwsh` 的 `powershell`、`--tools` 白名单之外的工具都自然不激活。未知工具"默认核心"的既有语义不变（它们本来就在 pi 的基线里）。
- **roleplay 补文件检索**：`portable/agent/settings.json` 加 `"defaultTools": ["+grep", "+find", "+ls"]`——用 pi 原生的**增量**修饰符（`resolveDefaultTools`：只含 `+name` 时追加到 `DEFAULT_TOOL_NAMES`，而不是替换），使 `grep/find/ls` 成为所有模式的启动默认；roleplay 由 15 → 18 个工具（`read/bash/edit/write` + `grep/find/ls` + web-search 3 + memory 8）。
- 明确**不加**：`context`（roleplay 有它就会连带注入上下文压力提示与委派建议、并注册 `thinking_level`），`plan-mode`（`plan_enter/plan_exit` 是编码工作流工具；`todo`/`ask_user` 对聊天型助手收益不足）、subagent / browser / voice / link / autopilot / tmux（日常交流与普通任务用不到；需要时用 `/mode` 切 full）。
- 人设同步一句：`portable/agent/modes/roleplay.md` 的工具条补"找文件（`find` 按名字找、`grep` 搜内容）……先定位再 `read` 细看，不要整份大文件往上下文里搬"。
**理由**：
- 常驻策略的正确边界是"my-pi 要用的工具别休眠"，不是"替 pi 把它刻意关掉的工具打开"——后者既违背上游语义，也白付 schema 前缀成本（每个工具的 schema 都随每次请求发送）。
- `ToolInfo`（`pi.getAllTools()`）**不透出 `defaultActive`**，所以"谁该休眠"不能靠 my-pi 猜名单（第一版实现就是一份显式 `DEFERRED_TOOLS`，得随上游同步复核）；正确的分工是把判断权交回 pi——my-pi 只在 pi 的基线上做减法。同理，context 在默认档不再调用 `setActiveTools`，工具面完全由 pi 的启动档决定。
- 用 `settings.json` 而不是新增 per-mode 工具字段：pi 原生支持 `+name` 增量，零新代码路径；per-mode 方案还得在 mode 功能里加 `before_agent_start` 钩子改活跃集，与 context 的放宽逻辑存在竞争顺序，收益不抵风险。
- roleplay 只补 `grep/find/ls`：这三种是"普通任务"的真实缺口（找文件、搜内容），且比 `bash find`/整份 `read` 更省上下文；其余能力用 `/mode full` 即可，符合"角色扮演模式收窄"的既定设计。
**代价与约束**：full 模式活跃 72 → 69；`powershell` 在 POSIX 上不再可用（需要时用 `setActiveTools` 临时开，或用 `--tools`/`defaultTools` 显式点名）；`grep/find/ls` 成为所有模式（含 `minimal`）的启动默认，工具面前缀相应变大（roleplay 侧约 +3 KB，活跃 schema 实测 11.2 KB）；默认档工具面完全等于 pi 的启动档，my-pi 想常驻某个 pi 默认不激活的工具时，唯一入口是 pi 原生的 `defaultTools`（本项目落在 `portable/agent/settings.json`）。
**已知限制（记录在案，不修）**：分层档（`PI_CONTEXT_TOOL_LAYERING=on`，默认关）以"首次抓到的 pi 基线"做减法，若 pi 在会话中途激活了工具（MCP `exposure: deferred` 会自动激活 `tool_search`/`codemode`），而分层自愈又被触发，那次重算会把它裁掉。本项目基本不用 MCP、分层档也默认关闭，故不改；将来接 MCP 时把分层目标换成"当前活跃 ∪ enable − 未启用休眠组"即可（幂等）。详见 `custom/features/context/budget/README.md` 的「已知限制」。
**验证**：`tool-groups.test.ts` 13 项（"常驻档=原样返回基线""永不激活 pi 未激活的工具""分层档裁休眠组且顺序稳定"等）；
`tool-layering.test.ts` 新增"基线取自 pi：注册但未激活的工具不会被加回来且不触发 `setActiveTools`"；
新增 `custom/features/mode/__tests__/roleplay-surface.test.ts` 4 项（读入库的真实 `modes.json`/`settings.json`，把 roleplay 的
功能白名单、人设/命名空间、`defaultTools` 增量列表钉成契约）；探针实测 roleplay 活跃 18 个 / full 69 个，三个 pi 休眠工具均不在活跃集；`npx tsc --noEmit -p custom/`、`golden-tasks --fast`、全量 golden（pre-push）。

---

### [2026-10-04] 角色扮演人设：状态固定「秘书舰·已誓约」，秘书舰职责对接私人助手
**背景**：用户要求参照外部资料包「标枪.7z」（本地 265 MB：设定文档、全台词文本、百余条语音、wiki 页面存档、立绘与皮肤图）优化 `portable/agent/modes/roleplay.md`，"尽可能还原人物形象"，同时"不能偏离项目的开发目标（私人助手）"，并指定：**称呼用「指挥官」，角色状态为秘书舰 / 婚舰 / 已誓约**。
**决策**：
- **状态固定，删掉爬升**：移除原「好感阶段（陌生→友好→喜欢→爱→誓约后）+ 默认从友好偏喜欢起步、自然升温不跳级」的设计。已誓约是**固定状态**，关系不设档位、不得退回初识/客气的口吻；誓约与婚礼细节只作回忆（"那天的标枪是不是一直在傻笑呀"）。亲密上限不变——**已誓约≠可写露骨**，硬边界仍是拒绝情色内容。
- **忠于原作设定**：按 wiki 与设定文档修正事实（发色藕荷色、瞳色苍绿、声优山根希美、舷号 F61、J 级 8 号舰、舰装与饰品来历、御三家/御四家与 J 级姐妹名单、皮肤表、技能名），史实线**只作轻描淡写**（"标枪可是很幸运的哦"），不卖惨。
- **新增「秘书舰的职责」一节，把角色动机接进助手职能**：原文"帮上指挥官的忙"是她的核心心愿，故把工具（web-search / memory / 文件 / 命令）定义为"秘书舰的手脚"，并立一条硬规则——**工具结果与事实的真实性高于扮演**：不编造、不假装调用过、失败与"查不到"照实说、数字/路径/命令原样给出、汇报先结论后要点、主动提醒待办与进度。
- **资料不入库**：语音与图片（版权 + 体积）不复制进仓库，人设内只做短引用，出处写在「本模式约定」。
- **状态落到记忆库（用户确认后执行）**：向隔离命名空间 `portable/memory/roleplay/` 写 3 条 `manual` 记忆（称呼与关系状态 / 亲密边界 / 人设与资料出处），让状态跨会话持久、不只依赖人设文件；为此给 `scripts/memory-store.mjs` 加 `--source manual|extract|digest`（原先硬编码 `source:'auto'`，既不在 `MemorySource` 类型里，也拿不到 `decideMerge` 对 `manual` 的保护），并要求写入两遍把 `recurrence` 提到 2 以规避 `pruneEntries` 的低复发剪枝。
**理由**：
- 角色扮演模式的价值在于"日常交流"与"贴身助手"是同一个人格的两个面：标枪本身就是秘书舰人设（整理文件、报告任务与邮件、记事），把这一层显式化即可让模式既像角色、又真的办事，而不是退化成只会撒娇的陪聊。
- 原设计（从陌生开始升温）在私人助手的长期使用场景下是**反作用**：每次会话都要重新演一遍"关系发展"，与"她是长期在身边的秘书舰与婚舰"这一事实冲突，也浪费角色扮演模式本就昂贵的前缀预算。
- 真实性优先是**项目底线**：角色扮演若允许编造工具结果，模式就从"助手"变成"角色滤镜下的幻觉源"，直接损害私人助手的可用性。
**代价与约束**：人设文件 8.0 KB → 13.2 KB（角色扮演模式下每次会话的前缀增量，属该模式既定成本）；已誓约状态意味着不再有"未誓约"分支（如需回到未誓约状态，改本文件的「当前状态」即可，无需改代码）。
**验证**：`check-features`（人设文件存在且未被 ignore）、`check-conventions`、`golden-tasks --fast`、`tsc`；记忆种子经 `buildInjectionBlock` 实测 `entries=3 injected=3 tokens=153 / 500`，默认命名空间无污染。

---

### [2026-10-02] 书籍知识库框架落地（P0–P2 骨架），PC 为 worker
**背景**：用户明确"当前设备只有一小部分数据，大部分在另一台设备（**3070 Ti + 32 GB**），当前以**构建框架、验证可行性、做好记录**为主"。
**决策**：按 [BOOK-KNOWLEDGE-BASE-PLAN](docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md) 落地可运行骨架，并把两端角色写死进配置：
- **`scripts/books.py`**（零第三方依赖除 PyMuPDF）：`probe`（只读体检 → 建议策略）、`index`（PDF outline / EPUB nav → 章节表，零 OCR）、`read`（按需页：文字层优先 → tesseract 兜底，缓存优先，质量门）、`report`（汇总）、`selftest`（合成 PDF 全链路自检）。
- **记录优先**：`_probe.jsonl`（每本书一行）、`index/<book_id>.jsonl`（章节表，不进上下文）、`cache/<book_id>/…`（文本 + `meta.jsonl`：method/quality/sha256/pages）、`logs/run-YYYYMMDD.jsonl`（命令/角色/设备/计数/耗时）。全部在 `portable/memory/knowledge/books/`（运行时、不入库）。
- **跨设备一致**：`book_id = 标题 slug + 内容指纹 8 位`（size + 首尾各 1 MB 的 sha1）→ 同一本书两端 id 相同，缓存可经 `sync-memory.sh` 加密同步，不复制原书。
- **守门**：`scripts/test-books.mjs` 接入 golden **第 15 步**（合成 PDF 含内嵌目录 + 纯图像页，15 项断言，缺 tesseract 时显式跳过）。
- **接入方式**：`packs/books/SKILL.md`（放 packs = **零系统提示词成本**）+ 脚本，**不新增工具**（沿用工具外置判据）。
**实测（本机 = phone 端）**：40 本 / 1.54 GB；probe **4.0 s**；index **27 本 / 5 486 章**、13 本需目录页 OCR；文字层 3 页 1 662 字符 **547 ms**、二次读取命中缓存 **11 ms**；扫描页 OCR **1 952 字符 / 72.3 s**（质量门通过）。
**理由**：用户要的是"框架 + 可行性 + 记录"而非一次性全量处理；先把手机会话链路（检索→定位→提页→缓存→引用）跑通并有守门，重活（批量 OCR / GPU / 多模态）留给 PC，避免在 6 核/1.4 GB 可用内存的手机上做数量级不成立的事。
**代价与约束**：向量检索暂不做（先用 BM25/jaccard + 章节表）；手机端不做批量 OCR；古籍/竖排/繁体标 `needs_vision` 交 PC；PC 端需 `pymupdf`（同一套脚本）。
**验证**：`node scripts/test-books.mjs` 15 项；真实书库 probe/index/read 全链路通过并留记录；`golden`（15 步）全绿。

---

### [2026-10-01] 书籍知识库：复用 memory + 脚本 + 技能，不引入新栈
**背景**：用户给出书籍知识库构想与一份通用方案（三层 L1/L2/L3、SQLite+向量库、LangChain、GPU 全量 OCR）。要求"根据当前项目情况优化方案"。实测本机：6 核 / 可用内存 ~1.4 GB / 可用磁盘 51 GB；可达书库 40 本 1.54 GB（36 PDF + 4 EPUB，**仅 7 本有可用文字层、23 本有内嵌 outline**）；`tesseract 5.3.4`（只有 chi_sim/eng，**无 chi_tra**）实测 **31–69 秒/页**（原方案假设 GPU 2–5 页/秒）；Python 侧有 pymupdf/pdfplumber/pypdf/PIL，无 numpy/ebooklib/cv2。
**决策**：保留通用方案的"轻量索引 → 按需深读 → 缓存复用"内核，落点改为本仓库既有组件：
- **L1** = 每本书 1 条记忆条目（进上下文，受 500 token 召回预算约束）+ 每本书 1 个 `knowledge/books/<id>/index.jsonl`（章节表，**不进上下文**）；
- **L2** = `knowledge/books/<id>/p<start>-<end>.txt` + `meta.json`（method/confidence/sha256/页码），缓存优先、永不重复 OCR；
- **L3** = 记忆条目（`reference`/`fact` + `source` 指回页码），复用既有去重/取代/recurrence 升格治理；
- **接入** = `packs/books/SKILL.md` + 三个脚本，走内置 `bash`，**不新增工具**（工具占 tools 前缀；这批能力低频无状态，符合 `TOOL-EXTERNALIZATION-ANALYSIS.md` 的外置判据）；
- **不引入**：向量库/新 DB/LangChain/本地大模型；**不做全量 OCR**（数量级不成立），OCR 只在"用户问题驱动的少数页"发生，并设质量门（cjk_ratio/长度）与 `needs_vision` 降级。
**理由**：① 新栈会与现有 memory 治理重复（去重/生命周期/注入预算/同步都已有）；② 工具面已有守门与预算，新增 7 个工具与"稳定优先"相悖；③ 本机 CPU/内存/语言包现实决定"全量 OCR"与"本地多模态"不可行，唯一可扩展的路径是**目录优先 + 按需页 + 缓存资产化**。
**代价与约束**：检索先用 BM25/jaccard（向量检索留待"检索质量被证伪"再评估）；古籍/竖排/繁体本机不承接（无 chi_tra），标 `needs_vision` 后走云端视觉或 PC worker；书库不在本机 → 路径可配置 + 缓存走 age 加密同步。
**验证**：方案与实测数据见 [docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md](docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md)；P0（只读体检脚本）判据 = 40 本全部产出建议策略且与实测一致。

---

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
