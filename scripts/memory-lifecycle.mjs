#!/usr/bin/env node
/**
 * memory-lifecycle.mjs —— 记忆生命周期只读报告（零 LLM，headless 可用）
 *
 * 迁移自 pi-tools `agent/extensions/pi-memory/scripts/memory-lifecycle.mjs`（2026-09-25 补齐）。
 * 背景：autopilot 的任务运行器以 `--no-extensions` 执行提示词（带扩展的 `-p` 一次性运行
 * 在本环境不退出，实测挂住），因此定时任务里**不能用 `/memory lifecycle` 等斜杠命令**。
 * 本脚本直接调用 memory 功能的纯逻辑 `analyzeLifecycle`，让 headless 流程拿到同一份确定性报告
 * （淘汰 / 升格 / 冲突 / 垃圾 / 聚合候选），避免让 LLM 手搓统计导致结果不可复现。
 *
 * 只读幂等：不修改任何记忆数据；淘汰/合并/归纳均为写操作，须用户确认后执行。
 *
 * 用法：
 *   bash scripts/run-ts.sh scripts/memory-lifecycle.mjs            # 人读报告
 *   bash scripts/run-ts.sh scripts/memory-lifecycle.mjs --json     # 机器可读（daily-review 消费）
 *   bash scripts/run-ts.sh scripts/memory-lifecycle.mjs --limit N  # 每类展开条数（默认 20，0=不限）
 *
 * 说明：需经 tsx 运行无扩展名导入（裸 node 会报 Cannot find module `../store/storage`）。
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

if (argv.includes('-h') || argv.includes('--help')) {
  console.log('用法: bash scripts/run-ts.sh scripts/memory-lifecycle.mjs [--json] [--limit N]');
  console.log('  只读生命周期报告：淘汰候选 / 升格候选 / 冲突嫌疑 / 垃圾嫌疑 / 聚合候选');
  process.exit(0);
}

const asJson = argv.includes('--json');
let limit = 20;
const li = argv.indexOf('--limit');
if (li >= 0 && argv[li + 1] !== undefined) {
  const n = Number.parseInt(argv[li + 1], 10);
  if (Number.isFinite(n) && n >= 0) limit = n;
}

const cap = (list) => (limit === 0 ? list : list.slice(0, limit));

let logic;
try {
  logic = await import(pathToFileURL(join(ROOT, 'custom/features/memory/logic.ts')).href);
} catch (e) {
  console.error(`错误：无法加载 memory 逻辑（需 tsx 解析无扩展名导入；请用 bash scripts/run-ts.sh 运行）：${e.message}`);
  process.exit(3);
}
const { analyzeLifecycle, formatLifecycleReport, loadEntries } = logic;

const report = analyzeLifecycle(loadEntries());

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        total: report.total,
        active: report.active,
        cold: report.cold,
        oldest: report.oldest,
        newest: report.newest,
        counts: {
          evictionCandidates: report.evictionCandidates.length,
          promotionCandidates: report.promotionCandidates.length,
          conflictSuspects: report.conflictSuspects.length,
          junkSuspects: report.junkSuspects.length,
          aggregationCandidates: report.aggregationCandidates.length,
        },
        evictionCandidates: cap(report.evictionCandidates),
        promotionCandidates: cap(report.promotionCandidates),
        conflictSuspects: cap(report.conflictSuspects),
        junkSuspects: cap(report.junkSuspects),
        aggregationCandidates: cap(report.aggregationCandidates),
      },
      null,
      2,
    ),
  );
} else {
  console.log(formatLifecycleReport(report));
}
