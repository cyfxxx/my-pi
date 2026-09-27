import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

// vendor/pi 不在根 node_modules，pi 运行时由 jiti 从 vendored 源码加载；
// 真实 dist 在 vitest 下 import 会卡死（依赖初始化过重）。工具层测试需要
// 这些包可解析（ui-adapter 的 TUI 组件与 getMarkdownTheme、session-adapter 的
// SessionManager），故 alias 到集中的最小 stub，避免每个测试文件重复 vi.mock。
// 用精确正则，避免误匹配同前缀包名。
const PI_TUI_STUB = resolve(root, 'custom/test-support/pi-tui-stub.ts');
const PI_CODING_AGENT_STUB = resolve(root, 'custom/test-support/pi-coding-agent-stub.ts');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@earendil-works\/pi-tui$/, replacement: PI_TUI_STUB },
      { find: /^@earendil-works\/pi-coding-agent$/, replacement: PI_CODING_AGENT_STUB },
    ],
  },
  test: {
    // 显式项目名 + 固定 maxWorkers/groupOrder：此前偶发
    // `Projects "" and "" have different 'maxWorkers' but same 'sequence.groupOrder'`
    // 导致 `Test Files no tests / Errors 1`（vitest 5 内部把同一配置视作两个匿名项目）。
    // 固定这两项后该断言不再触发，门不再假红。
    name: 'my-pi-custom',
    maxWorkers: 4,
    sequence: { groupOrder: 1 },
    include: ['custom/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**', 'vendor/**', 'custom/dist/**'],
  },
});
