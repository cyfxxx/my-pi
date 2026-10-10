#!/usr/bin/env node
/**
 * 本地代理探测（2026-10-10）
 *
 * ## 为什么有它（比镜像清单更轻的路子）
 *
 * 镜像清单只能解决"包下载 / 取 GitHub 文件"；而**"任意 URL 查资料"这一类，镜像根本覆盖不到** ——
 * 实测 `r.jina.ai` / `api.allorigins.win` / `api.codetabs.com/v1/proxy` / `corsproxy.io` **全部 000**。
 * 但宿主机上通常**已经有一个在跑的代理**（VPN/加速软件：Clash、v2ray、privoxy…）。
 * ⇒ **让 agent 复用它，比维护任何镜像清单都轻**：`curl` / `git` / `npm` / `pip` **都认**
 * `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` 这几个环境变量 ⇒ 一行生效、零清单、**永远与你的软件同步**。
 *
 * ## 口径与安全（本脚本最重要的纪律）
 *
 * - **只探测、只打印**：不改任何配置、不写任何文件、不设全局默认。要用就由调用方显式带上。
 * - **端口通 ≠ 能代理**：所以 `--verify` 会**真的走一次**目标 URL（默认关；开了才发这一次请求）。
 *   这条教训来自实测：`ghps.cc` 首页返回 404 说明"主机活着"，但**不等于"能用"**。
 * - **socks 用 `ALL_PROXY`**：`curl` 认 `socks5://`，Node 原生 `fetch` 不认（所以走 curl）。
 * - **不做默认开启**：把代理设成全局默认属于"改默认行为"，需用户批准。
 *
 * ## 自证（`--self-check`）
 *
 * 自己在本机 **listen 一个随机端口**，断言探测**能发现它**；再 `close` 后断言**发现不了**。
 * 两条断言缺一不可 —— 只有正向的话，"永远返回 true"也能让自检变绿。
 *
 * 用法：
 *   node scripts/net-proxy.mjs                 # 探测并列出命中（只读）
 *   node scripts/net-proxy.mjs --export        # 额外打印 POSIX 的 export 行
 *   node scripts/net-proxy.mjs --export-powershell
 *   node scripts/net-proxy.mjs --verify        # 对命中端口真的走一次 https://arxiv.org（发一次请求）
 *   node scripts/net-proxy.mjs --self-check    # 自证探测逻辑（不依赖外部网络）
 */

import { connect, createServer } from 'node:net';
import { execFileSync } from 'node:child_process';

const HOST = '127.0.0.1';
/** 常见本地代理端口（左到右优先级）：Clash / v2ray / socks / privoxy / 通用 */
const CANDIDATES = [
  { port: 7890, scheme: 'http', label: 'Clash (http)' },
  { port: 7891, scheme: 'http', label: 'Clash (socks/http 备用)' },
  { port: 10809, scheme: 'http', label: 'v2rayN (http)' },
  { port: 10808, scheme: 'socks5', label: 'v2rayN (socks)' },
  { port: 1080, scheme: 'socks5', label: '通用 socks5' },
  { port: 8118, scheme: 'http', label: 'privoxy' },
  { port: 8888, scheme: 'http', label: '常见 http 代理' },
  { port: 3128, scheme: 'http', label: 'squid' },
  { port: 8080, scheme: 'http', label: '通用 http 代理' },
  { port: 2080, scheme: 'http', label: '常见备用' },
];
const PROBE_TIMEOUT_MS = 300;

/** 纯函数：探测单个端口是否可连（TCP connect） */
export function probePort(port, host = HOST, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = connect({ port, host });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* 忽略：销毁失败不影响结论 */
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

async function probeAll() {
  const hits = [];
  for (const c of CANDIDATES) {
    // 串行探测：避免同时打开十几个连接把本机端口耗尽
    if (await probePort(c.port)) hits.push(c);
  }
  return hits;
}

/** `--verify`：对命中端口真的走一次请求（这是"能用"的唯一证据） */
function verifyProxy(hit, url = 'https://arxiv.org') {
  const proxyUrl = `${hit.scheme}://${HOST}:${hit.port}`;
  try {
    const out = execFileSync(
      'curl',
      ['-m', '15', '-s', '-o', '/dev/null', '-w', '%{http_code} %{size_download}', '-x', proxyUrl, url],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return { ok: true, detail: `${proxyUrl} → ${out.trim()}` };
  } catch (e) {
    return { ok: false, detail: `${proxyUrl} → 失败（${e && e.status ? `rc=${e.status}` : '异常'}）` };
  }
}

/** 自证：起监听 ⇒ 必须发现；再关掉 ⇒ 必须发现不了（反向断言缺一不可） */
async function selfCheck() {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, HOST, r));
  const port = srv.address().port;
  const whileOpen = await probePort(port);
  await new Promise((r) => srv.close(r));
  const afterClose = await probePort(port);
  return { port, whileOpen, afterClose };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-check')) {
    const r = await selfCheck();
    const ok = r.whileOpen === true && r.afterClose === false;
    console.log(`自证：监听 ${r.port} 时探测=${r.whileOpen}；关闭后探测=${r.afterClose}`);
    console.log(ok ? '✅ 自证通过（正向能发现 + 反向发现不了）' : '❌ 自证失败（探测逻辑不可信）');
    process.exit(ok ? 0 : 1);
  }

  const hits = await probeAll();
  if (hits.length === 0) {
    console.log('未发现本地代理端口（已探测：' + CANDIDATES.map((c) => c.port).join('/') + '）');
    console.log('⇒ 此时才需要走镜像兜底：见技能 pi-net-mirror 与 docs/design/NET-ACCEL.md');
    process.exit(0);
  }
  console.log(`发现 ${hits.length} 个可连端口（注意：**端口通 ≠ 能代理**）：`);
  for (const h of hits) console.log(`  ${HOST}:${h.port}  ${h.label}`);

  if (argv.includes('--verify')) {
    console.log('\n逐个真的走一次请求（--verify）：');
    for (const h of hits) {
      const v = verifyProxy(h);
      console.log(`  ${v.ok ? '✓' : '✗'} ${v.detail}`);
    }
  }

  const first = hits[0];
  const httpUrl = `http://${HOST}:${first.port}`;
  const socks = hits.find((h) => h.scheme === 'socks5');
  if (argv.includes('--export')) {
    console.log('\n# POSIX（在命令前带上，或先 eval 再执行；**本脚本不替你设置**）');
    console.log(`export HTTPS_PROXY=${httpUrl} HTTP_PROXY=${httpUrl} NO_PROXY=localhost,127.0.0.1${socks ? ` ALL_PROXY=socks5://${HOST}:${socks.port}` : ''}`);
  }
  if (argv.includes('--export-powershell')) {
    console.log('\n# Windows PowerShell');
    console.log(`$env:HTTPS_PROXY="${httpUrl}"; $env:HTTP_PROXY="${httpUrl}"; $env:NO_PROXY="localhost,127.0.0.1"`);
  }
  if (!argv.includes('--export') && !argv.includes('--export-powershell') && !argv.includes('--verify')) {
    console.log('\n提示：--verify 验证是否真能代理；--export / --export-powershell 打印可直接用的环境变量行。');
  }
}

main();
