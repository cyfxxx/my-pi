/**
 * 我们自己的 DSH 插件（拼接架构里的「A 类接缝」样板）。
 *
 * 它只做一件事：向宿主注册一个工具。注册一次，**两端自动可见** ——
 * 终端前端与 Web GUI 都是同一个宿主运行时的客户端，工具面只有一份。
 *
 * 边界：这里只依赖 `@deepseek-ai/dsh-tools`（宿主提供）与 node 内置模块，
 * 不 import 任何 pi / 本仓 custom 层的东西。
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ContextFormed } from '@deepseek-ai/dsh-llm';

// 声明我们自己的消息来源（DSH 的 MessageSourceMap 是"各生产者自己声明 kind"的合并式联合）。
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'mypi-memory': { kind: 'mypi-memory' } & ContextFormed;
    'mypi-intent': { kind: 'mypi-intent' } & ContextFormed;
  }
}
import { formatHit, formatStats, recall, remember, renderInjection, resolveMemoryConfig } from './memory';
import { ledgerFile, readLedger, recordIntent, renderIntentLedger, textOfContent } from '../memory/intent';
import { createSearxngProvider, resolveSearxngConfig } from './searxng';
import {
  hasTmux,
  listSessions,
  normalizeName,
  readSession,
  resolveTmuxConfig,
  runSession,
  sendKeys,
  stopSession,
} from './tmux';

export const name = 'mypi-assistant';

/** 宿主 ctx 的最小面：只声明我们真正会用的方法，避免 `any`。 */
interface HostContext {
  get?: (service: string) => unknown;
  /** cordis 的服务注入：服务就绪后才回调（未就绪则永不调用，不报错）。 */
  inject?: (
    services: readonly string[],
    callback: (child: { web: { registerSearchProvider: (provider: unknown) => () => void } }) => void,
  ) => unknown;
  /** 事件订阅（agent/pre-step 是宿主的事件瀑布；session/event 是会话事件流）。 */
  on?: (event: string, listener: (...args: readonly unknown[]) => unknown) => unknown;
  [key: string]: unknown;
}

interface ToolsService {
  register: (tool: unknown) => () => void;
}

function toolsOf(ctx: HostContext): ToolsService {
  // 先 ctx.get（DSH 服务注册表），退回属性读（测试替身）；两路都可能是 undefined。
  let candidate: unknown;
  if (typeof ctx.get === 'function') candidate = ctx.get('tools');
  if (candidate === undefined) candidate = ctx['tools'];
  const tools = candidate as Partial<ToolsService> | undefined;
  if (typeof tools?.register !== 'function') throw new Error('mypi-assistant: 宿主没有 tools 服务');
  return tools as ToolsService;
}

/**
 * 笔记文件位置：`MYPI_NOTES_FILE` 优先；否则 `<assistant>/.run/notes.md`
 * （产物在 `assistant/plugin/dist/`，上溯两级就是 `assistant/`）。
 */
function notesPath(): string {
  const override = process.env.MYPI_NOTES_FILE;
  if (override) return override;
  return join(dirname(new URL(import.meta.url).pathname), '..', '..', '.run', 'notes.md');
}

/** 统一形状：一行文本输出，减少五个 tmux 工具的样板。 */
function stringTool(
  name: string,
  description: string,
  parameters: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string }>,
  run: (args: Record<string, unknown>) => string,
): unknown {
  return defineTool({
    name,
    description,
    parameters,
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
        { type: 'text', text: typeof value === 'string' ? value : String(value) },
      ],
    },
    execute: async (args: unknown): Promise<string> => run((args ?? {}) as Record<string, unknown>),
  });
}

