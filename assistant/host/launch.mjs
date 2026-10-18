#!/usr/bin/env node
/**
 * 宿主启动器（自包含）：不依赖本仓 DSH 那条线的 `scripts/dsh-launch.sh`。
 *
 * 只做五件事：
 *   1. 找宿主可执行文件（仓内 vendored 优先，其次 PATH 里的 dsh）
 *   2. 建/复用 profile（web 模板）
 *   3. 拷凭据（600，仅当目标缺失）
 *   4. 叠 profile patch（我们自己的 + 可选附加）
 *   5. 起进程、抓 `dsh web: …?token=…`、把 URL 写到 .run/url
 *
 * 用法：
 *   node host/launch.mjs start [--with-facade] [--port N] [--home DIR]
 *   node host/launch.mjs stop | status | url | path
 *
 * 环境变量：MYPI_PORT / MYPI_HOME / MYPI_DSH_BIN / MYPI_EXTRA_PATCH（冒号分隔）
 */
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSISTANT = resolve(HERE, '..');
const REPO = resolve(ASSISTANT, '..');

const [command = 'start', ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const value = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

const RUN = join(ASSISTANT, '.run');
const PORT = Number(value('--port') ?? process.env.MYPI_PORT ?? 3099);
const HOME_DIR = resolve(value('--home') ?? process.env.MYPI_HOME ?? join(RUN, 'home'));
const LOG = join(RUN, 'host.log');
const URL_FILE = join(RUN, 'url');
const PID_FILE = join(RUN, 'host.pid');
const PROFILE = process.env.MYPI_PROFILE ?? 'mypi';

function platform() {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'win32' }[process.platform] ?? process.platform;
  const arch = { arm64: 'arm64', x64: 'x64' }[process.arch] ?? process.arch;
  return `${os}-${arch}`;
}

