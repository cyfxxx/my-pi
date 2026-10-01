/**
 * 并发限制器与带重试的批量 fetch（wechat-article-exporter P-Queue 启发）。
 * 适用于批量 URL 抓取、知识源并发拉取、多引擎搜索等场景。
 */

export interface ConcurrencyLimiter {
  /** 当前正在执行的任务数 */
  readonly running: number;
  /** 队列中等待的任务数 */
  readonly queued: number;
  /** 执行一个任务（自动排队，完成后自动释放槽位） */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** 排空队列（等待所有已提交任务完成） */
  drain(): Promise<void>;
}

export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  if (maxConcurrent < 1) throw new Error('maxConcurrent 必须 ≥ 1');

  let running = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (running < maxConcurrent) {
      running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function release(): void {
    running--;
    if (queue.length > 0) {
      running++;
      queue.shift()!();
    }
  }

  return {
    get running() {
      return running;
    },
    get queued() {
      return queue.length;
    },

    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },

    async drain(): Promise<void> {
      // 等待队列清空即可（running 会在每次 release 后自动递减）
      while (running > 0 || queue.length > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}

/** 批量并发 fetch，带并发限制和重试。 */
