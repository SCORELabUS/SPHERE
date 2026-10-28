import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['src/test/e2e/*.browser.ts'], environment: 'node', fileParallelism: false,
  testTimeout: 120000, hookTimeout: 60000,
} });
