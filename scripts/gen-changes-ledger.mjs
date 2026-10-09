#!/usr/bin/env node
/**
 * 改动台账生成器（WikiSkill 借鉴 B 项，2026-10-08）
 *
 * ## 为什么有它
 *
 * 论文 WikiSkill 的 `wiki/skill-impact.md` 由**外层 harness 程序化写入**，内容是"提案 + 目标 +
 * unified diff + 验证分数 + **接受/拒绝**"，论文给它的作用是"**被否的改动不会被重复提出**"。
 * my-pi 恰好缺这一条，且有**可指认的代价**：工具面预算顶格被提了 **3 次**、白名单分类纪律 **2 次**、
 * "默认关闭/不擅自动默认"这条边界几乎每批重申——因为"被否的理由"没有可查询的结构。
 *
 * ## 两类记录
 *
 * - `change`：从 **git log** 生成（提交号 / 日期 / 标题 / 改动文件 / 是否碰过留出集）。
 * - `rejected`：从 `DECISIONS.md` 里**负结果类条目**抽（标题 / 理由 / 证据）——
 *   我们本来就把负结果归档在台账里（如 fork 池化"收下但不分叉"），这一步只是让它**可程序化查询**。
 *
 * ## 设计取舍（与原计划的偏离，已记录）
 *
 * 原计划让 **git 钩子**追加。改动的理由：钩子会**弄脏工作区**（追写的记录进不了它正在推的那个提交），
 * 且给 pre-commit/pre-push 增加时间。改成**从 git 历史确定性生成**：零钩子成本、零噪声、
 * 且能用与知识索引同一套 `--check` 守漂移。
 *
 * 用法：`node scripts/gen-changes-ledger.mjs --update` ｜ `--check`
 *
 * **循环规避**：台账不记录"改动了 `docs/CHANGES.jsonl` 本身"的提交——否则它在提交那一刻
 * 就与自己的历史不一致（pre-commit 能过、pre-push 必红）。判定只依据该提交的改动文件列表，
 * 与台账内容无关，所以不存在自指循环。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'CHANGES.jsonl');
/** 只记最近这么多提交：台账要"可复核"，不是全量镜像（全量在 git 里） */
const MAX_COMMITS = 120;
const REASON_MAX = 200;

/** 从 git log 抽 change 记录（新→旧，确定性） */
function changes() {
  const raw = execFileSync(
    'git',
    ['log', `-${MAX_COMMITS}`, '--pretty=format:%H%x1f%ad%x1f%s', '--date=short', '--name-only'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const out = [];
  for (const block of raw.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length === 0) continue;
    const [hash, date, subject] = lines[0].split('\x1f');
    if (!hash || !subject) continue;
    const files = lines.slice(1).filter((l) => l.includes('/') || l.includes('.'));
    // **循环规避**：台账从 git 历史生成，而"引入/修改台账的那条提交"本身会改变历史 ⇒
    // 它一落盘就自我漂移（pre-commit 通过、pre-push 必失败）。故**不记录这些提交**。
    // 判定只看该提交改了哪些文件，与台账内容无关 ⇒ 不存在自指循环。
    if (files.includes('docs/CHANGES.jsonl')) continue;
    out.push({
      kind: 'change',
      commit: hash.slice(0, 9),
      ts: date,
      subject: subject.replace(/\s+/g, ' ').trim(),
      files: files.slice(0, 40),
      // 弱信号但真实：提交信息里提到留出集/场景开关 ⇒ 这次动过留出集（或至少声明了要动）
      heldOut: /留出集|PI_GOLDEN_SCENARIO/.test(subject),
    });
  }
  return out;
}

/** 从 DECISIONS.md 抽"被否/负结果"类条目 —— 台账最该可查的那一半 */
function rejected() {
  const src = readFileSync(join(ROOT, 'DECISIONS.md'), 'utf8');
  const out = [];
  const lines = src.split('\n');
  let title = null;
  let body = [];
  const flush = () => {
    if (title === null) return;
    const all = `${title}\n${body.join('\n')}`;
    if (/否掉|已否掉|不迁移|不推荐|负结果|收下但不分叉|不做\b/.test(all)) {
      const reasonLine = body.map((l) => l.trim()).find((l) => l && !l.startsWith('|') && !l.startsWith('```')) ?? '';
      const sha = (all.match(/\b[0-9a-f]{7,40}\b/) ?? [''])[0];
      out.push({
        kind: 'rejected',
        ts: (title.match(/\[(\d{4}-\d{2}-\d{2})\]/) ?? [])[1] ?? '未标日期',
        proposal: title.replace(/\s+/g, ' ').trim(),
        reason: reasonLine.replace(/\s+/g, ' ').slice(0, REASON_MAX),
        evidence: sha,
        source: 'DECISIONS.md',
      });
    }
    title = null;
    body = [];
  };
  for (const line of lines) {
    if (line.startsWith('### ')) {
      flush();
      title = line.slice(4);
    } else if (title !== null) {
      body.push(line);
    }
  }
  flush();
  return out;
}

function build() {
  const records = [...changes(), ...rejected()];
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

const want = build();
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== want) {
    console.error('❌ docs/CHANGES.jsonl 已漂移。请运行：node scripts/gen-changes-ledger.mjs --update');
    process.exit(1);
  }
  console.log('✅ 改动台账与 git 历史/台账一致（docs/CHANGES.jsonl）');
} else {
  writeFileSync(OUT, want, 'utf8');
  const lines = want.trim().split('\n');
  const ch = lines.filter((l) => l.includes('"change"')).length;
  const rj = lines.filter((l) => l.includes('"rejected"')).length;
  console.log(`✓ 已生成 docs/CHANGES.jsonl（change ${ch} 条 / rejected ${rj} 条）`);
}
