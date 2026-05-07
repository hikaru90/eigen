import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	optimizeDeps: {
		exclude: ['@remotion/whisper-web']
	},
	server: {
		headers: {
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Opener-Policy': 'same-origin'
		}
	},
	preview: {
		headers: {
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Opener-Policy': 'same-origin'
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })
	],
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'json-summary', 'lcov'],
			include: ['src/**/*.{ts,svelte}'],
			exclude: [
				'src/lib/paraglide/**',
				'src/lib/components/ui/**/index.ts',
				'src/app.d.ts',
				'src/lib/server/db/auth.schema.ts',
				'src/lib/vitest-examples/**',
				'src/routes/demo/**',
				'**/*.config.*'
			],
			thresholds: {
				'src/lib/server/{capture,retrieval,llm,pricing,validation,observability,memory,ingest,activity}/**': {
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
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
