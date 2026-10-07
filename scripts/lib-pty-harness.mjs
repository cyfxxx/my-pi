#!/usr/bin/env node
/**
 * lib-pty-harness.mjs — 真实 pty 生命周期场景的**公共骨架**（ESM，零依赖）
 *
 * 为什么抽这一层：`test-scenario-mode-restart.mjs`（单实例）与 `test-scenario-two-instances.mjs`
 * （两实例共享一个 agent 目录）面对的是同一批"进程级事实"——真 pty 的 spawn/收发、按
 * `/proc/<pid>/exe|environ` 认进程、SIGTERM 收尾、JSONL 轮次与会话文件读取。这些与"跑几个实例"
 * 无关，各写一份的结果是：一处修好的进程发现判据（例如"排除 supervisor 的 `node -e` 助手"）
 * 在另一处仍然是旧的（实测踩过：助手进程被当成 pi，argv 断言失败、还会去杀无关进程）。
 *
 * 本文件只做**机制**，不做断言、不打印"通过/失败"：断言与文案留在各场景里，便于按场景解释。
 * 设计约束（都来自实测，见各自注释）：
 *   - pi 启动后 `process.title = 'pi'`（本仓库 vendor/pi 的 APP_NAME），`/proc/<pid>/cmdline`
 *     只剩 "pi"，因此**不能用 argv 认 pi**；判据是 `exe=node` + environ 带本场景的隔离 agent
 *     目录（+ 调用方要求的实例标记），并排除 `node -e` 助手。
 *   - 单点查询（找进程、等文件出现）必须带重试与自解释失败信息，否则一次抖动会让整段场景塌掉。
 *   - 收尾用 SIGTERM（走 pi 自己的优雅关闭），不往 TUI 发 `/quit`（会被当成用户消息触发回合）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（本文件在 scripts/ 下） */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 真 pi 的 CLI 入口（未构建时场景应显式 SKIP） */
export const PI_CLI = join(REPO_ROOT, 'vendor/pi/packages/coding-agent/dist/cli.js');
/** supervisor 的默认 agent 目录（场景一律用隔离目录，这里只作为兜底） */
export const DEFAULT_AGENT_DIR = join(REPO_ROOT, 'portable/agent');
/** 等待上限：可用 PI_SCENARIO_TIMEOUT_MS 放宽（慢机器 / 冷启动） */
export const SCENARIO_TIMEOUT_MS = Number(process.env.PI_SCENARIO_TIMEOUT_MS || 300_000);

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 场景运行环境自检：返回**不可运行的原因**（null = 可运行）。
 * 缺 util-linux 的 script/stty、或 vendor/pi dist 未构建时，调用方应打印 SKIP 并 exit 0，
 * 让调用方在日志里看到 SKIP，而不是悄悄变绿（与 test-web-terminal.mjs 的处理一致）。
 */
export function ptyUnavailableReason({ cli = PI_CLI } = {}) {
  if (!existsSync(cli)) return `未构建 vendor/pi dist（先 bash scripts/build.sh）：${cli}`;
  if (spawnSync('script', ['--version'], { encoding: 'utf8' }).error) return '缺少 util-linux 的 script（无法分配 pty）';
  if (spawnSync('sh', ['-c', 'command -v stty'], { encoding: 'utf8' }).status !== 0) return '缺少 stty';
  return null;
}

/**
 * 建一个隔离的运行现场：临时根目录 + agent 目录（配置 + 人设 + 会话）+ memory 目录。
 * 从 `portable/agent` 复制**配置与人设**（不复制运行时数据），并预建 recovery/autopilot/modes 目录。
 */
