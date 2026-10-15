# reverse-skill（packs）经验记录

> 本文件按 my-pi `packs/README.md` 的"经验沉淀机制"维护：每条含**日期 / 技能名 / 环境**（环境必标，防跨设备误会）。
> 本包是上游 [zhaoxuya520/reverse-skill](https://github.com/zhaoxuya520/reverse-skill) 的 vendored 副本；**能改上游文件时优先走上游**，本文件只记"我们这一侧"的接线与实测事实。

## 2026-10-14 REA（morluto/rea）接线

- 环境: proot-ubuntu aarch64 (Termux/PRoot) + Node v22.23.1；**未安装 REA**（按 `ops/skill-supply-chain.md`：手动、pin 版本、不自动装）
- 场景/经验:
  - **上游 `morluto/rea` 与本包不是同一个东西**：本包是"路由 + 域 skill"，REA 是"CLI + stdio MCP 引擎"。接法是**把 REA 当域 skill 里的可选引擎**，关键词挂 `R0`、**不新增路由、不动 priority**（`MASTER-ROUTING.md` 的优先级表与 `routing.json` 必须一一对应，动 priority 会让 Windows 侧 coherence 门禁有漂移风险，而本机没有 pwsh，跑不了那道门禁）。
  - **本机抓取通道的事实**（供后人省一次排查）：`curl` 到 `raw.githubusercontent.com` 在本机被 reset（HTTP 000）；jsdelivr/jina/statically/githack 全失败；**只有 `api.github.com` 可用**，它的 `contents`/`readme` 返回 **base64**，解码后即为原文 ⇒ 离线核对上游文件靠这条路。
  - **my-pi 侧的接线陷阱（已按源码核实）**：上游 `rea setup --client pi` 把 MCP 条目写进 `~/.pi/agent/mcp.json`；而 **pi 的 agent 目录优先取 `PI_CODING_AGENT_DIR`**（`vendor/pi/packages/coding-agent/src/config.ts:605-611`），MCP 全局配置 = `join(agentDir,'mcp.json')`（`extensions/mcp/cli.ts:373/411`），my-pi 又把它指向 `<repo>/portable/agent`（`my-pi.sh:12`）⇒ **必须带 `PI_CODING_AGENT_DIR=… setup --client pi`**，否则条目落到 `~/.pi/agent/`，my-pi 读不到。
  - **REA 的平台声明面不含 Termux/PRoot**（0 命中）⇒ 本机要不要用，先 `npx -y rea-agents@6.5.0 doctor --json` 实测，别把上游文档当本机保证。
  - `master-route.sh` 会**写文件**（`work/master-route-<ts>/route-scope.md`，`work/` 已 gitignore）⇒ 冒烟后记得清，免得提交里混入生成物。
- 本次跑过的验证（可复跑）:
  - `bash skills/scripts/test-routing.sh` → **171/171 PASS**（原 168 + 新增 3 条 REA 用例；`[]/` 无回归）
  - `bash skills/scripts/test-bootstrap-manifest.sh` → passed（未动 manifest）
  - `bash skills/scripts/master-route.sh --hint "用 rea 逆向这个 electron 应用"` → PRIMARY `skills/reverse-engineering/SKILL.md`（confidence: high）
  - `node -e 'JSON.parse(...)'` → `config/routing.json` / `tests/routing-benchmark.json` 合法
- 未跑/未核实（✗）: `verify-routing-coherence.ps1` 与 `test-routing.ps1`（本机无 pwsh；**priority 与 `MASTER-ROUTING.md` 表未改动**，故该门禁的两条不变量按构造保持）；`extract-summaries.ps1`（未新增 `SKILL.md` ⇒ `INDEX.md` 不受影响）；REA 本体（未安装、未执行任何 `rea` 命令）。

## 2026-10-15 上游同步（vendored 快照 → upstream main `cab634bd`）

- 环境: proot-ubuntu aarch64 (Termux/PRoot)；无 pwsh ⇒ **两道 PowerShell 门禁跑不了**（如实用等价复刻替代，见下）
- **通道事实（省后人一次排查）**：本机 `curl`/`git` 到 `raw.githubusercontent.com`、`cdn.jsdelivr.net` **全部 000/reset**；
  `api.github.com` **通**（HTTP 200）；`codeload.github.com` 与 `api.github.com/repos/<o>/<r>/tarball/main` **都通**（3,762,168 B）；
  `gitclone.com` 也能 `ls-remote`，但它对本仓返回的是**陈旧快照**（HEAD=2026-06-12 `fe2e2def5`，无 `VERSION`）⇒ **不可当上游用** ✗。
  ⇒ 正确做法：`curl -sSL https://codeload.github.com/zhaoxuya520/reverse-skill/tar.gz/refs/heads/main` **一次拿全仓**（还省 API 配额：未认证只有 60/h）。
- **完整性校验（关键手法）**：用 `api.github.com/.../git/trees/main?recursive=1` 拿 **path+blob sha** 全表（880 条/599 blob），
  再对解包内容逐文件 `git hash-object --path=packs/reverse-skill/<path> <file>` 比对 ⇒ **599/599 一致** ✓。
  ★ 坑：GitHub tarball 会按 `.gitattributes` 做**行尾转换** ⇒ `.ps1`/`.bat`（`eol=crlf`）在 tarball 里是 CRLF（37 个 CR），
  直接 `git hash-object` 会**假不一致**（42 个）✗；按 CRLF→LF 归一化后全部对上 ✓（且这正好说明"工作树该是 CRLF、blob 是 LF"）。
- **合并策略（保住本地定制）**：用 `git merge-file` 三方合并：base=`edd62689f^:<path>`（vendored 快照）、ours=`HEAD:<path>`、
  theirs=上游文件。结果：**56 个纯上游变更直接取上游、26 个新增文件直接加、9 个需三方合并**（4 个是 `edd62689f` 的旧定制 +
  5 个是本次 REA 相关改动）。冲突只有 3 个文件：README.md / README_zh.md（都是**数字行**）/ routing-benchmark.json
  （上游把 JSON **重排成 2 空格缩进** ⇒ 整文件冲突）⇒ 前两个取上游结构 + **实测数字**（44 路由 / 181 用例 / 45 模块）；
  benchmark **整取上游 178 条 + 追加我的 3 条 REA 用例 = 181** ✓。
- **验证（全部可复跑）**：
  - `bash skills/scripts/test-routing.sh` ⇒ **181/181 PASS**（含上游新增的 R44/R45/R40 用例与我的 3 条）
  - `bash skills/scripts/test-bootstrap-manifest.sh` ⇒ passed
  - ★ **上游新引入的两个守门**（本仓无 pwsh 也能跑）在**独立副本**里跑（脚本假设 cwd=仓库根，vendored 场景下会误读父仓的 `git ls-files`）：
    `python3 skills/scripts/verify-doc-links.py` ⇒ **OK（所有内部 Markdown 链接可解析）**；
    `python3 skills/scripts/verify-repository-security.py` ⇒ **OK（tracked=600 / executable_sources=74 / binary_like=1 / agent_entries=4 / symlinks=0）**
  - **等价 coherence 复刻**（镜像 `verify-routing-coherence.ps1` 的机械判据）：routes=44 / priority 1:1 / MASTER-ROUTING 表与 JSON 顺序一致 /
    benchmark 覆盖每条路由 / expect 全部存在 / INDEX 存在 / RULES(.md,_zh) 含 case-init+scope+auth 硬门 / master-route.ps1 无硬编码路由表 ⇒ **全过** ✓
- **未跑（✗ 如实）**：`verify-routing-coherence.ps1`、`test-routing.ps1`、`smoke.ps1`、`extract-summaries.ps1`（本机无 pwsh）；
  `INDEX.md` 未用生成器重跑（直接取上游版本；模块数=45 与上游 README 一致 ✓）。

## 2026-10-15 补记：入库时被 `.gitignore` **静默吞掉**的上游文件（1 个补回 / 1 个有意排除）

- 环境: 与上一条同机（proot-ubuntu aarch64）；**本次未执行本包任何脚本**（只做文件比对与 `git add`）
- 场景/经验:
  - 全量体检时把本仓 `git ls-files packs/reverse-skill` 与上游快照（`cab634bd` 的 codeload 解包目录）**做集合差**，
    发现上游有、本仓没有的文件 **2 个**，两者在上游都**已跟踪**（能从 GitHub tarball 解出来即为证），
    却在本仓 `git add -A` 时被**静默跳过**：`docs/plans/2026-09-21-pwntools-kali-discovery.md`（11,741 B）命中
    **父仓根 `.gitignore:34 plans/`**（通用规则会递归进 vendored 目录）；`reports/2026-05-26_new-hahacc-ctf-pentest-report.md`（3,656 B）
    命中**本包自带的 `.gitignore:70 reports/`**。
  - **后果形态**：不报错、`git status` 也看不见（"未跟踪且被忽略"）⇒ 只有"逐文件比对上游"这种主动手段能发现。
    这也是上一节"599/599 一致"与本节看似矛盾的原因：那次比对的是**解包所得**，不是**入库所得** ✗✓。
  - **处置（两者不同，别一刀切）**：
    - `docs/plans/…` ⇒ **`git add -f` 补回**（它是与 pwntools 发现流程相关的设计文档，本包该有；被吞纯粹是父仓通用规则的误伤）。
    - `reports/…` ⇒ **有意不发布**：它是**针对真实第三方域名 `new.hahacc.com` 的渗透报告（含可复现 PoC）**，而上游 `.gitignore`
      自己的注释就是"报告（防未脱敏泄漏）"；本仓是公开仓库，且本仓约定里"数据默认不出本机"。**冲突时取更严的一方** ⇒
      该文件从工作区删除、**不** `git add -f`（需要时从上游 tarball 重新取，仅本地查看）。
    - 最终追踪数 **600** = 上游 599 − 1（有意排除 `reports/`） + 本侧 2（`EXPERIENCE.md`、`skills/reverse-engineering/references/rea.md`）。
      包入口在 `skills/SKILL.md`（`packs/INDEX.md` 已注明；结构守门 `scripts/check-packs-structure.mjs` 的 `ROOT_ENTRY_ALIAS` 也钉住了这条）。
  - 纪律（已写进 `packs/README.md` 更新与整合原则第 5 条）：**每次 vendored 同步后必须比对文件集**，差集里每一项都要有书面理由
    （补回 / 有意排除），不能"没报错就算同步完了"；`scripts/check-packs-structure.mjs` 的 R5 会在 packs 下出现
    "未跟踪且被忽略"的文件时直接让守门失败（把这一类从"沉默"变成"响铃"，包括将来同步又把 `reports/` 解包出来的情况）。
  - 可复跑的自查命令：`git ls-files packs/reverse-skill | wc -l`（应 =600）；`git ls-files --others --ignored --exclude-standard packs`（应为空）；
    重新解包上游后 `git status --ignored` 若再次出现 `reports/`，按上文删除即可（**不要** `git add -f`）。