export function apply(ctx: HostContext): void {
  const tools = toolsOf(ctx);
  // 搜索接缝：把 SearXNG 注册成 `ctx.web` 的 provider（官方扩展点，不 fork）。
  // 选哪个 provider 由 profile 的 `web.searchProvider` 或 `DSH_WEB_SEARCH_PROVIDER` 决定。
  const searxng = resolveSearxngConfig();
  ctx.inject?.(['web'], (child) => {
    child.web.registerSearchProvider(createSearxngProvider(searxng));
  });

  // 长期记忆：与原项目同 schema（entries.json）+ 三级去重合并 + append-only 注入。
  const memory = resolveMemoryConfig(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  tools.register(stringTool('memory_store', '存入一条长期记忆（自动脱敏、按标题/内容/近似去重合并）。', {
    category: { type: 'string', description: '类别：fact/preference/habit/procedure/reference/solutions' },
    title: { type: 'string', description: '简短标题（作索引与去重键）' },
    content: { type: 'string', description: '详细内容' },
    tags: { type: 'string', description: '（可选）逗号分隔标签' },
    confidence: { type: 'number', description: '（可选）置信度 0-1，默认 0.7' },
    environment: { type: 'string', description: '（可选）适用环境：all/linux/macos/windows/termux' },
  }, (args) => {
    const title = String(args.title ?? '').trim();
    const content = String(args.content ?? '').trim();
    if (title === '' || content === '') throw new Error('memory_store: title 与 content 都不能为空');
    return remember(memory, {
      category: String(args.category ?? 'fact'),
      title,
      content,
      tags: String(args.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
      environment: typeof args.environment === 'string' && args.environment.trim() ? args.environment.trim() : undefined,
    });
  }));
  tools.register(stringTool('memory_search', '按关键词检索长期记忆（标题/内容/标签；带置信度与复现次数加权）。', {
    query: { type: 'string', description: '检索词' },
    limit: { type: 'number', description: '（可选）最多几条，默认 5' },
  }, (args) => {
    const hits = recall(memory, String(args.query ?? ''), Number(args.limit ?? 5));
    return hits.length === 0 ? '没有匹配的长期记忆' : hits.map(formatHit).join('\n');
  }));
  tools.register(stringTool('memory_stats', '查看长期记忆库的条数、类别与环境分布。', {}, () => formatStats(memory)));

  // 意图账本：会话级、逐字、过滤纯推进语（压缩两阶段改造的第①步）。
  const assistantRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const OURS = new Set(['mypi-memory', 'mypi-intent', 'time-context']);
  // 注意：`session/event` 监听器是 (session, event) 两个位置参数，不是一个对象。
  ctx.on?.('session/event', (...args) => {
    const session = args[0] as { id?: unknown } | undefined;
    const event = args[1] as { type?: string; data?: { source?: { kind?: string }; content?: unknown } } | undefined;
    if (event?.type !== 'user/message') return;
    const kind = event.data?.source?.kind;
    if (typeof kind === 'string' && OURS.has(kind)) return;
    const sessionId = typeof session?.id === 'string' ? session.id : undefined;
    if (sessionId === undefined) return;
    const text = textOfContent(event.data?.content);
    if (text.trim() === '') return;
    recordIntent(ledgerFile(assistantRoot, sessionId), text);
  });

  // append-only 注入：只在回合第一步、内容与上次不同时，追加到请求消息末尾（前缀不动 ⇒ 缓存可命中）。
  const lastInjected = new Map<string, string>();
  ctx.on?.('agent/pre-step', async (...args) => {
    const payload = args[0] as { step?: number } | undefined;
    const next = args[1] as (() => Promise<unknown>) | undefined;
    const decision = (await next?.()) as { kind?: string; messages?: readonly unknown[] };
    if (decision?.kind === 'reject' || decision?.messages === undefined) return decision;
    const step = payload?.step ?? 1;
    if (step !== 1) return decision;
    const text = renderInjection(memory);
    if (text === '') return decision;
    const sessionId =
      ((payload as { agent?: { session?: { id?: unknown } } } | undefined)?.agent?.session?.id as string | undefined) ?? 'default';
    const intent = renderIntentLedger(readLedger(ledgerFile(assistantRoot, sessionId)), Number(process.env.MYPI_INTENT_BUDGET_TOKENS ?? '1000'));
    const memoryText = text;
    if (lastInjected.get(sessionId) === memoryText + '\u0000' + intent) return decision;
    lastInjected.set(sessionId, memoryText + '\u0000' + intent);
    const memoryMessage = createUserMessage({
      content: [{ type: 'text', text: memoryText }],
      source: { kind: 'mypi-memory', form: 'snapshot', sections: [{ name: 'memory', text: memoryText }] },
    });
    const intentMessage = createUserMessage({
      content: [{ type: 'text', text: intent }],
      source: { kind: 'mypi-intent', form: 'snapshot', sections: [{ name: 'intent', text: intent }] },
    });
    const extra: unknown[] = intent === '' ? [memoryMessage] : [memoryMessage, intentMessage];
    return { ...decision, messages: [...decision.messages, ...extra] };
  });

  // tmux：只认 `MYPI_TMUX_PREFIX`（默认 mypi-）前缀的会话，避免误杀用户自己的会话。
  const tmux = resolveTmuxConfig();
  const guard = (): void => {
    if (!hasTmux(tmux)) throw new Error('tmux 不在 PATH 里（装一个，或设 MYPI_TMUX_BIN 指向可执行文件）');
  };
  tools.register(stringTool('tmux_run', '在后台 tmux 会话里跑一条命令（会话名前缀 mypi-），返回会话名。', {
    command: { type: 'string', description: '要执行的 shell 命令' },
    name: { type: 'string', description: '（可选）会话名后缀，默认自动用命令前缀' },
    cwd: { type: 'string', description: '（可选）工作目录' },
  }, (args) => {
    guard();
    const name = normalizeName(tmux, typeof args.name === 'string' && args.name.trim() ? args.name : `run-${Date.now().toString(36)}`);
    return runSession(tmux, name, String(args.command ?? ''), typeof args.cwd === 'string' ? args.cwd : undefined);
  }));
  tools.register(stringTool('tmux_status', '列出本插件创建的 tmux 会话（只列 mypi- 前缀）。', {}, () => {
    guard();
    const sessions = listSessions(tmux);
    if (sessions.length === 0) return '没有本插件创建的 tmux 会话';
    return sessions.map((s) => `${s.name}	窗口 ${s.windows}	创建于 ${s.created}`).join('\n');
  }));
  tools.register(stringTool('tmux_read', '读取某个 tmux 会话最近的输出（默认 80 行）。', {
    name: { type: 'string', description: '会话名（可省略前缀）' },
    lines: { type: 'number', description: '（可选）读取行数，默认 80' },
  }, (args) => {
    guard();
    const name = normalizeName(tmux, String(args.name ?? ''));
    return readSession(tmux, name, Number(args.lines ?? 80));
  }));
  tools.register(stringTool('tmux_send', '向 tmux 会话发送文本（可选回车）。', {
    name: { type: 'string', description: '会话名（可省略前缀）' },
    text: { type: 'string', description: '要发送的文本' },
    enter: { type: 'boolean', description: '（可选）发送后回车，默认 true' },
  }, (args) => {
    guard();
    const name = normalizeName(tmux, String(args.name ?? ''));
    return sendKeys(tmux, name, String(args.text ?? ''), args.enter !== false);
  }));
  tools.register(stringTool('tmux_stop', '结束某个 tmux 会话（只允许 mypi- 前缀）。', {
    name: { type: 'string', description: '会话名（可省略前缀）' },
  }, (args) => {
    guard();
    const name = normalizeName(tmux, String(args.name ?? ''));
    return stopSession(tmux, name);
  }));
  tools.register(
    defineTool({
      name: 'mypi_note',
      description: '把一行笔记追加到本机笔记文件，返回行号与文件路径。用于验证「自写插件工具」这条接缝。',
      parameters: {
        text: { type: 'string', description: '要记住的一行内容' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
          { type: 'text', text: typeof value === 'string' ? value : String(value) },
        ],
      },
      execute: async (args: unknown): Promise<string> => {
        const text = (args as { text?: unknown } | undefined)?.text;
        if (typeof text !== 'string' || text.trim() === '') throw new Error('mypi_note: 缺少 text');
        const file = notesPath();
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${new Date().toISOString()} ${text.trim()}\n`, 'utf8');
        const lines = readFileSync(file, 'utf8').trimEnd().split('\n').length;
        return `已记录到 ${file}（第 ${lines} 行）`;
      },
    }),
  );
}
