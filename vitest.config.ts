import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      // Full-suite cold transforms of large modules (dynamic import) routinely
      // exceed Vitest's 5s default under parallel load; 15s keeps assertions
      // intact without false timeouts.
      testTimeout: 15_000,
      include: [
        'src/**/*.{test,spec}.{js,ts}',
        'evals/harness/**/*.{test,spec}.{js,ts}',
        'evals/graph-scale/**/*.{test,spec}.{js,ts}',
        'scripts/**/*.{test,spec}.{js,ts}',
      ],
      exclude: [
        'src/routes/demo/playwright/**/*.ts',
        '**/*.e2e.ts',
        '**/*.svelte.spec.ts',
        '**/longmemeval-scoring.spec.ts',
      ],
      globalTeardown: ['./vitest.global-teardown.ts'],
    },
  }),
)
