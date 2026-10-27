import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

/**
 * Launches the real CLI through vite-node (the way `npm run jev:check` does) in dry-run mode:
 * no config is read and no call is made. It proves the entry module loads under the eval vite
 * config and stays alive for the whole run (vite-node closes its server when the entry settles).
 */
describe('jev:check CLI launch', () => {
  it('prints the built requests in --dry-run and exits 0', () => {
    const res = spawnSync(
      'npx',
      [
        'vite-node',
        '--config',
        'evals/vite.config.ts',
        'evals/jev-check/run.ts',
        '--dry-run',
        '--case',
        'a01-clean-task-en',
        '--case',
        'r01-category-idea',
      ],
      {
        cwd: REPO_ROOT,
        // Blank, so even a CLI that wrongly read the config could not reach a model.
        env: {
          ...process.env,
          DECISION_SHADOW_ENABLED: '',
          OPENROUTER_API_KEY: '',
          DECISION_SHADOW_MODEL: '',
        },
        encoding: 'utf8',
        timeout: 120_000,
      },
    )
    const output = `${res.stdout}\n${res.stderr}`

    expect(output).not.toContain('server is being restarted or closed')
    expect(res.stdout).toContain('a01-clean-task-en')
    expect(res.stdout).toContain('r01-category-idea')
    expect(res.stdout).toContain('Captured on Tuesday 27 October 2026 at 10:00 (Europe/Berlin).')
    expect(res.stdout).toContain('"reason"')
    expect(res.status).toBe(0)
  }, 120_000)
})
