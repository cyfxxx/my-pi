#!/usr/bin/env node
/**
 * 网络通道探测与选路（2026-10-10）
 *
 * ## 为什么有它（解决"冗余"与"更新"）
 *
 * 镜像清单**必然腐烂**——本会话的血证：网上最常推荐的 **ghproxy 全系 8 个，实测从本环境全部 000**；
 * 而 `gitclone.com` 与 Gitee 镜像**能用**。所以正确做法不是背一张表，而是：
 *   **用前探测（看真实字节数）→ 选第一个真能用的 → 把结果带日期记下来**。
 *
 * ## 三条口径（都来自本会话的实测教训）
 *
 * 1. **看字节数，不只看状态码**：`ghps.cc` 首页返回 404——"主机活着"不等于"能用"；
 *    反过来 200 也可能只是首页壳子。所以每条通道都断言**拿到 > 0 字节**。
 * 2. **必须有反向对照**：把 `github.com` / `raw.githubusercontent.com` 也放进探测表——
 *    它们**应当失败**；如果某天它们通了，说明网络环境变了（这本身是有价值的信号）。
 * 3. **跨平台**：不使用 `/dev/null`（POSIX 专属），一律写 `os.tmpdir()` 下的临时文件再删；
 *    外部只依赖 `curl`（Win10+ 自带）与 `git`。
 *
 * ## 自证（`--self-check`，不依赖外网）
 *
 * 本机起一个 HTTP 服务返回**已知字节**：断言探测器报 `ok` 且 **size 等于已知值**；
 * 再起一个**必定连不上**的端口：断言报 `fail`。两条缺一不可——只有正向的话，
 * "永远返回 ok"也能让自检变绿。
 *
 * 用法：
 *   node scripts/net-mirror.mjs --probe            # 探测全部通道并追加带日期的日志
 *   node scripts/net-mirror.mjs --pick file|repo|npm|pypi|rust|go|hf
 *   node scripts/net-mirror.mjs --self-check       # 自证（不依赖外网）
 */

import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(import.meta.dirname, '..');

/** 探测表：`need` = 用途；`expect` = ok 判据（bytes>0 或 refs 非空） */
const CHANNELS = [
  { need: 'file', name: 'jsDelivr /gh/', kind: 'http', url: 'https://cdn.jsdelivr.net/gh/git/git@master/README.md', expect: 'bytes' },
  { need: 'file', name: 'jsDelivr /gh/ (tag)', kind: 'http', url: 'https://cdn.jsdelivr.net/gh/vuejs/vue@v2.7.16/README.md', expect: 'bytes' },
  { need: 'repo', name: 'gitclone.com (git)', kind: 'git', url: 'https://gitclone.com/github.com/git/git', expect: 'refs' },
  { need: 'repo', name: 'Gitee 镜像 (git)', kind: 'git', url: 'https://gitee.com/mirrors/redis.git', expect: 'refs' },
  { need: 'npm', name: 'registry.npmmirror.com', kind: 'http', url: 'https://registry.npmmirror.com/left-pad', expect: 'bytes' },
  { need: 'pypi', name: '清华 PyPI', kind: 'http', url: 'https://pypi.tuna.tsinghua.edu.cn/pypi/requests/json', expect: 'bytes' },
  { need: 'rust', name: 'rsproxy.cn', kind: 'http', url: 'https://rsproxy.cn/', expect: 'bytes' },
  { need: 'go', name: 'goproxy.cn', kind: 'http', url: 'https://goproxy.cn/', expect: 'bytes' },
  { need: 'hf', name: 'hf-mirror.com', kind: 'http', url: 'https://hf-mirror.com/', expect: 'bytes' },
  // 反向对照：**应当失败**（若通了说明环境变了）
  { need: 'control', name: 'github.com（对照）', kind: 'http', url: 'https://github.com', expect: 'fail' },
  { need: 'control', name: 'raw.githubusercontent.com（对照）', kind: 'http', url: 'https://raw.githubusercontent.com', expect: 'fail' },
];

const TIMEOUT_S = 10;

/** 最小 TCP 连通探测（自证里用来等子进程服务就绪） */
function probePort(port, host = '127.0.0.1', timeoutMs = 300) {
  return new Promise((resolve) => {
    const s = connect({ port, host });
    let done = false;
    const fin = (ok) => {
      if (done) return;
      done = true;
      try { s.destroy(); } catch { /* 忽略 */ }
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => fin(false));
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
  });
}

