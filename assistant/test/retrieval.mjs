/**
 * 检索排序断言（不需要宿主）：
 *   ① 稀有词（idf 高）能把对应条目顶上来；
 *   ② 标题命中优先于正文命中（标题加权）；
 *   ③ MMR 不会让两条几乎一样的条目同时占据前两位；
 *   ④ 质量分（置信度/复现）在同等相关下决定先后；
 *   ⑤ 环境过滤生效（termux 条目在 linux 下不出现）。
 */
import { searchWithScores } from '../dist/retrieval.mjs';

const now = Date.parse('2026-10-18T00:00:00Z');
const mk = (id, title, content, extra = {}) => ({
  id, category: 'fact', title, content, tags: [], confidence: 0.7, source: 'test', recurrence: 1,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', accessedAt: '2026-10-01T00:00:00Z',
  environments: ['all'], ...extra,
});
const entries = [
  mk('a', 'alpha', '通用说明：项目使用 node 与 tmux 与 git'),
  mk('b', 'beta', 'zebra 这个词只在这里出现一次'),
  mk('c', 'gamma', 'zebra 的另一种说法也提到了 zebra'),
  mk('d1', 'dup one', '完全相同的内容：playwright 浏览器自动化流程说明'),
  mk('d2', 'dup two', '完全相同的内容：playwright 浏览器自动化流程说明'),
  mk('q', '高置信', 'playwright 浏览器自动化的官方结论', { confidence: 1, recurrence: 5 }),
  mk('v', '替代方案', 'playwright 之外还有 browser-use 这条集成路线'),
  mk('t', 'termux 专用', 'playwright 在 termux 上的特殊处理', { environments: ['termux'] }),
];
const store = { version: 2, entries };

const rare = searchWithScores(store, 'zebra', { limit: 3, now, env: 'linux' });
const rareOk = rare[0]?.entry.id === 'b' || rare[0]?.entry.id === 'c';

const titleHit = searchWithScores(store, 'alpha', { limit: 3, now, env: 'linux' });
const titleOk = titleHit[0]?.entry.id === 'a';

const dup = searchWithScores(store, 'playwright', { limit: 3, now, env: 'linux' });
const dupIds = dup.map((h) => h.entry.id);
// 两条几乎一样的条目不应同时占住前两位——多样性文档 v 应该挤进来
const mmrOk = dupIds.slice(0, 2).includes('v') && !(dupIds.includes('d1') && dupIds.includes('d2'));

const quality = searchWithScores(store, 'playwright', { limit: 3, now, env: 'linux' });
const qualityOk = quality[0]?.entry.id === 'q';

const env = searchWithScores(store, 'playwright', { limit: 10, now, env: 'linux' });
const envOk = !env.some((h) => h.entry.id === 't');

// ⑥ 来源轮转：同一来源的 3 条高分不应挤掉另一来源
const multi = { version: 2, entries: [
  ...Array.from({ length: 3 }, (_, i) => mk(`s${i}`, `同源 ${i}`, 'playwright 浏览器自动化流程', { source: 'source-A', confidence: 1, recurrence: 5 })),
  mk('other', '别源', 'playwright 浏览器自动化流程的另一种说明', { source: 'source-B', confidence: 0.7, recurrence: 1 }),
]};
const rr = searchWithScores(multi, 'playwright', { limit: 3, now, env: 'linux' });
const roundRobinOk = rr.some((hit) => hit.entry.source === 'source-B');

const ok = rareOk && titleOk && mmrOk && qualityOk && envOk && roundRobinOk;
console.log(JSON.stringify({ rareOk, titleOk, mmrOk, qualityOk, envOk, roundRobinOk, top: dupIds, ok }));
process.exit(ok ? 0 : 1);
