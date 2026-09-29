#!/usr/bin/env node
/**
 * test-web-terminal.mjs — 浏览器终端的行为守门（无 LLM、无浏览器）
 *
 * 为什么需要它：`custom/web-terminal` 的安全边界（令牌换 cookie、Host/Origin 栅栏、
 * 目录穿越防护）和传输行为（WebSocket 双向数据、resize → SIGWINCH）都不是 `tsc`/vitest
 * 能覆盖的：单测只测纯函数，真实 pty 与 HTTP 语义必须有进程级验证。
 *
 * 做法：起真实服务（`--command` 指向一个可预测的 shell 片段），用 fetch + 裸 socket +
 * ws 客户端逐项断言。不启动 my-pi 本体，因此零 token 消耗、约 3 秒完成。
 *
 * 依赖 util-linux 的 `script` 与 `stty`（pty 分配与改尺寸）；缺失时**显式跳过**并 exit 0，
 * 由调用方在日志里看到 SKIP，而不是悄悄变绿。
 *
 * 用法：node scripts/test-web-terminal.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(ROOT, 'package.json'));

const toolsAvailable =
  spawnSync('sh', ['-c', 'command -v script >/dev/null 2>&1 && command -v stty >/dev/null 2>&1']).status === 0;
if (!toolsAvailable) {
  console.log('SKIP web-terminal：缺少 util-linux 的 script/stty，无法分配并调整 pty');
  process.exit(0);
}

const { WebSocket } = require('ws');
const PORT = 17700 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '❌'} ${name}${ok || detail === '' ? '' : ` :: ${detail}`}`);
}

// 可预测的子进程：打印初始尺寸，并在 SIGWINCH 时再打印尺寸；回显收到的每一行。
const inner =
  `bash -c 'stty size; trap "stty size" WINCH; echo READY; ` +
  `while :; do if IFS= read -t 0.2 -r line; then echo "ECHO:$line"; fi; done'`;

const child = spawn('bash', ['scripts/web-terminal.sh', '--port', String(PORT), '--command', inner], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => (stdout += d.toString()));
child.stderr.on('data', (d) => (stderr += d.toString()));

function rawRequest(payload) {
  return new Promise((resolvePromise) => {
    const socket = connect(PORT, '127.0.0.1', () => socket.write(payload));
    let data = '';
    socket.on('data', (d) => (data += d.toString()));
    socket.on('error', () => resolvePromise(data));
    socket.on('end', () => resolvePromise(data));
    setTimeout(() => {
      socket.destroy();
      resolvePromise(data);
    }, 3000);
  });
}

async function waitUntil(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(60);
  }
  return false;
}

async function waitForUrl(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = /访问地址（含一次性令牌）: (\S+)/.exec(stdout);
    if (m) return m[1];
    if (child.exitCode !== null) throw new Error(`服务提前退出 code=${child.exitCode}\n${stderr}`);
    await sleep(100);
  }
  throw new Error(`等待启动 URL 超时\n${stdout}\n${stderr}`);
}

async function main() {
  const url = await waitForUrl();
  const token = new URL(url).searchParams.get('token');
  check('启动并打印带 token 的本机地址', typeof token === 'string' && token.length > 20);

  const health = await (await fetch(`${BASE}/healthz`)).json();
  check('GET /healthz 免鉴权并报告 pty 已就绪', health.ok === true && health.terminal === true, JSON.stringify(health));

  check('GET / 无 cookie 返回 401', (await fetch(`${BASE}/`, { redirect: 'manual' })).status === 401);
  check(
    'GET /?token=<错误> 返回 401',
    (await fetch(`${BASE}/?token=nope`, { redirect: 'manual' })).status === 401,
  );

  const exchange = await fetch(`${BASE}/?token=${token}`, { redirect: 'manual' });
  const setCookie = (exchange.headers.getSetCookie() || []).join(' | ');
  const cookie = (exchange.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
  check('GET /?token=<正确> 返回 303 并下发签名 cookie', exchange.status === 303 && cookie.includes('='));
  check(
    'Set-Cookie 为 HttpOnly + SameSite=Strict + Path=/，且不带 Secure（回环 HTTP）',
    /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie) && /Path=\//.test(setCookie) && !/Secure/.test(setCookie),
    setCookie,
  );

  const index = await fetch(`${BASE}/`, { headers: { cookie } });
  const indexHtml = await index.text();
  check('GET / 带 cookie 返回前端页面', index.status === 200 && indexHtml.includes('id="terminal"'));

  // 资源缓存穿透：第三方资源带 immutable 长缓存，URL 必须带版本戳，否则换 xterm 版本后
  // 浏览器会继续用旧副本（升级 xterm 时曾因此让"触摸滚动修复"看起来没生效）。
  const versionMatch = /\/assets\/xterm\.js\?v=([0-9a-f]{10})/.exec(indexHtml);
  check('index.html 的第三方资源带内容版本戳', versionMatch !== null && !indexHtml.includes('__ASSET_V__'));
  if (versionMatch !== null) {
    const versioned = await fetch(`${BASE}/assets/xterm.js?v=${versionMatch[1]}`);
    check('带版本戳的资源 URL 仍可访问（路由按 pathname 匹配）', versioned.status === 200);
  }

  for (const [path, needle] of [
    ['/assets/xterm.js', 'Terminal'],
    ['/assets/addon-fit.js', 'FitAddon'],
    ['/assets/app.js', 'WebSocket'],
    ['/assets/style.css', '--accent'],
    ['/assets/xterm.css', 'xterm'],
  ]) {
    const res = await fetch(`${BASE}${path}`);
    const body = await res.text();
    check(`GET ${path} 可访问`, res.status === 200 && body.includes(needle), String(res.status));
  }

  const traversal = await rawRequest(
    `GET /assets/../../../../etc/passwd HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`,
  );
  check('目录穿越被拒', /^HTTP\/1\.1 (403|404)/.test(traversal), traversal.split('\r\n')[0]);

  const spoof = await rawRequest('GET /healthz HTTP/1.1\r\nHost: evil.com\r\nConnection: close\r\n\r\n');
  check('Host 非回环被拒 403', /^HTTP\/1\.1 403/.test(spoof), spoof.split('\r\n')[0]);

  check('POST / 返回 405', (await fetch(`${BASE}/`, { method: 'POST', headers: { cookie } })).status === 405);

  // WebSocket 数据面
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, host: `127.0.0.1:${PORT}` } });
  const chunks = [];
  let hello = null;
  await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('WS 握手超时')), 10000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        chunks.push(data.toString('utf8'));
        return;
      }
      const msg = JSON.parse(data.toString('utf8'));
      if (msg.t === 'hello') {
        hello = msg;
        clearTimeout(timer);
        resolvePromise();
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
  });
  const text = () => chunks.join('');
  check('WS 握手收到 hello（含尺寸与命令）', hello !== null && typeof hello.cols === 'number' && typeof hello.command === 'string');
  check('WS 收到 pty 回放', await waitUntil(() => text().includes('READY')), JSON.stringify(text().slice(0, 80)));
  check('pty 初始尺寸已生效', text().includes('24 80'), JSON.stringify(text().slice(0, 80)));

  ws.send(Buffer.from('ping\n', 'utf8'));
  check('WS 二进制输入到达 pty 并被回显', await waitUntil(() => text().includes('ECHO:ping')));

  chunks.length = 0;
  ws.send(JSON.stringify({ t: 'resize', cols: 100, rows: 30 }));
  check('WS resize 触发 SIGWINCH 且新尺寸生效', await waitUntil(() => text().includes('30 100')), JSON.stringify(text().slice(0, 80)));

  const unauth = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { host: `127.0.0.1:${PORT}` } });
  const unauthOutcome = await new Promise((resolvePromise) => {
    unauth.on('open', () => resolvePromise('opened'));
    unauth.on('error', (err) => resolvePromise(err.message));
  });
  check('未带 cookie 的 WS 被拒', unauthOutcome !== 'opened', String(unauthOutcome));
  ws.close();

  // restart：会话被重新拉起
  const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, host: `127.0.0.1:${PORT}` } });
  await new Promise((resolvePromise, rejectPromise) => {
    ws2.on('open', resolvePromise);
    ws2.on('error', rejectPromise);
  });
  const second = [];
  ws2.on('message', (d, isBinary) => {
    if (isBinary) second.push(d.toString('utf8'));
  });
  ws2.send(JSON.stringify({ t: 'restart' }));
  check('WS restart 重新拉起会话', await waitUntil(() => second.join('').includes('READY')));
  ws2.close();
}

// ── 孤儿 pty 回收：服务器被 SIGKILL（teardown 来不及跑）后，下次启动必须能清掉 ──
// 纯单测覆盖不到：需要真实进程被强杀后成为 PID 1 的孤儿，再验证回收。
// 用独立的 TMPDIR 隔离：临时文件只落在 box 里，既不受真实服务干扰，也不污染 /tmp。
async function orphanSweepChecks() {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { execFileSync } = await import('node:child_process');

  const boxes = [];
  const servers = [];
  const newBox = () => {
    const b = fs.mkdtempSync(`${os.tmpdir()}/mypi-sweep-`);
    boxes.push(b);
    return b;
  };
  const listIn = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('mypi-web-tty-'));
  const sweepIn = (dir) => {
    try {
      return execFileSync('bash', ['scripts/run-ts.sh', 'custom/web-terminal/main.ts', '--sweep'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, TMPDIR: dir },
      });
    } catch (err) {
      return String(err?.stdout ?? '') + String(err?.message ?? '');
    }
  };
  const startIn = async (dir, port, command) => {
    const s = spawn('bash', ['scripts/web-terminal.sh', '--port', String(port), '--command', command], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, TMPDIR: dir },
    });
    servers.push(s);
    let out = '';
    s.stdout.on('data', (d) => (out += d.toString()));
    s.stderr.on('data', (d) => (out += d.toString()));
    const up = await waitUntil(() => /访问地址（含一次性令牌）/.test(out), 25000);
    return { up, out: () => out };
  };
  const killGroup = async (s) => {
    try {
      process.kill(-s.pid, 'SIGKILL');
    } catch {
      try {
        s.kill('SIGKILL');
      } catch {
        /* 已退出 */
      }
    }
    await waitUntil(() => {
      try {
        process.kill(s.pid, 0);
        return false;
      } catch {
        return true;
      }
    }, 5000);
  };

  try {
    // ── 场景 1：强杀服务器 → 会话变孤儿 → 下次 sweep 回收 ──
    const box = newBox();
    const started = await startIn(box, PORT + 1, `bash -c 'echo ORPHAN-READY; sleep 300'`);
    check('孤儿回收前置：隔离 TMPDIR 下的服务实例已启动', started.up, started.out().slice(-200));
    if (!started.up) return;

    const files = listIn(box);
    check('新实例在隔离 TMPDIR 写出恰好一个 pty 临时文件', files.length === 1, files.join(','));
    if (files.length !== 1) return;
    const ttyFile = files[0];
    const ownerPid = Number(/^mypi-web-tty-(\d+)-/.exec(ttyFile)?.[1]);
    check('临时文件可解析出属主 pid', Number.isInteger(ownerPid) && ownerPid > 0, ttyFile);

    const scriptPids = psMatching(`${box}/${ttyFile}`);
    check('存在持有该 pty 的 script 进程', scriptPids.length >= 1, ttyFile);

    await killGroup(servers[servers.length - 1]);
    await sleep(400);

    const orphanAlive = scriptPids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    check('强杀服务器后 pty 子进程成为孤儿（仍在运行，故必须主动回收）', orphanAlive.length >= 1, orphanAlive.join(','));
    check('孤儿临时文件仍在', fs.existsSync(`${box}/${ttyFile}`));

    const swept = sweepIn(box);
    check('--sweep 报告回收了该孤儿会话', swept.includes(ttyFile), swept.trim().slice(-160));
    check('孤儿临时文件已被删除', !fs.existsSync(`${box}/${ttyFile}`));
    check('孤儿进程已被清除', psMatching(`${box}/${ttyFile}`).length === 0, psMatching(`${box}/${ttyFile}`).join(','));

    // ── 场景 2：存活实例的会话绝不能被误回收（属主 pid 仍在）──
    const box2 = newBox();
    const live = await startIn(box2, PORT + 2, `bash -c 'echo LIVE; sleep 120'`);
    if (!live.up) {
      check('存活实例的会话不被误回收（属主 pid 仍存在）', false, '实例未起来');
      return;
    }
    const liveFile = listIn(box2)[0];
    const out = sweepIn(box2);
    check('存活实例的会话不被回收', !out.includes(String(liveFile)), out.trim().slice(-160));
    check('存活实例的临时文件仍在', liveFile !== undefined && fs.existsSync(`${box2}/${liveFile}`), String(liveFile));
    check('存活实例的 pty 仍可用', psMatching(`${box2}/${liveFile}`).length >= 1, String(liveFile));
  } finally {
    // 先杀服务器（其进程组），再用 sweep 回收 pty 负载：`script` 会 setsid 另立会话，
    // 杀服务器进程组波及不到它；属主死后它正是 sweep 的回收对象。
    for (const s of servers) await killGroup(s);
    for (const b of boxes) {
      sweepIn(b);
      fs.rmSync(b, { recursive: true, force: true });
    }
  }
}

