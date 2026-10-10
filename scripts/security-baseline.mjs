#!/usr/bin/env node
/**
 * 分层完整性基线（防篡改）—— 2026-10-10
 *
 * ## 设计要点（三条都是用户硬要求）
 *
 * 1. **效率：增量**。基线存 `(path,size,mtimeMs,sha256)`；`--verify` **先比 size+mtimeMs**，
 *    只有不一致才重算 sha256 ⇒ 日常成本 **O(改动数)**，不是 O(文件数)
 *    （Tier1 ≈939 文件/≈14MB：939 次 stat 与 14MB 哈希差一个量级）。
 *    **只在显式调用时跑**，不进每轮对话路径。
 * 2. **便携化**：只用 Node 标准库（`node:fs/promises`/`node:crypto`/`node:path`/`node:os`）；
 *    **不调用任何外部命令**（无 sha256sum/strings/objdump/file/aide/rkhunter），不用 `/dev/null`。
 * 3. **默认只记录不阻断**：`--verify` 打印结论并**以 0 退出**（发现变更时用 `--strict` 才非 0）。
 *
 * ## 为什么单独成文件（而不是塞进 security-scan.mjs）
 *
 * 一次把基线塞进扫描器的尝试写出了 440 行**会崩**的 WIP（见 DECISIONS）⇒ 改为**职责分离**：
 * `security-scan.mjs` 管"单文件/URL 的三态检查"，本脚本管"分层清单的完整性"。层定义仍是**数据**
 * （`packs/security-baseline/tiers.json`），不硬编码。
 *
 * ## 自证（`--self-check`，双向、不依赖外网、不写仓库）
 *
 * 在 **临时目录**里造一棵小树：`--init` → 不改 ⇒ 必须 `unchanged`；**改一字节** ⇒ 必须 `changed`
 * **且给出路径**；**加一个文件** ⇒ 必须 `added`；删一个 ⇒ 必须 `removed`。
 * 反向性来自"改了必须变"——只断言"没改就不变"的假实现会在第二、三条上失败。
 *
 * 用法：
 *   node scripts/security-baseline.mjs --tier1 --init
 *   node scripts/security-baseline.mjs --tier1 --verify [--strict]
 *   node scripts/security-baseline.mjs --tier2 --verify
 *   node scripts/security-baseline.mjs --self-check
 * 环境变量（给自证/测试用，正常不用）：
 *   PI_BASELINE_ROOT   被检查的根目录（默认=仓库根）
 *   PI_BASELINE_DIR    基线存放目录（默认=<memoryDir>/security）
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const HERE = import.meta.dirname;
const REPO_ROOT = process.env.PI_BASELINE_ROOT ? process.env.PI_BASELINE_ROOT : join(HERE, '..');
const TIERS_FILE = join(HERE, '..', 'packs', 'security-baseline', 'tiers.json');
const BASELINE_DIR = process.env.PI_BASELINE_DIR
  ? process.env.PI_BASELINE_DIR
  : join(REPO_ROOT, 'portable', 'memory', 'security');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const toPosix = (p) => p.split(sep).join('/');

/** glob（只需够用）：目录下全部、任意层下的同名目录、按扩展名、精确路径、以 ~ 开头的主目录路径。
 *  注意：本注释里**不能**写出那两个星号紧跟斜杠的写法——那会形成注释结束符，把后面的文字变成代码。本文件真栽过一次（报 `name is not defined`）。 */
function globToRe(pat) {
  const home = pat.startsWith('~/') ? toPosix(homedir()) + pat.slice(1) : pat;
  let re = '';
  for (let i = 0; i < home.length; i++) {
    const c = home[i];
    if (c === '*' && home[i + 1] === '*') {
      re += '.*';
      i++;
      if (home[i + 1] === '/') i++; // `**/` 也匹配"零层目录"
    } else if (c === '*') re += '[^/]*';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

function loadTiers() {
  const j = JSON.parse(readFileSync(TIERS_FILE, 'utf8'));
  return {
    tiers: j.tiers,
    excludes: (j.exclude || []).map((p) => (p.startsWith('~/') ? toPosix(homedir()) + p.slice(1) : p)),
    excludeRes: (j.exclude || []).map(globToRe),
  };
}
/**
 * 递归收集：命中 include 且不在 exclude 的文件。
 *
 * **必须剪枝（2026-10-10 实测教训）**：第一版只对"文件"做 include/exclude 过滤，
 * 于是**整个仓库都被遍历**（含 .git/、node_modules/、vendor/）—— 在一台 proot/Android 的慢文件系统上，
 * 遍历本身就是主要成本：Tier1 **11s/4.7s**、连只有 25 个文件的 Tier2 也要 **3s** ✗。（成本不在文件数上。）
 * 现在两道剪枝：① **永不下潜**的目录名；② 目录路径**不可能是任何 include 的前缀**就不进。
 */
const NEVER_DESCEND = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'vendor', '.cache']);
/** 从一个 glob 里取"字面前缀"（第一个通配符之前的目录部分），用于剪枝 */
function literalPrefix(pat) {
  const home = pat.startsWith('~/') ? toPosix(homedir()) + pat.slice(1) : pat;
  const cut = home.search(/[*?]/);
  const head = cut === -1 ? home : home.slice(0, cut);
  const slash = head.lastIndexOf('/');
  return slash <= 0 ? '' : head.slice(0, slash);
}

