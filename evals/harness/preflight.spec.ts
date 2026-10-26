import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  caffeinateAdvice,
  fetchOpenRouterKeyInfo,
  missingFilesProblems,
  openRouterCreditProblem,
  parseOpenRouterKeyInfo,
  PreflightError,
  pendingMigrationTags,
  isUnderCaffeinate,
  requiredUsd,
  runDirProblems,
  throwIfProblems,
  walletProblem,
} from './preflight'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'preflight-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('throwIfProblems', () => {
  it('passes with no problems and otherwise lists every one of them', () => {
    expect(() => throwIfProblems([])).not.toThrow()
    try {
      throwIfProblems(['DB unreachable', 'no credit'])
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError)
      expect((err as Error).message).toContain('DB unreachable')
      expect((err as Error).message).toContain('no credit')
      expect((err as PreflightError).problems).toHaveLength(2)
    }
  })
})

describe('run directory', () => {
  it('is fine when it can be created and written', () => {
    expect(runDirProblems(join(dir, 'runs', 'r1'))).toEqual([])
  })

  it('names the directory when it cannot be written', () => {
    const problems = runDirProblems('/dev/null/not-a-dir/r1')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/run directory \/dev\/null\/not-a-dir\/r1 is not writable/)
  })
})

describe('data files', () => {
  it('reports each missing file with its label', () => {
    const exists = (p: string) => p === '/data/a.jsonl'
    expect(
      missingFilesProblems('PersonaMem data', ['/data/a.jsonl', '/data/b.json'], exists),
    ).toEqual(['PersonaMem data: /data/b.json is missing'])
    expect(missingFilesProblems('x', ['/data/a.jsonl'], exists)).toEqual([])
  })
})

describe('OpenRouter credit', () => {
  const info = (limitRemaining: number | null) => ({ limit: 20, limitRemaining, usage: 1 })

  it('parses the documented /key response', () => {
    expect(
      parseOpenRouterKeyInfo({
        data: { label: 'k', limit: 20, limit_remaining: 18.5, usage: 1.5 },
      }),
    ).toEqual({ limit: 20, limitRemaining: 18.5, usage: 1.5 })
    expect(
      parseOpenRouterKeyInfo({ data: { limit: null, limit_remaining: null, usage: 0 } }),
    ).toEqual({
      limit: null,
      limitRemaining: null,
      usage: 0,
    })
  })

  it('rejects a response without a data object or with a non-numeric usage', () => {
    expect(() => parseOpenRouterKeyInfo({})).toThrow(/data/)
    expect(() =>
      parseOpenRouterKeyInfo({ data: { limit: 1, limit_remaining: 1, usage: 'x' } }),
    ).toThrow(/usage/)
  })

  it('is fine when the remaining credit covers the run', () => {
    expect(openRouterCreditProblem(info(10), 4)).toBeNull()
  })

  it('names remaining and required USD when it does not', () => {
    expect(openRouterCreditProblem(info(1.25), 4)).toMatch(/\$1\.25.*\$4\.00/s)
  })

  it('cannot verify a key without a credit limit and says how to fix that', () => {
    expect(openRouterCreditProblem(info(null), 4)).toMatch(/no credit limit.*set a limit/is)
  })

  it('requests GET <base>/key with the bearer key and returns the parsed info', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { limit: 5, limit_remaining: 4, usage: 1 } }), {
          status: 200,
        }),
    )
    const result = await fetchOpenRouterKeyInfo({
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-or-secret',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(result).toEqual({ limit: 5, limitRemaining: 4, usage: 1 })
    expect(fetchFn).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk-or-secret' },
    })
  })

  it('a failing request names the status and never the key', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }))
    await expect(
      fetchOpenRouterKeyInfo({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-secret',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/401/)
    await expect(
      fetchOpenRouterKeyInfo({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-secret',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.not.toThrow(/sk-or-secret/)
  })
})

describe('estimate and wallet', () => {
  it('adds the margin to the estimate', () => {
    expect(requiredUsd(2, 1.5)).toBe(3)
  })

  it('the wallet must cover the required credits', () => {
    expect(walletProblem({ availableCredits: 5000, requiredCredits: 3000 })).toBeNull()
    expect(walletProblem({ availableCredits: 100, requiredCredits: 3000 })).toMatch(/100.*3,?000/s)
  })
})

describe('migrations', () => {
  it('lists journal migrations whose hash the database has not recorded', () => {
    const sql: Record<string, string> = { '0001_a': 'create a', '0002_b': 'create b' }
    const hashOf = (text: string) => `h:${text}`
    expect(
      pendingMigrationTags({
        journalTags: ['0001_a', '0002_b'],
        readSql: (tag) => sql[tag]!,
        hashOf,
        appliedHashes: new Set(['h:create a']),
      }),
    ).toEqual(['0002_b'])
    expect(
      pendingMigrationTags({
        journalTags: ['0001_a'],
        readSql: (tag) => sql[tag]!,
        hashOf,
        appliedHashes: new Set(['h:create a']),
      }),
    ).toEqual([])
  })
})

describe('caffeinate', () => {
  const chain = (commands: string[]) => (pid: number) => {
    const i = pid - 100
    return i < commands.length ? { ppid: pid + 1, command: commands[i]! } : null
  }

  it('recognises caffeinate among the ancestors on macOS', () => {
    expect(
      isUnderCaffeinate({
        platform: 'darwin',
        pid: 100,
        parentOf: chain(['node', 'npm', '/usr/bin/caffeinate', 'zsh']),
      }),
    ).toBe(true)
    expect(
      isUnderCaffeinate({ platform: 'darwin', pid: 100, parentOf: chain(['node', 'npm', 'zsh']) }),
    ).toBe(false)
  })

  it('does not apply off macOS', () => {
    expect(isUnderCaffeinate({ platform: 'linux', pid: 100, parentOf: chain(['node']) })).toBe(true)
  })

  it('advice prints the exact command to use', () => {
    expect(caffeinateAdvice('npm run eval:personamem -- --run-id r1 --resume')).toBe(
      'caffeinate -i npm run eval:personamem -- --run-id r1 --resume',
    )
  })
})
