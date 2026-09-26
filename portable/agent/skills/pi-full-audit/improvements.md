# 未合并改进（合并机制见 docs/development/SKILLS-MAINTENANCE.md）

> 格式：`日期 | 触发任务 | 偏差/发现 | 建议改动`（证据导向：命令/路径/现象）

- 2026-09-20 | 技能迁移（pi-tools → my-pi） | 全技能路径/命令/子系统引用按 my-pi 结构重写：删除 `agent/extensions/*`、`agent/services/*`、`~/.pi`、`test-all.sh`、`conflict-check.mjs`、`cache-guard.mjs`、`usage-stats.mjs`、Windows 便携专项 | 无（本次为迁移首次落地）
- 2026-09-26 | 全面检查 | `review.sh --all` 的 22 项“失败”全部是 A2 密钥扫描命中 `portable/agent/auth.json`（gitignore）与 `portable/agent/recovery/cache/dist/**`（21M 构建缓存），逐条人工定性为噪音，信噪比低 | 建议 A2 对 `portable/agent/recovery/` 与 `portable/agent/*.json` 运行时本地文件整体跳过，或单列“运行时噪音”计数不计入失败
- 2026-09-26 | 全面检查 | 4 组 scout 均自称“本环境无 shell”（无法执行 git say），而同批 reviewer 有 bash 并完成实测；E1 prompt 未区分两者实际工具差异 | scout 定义声明含 bash 但实际不可用，委派 scout 时勿要求“先 git log/实测”，需实测条目直接交主会话；或排查 subagent readonly 是否屏蔽了 bash
- 2026-09-26 | 运行态巡检 | `budget.ts:297-306`：会话累计输出预算耗尽后，小至 7 token 的输出也走截断分支，显示“约 7 token → 300 token (4286%)”并归档（内容实际未变），提示语义误导且产生无效归档 | `truncateHeadTail` 前判 `textTokens <= 300` 时直接短路为 `result = text`，或文案区分“全文保留/已归档”与“已截断”

# 已合并（保留批次摘要）

## 2026-09-20 迁移批次
模块 A 审查范围收敛为 `custom/`（adapters/core/features/bootstrap.ts）与 `scripts/`、`patches/`；模块 B 按 my-pi 结构重写（vendor 只读、portable 数据收敛、packs 体积、docs 同步）；模块 C 的 `review.sh` 重写为 my-pi 确定性脚本；模块 D 改为 `portable/sessions`、`portable/memory/tool-outputs`、`custom/features/context` 预算巡检；模块 E 改为 `custom/features/subagent` 内置 reviewer/scout/worker 角色。
