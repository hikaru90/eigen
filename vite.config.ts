import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

/** Watch / file-scoped re-runs only instrument a subset; thresholds would false-fail. */
const enforceCoverageThresholds =
	process.env.CI === 'true' || process.argv.includes('run');

export default defineConfig({
	server: {
		watch: {
			// Autosave writes this during logo editing; watching it reloads the page every 5s.
			ignored: ['**/data/logo-dot-current.json']
		}
	},
	build: {
		rollupOptions: {
			onwarn(warning, warn) {
				if (
					warning.code === 'CIRCULAR_DEPENDENCY' &&
					/node_modules\/(drizzle-orm|kysely|zod|@better-auth)\b/.test(warning.message)
				) {
					return;
				}
				warn(warning);
			}
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'service-worker.ts',
			registerType: 'autoUpdate',
			manifest: false,
			injectManifest: {
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,webmanifest}']
			},
			devOptions: {
				enabled: true,
				type: 'module'
			}
		}),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })
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
				'src/lib/server/db/auth.schema.ts',
				'src/lib/server/db/brain.schema.ts',
				'src/lib/vitest-examples/**',
				'src/routes/**/+page.server.ts',
				'src/routes/**/*.svelte',
				'src/routes/+layout.server.ts',
				'src/routes/demo/**',
				'**/*.e2e.ts',
				'**/*.config.*'
			],
			...(enforceCoverageThresholds
				? {
						thresholds: {
							'src/lib/server/{capture,retrieval,llm,pricing,validation,observability,memory,ingest,activity,qa}/**': {
								lines: 95,
								branches: 95,
								functions: 95,
								statements: 95
							},
							'src/lib/**': {
								lines: 80,
								branches: 80,
								functions: 80,
								statements: 80
							},
							'src/routes/**': {
								lines: 80,
								branches: 80,
								functions: 80,
								statements: 80
							}
						}
					}
				: {})
		}
	}
});
