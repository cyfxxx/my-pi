/**
 * 池 shutdown 的语义守门（回归：**正在服务任务的 worker 不得被销毁**）
 *
 * 事故（2026-10-10 实测）：并行子代理时日志出现「常驻池路径失败，已回退 spawn：worker 被池回收」，
 * 收件箱显示 `未读 1 / 共 1` ⇒ **中途投递的消息永远没被消费** ✗。
 * 根因：`session_shutdown` 钩子在**任务仍在跑**时触发 ⇒ 旧 `shutdown()` **连 `leased`（租用中）也 dispose** ✗
 * ⇒ 在跑的 worker 被 SIGTERM ⇒ 待处理请求全部 reject 成「worker 被池回收」⇒ 回退到**没有投递通道**的 spawn 路径。
 *
 * 断言在**池层面**做（用注入式假 worker，不必真起 pi 进程 ✓）：
 *  1) `shutdown()`（非 force）⇒ **leased 的 worker 绝不能被 dispose** ✓（改前必红 ✓）
 *  2) `shutdown(true)` ⇒ leased **必须**被 dispose ✓（反向断言：退出路径不能漏进程 ✓）
 *  3) `shutdown()` 仍要清理 **idle** ✓（别把正常清理一起关掉 ✗）
 */
import { describe, it, expect } from 'vitest';
import { RpcPool } from '../core/rpc-pool';
import type { RpcWorker, RpcWorkerOptions } from '../core/rpc-pool';

interface FakeWorker {
  alive: boolean;
  disposed: number;
  worker: RpcWorker;
}

function makeFake(): FakeWorker {
  const f: FakeWorker = { alive: true, disposed: 0, worker: undefined as unknown as RpcWorker };
  const fake = {
    get alive(): boolean {
      return f.alive;
    },
    dispose(): void {
      f.disposed += 1;
      f.alive = false;
    },
  };
  f.worker = fake as unknown as RpcWorker;
  return f;
}

const opts = (key: string): RpcWorkerOptions => ({ profileKey: key } as RpcWorkerOptions);

describe('RpcPool.shutdown 语义', () => {
  it('非 force：**租用中（leased）的 worker 不得被销毁** —— 否则在跑的任务会被掐断、中途投递失效', () => {
    const a = makeFake();
    const b = makeFake();
    const pool = new RpcPool(() => (a.disposed === 0 ? a.worker : b.worker));

    pool.lease(opts('p1')); // a：租用中（未 release）
    pool.lease(opts('p2')); // b：租用中
    pool.shutdown(); // ← 模拟 session_shutdown 在任务中途触发

    expect(a.disposed).toBe(0);
    expect(b.disposed).toBe(0);
  });

  it('force：**必须**销毁 leased（退出路径不能漏掉常驻进程）', () => {
    const a = makeFake();
    const pool = new RpcPool(() => a.worker);
    pool.lease(opts('p1'));
    pool.shutdown(true);
    expect(a.disposed).toBe(1);
  });

  it('非 force：**idle 仍要被清理**（别把正常清理一起关掉）', () => {
    const a = makeFake();
    const pool = new RpcPool(() => a.worker);
    const lease = pool.lease(opts('p1'));
    lease.release(); // 交还 ⇒ 进 idle
    pool.shutdown();
    expect(a.disposed).toBe(1);
  });

  it('非 force 之后**交还**的 worker 必须被销毁（修复不得引入漏进程）', () => {
    const a = makeFake();
    const pool = new RpcPool(() => a.worker);
    const lease = pool.lease(opts('p1'));
    pool.shutdown(); // 任务还在跑：不销毁
    expect(a.disposed).toBe(0);
    lease.release(); // 任务结束、交还 ⇒ 收工态下直接销毁
    expect(a.disposed).toBe(1);
  });
});
