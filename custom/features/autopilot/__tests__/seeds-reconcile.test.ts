/**
 * 种子对账的三条修正回归测试（2026-10-11）
 *
 * 起因：一条种子（「每日更新 ClamAV 病毒库」）缺 `type`/`schedule` ⇒ 被 `isSeedLike` **静默丢弃** ✗
 * ⇒ 既不注册也不报错（事后只能靠 daily-health 的"种子失配"侧面发现）；且漂移日志只记 `prompt` 标签、
 * 签名只在内存去重 ⇒ 事后无法诊断、每个新进程还会把同一条漂移再记一遍 ✗。
 *
 * 覆盖：修 1（合法种子⇒真的被注册）/ 修 2（非法种子⇒被报出、合法⇒不误报）/
 * 修 3（漂移⇒两侧摘要且不同、可诊断、跨进程不重复；一致⇒不记）/ 反向断言（假实现必然失败）。
 * 全部用 `PI_CODING_AGENT_DIR` + `PI_MEMORY_DIR` 指向 mkdtemp 临时目录隔离（两者都在调用时读 env ✓）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const origAgent = process.env.PI_CODING_AGENT_DIR;
const origMem = process.env.PI_MEMORY_DIR;

let tmp = '';
let agentDir = '';
let memDir = '';
let logsDir = '';

const sync = async (): Promise<typeof import('../store/seeds')> => {
  const mod = await import('../store/seeds');
  mod.__resetSeedCache(); // 缓存按 mtime + 模块级变量 ⇒ 每个用例前显式重置
  return mod;
};

const storageMod = async (): Promise<typeof import('../store/storage')> => await import('../store/storage');

const writeSeeds = (tasks: unknown[]): void => {
  writeFileSync(join(agentDir, 'scheduled-seeds.json'), JSON.stringify({ version: 1, tasks }, null, 2) + '\n');
};

const driftLog = (): string => (existsSync(join(logsDir, 'seed-drift.log')) ? readFileSync(join(logsDir, 'seed-drift.log'), 'utf8') : '');

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'seeds-reconcile-'));
  agentDir = join(tmp, 'agent');
  memDir = join(tmp, 'memory');
  logsDir = join(memDir, 'scheduler', 'logs');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(memDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_MEMORY_DIR = memDir;
});

afterEach(() => {
  if (origAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = origAgent;
  if (origMem === undefined) delete process.env.PI_MEMORY_DIR;
  else process.env.PI_MEMORY_DIR = origMem;
  rmSync(tmp, { recursive: true, force: true });
});

describe('修 1：合法的种子任务真的会被注册', () => {
  it('缺该任务时对账 ⇒ added=1，且 prompt/type/schedule 原样落库、nextRun 已计算', async () => {
    const prompt = '探针任务：直接回复 done。';
    writeSeeds([{ name: 'clamav-probe', type: 'cron', schedule: '15 6 * * *', prompt }]);
    const mod = await sync();
    expect(mod.loadSeeds().map((s) => s.name)).toEqual(['clamav-probe']); // 隔离生效的前提断言

    const r = await mod.syncSeedTasks();
    expect(r.added).toBe(1);
    expect(r.drifted).toEqual([]);

    const st = await storageMod();
    const t = st.readTasks().tasks.find((x) => x.name === 'clamav-probe');
    expect(t, '对账必须真的把任务写进（隔离的）tasks.json').toBeTruthy();
    expect(t?.prompt).toBe(prompt);
    expect(t?.type).toBe('cron');
    expect(t?.schedule).toBe('15 6 * * *');
    expect(t?.nextRun, 'nextRun 必须由调度表达式算出（不是 null）').toBeTruthy();

    // 幂等：再对账一次不应重复添加
    mod.__resetSeedCache();
    expect((await mod.syncSeedTasks()).added).toBe(0);
  });
});

describe('修 2：非法种子不再静默丢弃', () => {
  it('缺 type 的种子 ⇒ 被报出（含名字）；只有合法种子 ⇒ 不误报', async () => {
    writeSeeds([
      { name: 'ok-seed', type: 'cron', schedule: '5 5 * * *', prompt: '合法。' },
      { name: '每日更新 ClamAV 病毒库', prompt: '缺 type 与 schedule。' },
    ]);
    const mod = await sync();
    await mod.syncSeedTasks();
    const log = driftLog();
    expect(log, '被忽略的种子必须留痕').toContain('种子被忽略');
    expect(log).toContain('每日更新 ClamAV 病毒库');
    expect(log, '合法种子不应出现在"被忽略"里').not.toContain('ok-seed');

    // 反面对照：只有合法种子 ⇒ 不出现"被忽略"
    rmSync(join(logsDir, 'seed-drift.log'), { force: true });
    writeSeeds([{ name: 'ok-seed', type: 'cron', schedule: '5 5 * * *', prompt: '合法。' }]);
    mod.__resetSeedCache();
    await mod.syncSeedTasks();
    expect(driftLog()).not.toContain('种子被忽略');
  });
});

describe('修 3：漂移可诊断、跨进程不重复、一致时不记', () => {
  it('prompt 漂移 ⇒ 日志含两侧摘要且摘要不同；重复调用只记一条；一致后不再记漂移', async () => {
    const seedPrompt = '种子版本：内容 A。';
    writeSeeds([{ name: 'drift-seed', type: 'cron', schedule: '5 5 * * *', prompt: seedPrompt }]);
    const mod = await sync();
    const st = await storageMod();
    await st.addTask({ name: 'drift-seed', type: 'cron', schedule: '5 5 * * *', prompt: '本地版本：内容 B（更长一些）。' });

    const r1 = await mod.syncSeedTasks();
    expect(r1.drifted.length).toBe(1);
    expect(r1.drifted[0]).toContain('prompt(本地 ');
    expect(r1.drifted[0]).toContain('≠ 种子');

    const digests = r1.drifted[0].match(/([0-9a-f]{8}\/\d+)/g) ?? [];
    expect(digests.length, '必须记录两侧摘要（本地 + 种子）').toBe(2);
    expect(digests[0], '两侧摘要必须不同（否则无法诊断）').not.toBe(digests[1]);

    const log1 = driftLog();
    expect(log1).toContain('漂移:');
    expect(log1).toContain(digests[0]);

    // 同一漂移再对账一次 ⇒ 签名已落盘 ⇒ 不再重复记录（此前每个新进程都会重记一遍 ✗）
    mod.__resetSeedCache();
    await mod.syncSeedTasks();
    expect(driftLog(), '同一条漂移不得重复记录').toBe(log1);
  });

  it('本地与种子一致 ⇒ diffSeedTask 返回 null 且不写漂移日志（防止把警报器改瞎）', async () => {
    const p = '完全一致的内容。';
    writeSeeds([{ name: 'clean-seed', type: 'cron', schedule: '5 5 * * *', prompt: p }]);
    const mod = await sync();
    const st = await storageMod();
    await st.addTask({ name: 'clean-seed', type: 'cron', schedule: '5 5 * * *', prompt: p });

    expect(mod.diffSeedTask({ type: 'cron', schedule: '5 5 * * *', prompt: p }, { name: 'clean-seed', type: 'cron', schedule: '5 5 * * *', prompt: p })).toBeNull();
    const r = await mod.syncSeedTasks();
    expect(r.drifted).toEqual([]);
    expect(driftLog()).not.toContain('漂移:');
  });
});

describe('反向断言：判据必须能证伪（否则等于没有检测）', () => {
  it('diffSeedTask 对"相同"与"不同"给出相反结论；shortDigest 对相同输入稳定、对不同输入不同', async () => {
    const mod = await sync();
    const s = { name: 'x', type: 'cron' as const, schedule: '5 5 * * *', prompt: 'AAA' };
    const same = { type: 'cron' as const, schedule: '5 5 * * *', prompt: 'AAA' };
    const diff = { type: 'cron' as const, schedule: '5 5 * * *', prompt: 'BBB' };
    // 假实现（永远返回 null 或永远返回非 null）不可能同时满足下面两条 ⇒ 本断言有分辨力 ✓
    expect(mod.diffSeedTask(same, s)).toBeNull();
    expect(mod.diffSeedTask(diff, s)).not.toBeNull();

    expect(mod.shortDigest('AAA')).toBe(mod.shortDigest('AAA'));
    expect(mod.shortDigest('AAA')).not.toBe(mod.shortDigest('BBB'));
    expect(mod.shortDigest('AAA')).toContain('/3'); // 长度参与摘要（同哈希不同长度也可区分）
  });
});
