# 未合并改进（合并机制见 docs/development/SKILLS-MAINTENANCE.md）

> 格式：`日期 | 触发任务 | 偏差/发现 | 建议改动`（证据导向：命令/路径/现象）

（无）

## 2026-10-05 全面检查（A+B+C+D+E，会话 2026-10-05T11-38-04）

- 2026-10-05 | 执行一次全面检查 | 报告结论「确定性检查全部通过」，但同期 golden 第 10 步 `scripts/test-supervisor.sh` 5 项红（在 pi 会话内可复现：pi 进程 bootstrap 回写的 `PI_AGENT_MODE` 被 bash 侧 `lib-mode.sh` 当成外部注入 → 状态文件 roleplay 解析成 full）。模块 C 只跑 `review.sh` + `tsc` + `vitest`，覆盖不到 bash 侧守门，于是红着的门在报告里表现为"全绿" | 模块 C 增加 `bash scripts/golden-tasks.sh --fast`（秒级，含 supervisor/种子/约定/注入面），或把全量 golden 作为基线步骤
- 2026-10-05 | 执行一次全面检查 | 模块 E 报「`README.md:65` 42 个脚本 → 实际 40」为漂移。实测 `ls scripts/*.sh scripts/*.mjs \| wc -l`=40 漏掉了 `scripts/*.py`（`books.py`、`knowledge-fetch.py`）；`.sh+.mjs+.py`=42，与文档一致 → 误报 | 计数类发现必须写明取值命令与口径（扩展名集合、是否含共享库/非脚本文件），并复算一次才可进报告
- 2026-10-05 | 执行一次全面检查 | 模块 E 报「`STRUCTURE.md:30` 写 v0.99.1，需核对 `vendor/PINNED_COMMIT`」。实测 `vendor/PINNED_COMMIT`=`d2931ad3d…`（v0.99.1），文档一致 → 误报（"需核对"被当成发现列出） | 未核实的疑点不得作为发现条目；要么给出"文档值 vs 实测值 + 命令"，要么不列
- 2026-10-05 | 执行一次全面检查 | 「`custom/README.md` core/ 写 8 个文件 → 实际 10 个」为真漂移（漏 `file-lock.ts`、`index.ts`），已修（同日提交） | 目录清单类文档不要硬编码文件数，改为"数量 + 生成命令（`ls custom/core/*.ts | wc -l`）"或只列文件名

# 已合并（保留批次摘要）

## 2026-09-26 全面审计批次
- A2 密钥扫描噪音：`review.sh --all` 22 项“失败”均为运行时数据（`auth.json`、`recovery/cache`）→ 已写入 MODULES.md §C（A2 行注明运行时数据按噪音跳过）
- scout 实际无 bash：4 组 scout 均不能执行命令 → 已写入 WORKFLOW.md 第 3 步（需实测的验证直接交主会话或 reviewer）
- budget 输出归档文案（7 token 显示 4286% 截断）：已修复，提交 02a652ed3，非技能偏差
模块 A 审查范围收敛为 `custom/`（adapters/core/features/bootstrap.ts）与 `scripts/`、`patches/`；模块 B 按 my-pi 结构重写（vendor 只读、portable 数据收敛、packs 体积、docs 同步）；模块 C 的 `review.sh` 重写为 my-pi 确定性脚本；模块 D 改为 `portable/sessions`、`portable/memory/tool-outputs`、`custom/features/context` 预算巡检；模块 E 改为 `custom/features/subagent` 内置 reviewer/scout/worker 角色。
