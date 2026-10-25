import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFixtureDataDir } from './test-fixtures'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

/**
 * Launches the real CLI through vite-node. vite-node closes its module server as soon as the
 * entry module finishes evaluating, so a run.ts that does not await main() cannot load the
 * live path (a dynamic import) afterwards. The gateway env is blanked so the run stops at the
 * public-bench config check, before any database query or LLM call.
 */
describe('personamem CLI launch', () => {
  it('loads the live path through vite-node and stops at the gateway env check', () => {
    const dataDir = writeFixtureDataDir()
    const prepare = spawnSync(
      'python3',
      ['-I', resolve(import.meta.dirname, 'prepare.py'), '--data-dir', dataDir],
      { encoding: 'utf8' },
    )
    if (prepare.status !== 0) throw new Error(prepare.stderr)

    const res = spawnSync(
      'npx',
      [
        'vite-node',
        '--config',
        'evals/vite.config.ts',
        'evals/personamem/run.ts',
        '--data-dir',
        dataDir,
        '--persona-ids',
        '7',
        '--chat-model',
        'openai/gpt-4o-mini',
        '--tenant-concurrency',
        '1',
        '--enrich-concurrency',
        '1',
        '--answer',
        'compose',
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, OPENROUTER_BASE_URL: '', SERVICE_API_KEY_OPENROUTER: '' },
        encoding: 'utf8',
        timeout: 120_000,
      },
    )
    const output = `${res.stdout}\n${res.stderr}`

    expect(output).not.toContain('server is being restarted or closed')
    expect(output).toContain('[public-bench] invalid configuration')
    expect(output).toContain('OPENROUTER_BASE_URL is required and missing')
    expect(res.status).toBe(1)
  }, 120_000)
})
