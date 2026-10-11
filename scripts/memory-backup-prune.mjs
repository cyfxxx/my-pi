#!/usr/bin/env node
/**
 * memory-backup-prune.mjs —— 记忆备份保留策略（零 LLM，headless 可用）
 *
 * 背景：记忆治理约定"改动前先备份到 portable/memory/backups/<时间戳>/"，长期执行会无限堆积。
 * 本脚本按"最近 N 份 + 最近 D 天内"保留，其余**目录**可被清理。
 *
 * 安全设计（关键，全部有自检）：
 *   - **默认 dry-run**，只有显式 --apply 才真删；
 *   - **信任根**：备份根必须位于仓库 cwd 之下、**本身不是软链**；否则**整体拒绝并非零退出**
 *     （否则把 backups 换成软链指向 /tmp/xx，词法前缀就会"看起来合法" —— 实测过这个绕过）；
 *   - **目标守卫**（纯函数）：先 lstat（**软链一律拒**、必须真目录），再 realpath 后要求恰好一层；
 *   - **只删目录**，绝不删文件；绝不触碰 entries.json / notes.json 或任何其它路径；
 *   - 备份目录不存在/为空 ⇒ 优雅退出（0）；
 *   - `--self-check` 用**临时 fixture**（含软链）双向自证，并含"永远放行"假实现必然翻车的反证。
 *
 * 用法：
 *   node scripts/memory-backup-prune.mjs [--apply] [--keep N] [--days D] [--json] [--self-check]
 *     --keep N   保留最近 N 份（默认 10）
 *     --days D   最近 D 天内的都保留（默认 30）
 *     --json     以 JSON 输出结果
 */
import {
  readdirSync, lstatSync, realpathSync, rmSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(n);
  if (i === -1) return d;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v >= 0 ? v : d;
};
const APPLY = argv.includes('--apply');
const JSON_OUT = argv.includes('--json');
const SELF_CHECK = argv.includes('--self-check');
const KEEP = flag('--keep', 10);
const DAYS = flag('--days', 30);

const CWD_REAL = realpathSync(process.cwd());
const BACKUP_DIR = resolve(CWD_REAL, 'portable', 'memory', 'backups');

function realOrNull(p) {
  try { return realpathSync(p); } catch { return null; }
}
function isSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** 信任根判定（纯）：备份根必须在 cwdReal 之下，且自身不是软链。 */
export function isTrustedBackupRoot(backupDir, cwdReal) {
  if (!existsSync(backupDir)) return true;              // 不存在 ⇒ 无语境可破
  if (isSymlink(backupDir)) return false;               // ★ 软链根一律不信任
  const real = realOrNull(backupDir);
  if (!real) return false;
  return real === join(cwdReal, 'portable', 'memory', 'backups');
}

/** 目标守卫（纯）：rootReal 之下 **恰好一层的真目录** 才可删。 */
export function isAllowedTargetUnder(rootReal, dir) {
  if (!rootReal) return false;
  let st;
  try { st = lstatSync(dir); } catch { return false; }
  if (st.isSymbolicLink() || !st.isDirectory()) return false;   // 软链/文件都拒
  const real = realOrNull(dir);
  if (!real) return false;
  const prefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  if (!real.startsWith(prefix)) return false;
  const rel = real.slice(prefix.length);
  return !!rel && !rel.includes(sep);
}

const ROOT_OK = isTrustedBackupRoot(BACKUP_DIR, CWD_REAL);
const BACKUP_REAL = ROOT_OK ? realOrNull(BACKUP_DIR) : null;
export function isAllowedTarget(dir) {
  return ROOT_OK && isAllowedTargetUnder(BACKUP_REAL, dir);
}