/** 仓内 vendored 优先；Windows 用 .cmd；都没有再退回 PATH 里的 dsh。 */
function hostBin() {
  if (process.env.MYPI_DSH_BIN) return process.env.MYPI_DSH_BIN;
  const root = join(REPO, 'runtime', platform(), 'ext', 'dsh', 'node_modules', '.bin');
  for (const name of ['dsh', 'dsh.cmd', 'dsh.exe']) {
    const candidate = join(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return 'dsh';
}

function ensureDirs() {
  for (const dir of [RUN, HOME_DIR, join(HOME_DIR, 'profiles')]) mkdirSync(dir, { recursive: true });
}

/** 凭据：只在目标缺失时从 ~/.dsh 拷一份并收紧到 600。 */
function ensureCredentials() {
  const dest = join(HOME_DIR, '.credentials.yaml');
  if (existsSync(dest)) return false;
  const source = process.env.MYPI_CREDENTIALS ?? join(process.env.HOME ?? '', '.dsh', '.credentials.yaml');
  if (!existsSync(source)) return false;
  copyFileSync(source, dest);
  try {
    chmodSync(dest, 0o600);
  } catch {
    /* Windows 上 chmod 语义不同，忽略 */
  }
  return true;
}

/** profile 不存在就从 web 模板建一个（--dump-config 不启动宿主）。 */
async function ensureProfile(bin) {
  const dir = join(HOME_DIR, 'profiles', PROFILE);
  if (existsSync(join(dir, 'package.json'))) return false;
  await run(bin, ['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config']);
  return true;
}

function run(bin, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { env: { ...process.env, DSH_HOME: HOME_DIR }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${bin} ${args.join(' ')} → ${code}\n${err.slice(-800)}`))));
  });
}

function portBusy() {
  return new Promise((resolvePromise) => {
    const socket = createServer();
    socket.once('error', () => resolvePromise(true));
    socket.once('listening', () => socket.close(() => resolvePromise(false)));
    socket.listen(PORT, '127.0.0.1');
  });
}

function patchArgs() {
  const args = ['--patch', join(ASSISTANT, 'profile', 'mypi.patch.yml')];
  // 过渡期开关：M0.1 用它证明"换启动器后行为与旧路径一致"，M0.2 之后不再需要。
  if (flag('--with-facade')) args.push('--patch', join(REPO, 'dsh', 'profile', 'my-pi.patch.yml'));
  // 本地瘦身：用一个更小的 agent preset（工具面由 preset 决定，这是 DSH 的正式机制）。
  if (process.env.MYPI_LEAN_TOOLS === '1') args.push('--patch', join(ASSISTANT, 'profile', 'local-preset.patch.yml'));
  // 自动化（DSH 原生 schedule）：MYPI_SCHEDULE=1 时叠加定时任务/任务页/时间上下文。
  if (process.env.MYPI_SCHEDULE === '1') args.push('--patch', join(ASSISTANT, 'profile', 'schedule.patch.yml'));
  // 兼容旧环境变量名（verify 与文档里用的是 MY_PI_DSH_EXTRA_PATCH）
  const extras = process.env.MYPI_EXTRA_PATCH ?? process.env.MY_PI_DSH_EXTRA_PATCH ?? '';
  for (const extra of extras.split(':').filter(Boolean)) args.push('--patch', extra);
  return args;
}

async function waitForUrl(timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(LOG)) {
      const text = readFileSync(LOG, 'utf8');
      const match = text.match(/^dsh web: (https?:\/\/\S+\?token=\S+)$/m);
      if (match) return match[1];
      if (/startup failed|did not activate|EADDRINUSE/.test(text)) {
        throw new Error(`宿主启动失败，日志尾部：\n${text.split('\n').slice(-12).join('\n')}`);
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`等待宿主 URL 超时（${timeoutMs}ms），看日志：${LOG}`);
}

async function start() {
  ensureDirs();
  const bin = hostBin();
  if (flag('--with-facade') && !existsSync(join(REPO, 'dsh', 'profile', 'my-pi.patch.yml'))) {
    throw new Error('--with-facade 需要 dsh/profile/my-pi.patch.yml（本分支应存在）');
  }
  if (await portBusy()) throw new Error(`端口 ${PORT} 已被占用；先 \`node host/launch.mjs stop\` 或换 MYPI_PORT`);
  const creds = ensureCredentials();
  const created = await ensureProfile(bin);
  rmSync(URL_FILE, { force: true });

  const fd = openSync(LOG, 'w');
  const args = ['--profile', PROFILE, ...patchArgs(), '--port', String(PORT), '--no-open'];
  const child = spawn(bin, args, {
    env: { ...process.env, DSH_HOME: HOME_DIR },
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  const url = await waitForUrl();
  writeFileSync(URL_FILE, url);
  console.log(`✓ 宿主就绪（pid ${child.pid}，端口 ${PORT}${creds ? '，已拷凭据' : ''}${created ? '，已建 profile' : ''}）`);
  console.log(url);
}

function stop() {
  if (!existsSync(PID_FILE)) {
    console.log('没有记录的宿主进程');
    return;
  }
  const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`已发送停止信号：${pid}`);
  } catch {
    console.log(`进程 ${pid} 已不在`);
  }
  rmSync(PID_FILE, { force: true });
  rmSync(URL_FILE, { force: true });
}

function status() {
  if (!existsSync(PID_FILE)) {
    console.log('宿主没在跑（无 pid 文件）');
    process.exitCode = 1;
    return;
  }
  const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  console.log(alive ? `宿主在跑：pid ${pid}，端口 ${PORT}` : `pid ${pid} 已不存在`);
  if (alive && existsSync(URL_FILE)) console.log(readFileSync(URL_FILE, 'utf8').trim());
  if (!alive) process.exitCode = 1;
}

const commands = {
  start,
  stop,
  status,
  url: () => {
    if (!existsSync(URL_FILE)) {
      console.error('还没有 URL（先 start）');
      process.exit(2);
    }
    console.log(readFileSync(URL_FILE, 'utf8').trim());
  },
  path: () => console.log(hostBin()),
  profile: () => console.log(join(HOME_DIR, 'profiles', PROFILE)),
};

const handler = commands[command];
if (handler === undefined) {
  console.error(`用法：node host/launch.mjs [${Object.keys(commands).join('|')}] [--with-facade] [--port N]`);
  process.exit(2);
}
await handler();
