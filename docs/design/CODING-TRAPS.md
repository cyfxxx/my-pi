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

## 附：一条与"记录"本身有关的陷阱

**"写进台账" ≠ "记进会被人翻到的地方"** —— 本会话多次出现：内容在 `DECISIONS.md`（台账）里，但
`BUG-REPLAYS` / 知识库 / 技能 / 设计文档里**一处都没有** ✗。
**判据**：`bash -c 'grep -rl "<关键词>" docs packs portable scripts | grep -v DECISIONS'`（结果为空 ⇒ 只躺在台账里 ✗）。