export function prepareAgentDir({ prefix = 'my-pi-scenario-' } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const agentDir = join(root, 'agent');
  const memoryDir = join(root, 'memory');
  const sessionsDir = join(agentDir, 'sessions', '--root-my-pi--');
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(join(agentDir, 'modes'), { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  for (const f of ['settings.json', 'auth.json', 'keybindings.json', 'trust.json', 'modes.json', 'APPEND_SYSTEM.md', 'AGENTS.md']) {
    const src = join(DEFAULT_AGENT_DIR, f);
    if (existsSync(src)) copyFileSync(src, join(agentDir, f));
  }
  const persona = join(DEFAULT_AGENT_DIR, 'modes/roleplay.md');
  if (existsSync(persona)) copyFileSync(persona, join(agentDir, 'modes/roleplay.md'));
  return {
    root,
    agentDir,
    memoryDir,
    sessionsDir,
    sessionFile: (name) => join(sessionsDir, name),
    roundsFile: join(agentDir, 'recovery', 'rounds.jsonl'),
    stateFile: join(agentDir, 'autopilot', 'state.json'),
    /** 收尾：默认删掉临时目录；PI_SCENARIO_KEEP=1 时保留现场（打印路径供排查） */
    cleanup() {
      if (!process.env.PI_SCENARIO_KEEP) rmSync(root, { recursive: true, force: true });
      else console.log(`保留现场：${root}`);
    },
  };
}

/** 预置一个最小会话头（pi 以 --session 载入它 = 续接而不是新建） */
export function writeSessionHeader(sessionFile, { id, cwd = REPO_ROOT } = {}) {
  mkdirSync(dirname(sessionFile), { recursive: true });
  writeFileSync(
    sessionFile,
    JSON.stringify({ type: 'session', version: 3, id, timestamp: new Date().toISOString(), cwd }) + '\n',
  );
}

/** 写入一条重启请求（语义等价于 pi/看门狗/自动 failover 写下的 admin state） */
export function writeRestartRequest(stateFile, fields) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(fields));
}

/**
 * 把 models.json 指向本地假 provider（只覆盖 defaultProvider/defaultModel，其余 settings 原样继承）。
 * `reasoning: false` → pi 会把思考档位设为 off（会话里出现 `thinking_level_change:off`）；
 * 这是"非推理模型"的正常表现，**不是档位错乱**，排查场景失败时别误判。
 */
export function configureFakeProvider({ agentDir, provider, modelId = 'scenario-model', modelName = 'Scenario Model' }) {
  const realModels = existsSync(join(DEFAULT_AGENT_DIR, 'models.json'))
    ? JSON.parse(readFileSync(join(DEFAULT_AGENT_DIR, 'models.json'), 'utf8'))
    : { providers: {} };
  writeFileSync(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        ...(realModels.providers ?? {}),
        scenario: {
          baseUrl: `http://127.0.0.1:${provider.port}/v1`,
          api: 'openai-completions',
          apiKey: 'scenario-not-needed',
          models: [
            {
              id: modelId,
              name: modelName,
              contextWindow: 131072,
              maxTokens: 8192,
              reasoning: false,
              compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
            },
          ],
        },
      },
    }),
  );
  const settingsPath = join(agentDir, 'settings.json');
  const realSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  writeFileSync(settingsPath, JSON.stringify({ ...realSettings, defaultProvider: 'scenario', defaultModel: modelId }));
}

/**
 * 场景子进程的统一环境：隔离 agent/memory 目录 + pty 可用的 TERM。
 * **删掉外部硬覆盖**（PI_AGENT_MODE/_SOURCE/PI_SESSION_MODE），否则按会话解析会被跳过；
 * `extra` 在删除之后合并，供多实例场景注入实例标记（PI_SCENARIO_INSTANCE=A/B）。
 */
export function scenarioEnv({ agentDir, memoryDir, extra = {} }) {
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    MY_PI_AGENT_DIR: agentDir,
    PI_MEMORY_DIR: memoryDir,
    TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm-256color',
  };
  delete env.PI_AGENT_MODE;
  delete env.PI_AGENT_MODE_SOURCE;
  delete env.PI_SESSION_MODE;
  delete env.PI_SCENARIO_SKIP;
  return { ...env, ...extra };
}

/**
 * 在真 pty 里起一个进程（`script -q -e -f -E never -c <cmd> /dev/null`）。
 * 返回一个句柄：`output`（累计输出）、`mark()`（当前输出长度，用来只看"此刻之后"的新输出）、
 * `send(text)`（写 pty）、`kill(signal)`。
 */
