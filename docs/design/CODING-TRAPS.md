# 编码与验证陷阱（每条都配**可执行判据**）

本文件收录**"代码检查可能全绿、但实际已经错了"**的陷阱。与 `docs/BUG-REPLAYS.md` 的分工：
那边是**使用层面**故障（必须给可执行命令）；这边是**编写/验证过程中**的陷阱（同样给可执行判据）。
**新增一条时也必须给出可执行判据**——否则它只会变成"注意一下"，下次照样踩。

## 1. 注释里出现"两个星号紧跟斜杠"⇒ 块注释被提前关闭

- **症状**：`ReferenceError: xxx is not defined`，而报错行**看起来完全正常**（因为它是被"挤出注释"的普通文本）。
- **代价**：本会话**一次白费 3 轮**；另有一次 440 行的实现直接崩在这个坑上。
- **判据**：`bash -c 'node --check <改动的脚本>'`（语法级即可暴露）；写文档字符串/注释时，**任何"星号 + 斜杠"的组合都要先想一次**。

## 2. 形参名与导入的模块名同名 ⇒ 块内引用模块会打到形参上

- **症状**：`path.join is not a function`；**而且"补一个 import"完全无效**（导入同样被形参遮蔽）。
- **代价**：本会话白费 1 轮（我先误判成"导入缺失"）。
- **判据**：`bash -c 'grep -n "function .*(path" <文件>'` 之类的自查；**正解 = 块内不引用那个名字**（改用 `join` 等具名导入或别名）。

## 3. `pkill -f <模式>` 可能杀掉自己

- **症状**：命令自己被打断（`[killed by signal: SIGTERM]`），后续步骤静默不执行。
- **原因**：`-f` 匹配**整条命令行**，而**你自己的命令行里就含那个模式**。
- **判据**：`bash -c 'ps -o args= -p $$ | grep -c "<模式>"'`（非 0 ⇒ 会自杀）；**改用作业管理/精确 PID**。

## 4. 为"模拟缺工具"而清空 `PATH` ⇒ 连自己的工具一起弄没

- **症状**：报 `timeout: command not found` / `grep: command not found`，**看起来像被测代码失败**，其实是测试方法错。
- **代价**：本会话**同一个坑犯了两次**。
- **判据**：受限 `PATH` **只能注入给被测进程**（`bash -c 'env PATH=<受限> <绝对路径的解释器> …'`），**自己的工具一律用绝对路径**。

## 5. 新引入一种"我写的文件格式"⇒ 必须同时引入一条校验它的守门

- **症状**：一份**非法 JSON** 一路提交进仓库（文档链接只查 md、约定守门只查计数、死导出只查 TS ⇒ **没人看 `.json` 语法**）。
- **判据**：`bash -c 'node -e "JSON.parse(require(\"fs\").readFileSync(\"<文件>\",\"utf8\"))"'`；
  现行守门已覆盖 `packs/`、`scripts/`、`sync/` 下的 `.json`（见 `scripts/check-conventions.sh`）。

## 6. 改语义前，先读断言本身表达的契约——测试可能是 bug 的保护壳

- **症状**：一个 bug 长期存活，因为**既有测试把错误行为写成了期望**（实例：`it('shutdown 回收空闲与在租的全部 worker')`
  + `expect(a.worker.alive).toBe(false)` ✗ —— 它断言的正是 bug 行为）。
- **判据**：改动语义时，**先 `bash -c 'grep -n "<相关断言>" <测试文件>'` 回看契约**，再决定"改代码"还是"改断言"；
  **"改完测试还绿"不等于行为正确** ✗。

## 7. 真 pty 场景里，用"切片里没有某段文本"做断言 ⇒ 被 TUI 全屏重绘污染成**假失败**

- **症状**：断言"发 `/new` 之后 pane 里还没有 `New session started`"失败，而行为其实完全正确；
  更坏的是它的**镜像**：断言"等 pane 出现 `New session started`"会**因为重绘命中旧文本而立刻返回**，
  后续基于盘上产物的断言于是查得太早（本次实测：E4 提前返回 ⇒ E3b 在 pi 持久化之前读盘 ⇒ 假失败）。
