import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * Browser-mode Vitest for `*.svelte.spec.ts` (component tests).
 * Kept separate from `vitest.config.ts` / `test:unit` so node unit stays fast
 * and browser Playwright setup does not slow the merge-gate unit job.
 *
 * Uses `svelte()` (not full `sveltekit()` + PWA) so dep optimization stays
 * scoped to component specs. Specs that need `$app/*` mock those modules.
 *
 * Before running, `npm run test:components` applies
 * `scripts/patch-vitest-browser-iframeid.mjs` so paths containing `+` work.
 */
export default defineConfig({
  plugins: [
    // Tailwind is omitted here: bits-ui virtual `<style>` modules conflict with
    // `@tailwindcss/vite` in browser mode. Component specs assert behavior, not CSS.
    svelte({
      // `*.svelte.spec.ts` matches the default `.svelte.` module infix and would be
      // incorrectly compiled as Svelte modules (tests never collect in the browser).
      experimental: {
        compileModule: {
          exclude: [
            '**/*.svelte.spec.ts',
            '**/*.svelte.spec.js',
            '**/*.svelte.test.ts',
            '**/*.svelte.test.js',
          ],
        },
      },
    }),
    paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' }),
  ],
  resolve: {
    alias: {
      $lib: path.resolve(root, 'src/lib'),
      $app: path.resolve(root, 'src/lib/vitest-stubs/app'),
      '$env/static/public': path.resolve(root, 'src/lib/vitest-stubs/env/static/public.ts'),
      // PWA plugin is not loaded in this lean browser config.
      'virtual:pwa-register': path.resolve(root, 'src/lib/vitest-stubs/virtual-pwa-register.ts'),
    },
  },
  // Avoid holding browser module requests behind a full-app dep crawl.
  optimizeDeps: {
    noDiscovery: true,
    holdUntilCrawlEnd: false,
    exclude: ['vitest-browser-svelte', '@testing-library/svelte-core', 'svelte'],
  },
  test: {
    name: 'components',
    expect: { requireAssertions: true },
    setupFiles: ['vitest-browser-svelte'],
    // Component specs join this job as `$app/*` stubs and locator coverage
    // land for them (`src/lib/vitest-stubs/app/*`).
    include: [
      'src/lib/components/smoke.svelte.spec.ts',
      'src/lib/components/capture-onboarding-overlay.svelte.spec.ts',
    ],
    exclude: ['src/routes/demo/playwright/**/*.ts', '**/*.e2e.ts'],
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
