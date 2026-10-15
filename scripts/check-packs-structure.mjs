#!/usr/bin/env node
/**
 * check-packs-structure.mjs — `packs/` 结构守门（2026-10-15）
 *
 * ## 为什么需要它
 *
 * `packs/` 是随仓库分发的**唯一外部技能仓库**，但它的结构约定此前**只写在
 * `packs/README.md` 里，没有任何守门**。2026-10-15 的全量体检抓到两类静默漂移，
 * 都属于"写下来的规矩没人执行 ⇒ 迟早失真"：
 *
 *   1. **计数失真**：README 写"已落地 13 个"经验沉淀段，实测已是 17 个
 *      （pdf-toolkit / books / skill-integration 陆续补齐 + termux 新增）——
 *      这种数字一旦错，后来者会照错的基线"对齐"。
 *   2. **入库静默丢失**：`git add` 会被 `.gitignore` 跳过**上游已跟踪**的文件
 *      （本仓根级通用规则 + vendored 包自带的 `.gitignore` 两层都会咬），
 *      reverse-skill 同步上游 `cab634bd` 时就丢了 `reports/…` 与 `docs/plans/…`
 *      两个文件，**既不报错也不出现在 git status 里**，靠逐文件比对才抓到。
 *
 * 这两类的共同点是"**沉默**"：出错时没有任何信号。所以把 README 里已成文的约定
 * 变成可执行的断言（与 17367a496「把静默退化变成守门失败」同一思路）。
 *
 * ## 规则
 *
 *   R1 包根必须有 `SKILL.md`，除非在 `DETAIL_LAYERS` 白名单（细节层：无 SKILL.md，靠 INDEX 二级索引登记）
 *   R2 每个 `SKILL.md` 必须有 frontmatter，且 `name` / `description` 非空；
 *      `description` 不得含日期（缓存友好，见 packs/README.md「防膨胀守则」）
 *   R3 包根必须有经验沉淀落点：`SKILL.md` 含"使用后经验沉淀"段，或存在包根 `EXPERIENCE.md`
 *   R4 每个包名必须出现在 `packs/INDEX.md`（否则包存在但索引里找不到）
 *   R5 `packs/` 下不得有"未跟踪"或"未跟踪且被忽略"的文件
 *      （IGNORE_ALLOW 列的是各包运行时**正常产物**；其余都是漏提交或垃圾）
 *   R6 `packs/drafts/` 只允许 `.gitkeep` 与生成器命名 `workticket-*.md`
 *   R7 `packs/README.md` 里"已落地 N 个"的声明数必须等于实测数（防上面第 1 类漂移）
 *
 * 用法：
 *   node scripts/check-packs-structure.mjs          # 有违规 ⇒ exit 1
 *   node scripts/check-packs-structure.mjs --json
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const AS_JSON = process.argv.includes('--json');

/** 细节层：不是独立技能包，没有 SKILL.md（见 packs/README.md「目录结构」约定） */
const DETAIL_LAYERS = new Set(['net-mirror', 'security-baseline']);

/**
 * vendored 上游整树：包内沿用上游自己的目录布局，入口不在包根
 * （`packs/INDEX.md` 已注明入口路径）。白名单要带证据，别拿它当免检通道。
 */
const ROOT_ENTRY_ALIAS = { 'reverse-skill': 'skills/SKILL.md' };

/**
 * packs 下**正常使用会产生**的未跟踪/被忽略文件。
 * 判定口径：pack 自带的 .gitignore 与各包 SKILL.md 里明说的运行产物。
 * 新出现一类合法产物时，在这里加一条并注明来源（别把守门放宽成"什么都放行"）。
 */
const IGNORE_ALLOW = [
  /(^|\/)__pycache__\//, // Python 运行产物（根 .gitignore + 各包 .gitignore）
  /\.py[co]$/,
  /(^|\/)node_modules\//,
  /(^|\/)work\//, // reverse-skill kali 脚本的实验目录
  /(^|\/)skills\/tool-index\.(md|json)$/, // kali/refresh-tool-index.sh 生成
  /(^|\/)LOCAL-READINESS\.md$/, // 含本机路径的就绪报告，上游明确不入库
  /\.(log|tmp|bak|class|jar|keystore|exe|dll|so|dylib)$/,
  /(^|\/)\.(vscode|idea|claude|scratch|omc)\//,
  /(^|\/)(issues\.json|issues-index\.txt|implementation-notes\.md|Thumbs\.db|\.DS_Store)$/,
  /(^|\/)mcps\//,
  /master-route-/, // reverse-skill 本地实验目录
  /-scope-\//,
];

