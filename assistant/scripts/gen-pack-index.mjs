/**
 * gen-pack-index：为"按需取用"的大块内容（当前是 packs/ 技能包）生成索引，而不是整包入库。
 *
 * 策略（docs/POLICIES.md §3）：大块内容做成索引；需要时按索引取用。
 * 输出：docs/PACK-INDEX.md（人读）+ docs/PACK-INDEX.json（机读，供以后按需拉取）。
 *
 * 用法：node assistant/scripts/gen-pack-index.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname);
const PACKS = join(ROOT, 'packs');
if (!existsSync(PACKS)) {
  console.log(JSON.stringify({ error: `没有 packs 目录：${PACKS}` }));
  process.exit(0);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, out);
    else if (entry === 'SKILL.md') out.push(full);
  }
  return out;
}

function frontmatter(file) {
  const text = readFileSync(file, 'utf8').slice(0, 2000);
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  const data = {};
  if (match) {
    for (const line of match[1].split('\n')) {
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return data;
}

const packs = [];
for (const dir of readdirSync(PACKS)) {
  const full = join(PACKS, dir);
  if (!statSync(full).isDirectory()) continue;
  const skills = walk(full).map((file) => {
    const meta = frontmatter(file);
    return { path: relative(ROOT, file), name: meta.name ?? '', description: (meta.description ?? '').slice(0, 120) };
  });
  let sizeKb = 0;
  const walkSize = (d) => {
    for (const entry of readdirSync(d)) {
      const f = join(d, entry);
      const s = statSync(f);
      if (s.isDirectory()) walkSize(f);
      else sizeKb += s.size / 1024;
    }
  };
  walkSize(full);
  packs.push({ pack: dir, skills: skills.length, sizeKb: Math.round(sizeKb), items: skills });
}

packs.sort((a, b) => b.skills - a.skills);
const json = { generatedAt: new Date().toISOString(), packs };
writeFileSync(join(ROOT, 'docs', 'PACK-INDEX.json'), `${JSON.stringify(json, null, 2)}\n`);

const lines = [
  '# 技能包索引（按需取用，不入库）',
  '',
  `> 生成时间：${json.generatedAt.slice(0, 10)}；生成脚本：\`assistant/scripts/gen-pack-index.mjs\`。`,
  `> 共 ${packs.length} 个包、${packs.reduce((n, p) => n + p.skills, 0)} 个技能、${Math.round(packs.reduce((n, p) => n + p.sizeKb, 0) / 1024)} MB。`,
  '',
  '| 包 | 技能数 | 大小 | 说明 |',
  '|---|---|---|---|',
];
for (const pack of packs) {
  const first = pack.items[0]?.description?.replace(/\|/g, '/') ?? '';
  lines.push(`| \`${pack.pack}\` | ${pack.skills} | ${pack.sizeKb} KB | ${first.slice(0, 60)} |`);
}
lines.push('', '## 用法', '', '```bash', '# 需要某个包时，从老仓库按路径取（或以后放到独立 skills 仓库）：', 'git -C /path/to/my-pi archive HEAD packs/<包名> | tar -x -C .', '```');
writeFileSync(join(ROOT, 'docs', 'PACK-INDEX.md'), `${lines.join('\n')}\n`);

console.log(JSON.stringify({ packs: packs.length, skills: packs.reduce((n, p) => n + p.skills, 0), out: ['docs/PACK-INDEX.md', 'docs/PACK-INDEX.json'] }));
