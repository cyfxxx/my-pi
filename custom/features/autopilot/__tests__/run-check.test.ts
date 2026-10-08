/**
 * 只读检查命令执行器测试（P1）
 *
 * 锁三件事：
 *   ① exit 0 才算通过（这是 `verified` 唯一的来源）；
 *   ② 超时按失败处理，且**不挂住调用方**；
 *   ③ 输出只留尾部（给模型当证据够用，不把日志搬进上下文）。
 */
import { describe, it, expect } from 'vitest';
import { CHECK_OUTPUT_TAIL_CHARS, describeCheck, runCheckCommand } from '../store/run-check';

describe('runCheckCommand：exit 0 才算通过', () => {
  it('成功命令 → ok=true, status=0', async () => {
    const r = await runCheckCommand('true');
    expect(r.ok).toBe(true);
    expect(r.status).toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it('失败命令 → ok=false 且带退出码（**verified 绝不能从失败命令产生**）', async () => {
    const r = await runCheckCommand('false');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(1);
  });

  it('非 0/1 退出码原样带出（便于把判据写细）', async () => {
    const r = await runCheckCommand('exit 3');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(3);
  });

  it('stdout 与 stderr 都收进证据', async () => {
    const r = await runCheckCommand('echo OUT; echo ERR >&2');
    expect(r.outputTail).toContain('OUT');
    expect(r.outputTail).toContain('ERR');
  });
});

describe('runCheckCommand：有界', () => {
  it('超时 → ok=false、timedOut=true、status=null（且不把调用方挂住）', async () => {
    const t0 = Date.now();
    const r = await runCheckCommand('sleep 5', { timeoutMs: 300 });
    const dt = Date.now() - t0;
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.status).toBeNull();
    // 留足余量：应在超时后很快收口，而不是等 sleep 跑完（5s）
    expect(dt).toBeLessThan(3_000);
  }, 20_000);

  it('输出只留尾部（大输出不会把上下文撑爆）', async () => {
    const r = await runCheckCommand(`yes X | head -c ${CHECK_OUTPUT_TAIL_CHARS * 3}`, { timeoutMs: 20_000 });
    expect(r.outputTail.length).toBeLessThanOrEqual(CHECK_OUTPUT_TAIL_CHARS);
  }, 30_000);
});

describe('describeCheck：给模型/状态文案的一句话', () => {
  it('三种结果都能说清', () => {
    expect(describeCheck('npm test', { ok: true, status: 0, outputTail: '', timedOut: false, reason: '通过' })).toContain('检查通过');
    expect(describeCheck('npm test', { ok: false, status: 1, outputTail: '', timedOut: false, reason: '退出码 1' })).toContain('检查失败');
    expect(describeCheck('npm test', { ok: false, status: null, outputTail: '', timedOut: true, reason: '超时' })).toContain('检查超时');
  });
});
