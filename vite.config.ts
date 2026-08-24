import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { svelteKitPwaForVite8 } from './src/lib/build/sveltekit-pwa-vite8'

/** Watch / file-scoped re-runs only instrument a subset; thresholds would false-fail. */
const enforceCoverageThresholds = process.env.CI === 'true' || process.argv.includes('run')

export default defineConfig({
  build: {
    // Hidden maps: uploaded to PostHog for error tracking, not served to browsers.
    sourcemap: 'hidden',
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === 'CIRCULAR_DEPENDENCY' &&
          /node_modules\/(drizzle-orm|kysely|zod|@better-auth)\b/.test(warning.message)
        ) {
          return
        }
        warn(warning)
      },
    },
  },
  plugins: [
    tailwindcss(),
    sveltekit(),
    svelteKitPwaForVite8({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.ts',
      registerType: 'autoUpdate',
      manifest: false,
      injectManifest: {
        // No Workbox precache in the SW — push + capture queue only. Avoids __WB_MANIFEST deploy bugs.
        injectionPoint: undefined,
        globPatterns: [],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
    paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' }),
  ],
  test: {
    expect: { requireAssertions: true },
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}', 'evals/harness/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,svelte}'],
      exclude: [
        'src/lib/paraglide/**',
        'src/lib/components/ui/**/index.ts',
        'src/lib/components/**/*.svelte',
        'src/app.d.ts',
        'src/hooks.ts',
        'src/hooks.server.ts',
        'src/lib/index.ts',
        'src/lib/utils.ts',
        'src/lib/eval/**',
        'src/lib/push/client.ts',
        'src/lib/capture/queue/**',
        'src/lib/stores/**',
        'src/lib/server/db/auth.schema.ts',
        'src/lib/server/db/brain.schema.ts',
        'src/lib/server/consolidation/**',
        'src/lib/server/ontology/**',
        'src/lib/server/ontology-db/**',
        'src/lib/server/api-keys/**',
        'src/lib/server/graph/**',
        'src/lib/server/llm/embedding-compress/index.ts',
        'src/lib/server/llm/embedding-compress/types.ts',
        'src/lib/server/llm/embedding-compress/tokenize.ts',
        'src/lib/server/llm/types.ts',
        'src/lib/vitest-examples/**',
        'src/routes/**/+page.server.ts',
        'src/routes/**/*.svelte',
        'src/routes/+layout.server.ts',
        'src/routes/demo/**',
        'src/routes/e2e/**',
        'src/routes/api/e2e/**',
        'src/routes/api/eval/**',
        'src/routes/api/admin/**',
        'src/routes/api/keys/**',
        'src/routes/api/chat/sessions/**',
        'src/routes/graph/**',
        'src/service-worker.ts',
        '**/*.e2e.ts',
        '**/*.config.*',
      ],
      ...(enforceCoverageThresholds
        ? {
            thresholds: {
              // Product target remains 95% (docs/planning/03-guardrails-quality-gates.md).
              // These floors are ratcheted to current measured coverage so
              // `npm run test:coverage` fails on regressions; raise toward 95% as
              // more critical-path specs land, then make CI coverage merge-blocking.
              'src/lib/server/{capture,retrieval,llm,pricing,validation,observability,memory,ingest,activity}/**':
                {
                  lines: 89,
                  branches: 77,
                  functions: 90,
                  statements: 87,
                },
              'src/lib/server/db/**': {
                lines: 80,
                branches: 74,
                functions: 80,
                statements: 80,
              },
              'src/lib/server/auth.ts': {
                lines: 80,
                branches: 80,
                functions: 80,
                statements: 80,
              },
              'src/lib/server/auth-form-errors.ts': {
                lines: 80,
                branches: 80,
                functions: 80,
                statements: 80,
              },
              'src/routes/**/+server.ts': {
                lines: 80,
                branches: 65,
                functions: 77,
                statements: 80,
              },
            },
          }
        : {}),
    },
  },
})
