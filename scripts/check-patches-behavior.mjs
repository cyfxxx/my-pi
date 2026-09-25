#!/usr/bin/env node
/**
 * check-patches-behavior.mjs — 补丁"行为存在性"守门
 *
 * `check-features.sh` 只验证补丁**可应用/已应用**（`vendor_patch_applied` 看提交历史），
 * 但拿不到"补丁带来的行为是否真的还在代码里"。上游同步、手工回退或 3way 合并语义漂移
 * 都可能让补丁"应用成功但行为消失"，且 golden 不会变红。
 *
 * 本脚本断言每个补丁的关键标记存在于 `vendor/pi` 源码：
 *   - 004/005/006 带自标记注释 `Patch (<补丁名>)`，直接查标记；
 *   - 001/002/003 无自标记，用显式关键符号表。
 *
 * 用法：node scripts/check-patches-behavior.mjs
 * vendor/pi 不存在（fresh checkout）时跳过（exit 0）。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor', 'pi');

if (!existsSync(VENDOR)) {
  console.log('⚠ vendor/pi 不存在（fresh checkout），跳过补丁行为检查');
  process.exit(0);
}

/** 无自标记补丁的显式关键符号 */
const EXPLICIT = {
  '001-branding.patch': [{ file: 'package.json', contains: ['"name": "my-pi"', 'piConfig'] }],
  '002-local-pi-mods.patch': [
    { file: 'packages/coding-agent/src/config.ts', contains: ['projectPiDir'] },
    { file: 'packages/coding-agent/src/core/secrets.ts', contains: ['REDACTED'] },
  ],
  '003-tab-completion-fix.patch': [
    { file: 'packages/tui/src/components/editor.ts', contains: ['isInSlashCommandContext'] },
  ],
};

function read(rel) {
  try {
    return readFileSync(join(VENDOR, rel), 'utf-8');
  } catch {
    return null;
  }
}

/** 在 vendor 的 packages 下递归查找自标记注释 */
function findSelfMarker(marker) {
  const base = join(VENDOR, 'packages');
  if (!existsSync(base)) return [];
  const hits = [];
  // 目录项类型以 statSync 为准：d_type 在 overlayfs/沙箱下不可靠（实测把普通文件报成 DT_LNK），
  // 漏扫会让"补丁行为标记"假绿。
  const kindOf = (full) => {
    try {
      const st = statSync(full);
      return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other';
    } catch {
      return 'other';
    }
  };
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const full = join(dir, e.name);
      const kind = kindOf(full);
      if (kind === 'dir') walk(full);
      else if (kind === 'file' && /\.(ts|tsx)$/.test(e.name)) {
        try {
          if (readFileSync(full, 'utf-8').includes(marker)) hits.push(full.slice(VENDOR.length + 1));
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(base);
  return hits;
}

const patches = readdirSync(join(ROOT, 'patches'))
  .filter((f) => f.endsWith('.patch'))
  .sort();

let failed = 0;
for (const patch of patches) {
  const name = patch.replace(/\.patch$/, '');
  const problems = [];

  // 1) 自标记注释
  const marker = `Patch (${name})`;
  const markerHits = findSelfMarker(marker);
  const explicit = EXPLICIT[patch] ?? [];

  if (markerHits.length === 0 && explicit.length === 0) {
    problems.push('既无自标记注释也无显式符号表');
  }

  // 2) 显式关键符号
  for (const { file, contains } of explicit) {
    const text = read(file);
    if (text === null) {
      problems.push(`缺少文件 ${file}`);
      continue;
    }
    for (const token of contains) {
      if (!text.includes(token)) problems.push(`${file} 缺少 "${token}"`);
    }
  }

  if (problems.length > 0) {
    failed++;
    console.log(`❌ ${patch}`);
    for (const p of problems) console.log(`     ${p}`);
  } else {
    const via = markerHits.length > 0 ? `自标记 ×${markerHits.length} 文件` : '显式符号';
    console.log(`✓ ${patch}（${via}）`);
  }
}

if (failed > 0) {
  console.error(`\n❌ ${failed} 个补丁的行为标记缺失（应用成功但行为可能已漂移）`);
  process.exit(1);
}
console.log('\n补丁行为标记齐全。');
