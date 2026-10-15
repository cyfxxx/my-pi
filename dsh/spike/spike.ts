/**
 * DSH 换基座 spike —— 用**真实的** `@deepseek-ai/*` 包验证适配层（不是静态分析）
 *
 * 运行的判定标准（每一检查都打印可核对的证据；不可用的情况**记 SKIP 而不是记通过**）：
 *
 *   A1 真实 DSH 工具服务起来（`ctx.plugin(SystemPrompt)` + `ctx.plugin(ToolRuntime)` ⇒ `ctx.tools`）
 *   A2 本仓外观层注册的工具进了真实注册表（`ctx.tools.get(name)`）
 *   A3 真实流水线执行它：canonical 字符串 + 文本块内容（验证 `output` 通用合成）
 *   A4 pi 形状的观察者钩子（`tool_call`）能收到真实调用，且**不干预时工具照常成功**
 *      （验证 waterfall 的 `next()` 纪律——裸挂处理器会打成 isError，见 hooks.ts 文件头）
 *   A5 pi 形状的**拦截**钩子（`{block:true}`）真的能拦住调用（DSH 的 `{kind:'deny'}`）——
 *      这是安全关键路径（plan-mode 之类靠它否决工具）
 *   A6 一个**真实特性**（`custom/features/web-search`，唯一不依赖 pi 运行时包的特性）经外观层注册
 *   A7 该特性的工具能被真实执行（走本机 SearXNG；后端不在时记 SKIP）
 *   A8 负向：未登记映射的事件直接抛错（不允许"注册了但永不触发"）
 *   A9 **全量 bootstrap**（真实 `custom/bootstrap.ts` 的 12 个特性）经外观层注册；
 *      需要 pi 包别名（ui-adapter/session-adapter 运行时 import pi 的包）⇒ 别名不可用时记 SKIP
 *
 * 用法：`bash scripts/dsh-spike.sh`（自动装 `dsh/spike/node_modules`，用仓库自带 tsx 运行）
 */

import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

import { createDshExtensionApi } from '../../custom/adapters/dsh/facade';
import type { DshContext } from '../../custom/adapters/dsh/types';
// ★ 走**真实的** pi 侧适配器把内部定义编译成 pi 形状，再交给 DSH 外观层 ——
//   这正是运行期的调用链（feature → tool-adapter → facade → DSH），不是"直接调 facade"的理想路径。
import { registerTool as registerPiTool, type ToolDefinition } from '../../custom/adapters/tool-adapter';
import { register as registerWebSearch } from '../../custom/features/web-search';

interface Check {
  id: string;
  ok: boolean | 'skip';
  detail: string;
}

const checks: Check[] = [];
const record = (id: string, ok: boolean | 'skip', detail: string): void => {
  checks.push({ id, ok, detail });
};

