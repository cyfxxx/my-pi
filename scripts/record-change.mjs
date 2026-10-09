#!/usr/bin/env node
/**
 * 变更台账（WikiSkill 借鉴 B 项，2026-10-08）
 *
 * ## 为什么有它
 *
 * 论文里由**外层 harness 程序化写入**的 `wiki/skill-impact.md` 记录了每次改动的
 * 「提案 + 目标 + unified diff + 验证分数 + Accepted/Rejected」，它的作用被论文一句话说清：
 * **被否的改动不会被重复提出**。
 *
 * my-pi 缺的正是这一层：等价信息散在提交历史与散文台账里，**没有可查询的结构**，后果可指认——
 * 本会话里「工具面预算顶格」被提了 **3 次**、「白名单分类纪律」**2 次**、"默认关闭/不擅自动默认"
 * 几乎每批重申。都是因为**被否的理由不可查询**。
 *
 * ## 与钩子的关系（刻意不动工作区）
 *
 * 台账是**知识产物**，应当随提交一起入库；但让 pre-push 去追加文件会**每次推送后留一个脏工作区**。
 * 所以：`pre-push` 只调 `--remind`（**只提示、不写**，一次 `git log` 查询的开销）；
 * 追加由人/agent 显式执行，随下一次提交一起进库。
 *
 * 用法：
 *   node scripts/record-change.mjs --commit [sha] [--heldout] [--note "…"]   # 记一条"已接受"
 *   node scripts/record-change.mjs --reject "提案" --reason "为什么否" [--evidence "…"]
 *   node scripts/record-change.mjs --remind    # HEAD 未登记则提示（pre-push 用；退出码恒 0）
 *   node scripts/record-change.mjs --check     # 校验每一行都是合法 JSON（守门用）
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'docs', 'CHANGES.jsonl');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = '') => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function readAll() {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { __bad: l };
      }
    });
}

function append(rec) {
  appendFileSync(FILE, `${JSON.stringify(rec)}\n`, 'utf8');
}

// ── --check：每行必须是合法 JSON 且带 kind ──
if (has('--check')) {
  const rows = readAll();
  const bad = rows.filter((r) => r.__bad || !r.kind || !r.ts);
  if (bad.length) {
    console.error(`❌ docs/CHANGES.jsonl 有 ${bad.length} 行不合法（缺 kind/ts 或不是 JSON）`);
    process.exit(1);
  }
  console.log(`✅ 变更台账格式合法（${rows.length} 条）`);
  process.exit(0);
}

// ── --reject：记一条被否的提案（这是本台账最核心的价值）──
if (has('--reject')) {
  const proposal = val('--reject');
  const reason = val('--reason', '（未写理由）');
  if (!proposal) {
    console.error('用法：--reject "<提案>" --reason "<为什么否>" [--evidence "…"]');
    process.exit(2);
  }
  append({ kind: 'rejected', ts: new Date().toISOString(), proposal, reason, evidence: val('--evidence', '') });
  console.log(`✓ 已记录被否的提案：${proposal}`);
  process.exit(0);
}

// ── --remind：HEAD 未登记则提示（pre-push 调用；只读、退出码恒 0）──
if (has('--remind')) {
  try {
    const sha = val('--commit') || git(['rev-parse', '--short', 'HEAD']);
    const recorded = readAll().some((r) => typeof r.sha === 'string' && (r.sha === sha || r.sha.startsWith(sha) || sha.startsWith(r.sha)));
    if (!recorded) {
      console.log(`pre-push：提交 ${sha} 尚未登记进 docs/CHANGES.jsonl`);
      console.log(`          跑一次：node scripts/record-change.mjs --commit ${sha}（随下次提交进库）`);
    }
  } catch {
    /* 提醒失败绝不影响推送 */
  }
  process.exit(0);
}

// ── 默认/--commit：记一条"已接受"的改动 ──
const sha = val('--commit') || (() => {
  try {
    return git(['rev-parse', '--short', 'HEAD']);
  } catch {
    return '';
  }
})();
let subject = '';
let files = [];
try {
  subject = git(['log', '-1', '--pretty=%s', sha]);
  files = git(['show', '--name-only', '--pretty=format:', sha]).split('\n').filter(Boolean);
} catch {
  /* 忽略：拿不到 git 信息也照样记账 */
}
append({
  kind: 'accepted',
  ts: new Date().toISOString(),
  sha,
  subject,
  files,
  golden: 'pass',
  heldout: has('--heldout'),
  note: val('--note', ''),
});
console.log(`✓ 已登记提交 ${sha}（${files.length} 个文件${has('--heldout') ? '，含留出集' : ''}）`);
