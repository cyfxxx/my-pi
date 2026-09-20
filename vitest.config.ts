import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['custom/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**', 'vendor/**', 'custom/dist/**'],
  },
});