- **原因**：pi 的 TUI 是**全屏重绘**的；`pty.output` 是**累积流**，一次重画会把**换会话之前**就打印过的
  文本重新写一遍。于是 `pty.output.slice(mark)` 里出现旧文本**不代表**"事件刚刚发生"。
- **代价**：本会话白跑 2 次场景（每次约 3 分钟）+ 一次差点把测试改成迁就 bug 的绿色。
- **判据**：场景里的**决定性断言**必须落在"盘上产物 / 外部事实"上——会话文件内容与新建、
  provider 侧请求是否被回应、进程 PID 是否不变；pane 文案只用于"用户是否看见了提示"这类
  **单向**断言（正向出现；"没有出现"只在重绘不可能凭空造出该文本时才可信）。
  自查：`bash -c 'grep -n "slice(mark)" scripts/test-scenario-*.mjs'`，逐条问"这条是正向还是反向？
  重绘会让它假绿还是假红？"

## 8. `readdir` 给的 `Dirent` 类型在 PRoot/FUSE 下**不可信** ⇒ 遍历结果会"时好时坏"

- **症状**：同一个 `check-packs-structure.mjs`，前一分钟报 `147 个 SKILL.md`，下一分钟报
  `0 个 SKILL.md`（`packs` 目录数仍是 17）。期间没有任何文件被改动。
- **原因**：`fs.readdirSync(dir, { withFileTypes: true })` 的类型来自 `readdir` 的 `d_type`；
  在 Termux/PRoot 的 FUSE 视图下它可能是 `DT_UNKNOWN`，于是 `Dirent.isFile()` /
  `isDirectory()` **一律返回 false**。实测同一进程里 `packs/` 一层能给类型、
  `packs/books/` 一层全是 false（取决于目录项缓存状态）⇒ **行为不可预测**。
- **为什么没有静默放过**：该守门的 R7 拿"README 声明的经验沉淀数"与实测数比对，0 ≠ 17 直接报错
  （"计数必须等于实测"这条意外成了探针）。否则就是"守门全绿、其实什么都没查"。
- **判据**：遍历目录一律 `statSync` 兜底，不信任 `Dirent`：
  `const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };`
  自查：`bash -c 'grep -rn "withFileTypes" scripts/*.mjs custom 2>/dev/null'`，
  逐处问"这里依赖 d_type 吗？FUSE 下会不会全 false？"

## 9. PRoot/FUSE 下"覆盖更短的符号链接目标"不截断 ⇒ 留下 `0001` 尾巴；`cp -al` 还会**改到源**

- **症状 A（静默）**：`python3 -V` 仍能跑，但用的是**另一个解释器**（系统/Termux 的），
  报错却来自别处：`ImportError: dlopen failed: ... /libpython3.14.so is not accessible`。
  根因是仓内 `runtime/<平台>/py/bin/python3` 已变成**悬空链接**（目标 `python3.120001`），
  `[ -x … ]` 判定失败 ⇒ 解析器静默回退到 PATH 上的 python。
- **症状 B（更坏）**：`cp -al`（硬链接复制）在本机**会修改源仓库**——一次尝试把源仓库
  `runtime/` 下 **545 个符号链接**写成 `xxx0001`，还删掉了 `py/bin/python3`。
- **原因**：把链接目标写成 `target2` 时，若底层目录项原先存的是更长字符串且 FS 不截断，
  就会残留尾部（实测 `target1` → `ln -sfn target2` → `readlink` 得 `target20001`）；
  `cp -l` 为符号链接建硬链接在部分路径上**成功**，于是源与目标共享同一目录项。
- **判据**：
  - 创建/覆盖符号链接一律 **先 `rm -f` 再 `ln -s`**（本仓 `pi_py_repair_venv` 已如此）；
  - **不要用 `cp -al`** 复制含符号链接的树（用 `tar -cf - | tar -xf -`）；
  - 自查：`bash -c 'find runtime -type l -printf "%p -> %l\n" | grep -c "0001$"'` 应为 0；
    被污染时 `bash scripts/portable-runtime.sh repair` 从已校验的缓存归档重解包（自愈），
    守门 `check-portability.sh` 的 P5 与 `portable-runtime.sh verify` 都会拦。

## 10. `find -type f` 在本机 PRoot/FUSE 下会**间歇性漏掉普通文件**（比 #8 更毒：它会污染守门结论）