async function collect(root, includes, excludeRes) {
  const includeRes = includes.map(globToRe);
  const prefixes = includes.map(literalPrefix).filter((s) => s.length > 0);
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // 权限/不存在：跳过（Tier2 的 ~ 路径常常不存在）
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = toPosix(relative(root, full));
      if (excludeRes.some((r) => r.test(rel) || r.test(rel + '/'))) continue;
      if (e.isDirectory()) {
        if (NEVER_DESCEND.has(e.name)) continue;
        // 剪枝：该目录既不是某个 include 字面前缀的祖先/自身，也不是它的后代 ⇒ 不可能命中
        // 注意：**无字面前缀**的模式（如 `**/*.txt`）可以匹配任何地方 ⇒ 此时**不得剪枝**。
        // 第一版漏了这条，自证当场判红（`unchanged=1` 应为 2、`removed=[]` 应含 sub/b.txt）——
        // 又一次"自证必须能证伪"救场：剪枝错了会**静默少看文件**，比报错更危险。
        const maybe =
          prefixes.length === 0 ||
          prefixes.some((pfx) => pfx === rel || pfx.startsWith(rel + '/') || rel.startsWith(pfx + '/'));
        if (maybe) await walk(full);
      } else if (e.isFile() && includeRes.some((r) => r.test(rel))) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return { files: out };
}

async function scan(root, includes, excludeRes) {
  const { files } = await collect(root, includes, excludeRes);
  const recs = [];
  for (const f of files) {
    const st = await stat(f);
    recs.push({
      path: toPosix(relative(root, f)),
      size: st.size,
      mtimeMs: Math.round(st.mtimeMs),
      sha256: sha256(await readFile(f)),
    });
  }
  recs.sort((a, b) => (a.path < b.path ? -1 : 1));
  return recs;
}

async function verify(root, includes, excludeRes, baselineFile) {
  const base = JSON.parse(await readFile(baselineFile, 'utf8'));
  const byPath = new Map(base.records.map((r) => [r.path, r]));
  const { files } = await collect(root, includes, excludeRes);
  const changed = [];
  const added = [];
  let unchanged = 0;
  let rehashed = 0;
  for (const f of files) {
    const rel = toPosix(relative(root, f));
    const st = await stat(f);
    const old = byPath.get(rel);
    if (!old) {
      added.push(rel);
      continue;
    }
    byPath.delete(rel);
    if (old.size === st.size && old.mtimeMs === Math.round(st.mtimeMs)) {
      unchanged++; // ★ 增量：一致就**不读文件、不哈希**
      continue;
    }
    rehashed++;
    const h = sha256(await readFile(f));
    if (h === old.sha256) unchanged++; // mtime 变了但内容没变（touch/检出）
    else changed.push(rel);
  }
  const removed = [...byPath.keys()];
  return { unchanged, changed, added, removed, rehashed, total: files.length };
}

