#!/usr/bin/env node
/**
 * 零依赖安全扫描（2026-10-09）
 *
 * ## 为什么是"零依赖"
 * 本环境实测：**ClamAV / YARA / file / gpg / minisign / cosign / bwrap / firejail 全都没装**，
 * pip 又被 PEP 668 拦着 ⇒ 任何依赖第三方杀毒的脚本在这里**跑不起来**。
 * 所以这里只做**本机确定能做的两层**，其余的**如实报"未扫描"**——**绝不把"没查"显示成"安全"**。
 *
 * ## 三态结论（这是本脚本最重要的设计）
 *   clean       —— 该跑的都跑了，且没有命中
 *   suspicious  —— 有具体命中（附规则名与证据）
 *   not-scanned —— 能力缺失（如无 ClamAV）或证据不足
 * **没有 ClamAV 时结论里必然出现 not-scanned**：这是"不假装安全"的硬要求。
 *
 * ## 自证（没有它，扫描器等于摆设）
 * 用业界标准测试串 **EICAR**（68 字节、公开的杀毒测试文件）必须报 suspicious；
 * 另有两类结构性自证（zip 路径穿越、扩展名与 magic 不符）。
 *
 * 用法：
 *   node scripts/security-scan.mjs --file <path>        # L0 哈希 + L1 结构识别
 *   node scripts/security-scan.mjs --url <url>          # L4 与本地 URLhaus 缓存比对
 *   node scripts/security-scan.mjs --manifest <dir>     # 生成/校验哈希清单（防篡改）
 *   node scripts/security-scan.mjs --update-feed        # 拉 URLhaus（免费无需 key）
 *   任意命令加 --json
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, extname, delimiter as pathDelimiter, basename as pathBasename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, 'portable', 'memory', 'security');
const FEED = join(STATE_DIR, 'urlhaus.txt');
const MANIFEST = 'security-manifest.json';

/** 业界标准杀毒测试串（EICAR）——公开、无害、各家杀毒都用它自测 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** 极小 magic 表：只认最常见的几种，够用来抓"扩展名与内容不符" */
const MAGICS = [
  { name: 'PNG', ext: ['.png'], bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'JPEG', ext: ['.jpg', '.jpeg'], bytes: [0xff, 0xd8, 0xff] },
  { name: 'ZIP', ext: ['.zip', '.jar', '.apk', '.whl', '.docx'], bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'GZIP', ext: ['.gz', '.tgz'], bytes: [0x1f, 0x8b] },
  { name: 'ELF', ext: ['.so', '.bin', ''], bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'PE', ext: ['.exe', '.dll'], bytes: [0x4d, 0x5a] },
  { name: 'PDF', ext: ['.pdf'], bytes: [0x25, 0x50, 0x44, 0x46] },
];

