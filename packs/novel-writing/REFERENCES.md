# 来源、许可与取证（novel-writing pack）

## 一、本包既有三源（详见 SKILL.md §来源与许可）

| 来源 | 许可 | 贡献 |
|---|---|---|
| zy-zmc/tianming-skill | CC BY-NC-SA 4.0 | 分层架构；六大协议；一致性法典；文风四件套；知识库装配契约 |
| xiaofeng-928/chinese-longnovel-skill | MIT | 50 章分批；上下文组装与事实锁；状态回证；伏笔追踪；双重审查+哈希绑定 |
| ExplosiveCoderflome/ani-book-skill | Apache-2.0 | 连续性账本；去 AI 味二稿；质量债与恢复工作流 |

整合版许可：**CC BY-NC-SA 4.0**（取三者中最严格者）。

## 二、2026-10-10 新增借鉴：Narcooo/inkos

- 仓库：github.com/Narcooo/inkos（`package.json` 里 version **2.0.0**，描述 "Story Creation AI Agent for novels,
  short fiction, scripts, interactive worlds, and multilingual translation"）
- **许可：AGPL-3.0** —— 读了仓库根 `LICENSE`（**34,523 字节**），前三行为
  `GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007`

### 取证（通道 + 证据，不是"网上说的"）

- 探测：`node scripts/net-mirror.mjs --probe` ⇒ 当次 **7/9 可用**；记录追加在 `portable/memory/logs/net-probe.jsonl`
- **实际使用通道：直连 git** ——
  `git clone --depth 1 https://github.com/Narcooo/inkos` ⇒ **成功：792 个文件 / 31 MB**（github.com 当次 200）
- 踩过的坑（如实记录）：本机网络在 **000↔200 之间波动**；`gitclone.com` 我几轮前实测可用、**后来 `ls-remote` 502** ✗
  ⇒ **任何"某通道可用"的结论都会过期**，每次都要看**字节数**而不是状态码。

### 我们取的是什么

**只取机制与思想**：章节意图（must-keep / must-avoid / 冲突处理）、上下文**编译轨迹**（含保护层级）、
**角色×信息矩阵**、**检索投影可重建且不作事实权威**、审稿意见与完成态分离、**可选的趋势扫描**。
**未复制任何代码或提示词原文** ✓。

**读了正文的**（真实路径，逐条可核对）：`README.md`（§工作原理 425-500 行区间：八角色职责表、长期记忆三层、
控制面与运行时产物、创作规则体系）、`skills/SKILL.md`（标题结构）、`package.json`（头部字段）、`LICENSE`（前 3 行）。

**只确认存在、未读正文** ✗（不据此提炼任何内容）：`spec/creative-harness-v2.md`（74 行）、
`docs/harness-result-first-redesign.md`、`packages/{cli,core,studio}/**` 源码（**未读**，故其实现细节未核实）。
⇒ 本文所有借鉴项均来自上表"读了正文的"文件；**没有把"文件存在"当成"我看过内容"** ✓。

### AGPL-3.0 的处理（重要）

AGPL 是**强 copyleft**：如果将来要**复制它的代码或提示词原文**，本包的许可与发布方式**必须重新评估** ✗。
目前本包的 **CC BY-NC-SA 4.0 只覆盖我们自写的文本** ✓，与 AGPL 无冲突。

### 不采纳的项与理由（比堆功能更有价值）

1. **它的运行时依赖**（Node / SQLite FTS5 / Zod schema / 多 Agent 编排）✗ —— 本 pack 的既有承诺是
   "Markdown 项目 + 纯 Python 校验、对平台无依赖"，引入运行时依赖会背离它；
2. **Studio / Play 互动影世界** ✗ —— 超出"长篇网文工程化写作"的范围，属另一条产品线；
3. **提示词原文** ✗ —— AGPL 且与我们的文风/结构不一致（我们只保留**机制**）；
4. **趋势雷达**：**部分采纳** —— 只作**可选前置**（可跳过 ✓），因为它的价值依赖平台数据源，我们无法在离线环境复现。