async function selfCheck() {
  const root = join(tmpdir(), `baseline-selfcheck-${process.pid}`);
  const dir = join(root, '_baseline');
  await mkdir(join(root, 'sub'), { recursive: true });
  await writeFile(join(root, 'a.txt'), 'AAAA');
  await writeFile(join(root, 'sub', 'b.txt'), 'BBBB');
  const tiers = { tiers: { tier1: { include: ['**/*.txt'] } } };
  await writeFile(join(root, 'tiers.json'), JSON.stringify(tiers));
  const includes = tiers.tiers.tier1.include;
  const excludeRes = [];

  const baseFile = join(dir, 'tier1-baseline.json');
  await mkdir(dir, { recursive: true });
  await writeFile(baseFile, JSON.stringify({ records: await scan(root, includes, excludeRes) }));

  const r1 = await verify(root, includes, excludeRes, baseFile);
  await writeFile(join(root, 'a.txt'), 'AAAB'); // 改一字节
  const r2 = await verify(root, includes, excludeRes, baseFile);
  await writeFile(join(root, 'c.txt'), 'CCCC'); // 加一个
  const r3 = await verify(root, includes, excludeRes, baseFile);
  await rm(join(root, 'sub', 'b.txt')); // 删一个
  const r4 = await verify(root, includes, excludeRes, baseFile);

  const pass =
    r1.changed.length === 0 && r1.added.length === 0 && r1.unchanged === 2 &&
    r2.changed.length === 1 && r2.changed[0] === 'a.txt' && r2.rehashed === 1 &&
    r3.added.length === 1 && r3.added[0] === 'c.txt' &&
    r4.removed.length === 1 && r4.removed[0] === 'sub/b.txt';
  console.log(`自证：不改⇒unchanged=${r1.unchanged} / 改一字节⇒changed=${JSON.stringify(r2.changed)}(rehashed=${r2.rehashed}) / 加⇒added=${JSON.stringify(r3.added)} / 删⇒removed=${JSON.stringify(r4.removed)}`);
  console.log(pass ? '✅ 自证通过（四类都对，且"改了必须变"成立 ⇒ 假实现会失败）' : '❌ 自证失败');
  await rm(root, { recursive: true, force: true });
  process.exit(pass ? 0 : 1);
}

async function main() {
  const argv = process.argv.slice(2);
  if (!existsSync(TIERS_FILE)) {
    console.error(`缺层定义：${TIERS_FILE}`);
    process.exit(2);
  }
  if (argv.includes('--self-check')) return selfCheck();

  const tier = argv.includes('--tier1') ? 'tier1' : argv.includes('--tier2') ? 'tier2' : null;
  const init = argv.includes('--init');
  const verifyMode = argv.includes('--verify');
  if (!tier || (!init && !verifyMode)) {
    console.error('用法：--tier1|--tier2 --init|--verify [--strict] ｜ --self-check');
    process.exit(2);
  }
  const { tiers, excludeRes } = loadTiers();
  const includes = tiers[tier]?.include;
  if (!includes) {
    console.error(`tiers.json 里没有 ${tier}`);
    process.exit(2);
  }
  const baseFile = join(BASELINE_DIR, `${tier}-baseline.json`);

  if (init) {
    const t0 = Date.now();
    const records = await scan(REPO_ROOT, includes, excludeRes);
    await mkdir(dirname(baseFile), { recursive: true });
    await writeFile(baseFile, JSON.stringify({ tier, root: REPO_ROOT, ts: new Date().toISOString(), records }, null, 1));
    console.log(`✅ ${tier} 基线已生成：${records.length} 个文件，用时 ${Date.now() - t0}ms → ${baseFile}`);
    return;
  }
  if (!existsSync(baseFile)) {
    console.log(`not-scanned：还没有基线可比 ⇒ 先跑 --${tier} --init`);
    return;
  }
  const t0 = Date.now();
  const r = await verify(REPO_ROOT, includes, excludeRes, baseFile);
  const ms = Date.now() - t0;
  console.log(
    `${tier} 完整性：unchanged=${r.unchanged} changed=${r.changed.length} added=${r.added.length} removed=${r.removed.length}` +
      `（共 ${r.total} 个文件；重算哈希 ${r.rehashed} 个；用时 ${ms}ms ⇒ ` +
        (r.rehashed === 0 && r.total > 0 ? '增量生效（0 次哈希）' : `重算了 ${r.rehashed} 个文件`) +
        (ms > 1500 && r.rehashed === 0 ? '；注意：耗时由文件系统遍历主导（本机为 proot/Android，实测 stat 很慢）' : '') +
        '）',
  );
  if (r.changed.length) console.log('  changed: ' + r.changed.join(', '));
  if (r.added.length) console.log('  added: ' + r.added.join(', '));
  if (r.removed.length) console.log('  removed: ' + r.removed.join(', '));
  console.log('  （默认只记录不阻断；要非 0 退出加 --strict）');
  if (argv.includes('--strict') && (r.changed.length || r.added.length || r.removed.length)) process.exit(1);
}

main();