const git = (args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const posix = (p) => p.replaceAll('\\', '/');

/** 路径类型判定：**不用 Dirent.isFile()/isDirectory()**。
 *
 * 为什么（2026-10-15 实测陷阱）：在 Termux/PRoot 的 FUSE 视图下，`readdir` 不返回
 * `d_type`（DT_UNKNOWN），于是 Node 的 `Dirent.isFile()/isDirectory()` **全为 false** ——
 * 同一个函数上一分钟还能列出 147 个 SKILL.md，下一分钟就列 0 个（目录项缓存状态不同）。
 * 本守门当时靠 R7 计数不符**报错**才被发现（不是静默放过），但遍历逻辑必须自证可靠。
 * 结论：一律 `statSync` 兜底，不信任 readdir 给的类型。 */
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** packs/ 下的包目录（磁盘为准；drafts 单列） */
function packDirs() {
  const dirs = readdirSync(join(ROOT, 'packs'))
    .filter((name) => isDir(join(ROOT, 'packs', name)))
    .sort();
  return dirs.filter((d) => d !== 'drafts');
}

/** 递归列出 packs/ 下所有 SKILL.md（相对仓库根） */
function allSkillFiles() {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const r = `${rel}/${name}`;
      if (isDir(join(ROOT, r))) {
        if (name === 'node_modules' || name === '__pycache__' || name === '.git') continue;
        walk(r);
      } else if (name === 'SKILL.md' && isFile(join(ROOT, r))) out.push(posix(r));
    }
  };
  walk('packs');
  return out.sort();
}

