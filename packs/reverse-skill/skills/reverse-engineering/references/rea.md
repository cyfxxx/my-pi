# REA（Reverse Engineer Anything）—— 可选外部引擎接线

> 上游：[morluto/rea](https://github.com/morluto/rea)（仓库 description 原文：`Reverse engineer anything with agents, from app behavior down to native binaries.`）
> 本文件只写**怎么把它接进本包**；它自己的用法以它随包的 bundled skill 与 `rea --help` 为准。
> **核实日 2026-10-14**，核对面 = npm `rea-agents@6.5.0` ↔ release `rea-agents-6.5.0`（`target_commitish: 3b79af28e80785afce9f5998d8f03289402a1847`）↔ 上游 `docs/installation.md` / `docs/client-configuration.md` / `docs/cli.md` / `server.json` / `install.sh`。
> 抓取通道说明：本机只能走 `api.github.com`（`raw.githubusercontent.com` / jsdelivr / jina 等在本机全部不可达，`curl` 被 reset）⇒ 原文取自 API 的 base64 内容字段。

## 0. 它是什么（一句话）

REA = **CLI + MCP server（同一套 workflow / Evidence 引擎）+ 一个随产品的 bundled skill**。官方定位原文：
> `One MCP for reverse engineering across binaries, applications, and runtime behavior.`

⇒ 因此在本包里它**不是**路由器、也不是第二套路由表：**`config/routing.json` 仍是唯一 PRIMARY 事实源**；REA 只作为**域 skill 内的可选引擎**出现（关键词归 `R0`，见 §5）。

## 1. 什么时候用它（MUST 先判，别为了用而用）

| 适合交给 REA | 不该用 / 要谨慎 |
|---|---|
| 需要"一句话把某一类容器格式/Target 走完静态分析"：JavaScript/Electron bundle、.NET 托管、Android（JADX/Apktool/Flutter APK）、Dart AOT、WASM、Mach-O、Go/Android/… 元数据、Electron fuses、HarmonyOS HAP | 本包 `tool-index` 里**已有现成 CLI** 就能完成的活（jadx / frida / radare2 / IDA / Ghidra…）——先用手上的工具 |
| 离线**证据**分析：pcap / QUIC qlog / Fiddler SAZ / HAR / SQLite 快照 / 记录到的崩溃 core / 记录到的逻辑信号 | `capture-*` 与 **Frida 仪器化**：上游明确写 `Instrumentation executes foreign code and is destructive, not read-only.` ⇒ 必须先过 scope/auth（本包 `ops/scope-contract`） |
| 需要 Ghidra / IDA / Hopper 桥，但本机没配对应 MCP | 商用工具（IDA / Hex-Rays / Hopper / JEB）**未获授权**：上游原文 `You must legally obtain and be authorized to use commercial tools ... REA grants no tool license, key, or activation entitlement.` |
| 需要**分页/紧凑**的 Evidence 输出（token 敏感的长分析） | 平台不在其声明面内（见 §4）——**先实测 `doctor` 再依赖** |

## 2. 安装（手动、pin 版本；按 `ops/skill-supply-chain.md` §3）

**不进自动安装清单**：`scripts/bootstrap-manifest.json` 现有 24 项自动装能力，REA **不在其中**——供应链门闩要求自动装必须有 `pinnedVersion`/`pinnedCommit`/`pinPolicy`/asset hash，而它走 npm 渠道，我们选择**手动装 + 版本钉死**。

```bash
# 一次性（不落盘、最省事）
npx -y rea-agents@6.5.0 --help
npx -y rea-agents@6.5.0 doctor --json          # 环境自检（provider/依赖/客户端）
npx -y rea-agents@6.5.0 mcp doctor --json      # MCP 生产启动自检

# 全局（要用 `rea` 这个名字时）
npm install --global rea-agents@6.5.0
rea --help
```

- 上游 README 另给 `npx rea-agents setup`（交互式注册客户端 + 装 bundled skill）与 `rea update`；**本包口径**：`setup` 会写客户端配置、`--skill` 会往 skills 目录落文件 ⇒ **先 `--dry-run` 看清目的地再 `--yes`**。
- 上游还给 curl 包装：`curl -fsSL https://raw.githubusercontent.com/morluto/rea/main/install.sh | bash`（脚本内部就是 `npm install --global`，Linux 强制 `--prefix "$HOME/.local"`）。**本包口径：管道执行外源脚本必须用户显式同意**（`ops/skill-supply-chain.md` §2）⇒ 优先上面那两条显式命令。
- **无 Docker**（README/docs/install.sh/server.json/package.json 中 `docker` 0 命中）；**无独立二进制 release**（6.3.0 / 6.4.0 / 6.5.0 的 `assets` 均为空数组）。
- Bun 路线（上游原文 `With Bun, use bunx rea-agents@latest in place of npx rea-agents@latest.`）在本包**未实测** ✗。

## 3. 接入本机 Agent（MCP）

- **传输：stdio**（`server.json`: `"transport": {"type":"stdio"}`），无 SSE/HTTP 声明。
- **启动命令**：`npx -y rea-agents@6.5.0 mcp`（server.json 用 positional 参数 `mcp` 表达）。
- **工具规模：172 个**（上游 `docs/client-configuration.md` 原文：`On main at 04089d5b, with 172 tools, that payload measured about 496 KB with the default profile and about 290 KB with compact.`）⇒ **挂载前想清楚上下文成本**，长会话优先用 `compact` profile。
- 通用片段（上游 `docs/installation.md` 原文）：

```json
{
  "mcpServers": {
    "rea": {
      "command": "npx",
      "args": ["-y", "rea-agents@6.5.0", "mcp"]
    }
  }
}
```

### 3.1 调用方接线示例：my-pi / pi（本仓库，已按源码核实）

> 本节是**调用方（consumer）接线**说明，不参与本包的路由/测试/工具清单——本包核心保持 client-neutral（见 `AGENTS.md` 与 `ops/IDENTITY.md`）。

上游把 `pi` 列为官方 client：`setup writes a type: "stdio" entry under mcpServers.rea in the user-level ~/.pi/agent/mcp.json`。**在 my-pi 里这会落错地方** —— 本仓库的源码证据：

| 事实 | 证据 |
|---|---|
| pi 的 agent 目录优先取环境变量 `PI_CODING_AGENT_DIR` | `vendor/pi/packages/coding-agent/src/config.ts:605-611`（`getAgentDir()`：`process.env[ENV_AGENT_DIR]` 优先，否则 `~/.pi/agent`） |
| MCP **全局**配置 = `<agentDir>/mcp.json` | `vendor/pi/packages/coding-agent/src/extensions/mcp/cli.ts:373`：`join(options.agentDir, "mcp.json")`（`:411` 同） |
| my-pi 把该变量指向仓库内 | `my-pi.sh:12`：`export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/agent"`（`scripts/pi-supervisor.sh:65` 同） |

⇒ **在 my-pi 下必须显式带上变量**，否则条目写进 `~/.pi/agent/mcp.json` 而 my-pi（读 `portable/agent/mcp.json`）看不到：

```bash
# 先看计划（不改任何文件）
PI_CODING_AGENT_DIR=/root/my-pi/portable/agent npx -y rea-agents@6.5.0 setup --client pi --dry-run --json
# 再落盘
PI_CODING_AGENT_DIR=/root/my-pi/portable/agent npx -y rea-agents@6.5.0 setup --client pi --yes --json
# 核对（同一变量）
PI_CODING_AGENT_DIR=/root/my-pi/portable/agent npx -y rea-agents@6.5.0 doctor --client pi --json
# 结果自证：文件与内容
node -e 'const p="/root/my-pi/portable/agent/mcp.json";console.log(require("fs").readFileSync(p,"utf8"))'
```

- 也可以直接手写 `portable/agent/mcp.json`（§3 的片段），效果等价。
- **改完要 `/reload`**：上游原文 `Run /reload in an existing Pi session after changing servers outside the session.`（本仓库的 `/reload` 行为见 `custom/features/mode/README.md`：会重跑扩展工厂）。
- 同名的**项目级**配置（`<project>/.pi/mcp.json`）会覆盖用户级；`--no-tools`/`--tools` 等作用域开关与 my-pi 的 `PI_*` 覆盖无关。
- DeepSeek Harness（`--client dsh`）**不在本包范围**：它会写 `$DSH_HOME/cordis.patch.yml`，工具名形如 `mcp__rea__<tool>`。

## 4. 平台与前置（决定"本机到底能不能用"）

- **声明支持**：Linux x64/arm64 + macOS x64/arm64；Windows 仅 `experimental Windows x64 P0`（Ghidra provider 原文：`REA connects to an existing Ghidra installation on Linux x64/arm64, macOS x64/arm64, or experimental Windows x64 P0.`）。
- **运行时**：Node `^22.19.0 || ^24.11.0 || >=26.0.0`（23 / 25 / 预发布**不支持**）；Linux 需要 **procps 兼容的 `ps`**（它自己要求做 ownership 检查）；**SQLite 能力**要 Node ≥24.15 或 26+。
- **外部工具按需、由调用方提供**（上游 "What you can analyze" 表）：Ghidra / Hopper / IDA、JADX+完整 JDK、Apktool、adb、JEB、binwalk/unblob、TShark 4.x + prlimit、sigrok-cli 0.7.2 + prlimit、WABT 1.0.42、pwntools、mitmdump、Chrome 系浏览器。
- ★ **本机（Termux / PRoot aarch64）不在声明面内** ✗：`Termux`/`PRoot` 在 README、`docs/installation.md`、`client-configuration.md`、`cli.md`、`install.sh` 中 **0 命中**（Termux 只出现在上游一个把 Termux 当**浏览器采集目标**的 CI 工作流 `.github/workflows/real-termux.yml` 里，不构成宿主支持声明）。
  ⇒ **本机要用必须先实测**：`npx -y rea-agents@6.5.0 doctor --json` + 一次最小分析；失败按"能力不可用"处理（上游错误码族：`capability_unavailable` / `provider_unavailable` / `execution_failure`），**不要**把上游文档当本机保证。
- Linux **aarch64 有支持声明**（`install.sh` 的 arch 映射 `arm64|aarch64) node_arch_label="arm64"`；`Linux ARM64 uses linux_arm_64`）⇒ aarch64 不是问题，**proot 容器语义**才是未核实项。

## 5. 与本包契约怎么接（MUST）

1. **路由**：先跑 `scripts/master-route.sh`（Linux）或 `scripts/master-route.ps1`（Windows）定 PRIMARY。REA 的关键词归 **`R0`（通用逆向）**：`\brea\b` / `rea-agents` / `reverse engineer anything` / `rea mcp` / `rea doctor` / `rea cli`。⇒ 点到 REA 就落到 `reverse-engineering/`，再由你决定用不用它；**同时点名了具体域（APK/IDA/协议…）时，域 skill 仍按其规则优先**。
2. **授权**：任何 ACT（含 `capture-*`、Frida 仪器化）之前先 `scripts/case-init.sh` 落 `work/<case>/scope.md` 且 `auth granted`；REA 自己的合规声明也只允许"你拥有或获授权的软件"。
3. **证据**：REA 的 JSON 输出是**素材**不是结论——按本包 Evidence→Finding→Path 组织，交付前过 `case-review/scripts/review_case.py`。
4. **供应链**：升级 REA ⇒ 必须同步更新本文件的版本/日期与 `references/community-security-skills.md` §1.2，并记录"哪个域、用它做了什么、结论是否被独立复核"。

## 6. 未核实（✗ 如实标注，勿当保证）

- `rea --help` 的**全量子命令清单**：未安装、未执行任何 REA 命令 ⇒ 本文命令均来自上游 docs 原文 ✗。
- **172 个工具的逐个名字**：`docs/mcp-contracts.md`（51 KB）未抓全 ✗（172 是上游在 main@`04089d5b` 上的测量值，非 6.5.0 tarball 实测）。
- **Termux / PRoot 宿主可用性**：0 命中、未实测 ✗。
- 本机（aarch64 + proot）上的 **npm 安装体积/耗时**、`optionalDependencies: {"frida":"17.23.2"}` 能否装上 ✗。
- **Bun 路线**、`install.sh` 路线、`--client pi` 在本机的**实际写入内容**（未跑 `--dry-run`）✗。
- 上游 `docs/testing.md`（94 KB）与 `CHANGELOG.md`（366 KB）未逐条读 ✗。
