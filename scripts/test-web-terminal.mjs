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
  check('GET / 带 cookie 返回前端页面', index.status === 200 && (await index.text()).includes('id="terminal"'));

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

let crashed = null;
try {
  await main();
} catch (err) {
  crashed = err;
} finally {
  child.kill('SIGTERM');
  await sleep(600);
  child.kill('SIGKILL');
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
