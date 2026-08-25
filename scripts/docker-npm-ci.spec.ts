import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf-8')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
	scripts: { prepare?: string }
}

describe('Docker npm ci vs prepare', () => {
	it('runs npm ci with --ignore-scripts before source is copied (prepare needs project.inlang + scripts)', () => {
		const npmCiLines = dockerfile
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.startsWith('RUN npm ci'))

		expect(npmCiLines.length).toBeGreaterThanOrEqual(2)
		for (const line of npmCiLines) {
			expect(
				line,
				`Dockerfile must use npm ci --ignore-scripts so prepare does not run with only package*.json: ${line}`,
			).toMatch(/npm ci --ignore-scripts\b/)
		}
	})

	it('delegates prepare to a script that can skip missing docker-stage files', () => {
		expect(packageJson.scripts.prepare).toBe('node scripts/npm-prepare.mjs')
	})
})
