/**
 * 冒烟：**从"已安装的包"里**加载 DSH 插件产物（验证正式发布形态，而不是相对路径引用）。
 *
 * 与 `smoke-built.mjs` 的区别：那个加载的是仓库里的 `dist/`，本文件加载的是
 * `npm install <tgz|file:…>` 之后位于 **node_modules** 里的那份 —— 依赖解析、
 * `main`/`exports`、`files` 白名单都必须对，才能真正被 DSH profile 安装使用。
 *
 * 用法：
 *   MY_PI_PACKAGED_PLUGIN=/tmp/…/node_modules/my-pi-dsh-plugin/dist/my-pi-plugin.mjs \
 *     node dsh/spike/smoke-packaged.mjs
 * 说明：harness（`@deepseek-ai/*`）从**本仓库**解析，插件从**安装目录**解析 ——
 *       两者各自的 import 各自解析，这正是部署时的真实情形（插件只声明 peer 依赖）。
 */
import { existsSync } from 'node:fs';

import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

const target = process.env.MY_PI_PACKAGED_PLUGIN;
if (!target || !existsSync(target)) {
  console.error(`❌ 找不到已安装的插件产物：${target ?? '(未设置 MY_PI_PACKAGED_PLUGIN)'}`);
  process.exit(2);
}

const mod = await import(target);
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
const facade = mod.apply(ctx, { root: process.env.MY_PI_ROOT });
console.error = originalError;

const checks = [
  ['导出 name = my-pi', mod.name === 'my-pi'],
  ['导出 apply 为函数', typeof mod.apply === 'function'],
  ['inject 含 tools', Array.isArray(mod.inject) && mod.inject.includes('tools')],
  [`注册工具 ≥ 50（实际 ${registered.length}）`, registered.length >= 50],
  ['含真实特性工具 web_search', registered.includes('web_search')],
  [`特性注册失败 0 个（实际 ${failures.length}）`, failures.length === 0],
  ['工具清单可枚举（schemas 映射）', facade.api.getAllTools().length === registered.length],
];
console.log(`=== 已安装包冒烟（${target}）===`);
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '❌'} ${label}`);
  if (!ok) failed += 1;
}
facade.dispose();
console.log(`\n结果：${failed === 0 ? '通过' : `失败 ${failed} 项`}`);
process.exit(failed === 0 ? 0 : 1);
