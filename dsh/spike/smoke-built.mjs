/**
 * 纯 node 冒烟：加载**构建产物**（`dsh/plugin/dist/my-pi-plugin.mjs`）并在最小 DSH harness 里注册。
 *
 * 与 `spike.ts` 的分工：
 *   - `spike.ts`（tsx）验证**源码级**适配层（A1–A9，含真实搜索与拦截语义）；
 *   - 本文件验证**交付物**：DSH profile 真正会加载的那个 `.mjs`，在**没有 tsx、没有本仓 TS**
 *     的情况下也能 apply 成功并注册出工具。
 *
 * 前置：`dsh/spike/node_modules` 里有 `@deepseek-ai/*`（宿主包的本地等价物）。
 *       注意：**不再需要** `node_modules/@earendil-works/*` 别名 —— 2026-10-18 起产物用
 *       esbuild `--alias:` 把 pi specifier 改写成本仓 shim 并**打进产物**（本脚本会断言这一点）。
 * 用法：node dsh/spike/smoke-built.mjs
 */
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, name, inject } from '../plugin/dist/my-pi-plugin.mjs';

// 回归守门：打包后 `import.meta.url` 指向产物 ⇒ 若根目录解析没被显式钉住，
// features 会把 `portable/agent/modes.json` 写到 **dsh/portable/agent/**（踩过）。
const HERE = dirname(fileURLToPath(import.meta.url));
const STRAY_DIR = resolve(HERE, '..', 'portable');
const strayBefore = existsSync(STRAY_DIR);

const ctx = new Context();
ctx.plugin(SystemPrompt);
ctx.plugin(ToolRuntime);
await new Promise((r) => setTimeout(r, 300));

const registered = [];
const registry = ctx.tools;
const original = registry.register.bind(registry);
registry.register = (def) => {
  registered.push(def.name);
  return original(def);
};

const failures = [];
const originalError = console.error;
console.error = (...args) => {
  const text = args.map(String).join(' ');
  if (text.includes('注册功能失败')) failures.push(text.slice(0, 140));
  originalError(...args);
};
const facade = apply(ctx);
console.error = originalError;

const strayAfter = existsSync(STRAY_DIR);
const okNoStray = !strayBefore && !strayAfter;
const okName = name === 'my-pi';
const okInject = Array.isArray(inject) && inject.includes('tools');
const okTools = registered.length >= 20;
const okNoFail = failures.length === 0;
const hasWebSearch = registered.includes('searxng');
// ★ 自包含断言（2026-10-18 新增）：产物里**不得**再有 `@earendil-works/*` 的 import ——
//   它们是本仓 shim，应当被 `dsh-build.sh` 的 `--alias:` 改写并**打进产物**。留成外部依赖的话，
//   装到真 profile 时就要靠 profile 级 `pnpm.overrides` 兜底（而包清单不含 shim ⇒ 装不出来）。
//   放在这里是因为 `dsh-package.sh`（从头装一遍再加载）**不在任何自动门禁里**：
//   2026-10-18 加了 `@deepseek-ai/dsh-tools` 这个宿主 import 后，它静默失效了很久没人发现。
const ARTIFACT_PATH = resolve(HERE, '..', 'plugin', 'dist', 'my-pi-plugin.mjs');
const selfContained = !/from\s*"@earendil-works\//.test(readFileSync(ARTIFACT_PATH, 'utf8'));

console.log('=== 构建产物冒烟（纯 node，无 tsx）===');
console.log(`${okName ? '✓' : '❌'} 插件名 = ${name}`);
console.log(`${okInject ? '✓' : '❌'} inject = ${JSON.stringify(inject)}`);
console.log(`${okTools ? '✓' : '❌'} 注册工具 ${registered.length} 个（前 6：${registered.slice(0, 6).join(', ')}）`);
console.log(`${hasWebSearch ? '✓' : '❌'} 含真实特性工具 searxng = ${hasWebSearch}`);
console.log(`${okNoFail ? '✓' : '❌'} 特性注册失败 ${failures.length} 个${failures.length ? ' ⇒ ' + failures.join(' | ') : ''}`);
console.log(`${okNoStray ? '✓' : '❌'} 未产生脏目录 dsh/portable（根目录解析被显式钉住）`);
console.log(`${selfContained ? '✓' : '❌'} 产物自包含（无 @earendil-works/* import ⇒ 不需要部署侧 pi 别名）`);
facade.dispose();

const failed = [!okName, !okInject, !okTools, !hasWebSearch, !okNoFail, !okNoStray, !selfContained].filter(Boolean).length;
console.log(`\n结果：${failed === 0 ? '通过' : '失败 ' + failed + ' 项'}`);
process.exit(failed === 0 ? 0 : 1);
