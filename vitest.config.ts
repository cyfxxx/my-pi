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
    // 默认超时 5s 太紧：`custom/features/*/index.ts` 会被 `adapters/tool-adapter` 静态拉入
    // `typebox`（实测单独 import 就要 ~3.5s，用于在注册期把简化的参数声明编译成 TypeBox schema），
    // 于是"import 一个 feature + 注册"这类测试整体约 5–6s，贴着默认线跑——多一个测试文件提高并发
    // 就会假红（2026-10-01 实测：enable-tool / search-tool 两个用例在新增一个测试文件后超时）。
    // 这些测试做的是真实模块加载，不是慢逻辑，故把默认超时提到与其真实成本匹配。
    testTimeout: 20_000,
    include: ['custom/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**', 'vendor/**', 'custom/dist/**'],
  },
});
