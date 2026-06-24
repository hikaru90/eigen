import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			environment: 'node',
			include: [
				'src/**/*.{test,spec}.{js,ts}',
				'evals/harness/**/*.{test,spec}.{js,ts}',
				'evals/graph-scale/**/*.{test,spec}.{js,ts}',
				'scripts/**/*.{test,spec}.{js,ts}'
			],
			exclude: ['src/routes/demo/playwright/**/*.ts', '**/*.e2e.ts', '**/*.svelte.spec.ts'],
			globalTeardown: ['./vitest.global-teardown.ts']
		}
	})
);
