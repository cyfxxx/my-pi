# DSH 升级 runbook（换 DSH 版本时照这个来）

> ⚠️ **本文件描述 DSH 分支（`feat/base-switch-dsh` / `v1.3.0-dsh`）的升级流程**；`main` 已回退到合并前，
> 现状与处置见 [DSH-ROLLBACK.md](../design/DSH-ROLLBACK.md)。

> 适用：`@deepseek-ai/dsh` 从 `0.2.0-rc.2` 往上升（含 RC 之间的破坏性变更）。
> 结论先行：**版本只有 3 处钉死、形状只有 1 处钉死**，升级成本主要在"跑验证"而不是"改代码"。

## 1. 影响面（先认清楚要动哪几处）

| 位置 | 钉的是什么 | 改法 |
|---|---|---|
| `scripts/dsh-runtime.sh` → `DSH_VERSION` | **宿主版本**（装进 `runtime/<平台>/ext/dsh/`） | 改一行，然后 `bash scripts/dsh-runtime.sh install` |
| `dsh/spike/package.json` → 11 个 `@deepseek-ai/*` | **测试用真实包版本**（spike 全靠它们） | 一次改全（同版本），然后 `bash scripts/dsh-spike.sh`（自动装） |
| `dsh/plugin/package.json` → `peerDependencies["@deepseek-ai/cordis"]` | **cordis 主版本**（`~4.0.4`） | 跟宿主一致；改完重建产物 |
| `custom/adapters/dsh/types.ts` | **我们用到的事件/服务形状**（本地最小声明） | 形状变了就改这一处（这是"RC 变了只改一处"的落点） |

文档里的版本号是散文（`docs/design/*.md`），不算钉死；漂移不影响运行。

## 2. 怎么发现漂移（先体检，再动手）

```bash
bash scripts/dsh-runtime.sh doctor    # 版本是否漂移 / 解析是否命中仓内 / 产物 / home / 凭据 / profile
bash scripts/dsh-runtime.sh status    # 只看装没装、解析命中哪一份
```

`doctor` 的判据（有 ❌ 就退出码 1）：

- 仓内宿主版本 == `DSH_VERSION`；
- `dsh-launch.sh --print-host` 命中 `vendored`（否则告警"非便携"）；
- 插件产物存在（缺失只是"首次启动会现建"的提示）；
- `portable/dsh/.credentials.yaml` 权限必须是 `600`。

## 3. 升级步骤

```bash
# ① 读 changelog / 找破坏性变更（重点看下面第 5 节那几个高风险面）
# ② 改 3 处版本钉死（同一个新版本号）
# ③ 装宿主 + 重装 spike 依赖 + 重建产物
bash scripts/dsh-runtime.sh install                 # 或 install --from-npx（网络差时）
bash scripts/dsh-spike.sh                            # 会按新版本重装 11 个包并跑 26 项检查
bash scripts/dsh-build.sh                            # 产物冒烟（含自包含断言）
# ④ 类型与单测（两个工程都要跑！）
npx tsc -p custom/ --noEmit && npx tsc -p dsh/
npx vitest run
# ⑤ 打包形态 + profile 组合
bash scripts/dsh-package.sh && bash scripts/dsh-smoke-profile.sh
# ⑥ 真 Host（用你的凭据；隔离 home）
MY_PI_HOST_SMOKE=1 bash scripts/dsh-host-smoke.sh
MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-isolation.sh
MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-session-resume.sh
MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-mode.sh
# ⑦ 全量 golden（含留出集；DSH 升级不算"改 pi 侧"，但这一步最省心）
PI_GOLDEN_SCENARIO=1 bash scripts/golden-tasks.sh
```

**spike 会点名是哪条契约变了**（A1–A26 各守一段：事件映射/工具编译/命令/用量/注入/装载/`steer` 语义…），
所以"红了哪条 ⇒ 看那条对应的适配文件"就是最省时间的入口，不用通读 changelog。

## 4. 失败处置 / 回滚

1. **先别改代码**：把 3 处版本钉死改回旧值，`bash scripts/dsh-runtime.sh install` 重装回旧宿主，
   `bash scripts/dsh-build.sh` 重建 ⇒ 回到升级前状态（这一步通常 2 分钟）。
2. 若旧宿主已从 registry 消失：用 `install --from-npx`（本机 npx 缓存里若还有旧版本）；
   再不行就 `git checkout <升级前的提交> -- dsh/ custom/adapters/dsh/ scripts/dsh-*` 回代码。
3. 发布级回滚点：标签 `v1.3.0-dsh`（首个"pi + DSH 双底座"合并点）。

## 5. RC 期间的高风险面（升级时优先怀疑这几处）

| 面 | 我们依赖的具体东西 | 变了会红在哪 |
|---|---|---|
| 事件名与载荷 | `tools/*`、`agent/*`、`session/*`、`turn/end`、`agent/inbox/spliced` | spike A3/A13/A20；`DSH-HOOK-MAPPING.md` |
| `agent/pre-step` 的 waterfall 判定 | `PreStepDecision = {kind:'reject'} | {kind:'enter',messages}` | spike A14（工具结果替换）/ A25（steer 边界） |
| 命令契约 | `commands.register({ name, description, handler })`、`execute() ⇒ {commandId, result}` | spike A10/A21/A22 |
| 工具注册 | `defineTool()` 编译产物、`output: {schema, render}`、`run_code` 保留名 | spike A19 + 构建冒烟 |
| `Volatile` 契约 | **只有 `get()`**、值只由其拥有者更新（`maxActiveSubagents`） | spike A23 + `subagent-capacity.ts` |
| 宿主工具插件的注入面 | `dsh-tool-subagent` inject `tools/subagents/systemPrompt/sessionProjections` | 具名 agent（`named-agents.ts`）的可见性自检日志 |
| profile patch 语义 | `insert:` 追加、`- id:` **整体替换**该条 config | `dsh-smoke-profile.sh` |

## 6. 演练记录（"doctoring 真能抓到漂移"）

本仓做过一次**真漂移演练**：把 `scripts/dsh-runtime.sh` 的 `DSH_VERSION` 临时改成 `9.9.9-rc.0`，
`bash scripts/dsh-runtime.sh doctor` 必须报 **❌ 宿主版本 ≠ 钉死**（退出码 1），改回后必须恢复 **🎉 通过**。
结论：版本漂移**会被体检拦下**，不依赖人记。

## 7. 已知的非目标

- 不做跨大版本的自动迁移脚本（DSH 还是 RC，形态会变；手工 + 上面这套验证更可靠）。
- 不跟 DSH 的客户端插件（快捷键/消息渲染器）——那层我们本来就明确不支持（见能力审计 §4）。
