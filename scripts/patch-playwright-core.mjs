#!/usr/bin/env node
/**
 * patch-playwright-core.mjs — Termux/Android 平台补丁（playwright-core）
 *
 * 背景：Termux 的 Node 报告 process.platform / os.platform() === "android"，而
 * playwright-core 的缓存目录/二进制路径解析只认 linux/darwin/win32，android 会落到
 * `<unknown>` 导致浏览器启动失败。本补丁把 `platform === "linux"` 判断扩展为
 * `|| === "android"`，让 android 复用 linux 路径布局（Termux 为 POSIX 兼容）。
 *
 * 与 pi-tools 不同的适配：pi-tools 按 1.53.x 的 lib/server/* 精确文件表；my-pi 依赖
 * playwright-core 1.63.0（打包进 lib/coreBundle.js 等），故改为对已知承载平台判断的
 * 文件做模式替换（幂等：文件内已含 "android" 判断则跳过）。
 *
 * 用法：node scripts/patch-playwright-core.mjs [playwright-core 目录]
 *   - 非 Termux 直接退出 0
 *   - 全部命中并应用/跳过：exit 0；有目标文件缺失：exit 1 需人工核对
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// 已知承载平台判断的文件（存在才处理）
const TARGET_FILES = [
  'lib/coreBundle.js',
  'lib/serverRegistry.js',
  'lib/utilsBundle.js',
  'lib/tools/cli-client/registry.js',
  'lib/server/utils/hostPlatform.js',
  'lib/server/registry/index.js',
];

/** 纯函数：把沙箱/平台判断扩展至 android（幂等；便于单测） */
export function patchSource(src) {
  if (src.includes('process.platform === "android"')) return { src, changed: false };
  let out = src;
  let changed = false;

  // process.platform === "linux"（含已有 || ... 条件的同处）
  const reProc = /process\.platform === "linux"/g;
  if (reProc.test(out)) {
    out = out.replace(reProc, '(process.platform === "linux" || process.platform === "android")');
    changed = true;
  }
  // 裸 platform === "linux"（hostPlatform 等），排除 process.platform 与属性访问（`X.platform`）；
  // 注：若不禁 `.`，会把打包产物的 `X.default.platform === "linux"` 改写成非法语法 `X.default.(…)`。
  const reBare = /(?<![\w.])platform === "linux"/g;
  if (reBare.test(out)) {
    out = out.replace(reBare, '(platform === "linux" || platform === "android")');
    changed = true;
  }
  return { src: out, changed };
}

function detectDir() {
  const explicit = process.argv[2];
  if (explicit) return explicit;
  if (process.env.PI_PLAYWRIGHT_DIR) return process.env.PI_PLAYWRIGHT_DIR;
  for (const c of [join(REPO_ROOT, 'node_modules', 'playwright-core'), join(REPO_ROOT, 'custom', 'node_modules', 'playwright-core')]) {
    if (existsSync(c)) return c;
  }
  return '';
}

function main() {
  if (!existsSync('/data/data/com.termux')) {
    console.log('非 Termux 环境，无需 playwright-core 补丁');
    return 0;
  }
  const dir = detectDir();
  if (!dir) {
    console.error('未找到 playwright-core（先 npm install）');
    return 1;
  }
  let applied = 0;
  let skipped = 0;
  let missing = 0;
  const missingFiles = [];
  for (const rel of TARGET_FILES) {
    const file = join(dir, rel);
    if (!existsSync(file)) {
      missing++;
      missingFiles.push(rel);
      continue;
    }
    const src = readFileSync(file, 'utf8');
    const { src: out, changed } = patchSource(src);
    if (!changed) {
      skipped++;
      continue;
    }
    writeFileSync(file, out);
    console.log(`补丁已应用: ${rel}`);
    applied++;
  }
  console.log(`完成：应用 ${applied} / 跳过 ${skipped} / 缺失 ${missing}`);
  if (missing > 0) {
    console.log(`缺失目标（playwright-core 版本可能变化，需人工核对）：${missingFiles.join(', ')}`);
  }
  // 完全未命中（既没应用也没跳过）说明补丁表与当前版本不匹配，必须人工处理。
  if (applied === 0 && skipped === 0) {
    console.error('playwright-core 补丁未命中任何目标文件，Termux 浏览器可能不可用');
    return 1;
  }
  // 其余缺失仅告警：默认不致命（版本演进导致路径变化），可用 PI_PLAYWRIGHT_ALLOW_MISSING=0 要求严格。
  if (missing > 0 && process.env.PI_PLAYWRIGHT_ALLOW_MISSING === '0') {
    console.error('存在缺失目标文件且要求严格模式，退出 1');
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
