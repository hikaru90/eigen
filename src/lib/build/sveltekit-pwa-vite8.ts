import type { Plugin, ResolvedConfig } from 'vite';
import { copyFile, mkdir, rename, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

type SvelteKitPwaOptions = NonNullable<Parameters<typeof SvelteKitPWA>[0]>;

async function isFile(path: string): Promise<boolean> {
	try {
		const stats = await lstat(path);
		return stats.isFile();
	} catch {
		return false;
	}
}

/**
 * Vite 8 can run @vite-pwa/sveltekit's SSR `closeBundle` (enforce: pre) before
 * SvelteKit `writeBundle` emits `service-worker.js`. Run injectManifest in a
 * post-order closeBundle instead, after SvelteKit's writeBundle hook.
 */
function createSvelteKitBuildPlugin(
	options: SvelteKitPwaOptions,
	apiResolver: () => { disabled?: boolean } | undefined
): Plugin {
	let viteConfig: ResolvedConfig;

	return {
		name: 'vite-plugin-pwa:sveltekit:build',
		apply: 'build',
		enforce: 'pre',
		configResolved(config) {
			viteConfig = config;
		},
		async generateBundle(_, bundle) {
			if (viteConfig.build.ssr) return;
			const api = apiResolver();
			if (!api) return;
			const assetsGenerator = await api.pwaAssetsGenerator?.();
			if (assetsGenerator) assetsGenerator.injectManifestIcons();
			api.generateBundle?.(bundle, this);
		},
		writeBundle: {
			sequential: true,
			enforce: 'pre',
			async handler() {
				const api = apiResolver();
				if (!api || viteConfig.build.ssr) return;
				const assetsGenerator = await api.pwaAssetsGenerator?.();
				if (assetsGenerator) await assetsGenerator.generate();
			}
		},
		closeBundle: {
			sequential: true,
			order: 'post',
			async handler() {
				const api = apiResolver();
				if (!api || api.disabled || !viteConfig.build.ssr) return;
				if (options.strategies !== 'injectManifest') return;

				const injectionPoint =
					!options.injectManifest ||
					!('injectionPoint' in options.injectManifest) ||
					!!options.injectManifest.injectionPoint;

				// No Workbox manifest injection — SvelteKit builds service-worker.js in its
				// async writeBundle handler; closeBundle can run before that finishes on Vite 8.
				if (!injectionPoint) return;

				let swName = options.filename ?? 'sw.js';
				const outDir = options.outDir ?? `${viteConfig.root}/.svelte-kit/output`;
				const clientOutputDir = join(outDir, 'client');
				await mkdir(clientOutputDir, { recursive: true });

				const swSrc = join(clientOutputDir, 'service-worker.js').replace(/\\/g, '/');
				if (!(await isFile(swSrc))) {
					throw new Error(
						`Expected SvelteKit to emit ${swSrc} before PWA injectManifest. ` +
							'Check src/service-worker.ts and kit.serviceWorker config.'
					);
				}

				if (swName.endsWith('.ts')) swName = swName.replace(/\.ts$/, '.js');

				const injectManifestOptions = {
					globDirectory: outDir.replace(/\\/g, '/'),
					...options.injectManifest,
					swSrc,
					swDest: swSrc
				};
				const { injectManifest } = await import('workbox-build');
				await injectManifest(injectManifestOptions);

				const deployedSwName = swName.endsWith('.ts') ? 'service-worker.js' : swName;
				const deployedClientDir = join(viteConfig.root, 'build', 'client');
				await mkdir(deployedClientDir, { recursive: true });
				await copyFile(swSrc, join(deployedClientDir, deployedSwName));

				if (swName !== 'service-worker.js') {
					await rename(
						join(clientOutputDir, 'service-worker.js').replace(/\\/g, '/'),
						join(clientOutputDir, swName).replace(/\\/g, '/')
					);
				}
			}
		}
	};
}

export function svelteKitPwaForVite8(userOptions: SvelteKitPwaOptions = {}) {
	const plugins = SvelteKitPWA(userOptions);
	const pwaPlugin = plugins.find(
		(p) => p && typeof p === 'object' && 'name' in p && p.name === 'vite-plugin-pwa'
	);
	const resolveApi = () =>
		pwaPlugin && 'api' in pwaPlugin
			? (pwaPlugin as { api?: { disabled?: boolean } }).api
			: undefined;

	return [
		...plugins.filter(
			(p) => p && typeof p === 'object' && 'name' in p && p.name !== 'vite-plugin-pwa:sveltekit:build'
		),
		createSvelteKitBuildPlugin(userOptions, resolveApi)
	];
}
