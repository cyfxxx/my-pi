#!/usr/bin/env node
/**
 * check-packs-links.mjs — 校验 `packs/**` 内部 Markdown 相对链接
 *
 * 为什么需要它：仓库既有守门 `scripts/check-doc-links.mjs` **有意排除 `packs/`**
 * （见其文件头注释与 `SKIP` 集合："外部技能包，链接不由本仓保证"）。后果是
 * `packs/` 下 200+ 个 md 的内部链接**长期没有回归保护** —— 一次改名/挪文件就能让
 * 文档指向不存在的目标而无人发现。上游 `reverse-skill` 自己新增了
 * `skills/scripts/verify-doc-links.py`，但它假定 **cwd = 该包自己的仓库根**
 * （`git ls-files` + `git show :<path>`），在 vendored 布局下会去枚举**父仓库**的
 * 文件而报 `cannot read tracked Markdown blob`。本脚本就是补这一层：
 * **按 vendored 布局**（`packs/<pkg>/…`）判定，且与上游同口径。
 *
 * 判定口径（与上游一致 + 两处适配）：
 *   1. 只查**相对链接**：跳过 `http(s)://`、`mailto:`、纯锚点 `#…`；
 *   2. **跳过以 `/` 开头的链接**（上游按"包仓库根"解析；vendored 布局下根不唯一 ⇒ 不猜，单独计数如实报告）；
 *   3. 目标**去掉 `#锚点` 后**按"相对该 md 所在目录"解析；
 *   4. 命中集合 = **git 跟踪的文件 ∪ 其父目录**（`git ls-files -z packs`）—— 与上游同口径，
 *      天然忽略 `work/`、`tool-index.md` 这类 gitignore 的生成物；
 *   5. **额外放行**：目标在磁盘上确实存在，或该路径被 `.gitignore` 忽略（`git check-ignore`）
 *      —— 覆盖"文档引用了本机会生成的文件"这种正常情形；
 *   6. 只统计 ```` ``` ```` 围栏**之外**的链接（围栏里的示例链接不算）。
 *
 * 用法：
 *   node scripts/check-packs-links.mjs            # 全量校验（有断链 ⇒ exit 1）
 *   node scripts/check-packs-links.mjs --json     # 机器可读
 *   node scripts/check-packs-links.mjs --pkg reverse-skill   # 只查某个包
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const pkgIdx = argv.indexOf('--pkg');
const ONLY_PKG = pkgIdx >= 0 ? argv[pkgIdx + 1] : '';
const PREFIX = ONLY_PKG ? `packs/${ONLY_PKG}` : 'packs';

/** git 跟踪的文件（相对仓库根，posix 分隔） */
function tracked() {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z', PREFIX], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = new Set(out.split('\0').filter(Boolean).map((p) => p.replaceAll('\\', '/')));
  const dirs = new Set();
  for (const f of files) {
    let d = dirname(f);
    while (d && d !== '.' && !dirs.has(d)) {
      dirs.add(d);
      d = dirname(d);
    }
  }
  return { files, dirs };
}

/** 形如 ``` 或 ~~~ 的围栏开始/结束 */
const FENCE = /^\s*(```|~~~)/;

/** 提取一行里的 Markdown 行内链接目标（跳过图片 `![]()` 也一并纳入——图片同样要能解析） */
function linksInLine(line) {
  const targets = [];
  const re = /\[[^\]]*\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(line)) !== null) targets.push(m[1]);
  // 参考式定义 `[id]: path` 也校验（常见于长文档）
  const ref = /^\s*\[[^\]]+\]:\s*(\S+)/.exec(line);
  if (ref) targets.push(ref[1]);
  return targets;
}

function isIgnored(p) {
  try {
    execFileSync('git', ['check-ignore', '-q', p], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const { files, dirs } = tracked();
  const mds = [...files].filter((f) => f.toLowerCase().endsWith('.md')).sort();
  const broken = [];
  const skippedRootRelative = [];
  let checked = 0;

  for (const md of mds) {
    const abs = join(ROOT, md);
    if (!existsSync(abs)) continue; // 索引里存在但工作区没有（未 checkout 的稀疏场景）：跳过
    const lines = readFileSync(abs, 'utf8').split('\n');
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (FENCE.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      for (const raw of linksInLine(line)) {
        if (/^(https?:|mailto:|tel:|data:)/i.test(raw)) continue;
        if (raw.startsWith('#')) continue;
        if (raw.startsWith('/')) {
          skippedRootRelative.push({ md, line: i + 1, target: raw });
          continue;
        }
        const target = raw.split('#')[0].split('?')[0];
        if (!target) continue;
        checked++;
        const resolved = posix.normalize(join(dirname(md), target).replaceAll('\\', '/'));
        if (files.has(resolved) || dirs.has(resolved)) continue;
        if (existsSync(join(ROOT, resolved)) || isIgnored(resolved)) continue;
        broken.push({ md, line: i + 1, target: raw, resolved });
      }
    }
  }

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        { scope: PREFIX, mds: mds.length, checked, broken, skippedRootRelative: skippedRootRelative.length },
        null,
        2,
      ),
    );
    return broken.length === 0 ? 0 : 1;
  }

  if (broken.length) {
    console.error(`❌ packs 内部链接有 ${broken.length} 处断链（检查 ${mds.length} 个 md / ${checked} 条链接）：`);
    for (const b of broken.slice(0, 40)) console.error(`   ${b.md}:${b.line} -> ${b.target}（解析为 ${b.resolved}）`);
    if (broken.length > 40) console.error(`   … 还有 ${broken.length - 40} 处`);
    return 1;
  }
  console.log(
    `✓ packs 内部链接一致（${mds.length} 个 md / ${checked} 条相对链接` +
      (skippedRootRelative.length ? `；另有 ${skippedRootRelative.length} 条以 / 开头的链接按口径跳过` : '') +
      `）`,
  );
  return 0;
}

process.exit(main());
