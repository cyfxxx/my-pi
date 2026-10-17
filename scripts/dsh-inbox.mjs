#!/usr/bin/env node
/**
 * dsh-inbox.mjs — **外部进程**给正在跑的 my-pi（DSH 基座）投递消息
 *
 * 与插件侧的 `custom/adapters/dsh/session-inbox.ts` 配对：本脚本只负责**写文件**，
 * 真正的投递由插件（`inbox.enabled` 打开时）轮询完成 —— 与 my-pi 既有的收件箱分工一致
 * （`scripts/subagent-inbox.mjs` 当年也是"存取归脚本、投递归进程内"）。
 *
 * 格式（一行一条，追加写）：
 *   {"ts":"…","seq":1,"text":"……","deliverAs":"steer"|"followup"}
 *   `<dir>/<sessionId>.inbox.state.json` = {"consumed":N}（插件维护，脚本只读）
 *
 * 用法：
 *   node scripts/dsh-inbox.mjs post --session <id> --text "……" [--steer] [--dir D]
 *   node scripts/dsh-inbox.mjs list [--dir D]
 *   node scripts/dsh-inbox.mjs tail --session <id> [--dir D]
 *
 * 目录默认 `<repo>/portable/memory/inbox`（与插件的默认值一致；`PI_MEMORY_DIR` 可覆盖）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = join(process.env.PI_MEMORY_DIR ?? join(ROOT, 'portable', 'memory'), 'inbox');

const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f) => argv.includes(f);
const val = (f, d = '') => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const dir = resolve(val('--dir', DEFAULT_DIR));
const sessionId = val('--session', '');
const text = val('--text', '');

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

/** 读已有的最大 seq（坏行忽略；文件不存在返回 0） */
function maxSeq(path) {
  if (!existsSync(path)) return 0;
  let max = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed?.seq === 'number' && Number.isFinite(parsed.seq) && parsed.seq > max) max = parsed.seq;
    } catch {
      /* 坏行不影响取 max（插件那边会报"跳过 N 条坏行"） */
    }
  }
  return max;
}

function readConsumed(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed?.consumed === 'number' ? parsed.consumed : 0;
  } catch {
    return 0;
  }
}

if (cmd === 'post') {
  if (!sessionId) die('post 需要 --session <会话 id>');
  if (!text.trim()) die('post 需要 --text "……"（空的投递没有意义）');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.inbox.jsonl`);
  const seq = maxSeq(path) + 1;
  const record = {
    ts: new Date().toISOString(),
    seq,
    text,
    ...(has('--steer') ? { deliverAs: 'steer' } : { deliverAs: 'followup' }),
  };
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
  const consumed = readConsumed(join(dir, `${sessionId}.inbox.state.json`));
  console.log(`✓ 已写入 ${path}`);
  console.log(`  seq=${seq}（${record.deliverAs}；已消费到 ${consumed}）`);
  console.log(`  ⇒ 需要该会话**在本进程里活着**且插件开了 inbox.enabled，桥才会投递`);
  if (!consumed || seq > consumed) {
    console.log(`  （若插件没在跑这支收件箱，这条会一直等着，不会丢）`);
  }
} else if (cmd === 'list') {
  if (!existsSync(dir)) {
    console.log(`· 收件箱目录不存在：${dir}（还没投递过）`);
    process.exit(0);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.inbox.jsonl'));
  if (files.length === 0) {
    console.log(`· ${dir} 下还没有收件箱文件`);
    process.exit(0);
  }
  console.log(`收件箱目录：${dir}`);
  for (const f of files) {
    const sid = f.slice(0, -'.inbox.jsonl'.length);
    const path = join(dir, f);
    const size = statSync(path).size;
    const max = maxSeq(path);
    const consumed = readConsumed(join(dir, `${sid}.inbox.state.json`));
    const pending = maxSeq(path) > consumed ? max - consumed : 0;
    console.log(`  ${sid}：最大 seq=${max}，已消费=${consumed}，待投递≈${pending}，${size} B`);
  }
} else if (cmd === 'tail') {
  if (!sessionId) die('tail 需要 --session <会话 id>');
  const path = join(dir, `${sessionId}.inbox.jsonl`);
  if (!existsSync(path)) {
    console.log(`· 没有这支收件箱：${path}`);
    process.exit(0);
  }
  const consumed = readConsumed(join(dir, `${sessionId}.inbox.state.json`));
  console.log(`${path}（已消费到 ${consumed}）`);
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const mark = typeof parsed?.seq === 'number' && parsed.seq <= consumed ? '✓' : '·';
      console.log(`  ${mark} seq=${parsed?.seq} ${parsed?.deliverAs ?? 'followup'}  ${String(parsed?.text ?? '').slice(0, 80)}`);
    } catch {
      console.log(`  ! 坏行：${line.slice(0, 60)}`);
    }
  }
} else {
  console.error('用法：');
  console.error('  node scripts/dsh-inbox.mjs post --session <id> --text "……" [--steer] [--dir D]');
  console.error('  node scripts/dsh-inbox.mjs list [--dir D]');
  console.error('  node scripts/dsh-inbox.mjs tail --session <id> [--dir D]');
  process.exit(2);
}
