import { defineConfig } from 'vitest/config';

export default defineConfig({
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
