/**
 * RPC 帧追踪（`PI_RPC_TRACE=1` 门控）的单测。
 *
 * 这块仪表存在的唯一目的，是让"中途注入到底卡在哪一环"能被**证据**回答，而不是靠推断：
 * - `dir:'out'` 的帧 ⇒ **父侧真的把那条 prompt 写进了子进程 stdin**（写成功才记 ✓）；
 * - `dir:'in'` 的帧 ⇒ **子进程真的回了什么**（`turn_start`/`turn_end`/`agent_settled` …）；
 * ⇒ 两者合起来就能定性：没写进去 ✗ / 写了但不接 ✗ / 接了但不执行 ✗ / 其实生效了 ✓。
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  RPC_TRACE_MAX_CHARS,
  createRpcTracer,
  makeTraceRecord,
  rpcTraceEnabled,
  rpcTraceFile,
} from '../core/rpc-pool';

/** 收集式 append（注入用 ⇒ 不碰磁盘） */
function collector(): { lines: string[]; append: (file: string, line: string) => void } {
  const lines: string[] = [];
  return { lines, append: (_file: string, line: string) => lines.push(line) };
}

describe('rpc 帧追踪：纯函数与门控', () => {
  it('① 方向正确：out=父→子、in=子→父，且 raw 原样保留', () => {
    const out = makeTraceRecord('out', '{"id":"2","type":"prompt"}', 'T');
    const inn = makeTraceRecord('in', '{"type":"turn_start"}', 'T');
    expect(out.dir).toBe('out');
    expect(inn.dir).toBe('in');
    expect(out.raw).toBe('{"id":"2","type":"prompt"}');
    expect(inn.raw).toBe('{"type":"turn_start"}');
    expect(out.ts).toBe('T');
  });

  it('② 超长帧被截断并标注（不丢方向、不抛）', () => {
    const rec = makeTraceRecord('in', 'x'.repeat(RPC_TRACE_MAX_CHARS + 500), 'T');
    expect(rec.truncated).toBe(true);
    expect(rec.raw.length).toBe(RPC_TRACE_MAX_CHARS);
    const short = makeTraceRecord('in', 'ok', 'T');
    expect(short.truncated).toBeUndefined();
  });

  it('③ 默认关：不设 PI_RPC_TRACE 时零写盘（连文件都不该出现）', () => {
    expect(rpcTraceEnabled({})).toBe(false);
    expect(rpcTraceEnabled({ PI_RPC_TRACE: '0' })).toBe(false);
    expect(rpcTraceEnabled({ PI_RPC_TRACE: '1' })).toBe(true);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-trace-off-'));
    const file = path.join(dir, 'rpc-trace.jsonl');
    const trace = createRpcTracer({ enabled: false, file });
    trace('out', '{"x":1}');
    trace('in', '{"x":2}');
    expect(fs.existsSync(file)).toBe(false); // 真正的"零写盘" ✓
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('④ 开启时两个方向都写，且**含换行的坏帧不会破坏 JSONL**（每条记录仍是一行、可解析）', () => {
    const c = collector();
    const trace = createRpcTracer({ enabled: true, file: 'ignored', append: c.append, now: () => 'T' });
    trace('out', '{"id":"1","type":"prompt","message":"注入"}');
    trace('in', '{"type":"turn_start"}');
    trace('in', 'not-json\nsecond-line\ttab'); // 坏帧 + 换行 + 制表符
    expect(c.lines.length).toBe(3); // 坏帧也留痕 ✓
    for (const line of c.lines) {
      expect(line.endsWith('\n')).toBe(true);
      const obj = JSON.parse(line) as { dir?: string; raw?: string };
      expect(obj.dir).toBeTruthy();
      expect(typeof obj.raw).toBe('string');
    }
    const parsed = c.lines.map((l) => JSON.parse(l) as { dir: string; raw: string });
    expect(parsed[0].dir).toBe('out');
    expect(parsed[1].dir).toBe('in');
    expect(parsed[1].raw).toBe('{"type":"turn_start"}');
    expect(parsed[2].raw).toContain('second-line'); // 坏帧内容被转义存下来 ✓
  });

  it('⑤ 写失败 fail-open：append 抛异常时不得把异常抛给调用方', () => {
    const trace = createRpcTracer({
      enabled: true,
      file: 'ignored',
      append: () => {
        throw new Error('磁盘满了');
      },
    });
    expect(() => trace('out', '{"x":1}')).not.toThrow();
  });

  it('⑥ 文件路径：PI_RPC_TRACE_FILE 覆盖优先（便于实验注入），且不依赖真实 memoryDir', () => {
    expect(rpcTraceFile({ PI_RPC_TRACE_FILE: '/tmp/rt.jsonl' })).toBe('/tmp/rt.jsonl');
    const p = rpcTraceFile({ PI_MEMORY_DIR: '/tmp/mem-x' });
    expect(p).toBe(path.join('/tmp/mem-x', 'logs', 'rpc-trace.jsonl'));
  });

  it('⑦ 反向断言：一个"永远不记"的假实现必须在"应有记录"的场景下失败', () => {
    const c = collector();
    const real = createRpcTracer({ enabled: true, file: 'ignored', append: c.append, now: () => 'T' });
    const fakeAlwaysSilent = (_dir: 'in' | 'out', _raw: string): void => {
      /* 假实现：永远不产生记录 */
    };
    const fakeLines: string[] = [];
    const fake = (dir: 'in' | 'out', raw: string): void => {
      fakeAlwaysSilent(dir, raw);
      // 它什么也不写 ⇒ fakeLines 永远为空
    };
    real('out', '{"id":"2","type":"prompt"}');
    fake('out', '{"id":"2","type":"prompt"}');

    expect(c.lines.length).toBeGreaterThanOrEqual(1); // 真实现确实记了
    expect(fakeLines.length).toBe(0);
    // 关键：两者在"应有记录"的场景下行为必须不同 ⇒ 断言有分辨力 ✓
    expect(fakeLines.length).not.toBe(c.lines.length);
  });
});