/** 用 curl 取字节数（跨平台：不用 /dev/null） */
export function probeHttp(url, timeoutS = TIMEOUT_S) {
  const out = join(tmpdir(), `net-probe-${process.pid}-${Math.random().toString(36).slice(2)}.bin`);
  try {
    const r = execFileSync(
      'curl',
      ['-m', String(timeoutS), '-sSL', '-o', out, '-w', '%{http_code} %{size_download}', url],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const [code, size] = r.trim().split(/\s+/);
    return { ok: Number(size) > 0, code: Number(code), size: Number(size) };
  } catch (e) {
    return { ok: false, code: 0, size: 0, err: e && e.status ? `rc=${e.status}` : 'spawn/网络异常' };
  } finally {
    try {
      if (existsSync(out)) rmSync(out);
    } catch {
      /* 临时文件清理失败不影响结论 */
    }
  }
}

/** 用 git ls-remote 验证"能不能真取到 refs"（比首页 200 强得多） */
export function probeGit(url, timeoutS = TIMEOUT_S) {
  try {
    const r = execFileSync('git', ['ls-remote', url, 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutS * 1000,
    });
    const refs = r.trim().split('\n').filter(Boolean);
    return { ok: refs.length > 0, refs: refs.length, sample: (refs[0] || '').slice(0, 40) };
  } catch (e) {
    return { ok: false, refs: 0, err: e && e.status ? `rc=${e.status}` : '异常/超时' };
  }
}

export function probeChannel(ch) {
  const r = ch.kind === 'git' ? probeGit(ch.url) : probeHttp(ch.url);
  if (ch.expect === 'fail') return { ...r, ok: !r.ok }; // 对照项：失败才算"符合预期"
  return r;
}

function logPath() {
  return join(REPO_ROOT, 'portable', 'memory', 'logs', 'net-probe.jsonl');
}

function appendLog(rows) {
  const file = logPath();
  try {
    mkdirSync(dirname(file), { recursive: true });
    const rec = { ts: new Date().toISOString(), results: rows.map((r) => ({ need: r.need, name: r.name, ok: r.ok, code: r.code ?? null, size: r.size ?? null, refs: r.refs ?? null })) };
    appendFileSync(file, JSON.stringify(rec) + '\n');
    return file;
  } catch {
    return null; // 记录失败不影响探测结论
  }
}

/**
 * 自证：**服务必须跑在独立进程里**（2026-10-10 被自证抓出的设计缺陷）。
 *
 * 第一版把 HTTP 服务起在**本进程**里，然后用 `execFileSync` 去 curl 它 —— 必然失败：
 * `execFileSync` **阻塞本进程的事件循环**，服务永远没机会响应 ⇒ curl 拿到 0 字节。
 * 自证当场报红（`size=0（期望 29）`），这就是"自证必须能证伪"的价值。
 * 现在改成：`spawn` 一个独立的 node 子进程做服务 ⇒ 阻塞与否都无所谓。
 */
async function selfCheck() {
  const payload = 'net-mirror-self-check-payload';
  const srvCode =
    "const http=require('http');const s=http.createServer((q,r)=>{r.writeHead(200);r.end(process.argv[1]);});" +
    "s.listen(Number(process.argv[2]),'127.0.0.1',()=>{});";
  // 先占一个端口号：起服务再关掉，拿到一个"刚被用过、现在空着"的端口
  const holder = createServer();
  await new Promise((r) => holder.listen(0, '127.0.0.1', r));
  const port = holder.address().port;
  await new Promise((r) => holder.close(r));

  const child = spawn(process.execPath, ['-e', srvCode, payload, String(port)], { stdio: 'ignore' });
  // 等服务就绪（轮询 TCP，最多 3 秒）
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    ready = await probePort(port);
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }

  const good = ready ? probeHttp(`http://127.0.0.1:${port}/`) : { ok: false, size: -1, code: 0 };
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 200)); // 等端口释放
  const dead = probeHttp(`http://127.0.0.1:${port}/`);

  const ok = good.ok === true && good.size === Buffer.byteLength(payload) && dead.ok === false;
  console.log(
    `自证：独立进程服务 size=${good.size}（期望 ${Buffer.byteLength(payload)}）ok=${good.ok}；关闭后 ok=${dead.ok}`,
  );
  console.log(ok ? '✅ 自证通过（正向拿到确切字节 + 反向必然失败）' : '❌ 自证失败（探测逻辑不可信）');
  process.exit(ok ? 0 : 1);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-check')) return selfCheck();

  const pick = argv.indexOf('--pick');
  const rows = [];
  for (const ch of CHANNELS) {
    if (pick >= 0 && ch.need !== argv[pick + 1]) continue;
    const r = probeChannel(ch);
    rows.push({ ...ch, ...r });
    const detail = ch.kind === 'git' ? `refs=${r.refs ?? 0}` : `${r.code} size=${r.size ?? 0}`;
    console.log(`${r.ok ? '✓' : '✗'} [${ch.need}] ${ch.name}  ${detail}`);
  }

  if (pick >= 0) {
    const first = rows.find((r) => r.ok && r.need !== 'control');
    console.log(first ? `⇒ 选路：${first.name}` : '⇒ 该用途当前**没有可用通道**（如实报告，不要重试到超时）');
    return;
  }

  const file = appendLog(rows);
  const alive = rows.filter((r) => r.ok && r.need !== 'control').length;
  console.log(`\n可用 ${alive}/${rows.filter((r) => r.need !== 'control').length} 条；对照项符合预期 ${rows.filter((r) => r.need === 'control' && r.ok).length} 条`);
  console.log(file ? `实测记录已追加（带日期）：${file}` : '（实测记录追加失败，不影响结论）');
}

main();