/** 解析 frontmatter：返回 {fm, name, description} 或 null */
function frontmatter(abs) {
  const text = readFileSync(abs, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fm = m[1];
  const pick = (key) => {
    const mm = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(fm);
    if (!mm) return '';
    let v = mm[1].trim();
    if (!v || /^[>|][-+]?$/.test(v)) {
      // 折叠/字面块：收集紧随其后的缩进行
      const rest = fm.slice(mm.index + mm[0].length).split('\n');
      const block = [];
      for (const line of rest) {
        if (!line.trim()) {
          if (block.length) break; // 块内空行之后不再取
          continue; // 跳过紧跟 key 的那一行换行
        }
        if (!/^\s+\S/.test(line)) break;
        block.push(line.trim());
      }
      v = block.join(' ');
    }
    return v.replace(/^["']|["']$/g, '').trim();
  };
  return { text, fm, name: pick('name'), description: pick('description') };
}

function main() {
  const pkgs = packDirs();
  const skills = allSkillFiles();
  const violations = [];
  const add = (rule, detail) => violations.push({ rule, detail });

  // ── R1 包根必须有 SKILL.md（细节层白名单 / 上游整树入口别名除外）──
  for (const p of pkgs) {
    if (existsSync(join(ROOT, 'packs', p, 'SKILL.md'))) continue;
    if (DETAIL_LAYERS.has(p)) continue;
    const alias = ROOT_ENTRY_ALIAS[p];
    if (alias && existsSync(join(ROOT, 'packs', p, alias))) continue;
    if (alias) {
      add('R1', `packs/${p}/ 的入口别名 ${alias} 已不存在（ROOT_ENTRY_ALIAS 过期）`);
      continue;
    }
    add('R1', `packs/${p}/ 没有 SKILL.md，且不在细节层白名单（DETAIL_LAYERS）里`);
  }
  for (const p of DETAIL_LAYERS) {
    if (!existsSync(join(ROOT, 'packs', p))) add('R1', `DETAIL_LAYERS 里的 packs/${p}/ 已不存在（白名单过期）`);
  }

  // ── R2 frontmatter：name / description 必填，description 不带日期 ──
  for (const s of skills) {
    const f = frontmatter(join(ROOT, s));
    if (!f) {
      add('R2', `${s}: 缺 frontmatter`);
      continue;
    }
    if (!f.name) add('R2', `${s}: frontmatter 缺 name`);
    if (!f.description) add('R2', `${s}: frontmatter 缺 description`);
    else if (/\b20\d{2}-\d{2}-\d{2}\b/.test(f.description)) {
      add('R2', `${s}: description 里含日期（防膨胀守则要求缓存友好，日期放正文或包根 EXPERIENCE.md）`);
    }
  }

  // ── R3 经验沉淀落点（仅包根；细节层与子技能不适用）──
  let expCount = 0;
  for (const p of pkgs) {
    const skill = join(ROOT, 'packs', p, 'SKILL.md');
    const hasSection = existsSync(skill) && readFileSync(skill, 'utf8').includes('使用后经验沉淀');
    const hasExp = existsSync(join(ROOT, 'packs', p, 'EXPERIENCE.md'));
    if (hasSection) expCount++;
    if (!hasSection && !hasExp && !DETAIL_LAYERS.has(p)) {
      add('R3', `packs/${p}/: SKILL.md 既无"使用后经验沉淀"段，也没有包根 EXPERIENCE.md`);
    }
  }
  for (const s of skills) {
    if (/^packs\/[^/]+\/SKILL\.md$/.test(s)) continue; // 包根已计
    if (readFileSync(join(ROOT, s), 'utf8').includes('使用后经验沉淀')) expCount++;
  }

  // ── R4 索引登记 ──
  const index = readFileSync(join(ROOT, 'packs', 'INDEX.md'), 'utf8');
  const readme = readFileSync(join(ROOT, 'packs', 'README.md'), 'utf8');
  for (const p of pkgs) {
    if (!index.includes(p)) add('R4', `packs/${p}/ 未登记进 packs/INDEX.md`);
    if (!readme.includes(p)) add('R4', `packs/${p}/ 未登记进 packs/README.md「当前包」`);
  }

  // ── R5 未跟踪 / 未跟踪且被忽略的文件 ──
  const other = git(['ls-files', '--others', '--exclude-standard', '-z', 'packs'])
    .split('\0')
    .filter(Boolean)
    .map(posix);
  const otherIgnored = git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z', 'packs'])
    .split('\0')
    .filter(Boolean)
    .map(posix);
  const allowed = (f) => IGNORE_ALLOW.some((re) => re.test(f));
  for (const f of other) {
    if (!allowed(f)) add('R5', `${f}: 未跟踪（多半是漏了 git add，或是运行产物：清理或显式入库）`);
  }
  for (const f of otherIgnored) {
    if (!allowed(f)) {
      add(
        'R5',
        `${f}: 未跟踪且被 .gitignore 忽略 —— 若它是**上游已跟踪**的文件，说明入库时被静默吞掉了（用 git add -f，见 packs/README.md 第 5 条）；否则请清理`,
      );
    }
  }

  // ── R6 drafts 命名 ──
  const draftsDir = join(ROOT, 'packs', 'drafts');
  if (existsSync(draftsDir)) {
    for (const f of readdirSync(draftsDir)) {
      if (!statSync(join(draftsDir, f)).isFile()) {
        add('R6', `packs/drafts/${f}: 草稿目录里不应有子目录`);
        continue;
      }
      if (f !== '.gitkeep' && !/^workticket-.+\.md$/.test(f)) {
        add('R6', `packs/drafts/${f}: 命名不符生成器口径（应为 workticket-<短名>.md）`);
      }
    }
  }

  // ── R7 README 的计数声明 == 实测 ──
  const claimed = /已落地[ *]*(\d+)[ *]*个/.exec(readme);
  if (!claimed) {
    add('R7', 'packs/README.md 里找不到"已落地 N 个"的经验沉淀计数声明');
  } else if (Number(claimed[1]) !== expCount) {
    add('R7', `packs/README.md 声明"已落地 ${claimed[1]} 个"，实测 ${expCount} 个（同步改 README 这段）`);
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ packs: pkgs.length, skills: skills.length, expCount, violations }, null, 2));
    return violations.length ? 1 : 0;
  }
  if (violations.length) {
    console.error(`❌ packs 结构守门失败 ${violations.length} 项（${pkgs.length} 个包 / ${skills.length} 个 SKILL.md）：`);
    for (const v of violations) console.error(`   [${v.rule}] ${v.detail}`);
    return 1;
  }
  console.log(
    `✓ packs 结构一致（${pkgs.length} 个包 / ${skills.length} 个 SKILL.md / 经验沉淀落点 ${expCount} 个 / 无未跟踪文件）`,
  );
  return 0;
}

process.exit(main());
