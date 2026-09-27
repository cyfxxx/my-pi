# 未合并改进（合并见 docs/development/SKILLS-MAINTENANCE.md）

> 格式：`日期 | 触发任务 | 偏差/发现 | 建议改动`（证据导向：命令/路径/现象）

- 2026-09-27 | pi-backup sync | COMMANDS.md「sync 前置检查 7」将 `portable/agent/modes.json`、`scheduled-seeds.json` 列为敏感文件并规定「命中立即报错中止」，但 `.gitignore` 第 44-45 行以 `!` 白名单显式纳入分发（`AGENTS.md` 亦载明随仓库分发），按文档执行会误报中止 | 从检查列表移除这两项，或注明「白名单分发项除外」
- 2026-09-27 | pi-backup sync | COMMANDS.md「执行步骤 1」要求 `git add -A`，与项目 `AGENTS.md`「暂存显式路径，永远不要 git add -A」直接冲突；本次按项目规范显式 add 收窄到 8 个文件 | 改为按 `git status` 显式暂存，或注明以项目 `AGENTS.md` 为准
- 2026-09-27 | pi-backup sync | 前置检查 5 的基线目录 `.backup-baseline/` 不在 `.gitignore` 中（`grep -n backup-baseline .gitignore` 无输出），按文档创建会留下未跟踪文件 | 在 `.gitignore` 加入 `.backup-baseline/`，或明确不启用该基线机制

# 已合并（保留最近 3 条）

- （空）
