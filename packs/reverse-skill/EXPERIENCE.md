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
