# 未合并改进（合并机制见 docs/development/SKILLS-MAINTENANCE.md）

> 格式：`日期 | 触发任务 | 偏差/发现 | 建议改动`（证据导向：命令/路径/现象）

（无）

# 已合并（保留批次摘要）

## 2026-10-05 全面检查批次（模块 C 缺口 + 计数类误报）
- **模块 C 缺 bash 侧守门**：报告结论"确定性检查全部通过"的同一时间窗内 `scripts/test-supervisor.sh` 5 项红（`review.sh` + `tsc` + `vitest` 覆盖不到 bash 门）→ MODULES.md §C 步骤增加 `bash scripts/golden-tasks.sh --fast`（必跑），并写入对照表 F 行
- **计数类发现必须带口径**：`ls scripts/*.sh scripts/*.mjs | wc -l`=40 被判成"文档 42 个脚本是漂移"，实际文档口径含 `.py`（`.sh+.mjs+.py`=42，文档正确）→ ERROR-CHECKLIST.md 增"计数/版本类漂移必须带口径并复算"
- **"需核对"不是发现**：`STRUCTURE.md` 的 v0.99.1 疑点实测与 `vendor/PINNED_COMMIT`（`d2931ad3d…`）一致 → ERROR-CHECKLIST.md 增"没有实测值的疑点不进报告"
- **目录清单类文档的计数真漂移**（`custom/README` 写 `core/ 8 个文件`，实为 10，漏 `file-lock.ts`/`index.ts`，同日已修）→ ERROR-CHECKLIST.md 增"修复建议偏向数量 + 生成命令，而不是把数字改对了事"

## 2026-09-26 全面审计批次
- A2 密钥扫描噪音：`review.sh --all` 22 项“失败”均为运行时数据（`auth.json`、`recovery/cache`）→ 已写入 MODULES.md §C（A2 行注明运行时数据按噪音跳过）
- scout 实际无 bash：4 组 scout 均不能执行命令 → 已写入 WORKFLOW.md 第 3 步（需实测的验证直接交主会话或 reviewer）
- budget 输出归档文案（7 token 显示 4286% 截断）：已修复，提交 02a652ed3，非技能偏差
模块 A 审查范围收敛为 `custom/`（adapters/core/features/bootstrap.ts）与 `scripts/`、`patches/`；模块 B 按 my-pi 结构重写（vendor 只读、portable 数据收敛、packs 体积、docs 同步）；模块 C 的 `review.sh` 重写为 my-pi 确定性脚本；模块 D 改为 `portable/sessions`、`portable/memory/tool-outputs`、`custom/features/context` 预算巡检；模块 E 改为 `custom/features/subagent` 内置 reviewer/scout/worker 角色。