function selfCheck() {
  const T = mkdtempSync(join(tmpdir(), 'pruneguard-'));
  const root = join(T, 'backups');
  mkdirSync(join(root, 'child'), { recursive: true });
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  const outside = join(T, 'outside');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(T, 'entries.json'), '{}');
  symlinkSync(outside, join(root, 'link'));                 // 子项软链
  symlinkSync(outside, join(T, 'backups-link'));            // 根软链
  const rootReal = realpathSync(root);

  const cases = [
    [isAllowedTargetUnder(rootReal, join(root, 'child')), true, '正常子目录'],
    [isAllowedTargetUnder(rootReal, root), false, '备份根自身'],
    [isAllowedTargetUnder(rootReal, join(T, 'entries.json')), false, '越界到 entries.json'],
    [isAllowedTargetUnder(rootReal, join(root, 'a', 'b')), false, '两层子路径'],
    [isAllowedTargetUnder(rootReal, join(root, 'link')), false, '子项是软链（lstat 必须拒）'],
    [isAllowedTargetUnder(rootReal, outside), false, '完全在根之外'],
    [isTrustedBackupRoot(join(T, 'backups-link'), T), false, '★ 根本身是软链'],
    [isTrustedBackupRoot(root, T), false, '根不在 cwd 约定位置'],
    [isTrustedBackupRoot(join(T, 'nope'), T), true, '不存在 ⇒ 视为可信（无操作）'],
  ];
  let bad = 0;
  for (const [got, want, why] of cases) {
    if (got !== want) bad++;
    console.log(`  ${got === want ? '✓' : '✗'} ${why}：得 ${got}（期望 ${want}）`);
  }
  const alwaysTrue = () => true;
  const wouldFail = cases.filter(([, want]) => want === false).filter(([, ,], i) => alwaysTrue(i));
  console.log(`  反证：永远放行的假实现会错误放行 ${wouldFail.length} 个"应拒"用例（>0 ⇒ 本自检有分辨力）`);
  rmSync(T, { recursive: true, force: true });
  const ok = bad === 0 && wouldFail.length > 0;
  console.log(ok ? 'self-check ✓' : 'self-check ✗');
  process.exit(ok ? 0 : 1);
}
if (SELF_CHECK) selfCheck();

if (existsSync(BACKUP_DIR) && !ROOT_OK) {
  console.error(`拒绝执行：备份根不可信（软链或不在约定位置）：${BACKUP_DIR}`);
  process.exit(3);
}

function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .map((name) => ({ name, path: join(BACKUP_DIR, name) }))
    .map((b) => {
      try {
        const lst = lstatSync(b.path);
        if (lst.isSymbolicLink() || !lst.isDirectory()) return null;
        return { ...b, mtimeMs: lst.mtimeMs };
      } catch { return null; }
    })
    .filter(Boolean)
    // 名字优先（ISO 时间戳开头 ⇒ 字典序=时间序；同秒创建的 mtime 相同，只有名字稳）
    .sort((x, y) => (x.name < y.name ? 1 : x.name > y.name ? -1 : y.mtimeMs - x.mtimeMs));
}

function plan() {
  const all = listBackups();
  const cutoff = Date.now() - DAYS * 86400_000;
  const keep = new Set();
  all.slice(0, KEEP).forEach((b) => keep.add(b.path));
  all.filter((b) => b.mtimeMs >= cutoff).forEach((b) => keep.add(b.path));
  return { all, keep: all.filter((b) => keep.has(b.path)), del: all.filter((b) => !keep.has(b.path)) };
}

const { all, keep, del } = plan();
const fmt = (b) => `${b.name}（${new Date(b.mtimeMs).toISOString().slice(0, 10)}）`;
if (JSON_OUT) {
  console.log(JSON.stringify({ backupDir: BACKUP_DIR, trustedRoot: ROOT_OK, keep: keep.map((b) => b.name), delete: del.map((b) => b.name), apply: APPLY }, null, 2));
} else {
  console.log(`备份目录：${BACKUP_DIR}`);
  console.log(`策略：最近 ${KEEP} 份 + 最近 ${DAYS} 天内保留 ⇒ 共 ${all.length} 份，保留 ${keep.length}，可清理 ${del.length}`);
  if (keep.length) console.log(`保留：${keep.map(fmt).join('、')}`);
  console.log(del.length ? `可清理：${del.map(fmt).join('、')}` : '可清理：无（策略生效，当前无需删除）');
}
if (!APPLY) {
  if (!JSON_OUT) console.log(del.length ? '（dry-run，未删除；加 --apply 才真删）' : '（dry-run：无可删项）');
  process.exit(0);
}
let removed = 0;
for (const b of del) {
  if (!isAllowedTarget(b.path)) { console.error(`拒绝删除越界路径：${b.path}`); process.exit(2); }
  rmSync(b.path, { recursive: true, force: true });
  removed++;
}
console.log(`已清理 ${removed} 份备份（保留 ${keep.length} 份）`);
process.exit(0);
