#!/usr/bin/env node
/**
 * check-seeds-headless.mjs —— 定时任务提示词的 headless 可用性守门
 *
 * 背景：autopilot 的任务运行器以 `--no-extensions` 执行提示词（实测带扩展的 `-p` 一次性运行
 * 在本环境不退出），因此提示词里**不能引用扩展工具或斜杠命令**（`memory_store`、`/memory`、
 * `tmux_*`、`ctx_*` …），它们在那次运行中根本不存在——任务会静默失败或空转。
 *
 * 本脚本扫描 `portable/agent/scheduled-seeds.json` 的每个 task.prompt，命中即失败。
 * 正确做法：改用随仓库分发的脚本（如 `bash scripts/run-ts.sh scripts/memory-store.mjs …`）。
 *
 * 用法：node scripts/check-seeds-headless.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = join(ROOT, 'portable', 'agent', 'scheduled-seeds.json');

if (!existsSync(SEEDS)) {
  console.error(`⚠ 跳过 check-seeds-headless：前置文件缺失 ${SEEDS}（门禁未运行，未校验任何定时任务提示词）`);
  process.exit(0);
}

/** 扩展提供的工具名（pi 内置 read/bash/edit/write/grep/find/ls 不在此列） */
const EXT_TOOLS = [
  'memory_store', 'memory_search', 'memory_recall', 'memory_stats', 'memory_forget',
  'ctx_exec', 'ctx_list', 'ctx_note', 'ctx_snap',
  'tmux_run', 'tmux_status', 'tmux_read', 'tmux_send', 'tmux_stop', 'tmux_wait',
  'enable_tool', 'thinking_level', 'subagent', 'ask_user', 'plan_enter', 'plan_exit', 'todo',
  'link_send', 'link_status',
  'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_close',
  'voice_transcribe', 'voice_speak', 'voice_record',
  'autopilot_status', 'autopilot_stats', 'autopilot_failover', 'autopilot_policy',
  'schedule_task', 'verify_report', 'verify_config', 'verify_test',
  'admin_status', 'admin_restart', 'admin_list_sessions', 'admin_switch_session',
  'web_search', 'fetch_url', 'web_fetch',
];

/** 扩展提供的斜杠命令 */
const EXT_COMMANDS = [
  'memory', 'voice', 'context', 'mode', 'plan', 'link', 'intervention',
  'auto', 'schedule', 'tools', 'usage-diag',
];

const toolRe = new RegExp(`(?<![A-Za-z0-9_-])(${EXT_TOOLS.join('|')})(?![A-Za-z0-9_-])`, 'g');
// 斜杠命令：排除路径场景（`portable/memory/...`）——前一个字符不能是路径/单词字符
const cmdRe = new RegExp(`(?<![A-Za-z0-9_./-])/(${EXT_COMMANDS.join('|')})(?![A-Za-z0-9-])`, 'g');
// 「不要用 X」这类否定说明不算违规：命中前后 12 字符内含否定词时忽略
const NEGATION = /不要|禁止|勿|避免|不得|别用/;
function isNegated(prompt, index) {
  return NEGATION.test(prompt.slice(Math.max(0, index - 12), index + 12));
}

const data = JSON.parse(readFileSync(SEEDS, 'utf-8'));
const tasks = Array.isArray(data.tasks) ? data.tasks : [];

let bad = 0;
for (const task of tasks) {
  const prompt = typeof task.prompt === 'string' ? task.prompt : '';
  const hits = new Set();
  for (const m of prompt.matchAll(toolRe)) {
    if (!isNegated(prompt, m.index)) hits.add(`工具 ${m[1]}`);
  }
  for (const m of prompt.matchAll(cmdRe)) {
    if (!isNegated(prompt, m.index)) hits.add(`命令 /${m[1]}`);
  }
  if (hits.size > 0) {
    bad++;
    console.log(`❌ ${task.name}：提示词引用了 headless 不存在的 ${[...hits].join('、')}`);
  } else {
    console.log(`✓ ${task.name}`);
  }
}

if (bad > 0) {
  console.error(
    `\n❌ ${bad} 个定时任务提示词依赖扩展工具/命令，但任务以 --no-extensions 运行，执行时不存在。\n` +
      `   改用脚本入口，例如：bash scripts/run-ts.sh scripts/memory-store.mjs --json '<JSON数组>'`,
  );
  process.exit(1);
}
console.log('\n所有定时任务提示词均为 headless 可用。');