/** 命令行中出现指定临时文件路径的进程 pid */
function psMatching(path) {
  try {
    const { execFileSync } = require('node:child_process');
    return execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.includes(path))
      .map((l) => Number(/^\s*(\d+)\s/.exec(l)?.[1]))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

let crashed = null;
try {
  await main();
  await orphanSweepChecks();
} catch (err) {
  crashed = err;
} finally {
  child.kill('SIGTERM');
  await sleep(600);
  child.kill('SIGKILL');
  // 主实例用真实 TMPDIR；它被强杀后同样会留下孤儿 pty 负载，这里顺手回收，
  // 避免守门脚本自己制造泄漏（其它存活实例不受影响：属主 pid 仍在）。
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('bash', ['scripts/run-ts.sh', 'custom/web-terminal/main.ts', '--sweep'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
  } catch {
    /* 回收失败不影响守门结论 */
  }
}

const failed = results.filter((r) => !r.ok);
if (crashed !== null) {
  console.log(`  ❌ 探针异常: ${crashed.message}`);
}
if (failed.length > 0) {
  console.log(`❌ web-terminal 守门失败 ${failed.length}/${results.length}：${failed.map((f) => f.name).join('、')}`);
  process.exit(1);
}
if (crashed !== null) {
  console.log(`❌ web-terminal 守门异常终止（${results.length} 项已通过）`);
  process.exit(1);
}
console.log(`web-terminal 守门通过（${results.length} 项）`);
