/**
 * 纯 node 冒烟：加载**构建产物**（`dsh/plugin/dist/my-pi-plugin.mjs`）并在最小 DSH harness 里注册。
 *
 * 与 `spike.ts` 的分工：
 *   - `spike.ts`（tsx）验证**源码级**适配层（A1–A9，含真实搜索与拦截语义）；
 *   - 本文件验证**交付物**：DSH profile 真正会加载的那个 `.mjs`，在**没有 tsx、没有本仓 TS**
 *     的情况下也能 apply 成功并注册出工具。
 *
 * 前置：`node_modules/@earendil-works/*` 别名到 pi-shims（`scripts/dsh-spike.sh` 会建），
 *       以及 `dsh/spike/node_modules` 里有 `@deepseek-ai/*`。
 * 用法：node dsh/spike/smoke-built.mjs
 */
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { existsSync } from 'node:fs';
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

console.log('=== 构建产物冒烟（纯 node，无 tsx）===');
console.log(`${okName ? '✓' : '❌'} 插件名 = ${name}`);
console.log(`${okInject ? '✓' : '❌'} inject = ${JSON.stringify(inject)}`);
console.log(`${okTools ? '✓' : '❌'} 注册工具 ${registered.length} 个（前 6：${registered.slice(0, 6).join(', ')}）`);
console.log(`${hasWebSearch ? '✓' : '❌'} 含真实特性工具 searxng = ${hasWebSearch}`);
console.log(`${okNoFail ? '✓' : '❌'} 特性注册失败 ${failures.length} 个${failures.length ? ' ⇒ ' + failures.join(' | ') : ''}`);
console.log(`${okNoStray ? '✓' : '❌'} 未产生脏目录 dsh/portable（根目录解析被显式钉住）`);
facade.dispose();

const failed = [!okName, !okInject, !okTools, !hasWebSearch, !okNoFail, !okNoStray].filter(Boolean).length;
console.log(`\n结果：${failed === 0 ? '通过' : '失败 ' + failed + ' 项'}`);
process.exit(failed === 0 ? 0 : 1);
