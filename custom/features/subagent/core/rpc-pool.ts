/**
 * 子代理常驻 RPC 池（S2）—— 见 `docs/design/SUBAGENT-POOL.md`
 *
 * 要解决的问题：现在每次子代理任务都 `spawn` 一个新 pi 进程，本机实测**纯启动 19.1s**
 * （假 provider、无网络；见设计文档第八节）。而 pi 自带 `--mode rpc`，协议支持
 * `new_session`（新建/分叉会话）与 `prompt`，且**"这轮跑完"由 `agent_settled` 事件通知**
 * —— 与 my-pi 空闲门依赖的是同一个事件。
 *
 * 隔离性已用确定性判据验证（设计文档第八节）：同一进程内 `new_session` 之后，下一次请求的
 * `messages` 是干净的 `[system, user]`，不含上一任务的任何痕迹。
 *
 * 另一个关键事实：`modes/rpc/rpc-mode.ts` 用 `output(toJsonEvent(event))` 往外写事件
 * —— 与 `--mode json` **同一个序列化器**，所以 `runner.ts` 里现有的 `processLine` 映射
 * （`message_end` / `tool_result_end` → `SingleResult`）**可以原样复用**。池只是换传输层。
 *
 * 本模块只放协议与 worker 生命周期（可测的部分尽量做成纯函数）。
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/** rpc 请求（只列本模块用到的；完整定义见 vendor/pi/.../modes/rpc/rpc-types.ts） */
export type RpcRequest =
  | { type: 'prompt'; message: string }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'abort' };

/** 协议帧：一行一个 JSON 对象 */
export function encodeRequest(id: string, req: RpcRequest): string {
  return `${JSON.stringify({ id, ...req })}\n`;
}

/** 是否是"本轮跑完"的通知（池据此把 worker 交还） */
export function isTurnSettled(msg: unknown): boolean {
  return Boolean(msg && typeof msg === 'object' && (msg as { type?: string }).type === 'agent_settled');
}

/** 是否是某个请求的响应帧（带 id + type=response） */
export function isResponseFor(msg: unknown, id: string): boolean {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: string; id?: string };
  return m.type === 'response' && m.id === id;
}

/** 池是否启用：`PI_SUBAGENT_POOL=off` 回退到原来的 spawn 路径 */
export function poolEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PI_SUBAGENT_POOL !== 'off';
}

/**
 * 行分帧器：把 stdout 的任意分片拼成完整行。
 * 纯逻辑（不碰 IO），因此可以直接测"半行到达 / 一次多行 / 跨片 JSON"这些真实边界。
 */
export function createLineFramer(onLine: (line: string) => void): { feed(chunk: string): void; flush(): void } {
  let buf = '';
  return {
    feed(chunk: string): void {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) onLine(line);
      }
    },
    flush(): void {
      if (buf.trim()) onLine(buf);
      buf = '';
    },
  };
}

export interface RpcWorkerOptions {
  /** 已构造好的 pi 启动参数（`--mode rpc` + 该 profile 的固定参数；**不含任务文本**） */
  args: string[];
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
  /** profile 标识（agent 的 system prompt + model），同名复用同一 worker */
  profileKey: string;
}

interface PendingRequest {
  resolve: (msg: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * 一个常驻 rpc 子进程。**单飞**：同一时刻只应有一个 `prompt` 在进行（协议是单会话）。
 *
 * 崩溃语义：子进程退出 → 所有在途请求 reject、`alive` 变 false；池发现 `alive === false`
 * 就丢掉它并重建，**不让整个 subagent 调用失败**（这是设计文档里"崩溃只重建 worker"的落点）。
 */
export class RpcWorker {
  private readonly proc: ChildProcess;
  private readonly framer: ReturnType<typeof createLineFramer>;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(msg: unknown) => void>();
  private seq = 0;
  private settledWaiters: Array<() => void> = [];
  private exitCode: number | null = null;
  private stderrTail = '';

  readonly profileKey: string;

  constructor(opts: RpcWorkerOptions) {
    this.profileKey = opts.profileKey;
    this.proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.env as NodeJS.ProcessEnv,
    });
    this.framer = createLineFramer((line) => this.onLine(line));
    this.proc.stdout?.on('data', (d: Buffer) => this.framer.feed(d.toString('utf8')));
    this.proc.stderr?.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString('utf8')).slice(-8 * 1024);
    });
    this.proc.on('exit', (code) => {
      this.exitCode = code ?? -1;
      const err = new Error(`rpc 子进程退出（code=${this.exitCode}）：${this.stderrTail.slice(-300)}`);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      // 让等待 settled 的一方也醒过来（否则会一直等到超时）
      const waiters = this.settledWaiters;
      this.settledWaiters = [];
      for (const w of waiters) w();
    });
    this.proc.on('error', (e: Error) => {
      this.exitCode = -1;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(e);
      }
      this.pending.clear();
    });
  }

  get alive(): boolean {
    return this.exitCode === null;
  }

  get lastError(): string {
    return this.stderrTail.slice(-300);
  }

  onEvent(fn: (msg: unknown) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private onLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非 JSON 行（理论上有 extension_error 之类也仍是 JSON；解析失败就丢）
    }
    const m = msg as { id?: string };
    if (m.id && isResponseFor(msg, m.id) && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(msg);
      return;
    }
    if (isTurnSettled(msg)) {
      const waiters = this.settledWaiters;
      this.settledWaiters = [];
      for (const w of waiters) w();
    }
    for (const fn of this.listeners) fn(msg);
  }

  send(req: RpcRequest, timeoutMs = 120_000): Promise<unknown> {
    if (!this.alive) return Promise.reject(new Error(`worker 已退出：${this.lastError}`));
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc 请求 ${req.type} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin?.write(encodeRequest(id, req));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** 等下一次 `agent_settled`（= 本任务结束）；worker 退出也会立即返回（由调用方检查 alive） */
  waitSettled(timeoutMs = 30 * 60 * 1000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settledWaiters = this.settledWaiters.filter((w) => w !== done);
        reject(new Error(`等待 agent_settled 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.settledWaiters.push(done);
    });
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('worker 被池回收'));
    }
    this.pending.clear();
    this.listeners.clear();
    this.settledWaiters = [];
    try {
      this.proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

/** 池：按 profileKey 复用 worker（单 worker per profile；并发上限由上层 `helpers.ts` 的 limit 决定） */
export class RpcPool {
  private readonly workers = new Map<string, RpcWorker>();

  /** 取一个可用的 worker：存活则复用，否则新建（旧的先 dispose） */
  acquire(opts: RpcWorkerOptions): RpcWorker {
    const existing = this.workers.get(opts.profileKey);
    if (existing?.alive) return existing;
    if (existing) existing.dispose();
    const w = new RpcWorker(opts);
    this.workers.set(opts.profileKey, w);
    return w;
  }

  /** 丢掉某个 profile 的 worker（崩溃后强制重建） */
  drop(profileKey: string): void {
    const w = this.workers.get(profileKey);
    if (w) w.dispose();
    this.workers.delete(profileKey);
  }

  size(): number {
    return [...this.workers.values()].filter((w) => w.alive).length;
  }

  shutdown(): void {
    for (const [, w] of this.workers) w.dispose();
    this.workers.clear();
  }
}

let singleton: RpcPool | null = null;

/** 进程级单例（跨任务复用；`session_shutdown` 时由调用方 shutdown） */
export function getRpcPool(): RpcPool {
  if (!singleton) singleton = new RpcPool();
  return singleton;
}