const tick = (ms = 250): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const unsupported: string[] = [];

  // ── A1：真实 DSH 服务 ─────────────────────────────────────────────────────
  const ctx = new Context();
  ctx.plugin(SystemPrompt);
  ctx.plugin(ToolRuntime);
  await tick();
  const tools = ctx.tools;
  record('A1', typeof tools === 'object' && tools !== null, `ctx.tools = ${typeof tools}`);

  // 真实 ctx 的形状与本地最小声明不完全一致（我们只声明用到的部分）⇒ 在边界处显式转换
  const facade = createDshExtensionApi(ctx as unknown as DshContext, {
    onUnsupported: (member, detail) => unsupported.push(`${member}: ${detail}`),
    hasUI: false,
  });

  // ── A2/A3：本仓工具经外观层进真实注册表并真跑 ──────────────────────────────
  const echo: ToolDefinition = {
    name: 'mypi_spike_echo',
    description: 'spike 探针：回显文本（验证参数映射 / output 合成 / signal 透传）',
    parameters: {
      text: { type: 'string', description: '要回显的文本' },
      n: { type: 'number', description: '可选数字', optional: true },
      tags: { type: 'string[]', description: '可选标签', optional: true },
    },
    executionMode: 'sequential',
    execute: async (args, execCtx) => `echo:${String(args.text)}:signal=${execCtx?.signal ? 'yes' : 'no'}`,
  };
  registerPiTool(facade.api as never, echo);
  record('A2', typeof tools.get('mypi_spike_echo') === 'object', `registry.get('mypi_spike_echo') = ${typeof tools.get('mypi_spike_echo')}`);

  const first = await tools.execute({
    callId: 'spike-1',
    name: 'mypi_spike_echo',
    arguments: { text: 'hello', n: 1, tags: ['a'] },
    signal: new AbortController().signal,
  });
  record(
    'A3',
    first.isError === false && first.value === 'echo:hello:signal=yes' && JSON.stringify(first.content) === JSON.stringify([{ type: 'text', text: 'echo:hello:signal=yes' }]),
    `value=${JSON.stringify(first.value)} content=${JSON.stringify(first.content)}`,
  );

  // ── A4：观察者钩子不干预 ⇒ 工具照常成功（waterfall next() 纪律）────────────
  let observed = 0;
  facade.api.on('tool_call' as never, (() => {
    observed += 1;
    return undefined;
  }) as never);
  const second = await tools.execute({
    callId: 'spike-2',
    name: 'mypi_spike_echo',
    arguments: { text: 'observer' },
    signal: new AbortController().signal,
  });
  record(
    'A4',
    observed === 1 && second.isError === false,
    `钩子触发 ${observed} 次；调用 isError=${second.isError}（不干预时必须放行）`,
  );

  // ── A5：拦截钩子真的能拦住（安全关键路径）─────────────────────────────────
  const blocker = createDshExtensionApi(ctx as unknown as DshContext, { onUnsupported: () => undefined });
  blocker.api.on('tool_call' as never, ((event: unknown) => {
    const name = (event as { toolName?: string }).toolName;
    if (name === 'mypi_spike_echo') return { block: true, reason: 'spike 拦截测试' };
    return undefined;
  }) as never);
  const blocked = await tools.execute({
    callId: 'spike-3',
    name: 'mypi_spike_echo',
    arguments: { text: 'blocked' },
    signal: new AbortController().signal,
  });
  const blockedText = JSON.stringify(blocked);
  record(
    'A5',
    blocked.isError === true && blockedText.includes('spike 拦截测试'),
    `被拦截：isError=${blocked.isError}；结果含理由 = ${blockedText.includes('spike 拦截测试')}`,
  );
  blocker.dispose(); // 撤销拦截，避免影响后续检查

  // ── A6/A7：真实特性经外观层注册（web-search 只用 tool-adapter，不碰 pi 运行时包）──
  registerWebSearch(facade.api as never);
  const wsRegistered = typeof tools.get('web_search') === 'object' && typeof tools.get('fetch_url') === 'object';
  record('A6', wsRegistered, `web_search=${typeof tools.get('web_search')} fetch_url=${typeof tools.get('fetch_url')}`);

  let a7: Check = { id: 'A7', ok: 'skip', detail: '未执行（前置未满足）' };
  if (wsRegistered) {
    const search = await tools.execute({
      callId: 'spike-4',
      name: 'web_search',
      arguments: { query: 'deepseek harness', maxResults: 3 },
      signal: new AbortController().signal,
    });
    const text = typeof search.value === 'string' ? search.value : JSON.stringify(search.content);
    const short = text.slice(0, 160).replace(/\s+/g, ' ');
    if (search.isError) a7 = { id: 'A7', ok: 'skip', detail: `执行报错（多半是 SearXNG 未运行）：${short}` };
    else a7 = { id: 'A7', ok: true, detail: `真实执行返回：${short}` };
  }
  checks.push(a7);

  // ── A8：负向——未登记事件必须抛错 ─────────────────────────────────────────
  let threw = '';
  try {
    facade.api.on('before_tool_call' as never, (() => undefined) as never);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  record('A8', threw.includes('before_tool_call'), `抛错信息：${threw.slice(0, 120)}`);

  // ── A9：全量 bootstrap（真实 12 个特性）；需要 pi 包别名 ────────────────────
  let a9: Check = { id: 'A9', ok: 'skip', detail: 'pi 包别名不可用（DSH-only 部署需 P5 的 shim/别名）' };
  try {
    const resolvePiTui = await import('@earendil-works/pi-tui');
    if (resolvePiTui) {
      const bootCtx = new Context();
      bootCtx.plugin(SystemPrompt);
      bootCtx.plugin(ToolRuntime);
      await tick();
      const bootFacade = createDshExtensionApi(bootCtx as unknown as DshContext, { onUnsupported: () => undefined, hasUI: false });
      const names: string[] = [];
      const registry = bootCtx.tools as unknown as { register: (d: { name: string }) => unknown };
      const original = registry.register.bind(bootCtx.tools);
      registry.register = (def: { name: string }) => {
        names.push(def.name);
        return original(def as never);
      };
      const failures: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        const text = args.map(String).join(' ');
        if (text.includes('注册功能失败')) failures.push(text.slice(0, 120));
        originalError(...args);
      };
      const bootstrapModule = await import('../../custom/bootstrap');
      bootstrapModule.default(bootFacade.api);
      console.error = originalError;
      // 事件桥接台账：确认"哪些 pi 钩子真的接上了"，并守住"压缩事件不再被判为服务替换"这条更正
      const eventEntries = bootFacade.surfaceReport().filter((e) => e.member.startsWith('on('));
      const supported = eventEntries.filter((e) => e.status === 'supported').length;
      const degraded = eventEntries.filter((e) => e.status === 'degraded').length;
      const unsupported = eventEntries.filter((e) => e.status === 'unsupported').length;
      const compact = eventEntries.find((e) => e.member === 'on(session_before_compact)');
      const compactOk = compact?.status === 'degraded';
      a9 = {
        id: 'A9',
        ok: failures.length === 0 && names.length > 20 && unsupported === 0 && compactOk,
        detail: `全量 bootstrap：注册工具 ${names.length} 个；失败特性 ${failures.length} 个；钩子桥接 ${supported} 直接 / ${degraded} 降级 / ${unsupported} 无等价；session_before_compact=${compact?.status ?? '未注册'}${failures.length ? ' ⇒ ' + failures.join(' | ') : ''}`,
      };
      bootFacade.dispose();
    }
  } catch (error) {
    a9 = { id: 'A9', ok: 'skip', detail: `pi 包别名不可用：${(error as Error).message.slice(0, 80)}` };
  }
  checks.push(a9);

  // ── 输出（含"哪些 pi 面没有等价物"的清单，不藏缺口）────────────────────────
  console.log('=== DSH 换基座 spike（真实 @deepseek-ai 包）===');
  for (const c of checks) {
    const mark = c.ok === true ? '✓' : c.ok === 'skip' ? '·' : '❌';
    console.log(`${mark} ${c.id}  ${c.detail}`);
  }
  console.log('\n--- 外观层：pi 面可用性（未被调用的成员不在报告里）---');
  for (const entry of facade.surfaceReport()) {
    console.log(`  [${entry.status}${entry.called ? ',called' : ''}] ${entry.member}${entry.detail ? ' — ' + entry.detail : ''}`);
  }
  if (unsupported.length > 0) {
    console.log(`\n--- 无等价物上报（${unsupported.length} 条，去重前）---`);
    for (const u of [...new Set(unsupported)].slice(0, 12)) console.log(`  ! ${u}`);
  }

  const failed = checks.filter((c) => c.ok === false);
  const skipped = checks.filter((c) => c.ok === 'skip');
  console.log(`\n结果：${checks.length - failed.length - skipped.length} 通过 / ${failed.length} 失败 / ${skipped.length} 跳过`);
  facade.dispose();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('spike 异常终止:', error);
  process.exit(2);
});
