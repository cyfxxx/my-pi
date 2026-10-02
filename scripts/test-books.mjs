#!/usr/bin/env node
/**
 * test-books.mjs — 书籍知识库框架自检（零网络、零 LLM）
 *
 * 调 `scripts/books.py selftest`：用合成 PDF（含内嵌目录 + 纯图像页）验证
 * probe/index/read/report/记录 全链路，避免"框架只在真实大书库上才能验证"。
 *
 * 用法：node scripts/test-books.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync('python3', [join(ROOT, 'scripts', 'books.py'), 'selftest'], {
  encoding: 'utf8',
  cwd: ROOT,
  timeout: 300_000,
});

const out = `${r.stdout || ''}${r.stderr || ''}`;
// 以 books.py 自己输出的 JSON 摘要为准（避免把子命令的 ✓ 行也算进去）
const m = [...out.matchAll(/"checks": (\d+), "failed": (\d+)/g)].pop();
const ok = m ? Number(m[1]) : [...out.matchAll(/^\s+✓ /gm)].length;
const bad = m ? Number(m[2]) : [...out.matchAll(/^\s+❌ /gm)].length;
if (r.status !== 0 || bad > 0) {
  console.error(out.trim().split('\n').slice(-25).join('\n'));
  console.error(`❌ 书籍框架自检失败（通过 ${ok} / 失败 ${bad}）`);
  process.exit(1);
}
console.log(`书籍知识库框架自检通过（${ok} 项；含 OCR 兜底，缺 tesseract 时该项显式跳过）`);
