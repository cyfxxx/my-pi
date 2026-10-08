/**
 * 子代理常驻池的复用度量（P9，见 `docs/design/SOL-PI-BORROW.md`）
 *
 * 借鉴 SoL-Pi 的 D4："Bound child work and **measure parent reuse**"。
 *
 * 为什么值得单独测：池唯一真正有价值的行为就是**复用**——两次任务只起一个进程（端到端实测：
 * 16.8s 跑完两轮，而纯冷启动一次就要 19.1s）。而"复用"这件事**必须能被数出来**，
 * 否则我们只能靠"感觉快了"。落盘后 `daily-health` 会给出**复用率**与**实际起进程次数**。
 *
 * 落盘模式与 `usage-log.ts` 保持一致（`getMemoryDir()` + 环境变量覆盖 + append + fail-open）。
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getMemoryDir } from '../../../core/config';

/** 落盘路径；可用 `PI_SUBAGENT_POOL_LOG` 覆盖（测试用） */
export function subagentPoolLogFile(): string {
  return process.env.PI_SUBAGENT_POOL_LOG || join(getMemoryDir(), 'logs', 'subagent-pool.jsonl');
}

export interface PoolLeaseRecord {
  ts: number;
  /** profile 标识（model | agent | ext 旗标 | 人设哈希） */
  profileKey: string;
  /** true = 从 idle 池复用了既有 worker；false = **新起了一个进程** */
  reused: boolean;
  /** 租出后池里存活的 worker 数（含在租） */
  poolSize: number;
}

export function buildPoolLeaseRecord(
  input: { reused: boolean; profileKey: string; poolSize: number },
  ts: number = Date.now(),
): PoolLeaseRecord {
  return { ts, profileKey: input.profileKey, reused: input.reused, poolSize: input.poolSize };
}

/** 记一次租借。**fail-open**：度量写不进去绝不影响子代理执行。 */
export function recordPoolLease(input: { reused: boolean; profileKey: string; poolSize: number }): void {
  try {
    const file = subagentPoolLogFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(buildPoolLeaseRecord(input))}\n`);
  } catch {
    /* 度量失败不得影响执行 */
  }
}
