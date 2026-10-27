import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

function launch(args: string[]) {
  return spawnSync(
    'npx',
    ['vite-node', '--config', 'evals/vite.config.ts', 'evals/capture-review/verify.ts', ...args],
    {
      cwd: REPO_ROOT,
      // Blank, so even an entry that wrongly went live could not reach a database or a model.
      env: {
        ...process.env,
        DATABASE_URL: '',
        DECISION_SHADOW_ENABLED: '',
        OPENROUTER_API_KEY: '',
        SERVICE_API_KEY_OPENROUTER: '',
      },
      encoding: 'utf8',
      timeout: 120_000,
    },
  )
}

/**
 * Launches the real entry through vite-node (the way `npm run capture-review:verify` does) with
 * --help or a bad flag: nothing live runs. It proves the entry loads under the eval vite config and
 * that the database modules are only loaded for a real run.
 */
describe('capture-review:verify launch', () => {
  it('prints the usage for --help and exits 0 without touching the database', () => {
    const res = launch(['--help'])
    const output = `${res.stdout}\n${res.stderr}`

    expect(output).not.toContain('server is being restarted or closed')
    expect(res.stdout).toContain('npm run capture-review:verify')
    expect(res.stdout).toContain('--keep')
    expect(res.status).toBe(0)
  }, 120_000)

  it('rejects an unknown flag with the usage and exit code 2', () => {
    const res = launch(['--bogus'])

    expect(res.stderr).toContain('unknown argument "--bogus"')
    expect(res.stderr).toContain('npm run capture-review:verify')
    expect(res.status).toBe(2)
  }, 120_000)
})
