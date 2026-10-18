/**
 * 自优化管线脚本的断言（不需要宿主）：
 *   ① memory-store：首写 created，重写变 updated（去重合并），总数不涨；
 *   ② knowledge-ingest：解析 md 并入库，重复跑幂等；
 *   ③ memory-lifecycle：只读报告能算出条数；
 *   ④ lesson-miner：能从干预记录挖出候选，--ingest 后入库。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mypi-scripts-'));
const memoryFile = join(dir, 'entries.json');
const run = (script, args, input) => {
  const out = execFileSync(process.execPath, [`dist/${script}.mjs`, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MYPI_MEMORY_FILE: memoryFile },
    input,
  });
  return JSON.parse(out.trim().split('\n').pop());
};

const first = run('memory-store', ['--json', JSON.stringify({ category: 'solutions', title: '脚本测试', content: '这是 headless 写入的一条记忆' })]);
const second = run('memory-store', ['--json', JSON.stringify({ category: 'solutions', title: '脚本测试', content: '这是 headless 写入的一条记忆' })]);
const storeOk = first.actions.created === 1 && second.actions.updated === 1 && second.total === 1;

const md = join(dir, 'knowledge.md');
writeFileSync(
  md,
  '# 知识\n\n- [插件组合模型](https://example.com/a)\n  插件是组合单位，profile 决定挂载哪些插件，未挂载的能力不会生效。\n'
    + '- [终端差分渲染](https://example.com/b)\n  差分渲染只重绘变化的行，长会话滚动时开销稳定，适合做终端前端。\n',
);
const know1 = run('knowledge-ingest', [md, '2']);
const know2 = run('knowledge-ingest', [md, '2']);
const knowledgeOk = know1.actions.created === 2 && know2.actions.created === 0 && know2.actions.updated === 2 && know2.total === 3;

const life = run('memory-lifecycle', ['--json']);
const lifecycleOk = life.total === 3 && Array.isArray(life.candidates.stale);

const interventions = join(dir, 'interventions.jsonl');
writeFileSync(interventions, `${JSON.stringify({ type: 'abort', prompt: '这不是我要的', correctivePrompt: '应该先确认范围', lastTool: { name: 'bash' } })}\n`);
const mineDry = run('lesson-miner', ['--file', interventions]);
const mineIngest = run('lesson-miner', ['--file', interventions, '--ingest']);
const minerOk = mineDry.mined === 1 && mineIngest.actions.created === 1 && mineIngest.total === 4;

const ok = storeOk && knowledgeOk && lifecycleOk && minerOk;
console.log(JSON.stringify({ storeOk, knowledgeOk, lifecycleOk, minerOk, ok }));
process.exit(ok ? 0 : 1);