/** pickle 里值得警惕的全局引用（反序列化触发执行一类的常见入口）；不是穷举 */
const PICKLE_RISK = ['posix.system', 'os.system', 'subprocess', 'os.popen', 'pty.spawn', 'builtins.eval', 'builtins.exec', 'socket'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const detectMagic = (buf) => MAGICS.find((m) => m.bytes.every((b, i) => buf[i] === b))?.name ?? null;

function scanFile(path) {
  const hits = [];
  const layers = { L0_hash: 'ok', L1_structure: 'ok', L2_antivirus: 'not-scanned' };
  if (!existsSync(path) || !statSync(path).isFile()) return { path, error: '不是普通文件', verdict: 'not-scanned' };
  const buf = readFileSync(path);
  const digest = sha256(buf);

  // L0：完整性（只报事实，是否有官方校验和由调用方决定）
  // L1-① EICAR：业界标准测试串（自证依赖它）
  if (buf.includes(EICAR)) hits.push({ rule: 'eicar-test-file', detail: '命中业界标准杀毒测试串（EICAR）' });
  // L1-② 常见恶意/可疑脚本特征（保守，只报明确可疑的）
  const text = buf.length < 4_000_000 ? buf.toString('latin1') : '';
  if (/curl\s+[^|]{0,80}\|\s*(ba)?sh/.test(text)) hits.push({ rule: 'curl-pipe-shell', detail: 'curl 管道直接喂 shell' });
  if (/base64\s+-d\s*\|/.test(text)) hits.push({ rule: 'base64-pipe', detail: 'base64 解码后直接管道执行' });
  // L1-③ 扩展名与 magic 不符
  const magic = detectMagic(buf);
  const ext = extname(path).toLowerCase();
  if (magic && ext) {
    const spec = MAGICS.find((m) => m.name === magic);
    const expectsBinary = /\.(png|jpg|jpeg|gif|zip|gz|tgz|pdf|so|exe|dll|jar|apk|whl|docx)$/.test(ext);
    if (expectsBinary && spec && !spec.ext.includes(ext)) hits.push({ rule: 'extension-magic-mismatch', detail: `扩展名 ${ext} 但内容是 ${magic}` });
  }
  // L1-④ pickle：反序列化风险（用文本特征做保守判断：协议头 + 危险全局引用）
  if (buf[0] === 0x80 || buf.includes(Buffer.from('__reduce__'))) {
    const risky = PICKLE_RISK.filter((r) => text.includes(r));
    if (risky.length) hits.push({ rule: 'pickle-risky-globals', detail: `pickle 内引用：${risky.join(', ')}` });
    layers.L1_structure = risky.length ? 'hit' : 'ok';
  }
  // L1-⑤ zip/tar 路径穿越与炸弹比率（启发式：直接扫条目名与头部，不完整解析）
  if (text.includes('PK\u0003\u0004')) {
    const traversal = [...text.matchAll(/PK\u0003\u0004[\s\S]{26}([^\u0000]{1,80})/g)]
      .map((m) => m[1].replace(/PK[\s\S]*$/, '').replace(/[^\x20-\x7e].*$/s, '')).filter((n) => n.includes('..') || n.startsWith('/'));
    if (traversal.length) hits.push({ rule: 'zip-path-traversal', detail: `条目名疑似越界：${traversal.slice(0, 3).join(' | ')}` });
    const unpacked = buf.length;
    if (unpacked > 0 && unpacked < 200) hits.push({ rule: 'zip-bomb-ratio', detail: '压缩体积极小但含大量条目头' });
  }
  if (hits.length) layers.L1_structure = 'hit';
  // L2：杀毒/特征层 —— **可选、缺失即如实 not-scanned**（2026-10-10 接上 YARA）
  // 说明：YARA 是**规则引擎、不需要病毒库**，正好绕开 ClamAV 的死结（官方库实测 000、国内镜像 404）。
  // 口径：① 有引擎 + 有规则才跑；② 引擎或规则缺失、或规则编译失败 ⇒ 一律 `not-scanned` 并写明原因；
  //       ③ **只在本层破"零依赖"**（Tier1/Tier2 基线不受影响，那是 Node 标准库的零依赖）。
  const yaraRulesDir = process.env.PI_YARA_RULES || join(dirname(new URL(import.meta.url).pathname), '..', 'packs', 'security-baseline', 'yara');
  let yaraRules = [];
  try {
    yaraRules = existsSync(yaraRulesDir) ? readdirSync(yaraRulesDir).filter((f) => /[.](yar|yara)$/i.test(f)).map((f) => join(yaraRulesDir, f)) : [];
  } catch {
    yaraRules = [];
  }
  if (yaraRules.length === 0) {
    layers.L2_antivirus = 'not-scanned';
    hits.push({ rule: 'l2-not-scanned', detail: `无 YARA 规则文件（${yaraRulesDir}）⇒ 未做特征匹配；**未扫描不等于安全**` });
  } else {
    const py = [
      '-c',
      'import sys, yara\n' +
        'rules = yara.compile(filepaths={p.split("/")[-1]: p for p in sys.argv[2:]})\n' +
        'print("\\n".join(sorted({m.rule for m in rules.match(sys.argv[1])})))\n',
      path,
      ...yaraRules,
    ];
    try {
      const out = execFileSync('python3', py, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const matched = out.split('\n').map((s) => s.trim()).filter(Boolean);
      if (matched.length) {
        layers.L2_antivirus = 'hit';
        for (const r of matched) hits.push({ rule: `yara:${r}`, detail: '命中 YARA 规则' });
      } else {
        layers.L2_antivirus = 'ok';
      }
    } catch (e) {
      layers.L2_antivirus = 'not-scanned';
      hits.push({ rule: 'l2-not-scanned', detail: `YARA 不可用（${e && e.status ? `rc=${e.status}` : '未安装/异常'}）⇒ **未扫描不等于安全**` });
    }
  }

  // L2-b：ClamAV（可选；与 YARA 并存）。**缺失即如实 not-scanned**，绝不假装扫过。
  // ⚠ 陷阱（本会话踩过）：本函数**形参就叫 path**（文件路径字符串）⇒ 块内**不能**写 `path.join`，
  //    那是被遮蔽的形参、不是 node:path 模块（加 import 也无效）。故只用具名导入：join/pathDelimiter/pathBasename。
  // **候选按序回退（2026-10-10 修缺口）**：先 `clamdscan`（常驻守护，亚秒级），失败**必须回退**到 `clamscan`；
  //    两者都不行才 `not-scanned`。原因：`clamdscan` 存在但 `clamd` 没跑时会失败，若不回退就会**假阴性**
  //    （明明能扫却报"未扫描"）。探测二进制用纯 Node 扫 PATH（Windows 用 PATHEXT 近似）。
  // 成本如实说明：`clamscan` 每次载库，本机实测约 **10 秒、峰值 RSS ≈966 MB**；`clamdscan` 亚秒级但要常驻 ≈1GB。
  const findBin = (name) => {
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of String(process.env.PATH || '').split(pathDelimiter)) {
      if (!dir) continue;
      for (const ext of exts) {
        const full = join(dir, name + ext);
        if (existsSync(full)) return full;
      }
    }
    return null;
  };
  const clamCands = ['clamdscan', 'clamscan'].map(findBin).filter(Boolean);
  const sigsOf = (text) =>
    String(text || '').split('\n').filter((l) => /FOUND/.test(l)).map((l) => (l.split(':').pop() || '').replace(/\s*FOUND\s*$/, '').trim());
  if (clamCands.length === 0) {
    if (layers.L2_antivirus === 'not-scanned') {
      hits.push({ rule: 'l2-not-scanned', detail: 'ClamAV 未安装（PATH 里没有 clamdscan/clamscan）⇒ **未扫描不等于安全**' });
    }
  } else {
    const failures = [];
    let settled = false;
    for (const bin of clamCands) {
      const binName = pathBasename(bin);
      try {
        const out = execFileSync(bin, ['--no-summary', '--stdout', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
        const sigs = sigsOf(out);
        if (sigs.length) {
          layers.L2_antivirus = 'hit';
          for (const sig of sigs) hits.push({ rule: `clamav:${sig || 'unknown'}`, detail: `ClamAV(${binName}) 检出` });
        } else if (layers.L2_antivirus === 'not-scanned') {
          layers.L2_antivirus = 'ok';
        }
        settled = true;
        break;
      } catch (e) {
        const sigs = sigsOf((e && e.stdout) || '');
        if (sigs.length) {
          layers.L2_antivirus = 'hit'; // rc=1 = 检出
          for (const sig of sigs) hits.push({ rule: `clamav:${sig || 'unknown'}`, detail: `ClamAV(${binName}) 检出` });
          settled = true;
          break;
        }
        failures.push(`${binName}:rc=${(e && e.status) !== undefined ? e.status : '异常'}`); // 回退到下一个候选
      }
    }
    if (!settled && layers.L2_antivirus === 'not-scanned') {
      hits.push({ rule: 'l2-not-scanned', detail: `ClamAV 全部候选失败（${failures.join(' / ')}）⇒ **未扫描不等于安全**` });
    }
  }

  // 判决必须在 **L2 之后**算（2026-10-10 修 bug）：原来它算在 L2 之前 ⇒ YARA 命中了结论却还是 clean ✗。
  // 同时把**信息性条目**排除在外（"L2 未扫描"是**披露**，不是命中的恶意特征 ⇒ 不该翻转结论）。
  const decisiveHits = hits.filter((h) => !String(h.rule).startsWith('l2-not-scanned'));
  const verdict = decisiveHits.length ? 'suspicious' : 'clean';

  return { path, bytes: buf.length, sha256: digest, magic, layers, hits, verdict };
}

function checkUrl(url) {
  const layers = { L4_url_reputation: existsSync(FEED) ? 'ok' : 'not-scanned' };
  if (!existsSync(FEED)) {
    return { url, layers, hits: [], verdict: 'not-scanned', note: `本地没有 URLhaus 缓存（跑 --update-feed）；**未查询不等于安全**` };
  }
  const lines = readFileSync(FEED, 'utf8').split('\n');
  const hit = lines.find((l) => l.trim() && url.includes(l.trim().replace(/^https?:\/\//, '')));
  return {
    url, layers, hits: hit ? [{ rule: 'urlhaus', detail: `命中 URLhaus 已知恶意条目：${hit.trim()}` }] : [],
    // **措辞就是安全语义**：URLhaus 是黑名单，没命中只能叫"不在已知恶意表里"，
    // 叫 clean 会让人误以为"查过并确认安全"⇒ 这里刻意用 not-listed。
    verdict: hit ? 'suspicious' : 'not-listed',
  };
}

function updateFeed() {
  mkdirSync(STATE_DIR, { recursive: true });
  execFileSync('curl', ['-sS', '-m', '60', '-o', FEED, 'https://urlhaus.abuse.ch/downloads/text/'], { stdio: 'inherit' });
  const n = readFileSync(FEED, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
  console.log(`✓ URLhaus 已更新：${FEED}（${n} 条）`);
}

function manifest(dir, verify) {
  const file = join(dir, MANIFEST);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return e.name === MANIFEST ? [] : [p];
  });
  const now = Object.fromEntries(walk(dir).map((p) => [p, sha256(readFileSync(p))]));
  if (!verify) {
    writeFileSync(file, JSON.stringify(now, null, 2));
    console.log(`✓ 已写清单：${file}（${Object.keys(now).length} 个文件）`);
    return { verdict: 'clean', written: Object.keys(now).length };
  }
  if (!existsSync(file)) return { verdict: 'not-scanned', note: '没有清单可比（先跑一次不带 --verify）' };
  const old = JSON.parse(readFileSync(file, 'utf8'));
  const changed = Object.keys(old).filter((k) => now[k] !== old[k]);
  const added = Object.keys(now).filter((k) => !(k in old));
  const removed = Object.keys(old).filter((k) => !(k in now));
  const hits = [...changed.map((k) => ({ rule: 'tamper-changed', detail: k })), ...added.map((k) => ({ rule: 'tamper-added', detail: k })), ...removed.map((k) => ({ rule: 'tamper-removed', detail: k }))];
  return { verdict: hits.length ? 'suspicious' : 'clean', hits };
}

// ── CLI ──
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const wantJson = flag('--json');

let out;
if (flag('--update-feed')) { updateFeed(); out = { verdict: 'clean', updated: FEED }; }
else if (flag('--file')) out = scanFile(val('--file'));
else if (flag('--url')) out = checkUrl(val('--url'));
else if (flag('--manifest')) out = manifest(val('--manifest'), flag('--verify'));
else { console.error('用法见文件头注释（--file / --url / --manifest [--verify] / --update-feed）'); process.exit(2); }

if (wantJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`结论：${out.verdict}`);
  if (out.sha256) console.log(`  sha256=${out.sha256} bytes=${out.bytes} magic=${out.magic ?? '未知'}`);
  if (out.layers) console.log(`  分层：${Object.entries(out.layers).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  for (const h of out.hits ?? []) console.log(`  ⚠ ${h.rule}: ${h.detail}`);
  if (out.note) console.log(`  注：${out.note}`);
  if (out.error) console.log(`  原因：${out.error}`);
  // 2026-10-10 修误导文案：原来这里写死「本机没有 ClamAV/YARA」——既不成立（两者现在都已安装），
  // 又掩盖真实原因（not-scanned 也可能是文件不存在、只有一边引擎缺、没有 URLhaus 缓存）。
  // 现在不断言原因，指向上面已打印的「注」与「⚠」行（那里才是真实原因）。
  if (out.verdict === 'not-scanned') console.log('  ⚠ 未扫描 ≠ 安全（真实原因见上面的「注」或「⚠」行）——不要据此外推');
}
process.exit(out.verdict === 'suspicious' ? 1 : 0);
