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

export const name = 'mypi-assistant';

/** 宿主 ctx 的最小面：只声明我们真正会用的两个方法，避免 `any`。 */
interface HostContext {
  get?: (service: string) => unknown;
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

export function apply(ctx: HostContext): void {
  const tools = toolsOf(ctx);
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