- **症状 A（守门虚假失败）**：`check-conventions.sh` 的"模式资产引用成对"突然报
  `0 个文件，0KB`，而同一目录 `ls` 明明有 9 个文件（8 图 + README）。
- **症状 B（同一路径类型会变）**：`find <png> -printf '%y\n'` 上一分钟输出 `l`（符号链接）、
  下一分钟输出 `f`（普通文件）；`stat` / `test -f` / `readlink` 始终说它是普通文件。
- **根因**：与第 8 条同族——PRoot/FUSE 的目录项类型/`lstat` 结果不可靠。
  `find -type f` 依赖该结果 ⇒ **命中数会随机变成 0**。
- **影响面（为什么列成陷阱而不是"本机怪现象"）**：
  - 断言"**必须有几个**"的守门 ⇒ **虚假失败**（本次实例：模式资产 8 个被判成 0 个）；
  - 断言"**不该有别的**"的检查 ⇒ **虚假通过**（更危险！例如引导包白名单、敏感文件扫描）。
  本次实测到两处真实代码依赖它：`scripts/check-conventions.sh`（E 段资产）与
  `scripts/bootstrap-key.sh`（引导包成员白名单，漏报方向虽安全但会造成假失败）。
- **判据（改法）**：枚举一律 `find <dir> -print0`，类型判定交给 `[ -f ]`（stat）：
  ```
  find "$dir" -print0 | while IFS= read -r -d '' p; do [ -f "$p" ] || continue; …; done
  ```
  体积用 `stat -c %s` 累加，不要 `find -printf '%s'`。
  自查：`bash -c 'grep -rn "find .*-type f" scripts .githooks'`（应无命中，或每处都能说明为何不受影响）。

## 11. 共享状态对外给"取走即销毁"的接口 ⇒ 多订阅者场景下静默丢数据

- **症状**：某功能"看着接上了却永远没数据"——处理器正常返回、字段只是**恰好为空**，
  没有报错、没有日志。2026-10-18 DSH 换基座实测：回合用量累积器对外是 `take()`（取走即清桶），
  而 `turn_end` 被**3 个特性**注册、适配层每个注册生成**一条独立订阅** ⇒ 一条 `turn/end` 触发
  3 条桥接，只有第一条拿到用量，`recordUsage` 恰好不是第一条 ⇒ token 记账永久丢失。
- **为什么容易漏**：单订阅者路径（自己写的小测试、自己的 `apply()` 便捷入口）**永远是对的**；
  只在"同一事件被多方订阅"的真实宿主拓扑里才暴露 ⇒ 本地全绿也算不出这条。
- **判据（改法）**：多订阅者共享的累积结果，对外**只提供只读**（`read`），回收交给明确的
  `drop` 或容量上限（LRU）；需要分桶时**必须带上所有区分维度**（此处是"会话 id + 回合号"，
  只按回合号会让两个会话的回合 1 串账）。
- **自查**：`bash -c 'grep -rn "function take\|\.take(" custom/adapters'`（本仓应无命中）；
  反向探针：注册 **2~3 个**同事件处理器，断言**每一个**都拿到同一份数据
  （单测 `usage-accumulator.test.ts` + 真包 spike **A20**）。
- 台账：[`docs/BUG-REPLAYS.md`](../BUG-REPLAYS.md) #40。

## 12. 上游"注册冲突"错误直接冒泡 ⇒ **连带丢掉该特性后面的一切注册**（且数量上看不出来）

- **症状**：真实宿主里某些能力就是没有，而**日志只说了一个冲突**。2026-10-18 DSH 换基座实测：
  `ctx.tools.register()` 抛 `tool "web_search" is already registered`，冒泡被"每特性 try/catch"接住 ⇒
  `web-search` 特性**排在后面的** `fetch_url` 没注册、`subagent`/`plan-mode` 的钩子（plan-mode 的
  只读护栏很可能就在里面）全没注册，而日志只有 3 行"注册功能失败"。（该名字 2026-10-18 已改名 `searxng`
  以避开宿主同名工具；此处保留当时的现场原文。）