export function startPty({ command, cwd = REPO_ROOT, env }) {
  const child = spawn('script', ['-q', '-e', '-f', '-E', 'never', '-c', command, '/dev/null'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d.toString('utf8')));
  child.stderr.on('data', (d) => (output += d.toString('utf8')));
  let exited = false;
  child.on('exit', () => (exited = true));
  return {
    child,
    get output() {
      return output;
    },
    get exited() {
      return exited;
    },
    mark() {
      return output.length;
    },
    send(text) {
      try {
        if (child.stdin.writable) child.stdin.write(text);
      } catch {
        /* pty 已关 */
      }
    },
    kill(signal = 'SIGKILL') {
      try {
        child.kill(signal);
      } catch {
        /* 已退出 */
      }
    },
  };
}

/**
 * 在真 pty 里起一个 supervisor（**场景的统一入口**：所有实例都走它，差别只在环境标记）。
 * `exec bash` 让 supervisor 顶替 `script` 起的中间 shell，进程树里只多一层 pty。
 */
export function startSupervisorPty({ agentDir, memoryDir, session, extraEnv = {} }) {
  const shellCmd = `exec bash ${JSON.stringify(join(REPO_ROOT, 'scripts/pi-supervisor.sh'))} --session ${JSON.stringify(session)}`;
  return startPty({ command: shellCmd, cwd: REPO_ROOT, env: scenarioEnv({ agentDir, memoryDir, extra: extraEnv }) });
}

function readProcPid(pid) {
  let exe = '';
  let args = '';
  let env = '';
  try {
    exe = readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
  try {
    args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
    env = readFileSync(`/proc/${pid}/environ`, 'utf8');
  } catch {
    return null;
  }
  return { pid, exe, args, env };
}

/** environ 里是否包含全部要求的环境片段（实例标记就靠它区分） */
function envHasAll(env, envIncludes) {
  for (const frag of envIncludes) if (!env.includes(frag)) return false;
  return true;
}

/** 本场景的进程筛选：exe=node + environ 带隔离 agent 目录 +（可选的）若干"必须包含的环境片段" */
function matchesScenarioProcess(p, { agentDir, envIncludes }) {
  if (!/(^|\/)node$/.test(p.exe)) return false; // 只认 node 进程（排除 script/bash）
  if (agentDir && !p.env.includes(`PI_CODING_AGENT_DIR=${agentDir}`)) return false;
  return envHasAll(p.env, envIncludes);
}

/** supervisor 自己的 `node -e` 助手（mode_resolve / read_admin_action / mark_recovery_restart_log） */
function isSupervisorHelper(args) {
  return /^node\s+-e\b/.test(args) || args.includes('pi-supervisor.sh') || args.includes('--no-extensions');
}

/**
 * 找到本场景的**全部** pi 进程（多实例场景用来区分 A/B 与断言 pid 不重复）。
 * 认进程不能靠 argv：pi 启动后 `process.title = 'pi'`，`/proc/<pid>/cmdline` 只剩 "pi"，
 * cli.js/--extension 全没了。判据 = `exe=node` + environ 带隔离 agent 目录 + 实例标记，
 * 并排除 supervisor 的 `node -e` 助手（它们同样满足"node + 本 agent 目录"，
 * 会把进程发现指到助手身上：argv 断言失败、phase 3 还会去杀一个无关进程）。
 */
export function findAllPiProcesses({ agentDir, envIncludes = [] } = {}) {
  let pids = [];
  try {
    pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return [];
  }
  const found = [];
  for (const pid of pids) {
    const p = readProcPid(pid);
    if (!p) continue;
    if (!matchesScenarioProcess(p, { agentDir, envIncludes })) continue;
    if (isSupervisorHelper(p.args)) continue;
    found.push(p);
  }
  return found;
}

/**
 * 找到本场景的**一个** pi 进程（单实例场景的常用入口）。
 * `diagnose=true` 时打印全部候选（含被排除的助手），失败时用来自解释"为什么没找到"。
 */
export function findPiProcess({ agentDir, envIncludes = [], diagnose = false } = {}) {
  let pids = [];
  try {
    pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return null;
  }
  const candidates = [];
  for (const pid of pids) {
    const p = readProcPid(pid);
    if (!p) continue;
    if (!matchesScenarioProcess(p, { agentDir, envIncludes })) continue;
    candidates.push(p);
    if (isSupervisorHelper(p.args)) continue;
    return p;
  }
  if (diagnose) {
    console.log(`  （pid 候选 ${candidates.length} 个：${candidates.map((c) => `${c.pid}:${c.args.slice(0, 80)}`).join(' | ')}）`);
  }
  return null;
}

/** 找到本实例的 supervisor（bash + pi-supervisor.sh + 实例标记）；用于核对 pi 的 ppid = ownerPid */
export function findSupervisorProcess({ agentDir, envIncludes = [] } = {}) {
  let pids = [];
  try {
    pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return null;
  }
  for (const pid of pids) {
    const p = readProcPid(pid);
    if (!p) continue;
    if (!/bash$/.test(p.exe)) continue;
    if (!p.args.includes('pi-supervisor.sh')) continue;
    if (agentDir && !p.env.includes(`PI_CODING_AGENT_DIR=${agentDir}`)) continue;
    if (!envHasAll(p.env, envIncludes)) continue;
    return p;
  }
  return null;
}

/** 等到 cond() 为真；超时返回 false（quiet=false 时打印超时原因，供最后定位） */
export async function waitFor(cond, { timeout = SCENARIO_TIMEOUT_MS, poll = 500, label = '', quiet = true } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (cond()) return true;
    await sleep(poll);
  }
  if (!quiet) console.log(`  （等待超时：${label}，已等 ${Math.round((Date.now() - t0) / 1000)}s）`);
  return false;
}

