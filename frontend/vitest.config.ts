import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.tsx'],
    // Modules read VITE_API_URL when they load; CI has no .env, so tests get the value every .env uses.
    env: { VITE_API_URL: '/api/v1' },
  },
});