- **为什么容易漏**：`registerAll` 的"每特性隔离"看起来是**健壮**的（"一个特性失败不拖垮其余"），
  于是没人去想"**特性内部**也会被截断"；而且少的是**钩子**，从工具数量上完全看不出来 ⇒
  必须专门把"已注册清单"（含钩子）打出来才能发现。
- **判据（改法）**：边界层里凡是"名字冲突"这类**可预期**的上游拒绝，就地 try/catch **只跳过该项**
  并点名上报（`registerTool.duplicate:<名>`）；同时提供**注册汇总**（成功项 + 跳过项 + 钩子清单），
  让"到底少了什么"可量。
- **反向探针**：① 让第 n 次注册抛"已注册"，断言**后面的注册仍然成功**；② 让注册抛**非冲突**错误，
  断言错误文本仍被上报（别把真故障也当成"冲突"吞掉）；③ 真 Host 上 grep 汇总行核对数量。
- 实现与守门：`custom/adapters/dsh/facade.ts`（`registerTool`/`registerCommand` 的就地隔离 +
  `registrationSummary()`）、单测 `dsh-adapter.test.ts`、诊断开关 `MY_PI_DSH_TRACE_EVENTS=1`。
- 台账：[`docs/BUG-REPLAYS.md`](../BUG-REPLAYS.md) #41。

## 13. `local`/`declare` 同一行里引用前面刚声明的变量 ⇒ `set -u` 下报 `unbound variable`

- **症状**：函数里写
  ```bash
  local label="$1" mode="$2" out="$LOG_DIR/run-$label.log"
  ```
  在 `set -u` 的脚本里直接失败：`line 89: label: unbound variable` —— **报错指向变量名**，
  看起来像"调用方没传参"，实际是写法问题。
- **根因**：`local`/`declare`/`export`/`readonly` 这类内建命令的**所有词先展开、再逐个赋值**
  ⇒ 同一行里 `$label` 展开时那个赋值还没生效。
- **判据（改法）**：拆成多条 `local`（或先算好再声明）。
- **复现**（一条命令看懂）：
  ```bash
  bash -c 'set -u; f(){ local a="$1" b="x-$a"; echo "$b"; }; f one'   # ❌ a: unbound variable
  bash -c 'set -u; f(){ local a="$1"; local b="x-$a"; echo "$b"; }; f one'  # ✓ x-one
  ```
- 台账：`docs/BUG-REPLAYS.md` #42。

## 14. `ln -sfn <源> <目标>` 在"目标已是**真目录**"时会把链接建到**它里面**

- **症状**：`ln -sfn "$SRC" "$D/node_modules/@scope"` 之后，`$D/node_modules/@scope/pkg` **依然找不到**
  ⇒ 看起来像"补了软链却没生效"。实际是生成了 `$D/node_modules/@scope/@scope → $SRC`。
- **根因**：`-n`（`--no-dereference`）只在**目标本身是符号链接**时把链接当作文件替换；
  目标是**已存在的真目录**时，`ln` 的行为是"在目录里建一个同名链接"（经典语义）。
  实测场景：`npm install` 因为 peerDependency 先建了真的 `node_modules/@deepseek-ai/`（含 `cordis`），
  于是整体软链把 `@scope` 建进了目录内部。
- **判据（改法）**：**逐包**补，跳过已存在的项（本仓 `scripts/dsh-build.sh` 早就是这么写的）：
  ```bash
  mkdir -p "$D/node_modules/@scope"
  for pkg in "$SRC"/*; do n="$(basename "$pkg")"; [ -e "$D/node_modules/@scope/$n" ] || ln -sfn "$pkg" "$D/node_modules/@scope/$n"; done
  ```
  想整体替换就先 `rm -rf` 目标（GNU 的 `ln -sfnT` 也行，但可移植性差）。
- **复现**：`bash -c 'mkdir -p /tmp/ln-probe/{src,dst/@s}; touch /tmp/ln-probe/src/p; ln -sfn /tmp/ln-probe/src /tmp/ln-probe/dst/@s; ls -l /tmp/ln-probe/dst/@s'`
  （会看到 `dst/@s/@s -> /tmp/ln-probe/src`）。
- 台账：`docs/BUG-REPLAYS.md` #43。

## 15. 把依赖 `this` 的方法"取下来"再调用 ⇒ 静默 undefined；而**箭头函数 fake 会把这个 bug 保护起来**

