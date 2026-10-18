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
import { defineTool } from '@deepseek-ai/dsh-tools';
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
