#!/usr/bin/env node
/**
 * npm `prepare` lifecycle: sync SvelteKit, compile Paraglide, install git hooks.
 * Must succeed when only package*.json is present (Docker deps/runner stages) —
 * skip each step whose inputs are missing instead of failing npm ci.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * @typedef {{ root: string, run?: (command: string, args: string[], cwd: string) => void }} NpmPrepareOptions
 * @typedef {{ svelteKitSync: 'ran' | 'skipped', paraglide: 'ran' | 'skipped', gitHooks: 'ran' | 'skipped' }} NpmPrepareResult
 */

/**
 * @param {NpmPrepareOptions} options
 * @returns {NpmPrepareResult}
 */
export function runNpmPrepare(options) {
	const root = options.root
	const run =
		options.run ??
		((command, args, cwd) => {
			const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
			if (result.status !== 0) {
				throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? 'null'}`)
			}
		})

	/** @type {NpmPrepareResult} */
	const result = {
		svelteKitSync: 'skipped',
		paraglide: 'skipped',
		gitHooks: 'skipped',
	}

	const hasSvelteConfig =
		existsSync(join(root, 'svelte.config.js')) ||
		existsSync(join(root, 'svelte.config.ts')) ||
		existsSync(join(root, 'svelte.config.mjs'))

	if (hasSvelteConfig) {
		run('npx', ['svelte-kit', 'sync'], root)
		result.svelteKitSync = 'ran'
	}

	const inlangSettings = join(root, 'project.inlang', 'settings.json')
	if (existsSync(inlangSettings)) {
		run(
			'npx',
			[
				'@inlang/paraglide-js',
				'compile',
				'--project',
				'./project.inlang',
				'--outdir',
				'./src/lib/paraglide',
			],
			root,
		)
		result.paraglide = 'ran'
	}

	const hooksInstaller = join(root, 'scripts', 'install-git-hooks.mjs')
	if (existsSync(hooksInstaller) && existsSync(join(root, '.git'))) {
		run('node', ['scripts/install-git-hooks.mjs'], root)
		result.gitHooks = 'ran'
	}

	return result
}

const isMain =
	process.argv[1] &&
	(process.argv[1].endsWith('npm-prepare.mjs') || process.argv[1].includes('npm-prepare'))

if (isMain) {
	const root = join(dirname(fileURLToPath(import.meta.url)), '..')
	runNpmPrepare({ root })
}