- **症状**：`const f = ctx.sessionManager.getSessionFile; f()` 在 `this` 依赖型方法上**抛 TypeError**，
  若外面有 try/catch（我们为了"不炸"而加的那些）⇒ **静默返回 undefined**，功能"看起来还在跑、只是什么都没存"。
  实际事故：`sessionKeyOf()` 因此对 pi 恒返回 `undefined` ⇒ 模式记录键为 undefined、重启请求 `targetSession` 为空
  ⇒ 留出集"模式切换/两实例隔离"从 **33/33** 掉到 **11/33 / 8/33**（`docs/BUG-REPLAYS.md` #44）。
- **为什么单测没抓到（最值得记的一点）**：测试里的 fake 写成
  `{ sessionManager: { getSessionFile: () => '/x.jsonl' } }` —— **箭头函数不依赖 `this`**，
  所以解绑调用照样通过 ⇒ **fake 把 bug 当成了契约**（与第 6 条"测试可能是 bug 的保护壳"同源）。
- **判据（改法）**：① 调用时保住接收者：`sm?.getSessionFile?.()`，或包一层闭包 `() => sm.getSessionFile?.()`；
  ② **fake 要模仿真实实现的形状** —— 用 `class`/对象方法（`getSessionFile() { return this.x }`）而不是箭头函数属性。
- **复现**：`node -e 'const sm={f:"x",getSessionFile(){return this.f}}; const g=sm.getSessionFile; try{console.log(g())}catch(e){console.log("throws:",e.message)}'`
- 台账：`docs/BUG-REPLAYS.md` #44。

## 16. 把**派生产物**当事实来源写 ⇒ 记录被生成器静默覆盖（还打印"已记录"）

- **症状**：`record-change.mjs --reject` 打印"✓ 已记录被否的提案"，但**下一次**重建台账时那条记录消失。
  更隐蔽的是：约定守门发现台账漂移后**提示你跑的正是抹掉它的那条命令**。
- **根因**：`docs/CHANGES.jsonl` 是**派生物**（`gen-changes-ledger.mjs` 用 `git log` + `DECISIONS.md`
  整个重新生成；`rejected` 抽取自 `DECISIONS.md`），而写入方却往派生物里追加 ⇒ 写进了"会被覆盖的文件"。
- **判据（改法）**：① **写事实来源**（生成器读的那个文件/表），不写生成物；
  ② 写完**自检**"它真的出现在派生结果里"（进不去就报错，不许打印成功）；
  ③ 工具自己触发重建，避免留下"漂移 → 按提示重建 → 记录被抹掉"的陷阱路径。
- **复现**（一条命令看懂修前的行为）：
  `node scripts/record-change.mjs --reject "探测" --reason "探测用"; node scripts/gen-changes-ledger.mjs --check; node scripts/gen-changes-ledger.mjs --update; grep -c "探测" docs/CHANGES.jsonl`
- **同类**：任何 `*-generated.* / *.jsonl（由脚本重建） / docs/INDEX.md / docs/knowledge/**` 都属"只读派生物"，
  要改就改它们的源，或改生成器。
- 台账：`docs/BUG-REPLAYS.md` #45。

## 17. `pkill -f <pattern>` 会匹配到**你自己的命令行** ⇒ 自杀

- **症状**：命令返回 `[killed by signal: SIGTERM]`，后续语句一条没跑（比如本该删凭据的 `rm` 没执行）。
- **根因**：`pkill -f`/`pgrep -f` 匹配的是**整条命令行**，而你"正在敲的那条命令"里就含这个 pattern。
  实际事故（2026-10-17）：`pkill -f "profile mypi.*--port 3099"` 把自己的 shell 杀了，
  导致清理步骤中断、隔离 home 里的凭据副本没删掉（事后手工补删）。
- **判据（改法）**：① 用字符类打断自匹配：`pgrep -f "[e]xt/dsh/node_modules/.bin/dsh"`；
  ② 或先 `pgrep` 看 PID、再按 PID `kill`；③ 或按端口 `fuser -k 3099/tcp`；
  ④ 杀完**必须复验**（端口/进程），别假设清理成功。
