import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Most of the suite exercises server-side modules (services, models,
 * payment accounting), so `node` is the default environment. Anything
 * that renders React needs a DOM and is matched by
 * `environmentMatchGlobs` instead.
 *
 * `jsdom` is an optional peer for component tests only:
 *   npm install -D jsdom
 */
const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
