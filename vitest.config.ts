import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    pool: 'forks',
    forks: { singleFork: true },
    fileParallelism: false,
  },
});
