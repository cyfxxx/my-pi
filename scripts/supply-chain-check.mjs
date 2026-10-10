#!/usr/bin/env node
/**
 * 供应链审计（离线，2026-10-10）
 *
 * ## 为什么是这两个指标（都在 lockfile 里，**不需要联网、不需要装任何东西**）
 *
 * 对"代码 agent"而言，命中率最高的攻击面不是"某个可执行文件带毒"，而是**依赖链被动手脚**：
 *   1. **`resolved` 指向非预期的 registry** —— 正常依赖应当从你配置的 registry 下载；
 *      指向别处（或某个陌生域名）就可能是**镜像劫持 / typosquat / 私有代理注入**。
 *   2. **带安装钩子的包**（`hasInstallScript` ⇒ `preinstall`/`postinstall`…）—— 这些脚本
 *      **在 `npm install` 时就执行**，是"装个依赖＝跑别人代码"的最直接通道。
 *
 * 两个指标都能**离线**从 `package-lock.json` 判出来（lockfile v2/v3 的 `packages` 映射里
 * 同时有 `resolved` 与 `hasInstallScript`），所以：**零依赖、零网络、跨平台** ✓。
 *
 * ## 口径（不许把"可疑"说成"恶意"）
 *
 * 结论只有两类：`needs-review`（需人工确认）与 `clean`（未发现）。**不做判定、不自动阻断**。
 * `resolved` 的"预期 host"是**配置项**（默认官方 registry + 国内镜像），因为用镜像是**正当选择**，
 * 本脚本只负责**指出偏离**，由人判断那是不是你有意为之。
 *
 * ## 自证（`--self-check`，离线、双向）
 *
 * 造三个合成 lockfile：① 全干净 ⇒ 必须 `clean`；② 混入陌生 registry ⇒ 必须点名那个包；
 * ③ 混入带安装钩子的包 ⇒ 必须点名。三条都要对，否则 exit 1 ——
 * 只断言"干净的时候是 clean"的假实现会在 ②③ 上失败。
 *
 * 用法：
 *   node scripts/supply-chain-check.mjs [--lock <path>]      # 默认 package-lock.json
 *   node scripts/supply-chain-check.mjs --self-check
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = import.meta.dirname;
const REPO = join(HERE, '..');

/** 预期 registry 的 host（用镜像也是正当的 ⇒ 只指出偏离，不判恶意） */
const EXPECTED_HOSTS = [
  'registry.npmjs.org',
  'registry.npmmirror.com',
  'registry.yarnpkg.com',
  'npm.pkg.github.com',
];

/** 纯函数：审计一个 lockfile 对象 ⇒ 发现列表 */
export function auditLock(lock, expectedHosts = EXPECTED_HOSTS) {
  const findings = [];
  const localLinks = [];
  const localLinkCount = 0; // 非 null ⇒ 启用本地链接识别
  const pkgs = lock && lock.packages;
  if (!pkgs || typeof pkgs !== 'object') {
    return { findings: [{ kind: 'invalid', name: '(lockfile)', detail: '没有 packages 映射（lockfile v2/v3 才有）' }], localLinks: [] };
  }
  for (const [path, meta] of Object.entries(pkgs)) {
    if (!path) continue; // "" = 根项目自身
    const name = path.replace(/^node_modules\//, '');
    if (meta && typeof meta.resolved === 'string') {
      // **本地链接不算偏离**（2026-10-10 修误报）：workspace 包常写成 `resolved: "custom"` 这类
      // 非 URL 值（`file:` / 相对路径 / 无 scheme）。第一版把它当成"resolved 无法解析"报了
      // `my-pi-custom` ⇒ **假阳性**。会狼来了的检查必然被无视 ⇒ 这里单独计数并跳过。
      if (localLinkCount !== null && !/^[a-z]+:\/\//i.test(meta.resolved)) {
        localLinks.push(name);
        continue;
      }
      let host = '';
      try {
        host = new URL(meta.resolved).host;
      } catch {
        findings.push({ kind: 'foreign-registry', name, detail: `resolved 无法解析：${meta.resolved}` });
        continue;
      }
      if (!expectedHosts.includes(host)) {
        findings.push({ kind: 'foreign-registry', name, detail: `resolved 指向 ${host}（预期 ${expectedHosts.join(' / ')}）` });
      }
    }
    if (meta && meta.hasInstallScript === true) {
      findings.push({ kind: 'install-script', name, detail: '该包带安装钩子（install 时执行代码）' });
    }
  }
  return { findings, localLinks };
}

function readLock(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { __parseError: e.message };
  }
}

function report(findings, lockFile, localLinks = []) {
  const localNote = localLinks.length ? `（另有 ${localLinks.length} 个本地链接已跳过：${localLinks.slice(0, 5).join(', ')}${localLinks.length > 5 ? ' …' : ''}）` : '';
  if (findings.length === 0) {
    console.log(`结论：clean（未发现偏离项）—— ${lockFile} ${localNote}`);
    return 0;
  }
  console.log(`结论：needs-review（${findings.length} 项，需人工确认；本脚本**不判定恶意、不阻断**）—— ${lockFile}`);
  for (const f of findings.slice(0, 40)) console.log(`  [${f.kind}] ${f.name} — ${f.detail}`);
  if (findings.length > 40) console.log(`  …另有 ${findings.length - 40} 项`);
  console.log('  提示：用镜像是正当的；请确认陌生 registry 与安装钩子是否是你有意引入的。');
  return 0; // 默认只记录不阻断
}

function selfCheck() {
  const dir = join(tmpdir(), `supply-chain-selfcheck-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const clean = { packages: { '': { name: 'x' }, 'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz' } } };
  const foreign = {
    packages: {
      '': { name: 'x' },
      'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz' },
      'node_modules/evil': { resolved: 'https://registry.npmjs.org.evil.example/evil/-/evil-1.0.0.tgz' },
    },
  };
  const hook = {
    packages: {
      '': { name: 'x' },
      'node_modules/hooker': { resolved: 'https://registry.npmjs.org/hooker/-/hooker-1.0.0.tgz', hasInstallScript: true },
    },
  };
  const f1 = auditLock(clean).findings;
  const f2 = auditLock(foreign).findings;
  const f3 = auditLock(hook).findings;
  const pass =
    f1.length === 0 &&
    f2.some((f) => f.kind === 'foreign-registry' && f.name === 'evil') &&
    f3.some((f) => f.kind === 'install-script' && f.name === 'hooker');
  console.log(`自证：干净⇒${f1.length} 项；陌生 registry⇒${JSON.stringify(f2.map((f) => f.name))}；安装钩子⇒${JSON.stringify(f3.map((f) => f.name))}`);
  console.log(pass ? '✅ 自证通过（干净为 0；两类偏离都被点名 ⇒ 假实现会失败）' : '❌ 自证失败');
  rmSync(dir, { recursive: true, force: true });
  process.exit(pass ? 0 : 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-check')) return selfCheck();
  const i = argv.indexOf('--lock');
  const lockFile = i >= 0 && argv[i + 1] ? argv[i + 1] : join(REPO, 'package-lock.json');
  const lock = readLock(lockFile);
  if (!lock) {
    console.log(`not-scanned：找不到 ${lockFile}`);
    process.exit(0);
  }
  if (lock.__parseError) {
    console.log(`not-scanned：${lockFile} 不是合法 JSON（${lock.__parseError}）`);
    process.exit(0);
  }
  const r = auditLock(lock);
  process.exit(report(r.findings, lockFile, r.localLinks));
}

main();
