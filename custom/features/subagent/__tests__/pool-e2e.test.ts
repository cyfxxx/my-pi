/**
 * 端到端：池在**真实调用链**上真的复用了进程吗？（S3 的收尾验证）
 *
 * 为什么必须有这一层：S2 曾把复用键写成"每次新建的临时文件路径"，导致**池从未复用**——而当时
 * 14 项纯协议测试**全部通过**（它们测分帧/关联/参数契约，测不到"键选错了"）。
 * 所以"池有没有真的复用"只能靠**数进程启动次数**来证明。
 *
 * 默认跳过（每次要真起 rpc 子进程，约 20–30s）；用 `PI_SUBAGENT_POOL_E2E=1` 打开。
 * 依赖假 provider（确定性、零网络），因此不依赖真实模型抖动。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSubprocessAgent } from '../core/runner';
import { RpcWorker, getRpcPool, __setPoolFactoryForTest } from '../core/rpc-pool';

const ENABLED = process.env.PI_SUBAGENT_POOL_E2E === '1';
/** 仓库根下的 scripts（必须用**绝对**路径：动态 import 的 specifier 由打包器解析，相对路径会跑偏） */
const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts');

describe.skipIf(!ENABLED)('池端到端：两次同 profile 的任务只起一个进程', () => {
  let agentDir = '';
  let savedMemoryDir: string | undefined;
  let savedAgentDir: string | undefined;
  let savedPool: string | undefined;
  let spawnCount = 0;
  let completions: Array<{ body?: { messages?: Array<{ role?: string; content?: unknown }> } }> = [];
  let closeProvider: (() => Promise<void>) | undefined;
  let savedArgv1: string | undefined;

  const MARK1 = 'E2EONE-MARKER-42';
  const MARK2 = 'E2ETWO-MARKER-88';

  beforeAll(async () => {
    // 运行时拼路径导入 .mjs（静态 import 会让 tsc 去解析 scripts/*.mjs 的类型）
    const fake = (await import(/* @vite-ignore */ `${SCRIPTS}/lib-fake-provider.mjs`)) as {
      startFakeProvider(o: { replyText: string; delayMs?: number }): Promise<{
        port: number;
        requests: typeof completions;
        close?: () => Promise<void>;
      }>;
    };
    const harness = (await import(/* @vite-ignore */ `${SCRIPTS}/lib-pty-harness.mjs`)) as {
      configureFakeProvider(o: { agentDir: string; provider: unknown }): void;
    };

    agentDir = mkdtempSync(join(tmpdir(), 'pool-e2e-'));
    const provider = await fake.startFakeProvider({ replyText: 'ack', delayMs: 100 });
    harness.configureFakeProvider({ agentDir, provider: provider as unknown });
    completions = provider.requests;
    closeProvider = provider.close?.bind(provider);

    // runner 内的 getPiInvocation() 用 `process.argv[1]` 判断"是不是直接跑 cli.js"；在 vitest 里
    // argv[1] 是 vitest 自己，于是子进程会变成 `vitest --mode rpc`（3s 就失败）。这是**测试环境产物**，
    // 不是产品缺陷（生产里 argv[1] 就是 pi 的 cli.js）——这里定向把它指向真正的 cli.js。
    savedArgv1 = process.argv[1];
    process.argv[1] = resolve(SCRIPTS, '..', 'vendor/pi/packages/coding-agent/dist/cli.js');

    savedAgentDir = process.env.PI_CODING_AGENT_DIR;
    savedPool = process.env.PI_SUBAGENT_POOL;
    process.env.PI_CODING_AGENT_DIR = agentDir; // 子进程走 filteredSubagentEnv()，即继承本进程环境
    process.env.PI_MEMORY_DIR = join(agentDir, 'memory');
    process.env.PI_SUBAGENT_POOL = 'on';

    // 数进程启动：工厂每次被调用 = 新建一个 rpc 进程
    __setPoolFactoryForTest((opts) => {
      spawnCount++;
      return new RpcWorker(opts);
    });
  }, 60_000);

  afterAll(async () => {
    __setPoolFactoryForTest(null);
    if (savedArgv1 !== undefined) process.argv[1] = savedArgv1;
    if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
    if (savedMemoryDir === undefined) delete process.env.PI_MEMORY_DIR;
    else process.env.PI_MEMORY_DIR = savedMemoryDir;
    if (savedPool === undefined) delete process.env.PI_SUBAGENT_POOL;
    else process.env.PI_SUBAGENT_POOL = savedPool;
    await closeProvider?.();
    if (agentDir) rmSync(agentDir, { recursive: true, force: true });
  });

  const agent = {
    name: 'e2e-worker',
    description: 'e2e',
    systemPrompt: '你是端到端验证用的子代理。',
    source: 'user',
    filePath: '',
  };

  const run = (task: string) =>
    runSubprocessAgent(
      agent as never,
      agentDir,
      task,
      undefined,
      undefined,
      undefined,
      undefined,
      (() => ({})) as never,
    );

  it('两次任务共用同一个常驻进程，且第二次是干净上下文', async () => {
    const r1 = await run(`只回复 ack。暗号A=${MARK1}`);
    expect(r1.exitCode).toBe(0);
    expect(r1.messages.length).toBeGreaterThan(0);

    const r2 = await run(`只回复 ack。暗号B=${MARK2}`);
    expect(r2.exitCode).toBe(0);
    expect(r2.messages.length).toBeGreaterThan(0);

    // 核心断言：两次任务、一个进程
    expect(spawnCount, '每个任务都新起了进程 ⇒ 池没复用（键或租借语义坏了）').toBe(1);
    expect(getRpcPool().size()).toBe(1);

    // 顺带证明"复用时隔离成立"：第二次的请求里不得有第一次的暗号
    const chats = completions.filter((c) => JSON.stringify(c.body?.messages ?? []).includes('暗号'));
    const second = chats.filter((c) => JSON.stringify(c.body?.messages ?? []).includes(MARK2));
    expect(second.length, '没抓到第二次任务的请求（探针口径变了？）').toBeGreaterThan(0);
    for (const c of second) {
      expect(JSON.stringify(c.body?.messages ?? [])).not.toContain(MARK1);
    }
  }, 180_000);
});
