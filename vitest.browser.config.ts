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
      // Must precede the general `$lib` prefix alias so this module resolves to the
      // stub instead of the real posthog-js client (see stub header).
      '$lib/analytics/posthog-client': path.resolve(
        root,
        'src/lib/vitest-stubs/analytics/posthog-client.ts',
      ),
      $lib: path.resolve(root, 'src/lib'),
      $app: path.resolve(root, 'src/lib/vitest-stubs/app'),
      '$env/static/public': path.resolve(root, 'src/lib/vitest-stubs/env/static/public.ts'),
      // PWA plugin is not loaded in this lean browser config.
      'virtual:pwa-register': path.resolve(root, 'src/lib/vitest-stubs/virtual-pwa-register.ts'),
      // SvelteKit modules cannot be vi.mock'ed reliably in browser mode; specs that
      // render real components get the per-module stubs under vitest-stubs/app instead.
      '$app/environment': path.resolve(root, 'src/lib/vitest-stubs/app/environment.ts'),
      '$app/paths': path.resolve(root, 'src/lib/vitest-stubs/app/paths.ts'),
      '$app/forms': path.resolve(root, 'src/lib/vitest-stubs/app/forms.ts'),
      '$app/navigation': path.resolve(root, 'src/lib/vitest-stubs/app/navigation.ts'),
      '$app/state': path.resolve(root, 'src/lib/vitest-stubs/app/state.ts'),
      '$env/static/public': path.resolve(root, 'src/lib/vitest-stubs/app-modules.js'),
    },
  },
  // Avoid holding browser module requests behind a full-app dep crawl.
  optimizeDeps: {
    noDiscovery: true,
    holdUntilCrawlEnd: false,
    exclude: ['vitest-browser-svelte', '@testing-library/svelte-core', 'svelte'],
  },
  server: {
    fs: {
      // Allow serving a symlinked node_modules: git worktrees often symlink it
      // to the main checkout, which sits outside this config's workspace root.
      allow: [root, path.dirname(path.resolve(root))],
    },
  },
  test: {
    name: 'components',
    expect: { requireAssertions: true },
    setupFiles: ['vitest-browser-svelte'],
    // Phase 4 merge gate: smoke + component specs that run under the stub
    // aliases above. Component specs join this job as `$app/*` stubs and
    // locator coverage land for them (`src/lib/vitest-stubs/app/*`).
    include: [
      'src/lib/components/smoke.svelte.spec.ts',
      'src/lib/components/capture-onboarding-overlay.svelte.spec.ts',
      'src/lib/components/capture-reading.svelte.spec.ts',
      'src/lib/components/brand/glyph-scramble.svelte.spec.ts',
      'src/lib/components/capture-kept.svelte.spec.ts',
      'src/lib/components/capture-vote.svelte.spec.ts',
      'src/lib/components/check-in-question.svelte.spec.ts',
      'src/lib/components/chrome/view-select.svelte.spec.ts',
      'src/lib/components/chrome/you-menu.svelte.spec.ts',
      'src/lib/components/eigen-wordmark.svelte.spec.ts',
      'src/lib/components/chat-memory-reference-card.svelte.spec.ts',
      'src/lib/components/chat-timeline-step.svelte.spec.ts',
      'src/lib/components/voice-input-button.svelte.spec.ts',
      'src/lib/components/voice-message-bar.svelte.spec.ts',
      'src/lib/components/writer/glass-writer.svelte.spec.ts',
      'src/lib/feedback/board-empty.svelte.spec.ts',
      'src/lib/feedback/board-row.svelte.spec.ts',
      'src/lib/components/ui/button/button.svelte.spec.ts',
      'src/lib/feedback/share-composer.svelte.spec.ts',
      'src/lib/components/mesh/thought-inline-editor.svelte.spec.ts',
      'src/lib/components/mesh/thought-row.svelte.spec.ts',
      'src/lib/components/thought-thread-menu.svelte.spec.ts',
      'src/lib/components/ui/overlay-scroll.svelte.spec.ts',
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
