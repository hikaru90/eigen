import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreflightError } from '../harness/preflight'
import { preparedFilename } from './load-dataset'
import {
  livePreflightProblems,
  PREFLIGHT_MARGIN,
  staticPreflightProblems,
  type LiveChecks,
} from './preflight'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pm-preflight-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('staticPreflightProblems', () => {
  const env = { DATABASE_URL: 'postgres://x' }

  it('is clean with the prepared data, a database URL and a writable run directory', () => {
    writeFileSync(join(dir, preparedFilename('val')), '{}\n')
    expect(
      staticPreflightProblems({ dataDir: dir, split: 'val', runDir: join(dir, 'runs', 'r1'), env }),
    ).toEqual([])
  })

  it('reports every missing prerequisite at once', () => {
    const problems = staticPreflightProblems({
      dataDir: dir,
      split: 'val',
      runDir: '/dev/null/nope/r1',
      env: {},
    })
    expect(problems).toHaveLength(3)
    expect(problems.join('\n')).toMatch(/personamem\.val\.jsonl is missing/)
    expect(problems.join('\n')).toMatch(/DATABASE_URL/)
    expect(problems.join('\n')).toMatch(/not writable/)
  })
})

describe('livePreflightProblems', () => {
  const okChecks = (): LiveChecks => ({
    checkDatabase: vi.fn(async () => []),
    fetchKeyInfo: vi.fn(async () => ({ limit: 100, limitRemaining: 90, usage: 10 })),
    walletCredits: vi.fn(async () => 500_000),
  })
  const run = (checks: LiveChecks, estimateUsd = 2) =>
    livePreflightProblems({ estimateUsd, checks, creditsFor: (usd) => usd * 1.2 * 1000 })

  it('is clean when the database is ready and both the key and the wallet cover the run', async () => {
    expect(await run(okChecks())).toEqual([])
  })

  it('uses the estimate plus the margin for the credit checks', async () => {
    const checks = okChecks()
    checks.fetchKeyInfo = vi.fn(async () => ({
      limit: 10,
      limitRemaining: 2 * PREFLIGHT_MARGIN - 0.01,
      usage: 0,
    }))
    const problems = await run(checks, 2)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/OpenRouter key has \$2\.99 left.*needs about \$3\.00/)
  })

  it('reports an unreachable database and skips the wallet check that depends on it', async () => {
    const checks = okChecks()
    checks.checkDatabase = vi.fn(async () => ['database is not reachable: ECONNREFUSED'])
    const problems = await run(checks)
    expect(problems).toEqual(['database is not reachable: ECONNREFUSED'])
    expect(checks.walletCredits).not.toHaveBeenCalled()
  })

  it('reports pending migrations', async () => {
    const checks = okChecks()
    checks.checkDatabase = vi.fn(async () => [
      'migrations not applied: 0083_note_passage (run npm run db:migrate)',
    ])
    expect((await run(checks))[0]).toMatch(/migrations not applied: 0083_note_passage/)
  })

  it('reports an OpenRouter key with too little credit, an unlimited key, and a request that failed', async () => {
    const low = okChecks()
    low.fetchKeyInfo = vi.fn(async () => ({ limit: 5, limitRemaining: 0.5, usage: 4.5 }))
    expect((await run(low))[0]).toMatch(/\$0\.50 left/)

    const unlimited = okChecks()
    unlimited.fetchKeyInfo = vi.fn(async () => ({ limit: null, limitRemaining: null, usage: 4.5 }))
    expect((await run(unlimited))[0]).toMatch(/no credit limit/)

    const broken = okChecks()
    broken.fetchKeyInfo = vi.fn(async () => {
      throw new Error('[eval] OpenRouter GET https://x/key failed with HTTP 401')
    })
    expect((await run(broken))[0]).toMatch(/HTTP 401/)
  })

  it('reports a harness wallet that cannot cover the run', async () => {
    const checks = okChecks()
    checks.walletCredits = vi.fn(async () => 10)
    expect((await run(checks))[0]).toMatch(/harness wallet has 10 credits/)
  })

  it('collects the OpenRouter and wallet problems together', async () => {
    const checks = okChecks()
    checks.fetchKeyInfo = vi.fn(async () => ({ limit: 5, limitRemaining: 0, usage: 5 }))
    checks.walletCredits = vi.fn(async () => 1)
    expect(await run(checks)).toHaveLength(2)
  })

  it('PreflightError lists all of them (what the run prints before exiting)', () => {
    expect(new PreflightError(['a', 'b']).message).toMatch(/- a\n- b/)
  })
})