- **同类**：`grep` 自己的输出、`ps | grep`（不带 `[]` 技巧时的经典坑）。

## 18. 把"症状汇总表"当病因：`Missing services` 不是根因

- **症状**：`dsh` 启动失败，输出一张 `Plugin / Missing services` 表（`connection` 缺 `webRuntime`、
  `webServer` 缺 `session-controller`…），看起来像"宿主包不全/版本不对"。
- **真实原因**（本次）：`EADDRINUSE: 127.0.0.1:3099` —— 上一轮的实例还占着端口，
  一串依赖 `webServer/connection` 的插件因此没激活，于是被**汇总成"缺服务"**。
- **判据（改法）**：先看 `DSH_HOME/logs/startup-*.log` 里的 `Failed plugins (...)` 那一段的**第一条 cause**：
  `grep -aiE "EADDRINUSE|Failed plugins|MODULE_NOT_FOUND" logs/startup-*.log | head`。
  端口/权限/网络这类"外部条件"失败，会被健康检查**二次表述**成依赖缺失 —— 别对着症状表改依赖。
- **同类提醒**：`dsh --dump-config` 打印的是**配置文档**（连 `!!js` 表达式都原样打出），
  **不是**解析后的运行时值 ⇒ 不能用它证明"配置生效"（要看运行时真值就写一行读回日志，或在 Host 里实测）。

## 19. 把插件 `apply` 改成 `async` ⇒ 工具在全局工具面**看不见**

- **症状**：`apply` 改成 `async` 后，插件自己的 `apply` 里 `ctx.tools.register()` 明明都执行了
  （facade 汇总里有 54 个工具），但**经 cordis 装载**后 `tools.schemas()` 返回 **0**；
  直接 `await apply(ctx)` 又正常 54 个。⇒ 模型的第一请求里工具全缺席。
- 实测（2026-10-17，DSH 插件入口）：`cordis 装载 ⇒ 0`、`直接 await apply ⇒ 54`；
  spike **A19 立刻从 54 掉到 0**（`注册 0 个工具；admin_get_config.type=undefined`）。
- **判据（改法）**：插件入口的 `apply` **保持同步**；需要异步准备的东西（如动态 import 宿主包）
  在**模块加载期**用顶层 `await` + `try/catch` 取好，`apply` 里只做同步注册。
- 台账：`docs/BUG-REPLAYS.md` #46。

## 20. "注册调用成功" ≠ "工具面可见"：缺注入会**静默不激活**

- **症状（同一件事的两次误判）**：
  ① 在**自己的** ctx 上 `ctx.plugin(宿主工具插件)` ⇒ 它缺 `tools/subagents/systemPrompt/sessionProjections`
  注入，于是**静默不激活**；我的日志却写着"注册 2 个"（只看调用、不看结果）。
  ② 改走 `ctx.inject([…], child => child.plugin(...))` 后，立刻读 `tools.schemas()` 又报"可见 0 个" ——
  因为 inject 回调**异步落地**，读得太早。
- **判据（改法）**：
  1. 装载要服务的子插件时，用 `ctx.inject(所需服务, child => child.plugin(...))`，
     **不要**在自己的 ctx 上直接 `plugin()`；
  2. 上报前做**行为验证**：`tools.schemas()` 前后对比，报"真正出现在工具面"的数量；
  3. 行为验证要**给足时间窗**（`setTimeout(0)`/等一拍），并区分"注册调用成功"与"工具面可见"两个数字；
  4. 两者不一致就**明确告警**，不要打印成功。
- 实测对照：会话请求里出现 `reviewer, scout`（工具面确实可见）时，我的自检因读得太早报"可见 0 个" ⇒
  一条"假阴性告警"和一条"假阳性成功"本质是同一个错：**不看行为、只看调用**。

## 附：一条与"记录"本身有关的陷阱

**"写进台账" ≠ "记进会被人翻到的地方"** —— 本会话多次出现：内容在 `DECISIONS.md`（台账）里，但
`BUG-REPLAYS` / 知识库 / 技能 / 设计文档里**一处都没有** ✗。
**判据**：`bash -c 'grep -rl "<关键词>" docs packs portable scripts | grep -v DECISIONS'`（结果为空 ⇒ 只躺在台账里 ✗）。
