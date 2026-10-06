#!/usr/bin/env node
/**
 * state-audit.mjs — 运行时状态不变量体检（CLI）
 *
 * 只读、零 LLM、零网络：把"使用中才会发现"的静默失效（人设文件丢失、功能名拼错、
 * 会话模式记录指向不存在的会话、重启请求没落地、重启通知没被消费、env 硬覆盖）
 * 变成一条可看的体检结论。判定逻辑在 scripts/lib-state-audit.mjs。
 *
 * 用法：
 *   node scripts/state-audit.mjs            # 人类可读；有 error 级发现则 exit 1
 *   node scripts/state-audit.mjs --json     # 机器可读（daily-health / 自动化）
 *   node scripts/state-audit.mjs --strict   # warning 级也算失败（发布前自检用）
 *   node scripts/state-audit.mjs --quiet    # 只输出一行汇总
 *
 * 真值来源：`knownFeatures` 取 scripts/registration-baseline.json 里 **tools ∪ commands ∪
 * shortcuts 的键**（由 gen-registrations.mjs 从代码生成），不在这里硬编码功能清单。
 * 只取 tools 会误判——`mode` / `intervention` 只注册命令或钩子，没有工具（2026-10-06 实测）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditState, buildSnapshot, summarize } from './lib-state-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const STRICT = argv.includes('--strict');
const QUIET = argv.includes('--quiet');

/** 已知功能名：注册面基线的 tools ∪ commands ∪ shortcuts 键；缺失时退化为"不做功能名校验"并明确提示 */
function knownFeatures() {
  try {
    const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/registration-baseline.json'), 'utf-8'));
    return [...new Set([...Object.keys(baseline.tools ?? {}), ...Object.keys(baseline.commands ?? {}), ...Object.keys(baseline.shortcuts ?? {})])].sort();
  } catch {
    return [];
  }
}

const agentDir = process.env.PI_CODING_AGENT_DIR || join(ROOT, 'portable/agent');
const findings = auditState(buildSnapshot({ agentDir, knownFeatures: knownFeatures() }));
const stats = summarize(findings);
const failed = stats.alert || (STRICT && stats.warning > 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ agentDir, ...stats, findings }, null, 2));
} else {
  const icon = { error: '✗', warning: '⚠', info: '·' };
  if (!QUIET) {
    console.log(`状态体检（${agentDir}）`);
    if (findings.length === 0) console.log('  ✓ 没有发现状态层面的不一致');
    for (const f of findings) {
      console.log(`  ${icon[f.level]} [${f.code}] ${f.message}`);
      if (f.fix) console.log(`      → ${f.fix}`);
    }
    console.log('');
  }
  console.log(
    `结论=${failed ? 'alert' : 'ok'} 异常=${stats.error} 警告=${stats.warning} 提示=${stats.info}` +
      (stats.error ? ` 异常项=${findings.filter((f) => f.level === 'error').map((f) => f.code).join('+')}` : ''),
  );
}

process.exit(failed ? 1 : 0);
