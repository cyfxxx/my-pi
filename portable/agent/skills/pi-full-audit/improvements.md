# 未合并改进（合并机制见 docs/development/SKILLS-MAINTENANCE.md）

> 格式：`日期 | 触发任务 | 偏差/发现 | 建议改动`（证据导向：命令/路径/现象）

（无）

# 已合并（保留批次摘要）

## 2026-09-26 全面审计批次
- A2 密钥扫描噪音：`review.sh --all` 22 项“失败”均为运行时数据（`auth.json`、`recovery/cache`）→ 已写入 MODULES.md §C（A2 行注明运行时数据按噪音跳过）
- scout 实际无 bash：4 组 scout 均不能执行命令 → 已写入 WORKFLOW.md 第 3 步（需实测的验证直接交主会话或 reviewer）
- budget 输出归档文案（7 token 显示 4286% 截断）：已修复，提交 02a652ed3，非技能偏差
模块 A 审查范围收敛为 `custom/`（adapters/core/features/bootstrap.ts）与 `scripts/`、`patches/`；模块 B 按 my-pi 结构重写（vendor 只读、portable 数据收敛、packs 体积、docs 同步）；模块 C 的 `review.sh` 重写为 my-pi 确定性脚本；模块 D 改为 `portable/sessions`、`portable/memory/tool-outputs`、`custom/features/context` 预算巡检；模块 E 改为 `custom/features/subagent` 内置 reviewer/scout/worker 角色。
