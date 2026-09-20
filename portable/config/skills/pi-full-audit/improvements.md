# 未合并改进（合并机制见 docs/development/SKILLS-MAINTENANCE.md）

> 格式：`日期 | 触发任务 | 偏差/发现 | 建议改动`（证据导向：命令/路径/现象）

- 2026-09-20 | 技能迁移（pi-tools → my-pi） | 全技能路径/命令/子系统引用按 my-pi 结构重写：删除 `agent/extensions/*`、`agent/services/*`、`~/.pi`、`test-all.sh`、`conflict-check.mjs`、`cache-guard.mjs`、`usage-stats.mjs`、Windows 便携专项 | 无（本次为迁移首次落地）

# 已合并（保留批次摘要）

## 2026-09-20 迁移批次
模块 A 审查范围收敛为 `custom/`（adapters/core/features/bootstrap.ts）与 `scripts/`、`patches/`；模块 B 按 my-pi 结构重写（vendor 只读、portable 数据收敛、packs 体积、docs 同步）；模块 C 的 `review.sh` 重写为 my-pi 确定性脚本；模块 D 改为 `portable/sessions`、`portable/memory/tool-outputs`、`custom/features/context` 预算巡检；模块 E 改为 `custom/features/subagent` 内置 reviewer/scout/worker 角色。
