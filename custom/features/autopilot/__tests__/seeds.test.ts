/**
 * autopilot 种子任务对账测试（使用临时目录，不触碰真实数据）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncSeedTasks, diffSeedTask, __resetSeedCache } from '../store/seeds';
import { listTasks } from '../store/storage';

let agentDir: string;
let memDir: string;
const origAgent = process.env.PI_CODING_AGENT_DIR;
const origMem = process.env.PI_MEMORY_DIR;

function writeSeeds(schedule: string): void {
  writeFileSync(
    join(agentDir, 'scheduled-seeds.json'),
    JSON.stringify({
      version: 1,
      tasks: [{ name: 'seed-a', type: 'cron', schedule, prompt: 'do a' }],
    }),
  );
}

describe('autopilot 种子任务对账', () => {
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), 'my-pi-seeds-agent-'));
    memDir = mkdtempSync(join(tmpdir(), 'my-pi-seeds-mem-'));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_MEMORY_DIR = memDir;
    __resetSeedCache();
  });

  afterEach(() => {
    if (origAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = origAgent;
    if (origMem === undefined) delete process.env.PI_MEMORY_DIR;
    else process.env.PI_MEMORY_DIR = origMem;
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(memDir, { recursive: true, force: true });
  });

  it('缺失的种子任务自动注册（幂等）', async () => {
    writeSeeds('0 9 * * *');
    const r1 = await syncSeedTasks();
    expect(r1.added).toBe(1);
    expect(r1.drifted).toEqual([]);
    expect(listTasks().some((t) => t.name === 'seed-a')).toBe(true);

    __resetSeedCache();
    const r2 = await syncSeedTasks();
    expect(r2.added).toBe(0);
    expect(listTasks().filter((t) => t.name === 'seed-a')).toHaveLength(1);
  });

  it('同名任务与种子不一致记为漂移但不覆盖', async () => {
    writeSeeds('0 9 * * *');
    await syncSeedTasks();
    __resetSeedCache();
    writeSeeds('0 10 * * *');
    const r = await syncSeedTasks();
    expect(r.added).toBe(0);
    expect(r.drifted).toHaveLength(1);
    expect(r.drifted[0]).toContain('seed-a');
  });

  it('diffSeedTask 比较 type/schedule/prompt', () => {
    const local = { type: 'cron' as const, schedule: '0 9 * * *', prompt: 'x' };
    expect(diffSeedTask(local, { name: 's', type: 'cron', schedule: '0 9 * * *', prompt: 'x' })).toBeNull();
    expect(diffSeedTask(local, { name: 's', type: 'cron', schedule: '0 10 * * *', prompt: 'x' })).toContain('schedule');
    expect(diffSeedTask(local, { name: 's', type: 'cron', schedule: '0 9 * * *', prompt: 'y' })).toBe('prompt');
  });
});