/**
 * 让 pi 退出：**用 SIGTERM 而不是往 TUI 里发 `/quit`**。
 * 实测 TUI 输入在"回合进行中/刚起来"时会失效或被当成消息（曾导致场景假失败），
 * 而 SIGTERM 走 pi 自己的优雅关闭路径（exit 0），supervisor 照常读 admin action 重拉。
 * `find` 每次重新发现进程（新 pid 也要能被下一次循环杀掉），带重试直到 `done()` 为真。
 */
export async function stopPi({ find, done, timeout = 150_000, label = '进程退出' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = find();
    if (p) {
      try {
        process.kill(Number(p.pid), 'SIGTERM');
      } catch {
        /* 已退出 */
      }
    }
    if (await waitFor(done, { timeout: 10_000 })) return true;
  }
  console.log(`  （等待超时：${label}）`);
  return done();
}

/** 读 JSONL（缺文件/坏行都容忍；场景靠断言解释，不靠这里抛异常） */
export function readJsonl(path) {
  try {
    return readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 会话文件 → 条目数组（坏行跳过） */
export function sessionEntries(text) {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    });
}

/** 会话文件 → 条目类型/角色序列（用于断言"有哪些条目"而不看内容） */
export function sessionRoles(text) {
  return sessionEntries(text).map((e) => (e?.type === 'message' ? e.message?.role : e?.type));
}

/** 会话文件里所有 message/custom_message 的文本（用于断言互不污染） */
export function sessionTexts(text) {
  const out = [];
  for (const e of sessionEntries(text)) {
    if (e?.type === 'message') {
      const c = e.message?.content;
      out.push(typeof c === 'string' ? c : JSON.stringify(c ?? ''));
    } else if (e?.type === 'custom_message') {
      out.push(typeof e.content === 'string' ? e.content : JSON.stringify(e.content ?? ''));
    }
  }
  return out;
}

/** 请求体里最后一条"模型可见的输入"（custom/user）——用于断言"这次请求就是那次续跑" */
export function lastInputText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user' || m?.role === 'custom') {
      const c = m.content;
      return typeof c === 'string' ? c : JSON.stringify(c ?? '');
    }
  }
  return '';
}
