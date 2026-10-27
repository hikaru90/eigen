import type { Decide } from './check'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCaptureAuditRequest } from '$lib/server/capture-review/audit-questions'
import { buildCaptureReasonRequest } from '$lib/server/capture-review/reason-question'
import type { DecisionRequest, DecisionResponse } from '$lib/server/llm/decision-client'
import {
  JEV_CHECK_USAGE,
  JevCheckUsageError,
  parseJevCheckArgs,
  resolveLiveDecide,
  runJevCheck,
  type JevCheckDeps,
} from './cli'
import { FIXTURES_DIR, loadFixtureFiles } from './fixtures'

describe('parseJevCheckArgs', () => {
  it('defaults to everything, live, no help', () => {
    expect(parseJevCheckArgs([])).toEqual({ kind: null, caseIds: [], dryRun: false, help: false })
  })

  it('reads --kind, repeated --case and --dry-run', () => {
    expect(
      parseJevCheckArgs(['--kind', 'capture_audit', '--case', 'a01', '--case', 'a02', '--dry-run']),
    ).toEqual({ kind: 'capture_audit', caseIds: ['a01', 'a02'], dryRun: true, help: false })
  })

  it('reads --help and -h', () => {
    expect(parseJevCheckArgs(['--help']).help).toBe(true)
    expect(parseJevCheckArgs(['-h']).help).toBe(true)
  })

  it('rejects an unknown kind', () => {
    expect(() => parseJevCheckArgs(['--kind', 'capture_other'])).toThrow(JevCheckUsageError)
    expect(() => parseJevCheckArgs(['--kind', 'capture_other'])).toThrow(
      '--kind must be capture_audit or capture_reason, got "capture_other"',
    )
  })

  it('rejects a flag without its value', () => {
    expect(() => parseJevCheckArgs(['--case'])).toThrow('--case needs a value')
    expect(() => parseJevCheckArgs(['--kind', '--dry-run'])).toThrow('--kind needs a value')
  })

  it('rejects unknown flags and positional arguments', () => {
    expect(() => parseJevCheckArgs(['--nope'])).toThrow('unknown argument "--nope"')
    expect(() => parseJevCheckArgs(['a01'])).toThrow('unknown argument "a01"')
  })

  it('rejects --kind given twice', () => {
    expect(() =>
      parseJevCheckArgs(['--kind', 'capture_audit', '--kind', 'capture_reason']),
    ).toThrow('--kind given more than once')
  })

  it('rejects the same --case twice', () => {
    expect(() => parseJevCheckArgs(['--case', 'a01', '--case', 'a01'])).toThrow(
      '--case "a01" given more than once',
    )
  })
})

describe('resolveLiveDecide', () => {
  it('fails loud when the decision model is not enabled, naming every env var', () => {
    expect(() => resolveLiveDecide({})).toThrow(
      /DECISION_SHADOW_ENABLED.*OPENROUTER_API_KEY.*DECISION_SHADOW_MODEL/s,
    )
    expect(() => resolveLiveDecide({ DECISION_SHADOW_ENABLED: 'false' })).toThrow(
      /DECISION_SHADOW_ENABLED/,
    )
  })

  it('fails loud when enabled but incomplete, naming what is missing', () => {
    expect(() =>
      resolveLiveDecide({ DECISION_SHADOW_ENABLED: 'true', OPENROUTER_API_KEY: 'k' }),
    ).toThrow(/DECISION_SHADOW_MODEL/)
  })

  it('returns a function when fully configured, without calling anything', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const decide = resolveLiveDecide({
      DECISION_SHADOW_ENABLED: 'true',
      OPENROUTER_API_KEY: 'k',
      DECISION_SHADOW_MODEL: 'typesafe/jev-test',
    })
    expect(typeof decide).toBe('function')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('posts exactly the built request, with the configured model and key, to the Decisions API', async () => {
    const request = buildCaptureReasonRequest({
      rawText: 'Idea: maps',
      storedSummary: 'Saved as a task',
      reason: 'this is an idea',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const labels = Object.keys(request.questions.reason.criteria)
      return new Response(
        JSON.stringify({
          model: 'typesafe/jev-test',
          answers: {
            reason: {
              type: 'choice',
              choice: 'wrong_category',
              probabilities: Object.fromEntries(
                labels.map((l) => [l, l === 'wrong_category' ? 0.9 : 0.0125]),
              ),
              confidence: 0.9,
            },
          },
          usage: { cost: 0.0002, input_tokens: 10, output_tokens: 2 },
        }),
        { status: 200 },
      )
    })
    try {
      const decide = resolveLiveDecide({
        DECISION_SHADOW_ENABLED: 'true',
        OPENROUTER_API_KEY: 'sk-test',
        DECISION_SHADOW_MODEL: 'typesafe/jev-test',
      })
      const response = await decide(request)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
      expect(JSON.parse(init?.body as string)).toEqual({
        model: 'typesafe/jev-test',
        state: request.state,
        questions: request.questions,
      })
      expect(response.answers.reason.choice).toBe('wrong_category')
      expect(response.reportedCostUsd).toBe(0.0002)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('runJevCheck', () => {
  let outDir: string
  let lines: string[]

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'jev-check-out-'))
    lines = []
  })
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  const NOW = new Date('2026-10-27T10:20:30.456Z')

  function deps(patch: Partial<JevCheckDeps> = {}): JevCheckDeps {
    return { env: {}, log: (line) => lines.push(line), outDir, now: () => NOW, ...patch }
  }

  function written(): string[] {
    return existsSync(outDir) ? readdirSync(outDir) : []
  }

  /** Jev that answers the first criterion of every question (the label a01 expects everywhere), at p. */
  function fakeDecide(p = 0.95, override: Record<string, string> = {}) {
    return vi.fn(async (request: DecisionRequest): Promise<DecisionResponse> => {
      const answers: DecisionResponse['answers'] = {}
      for (const [id, question] of Object.entries(request.questions)) {
        const labels = Object.keys(question.criteria)
        const choice = override[id] ?? labels[0]
        const probabilities: Record<string, number> = {}
        for (const label of labels) probabilities[label] = (1 - p) / (labels.length - 1)
        probabilities[choice] = p
        answers[id] = { type: 'choice', choice, probabilities, confidence: p }
      }
      return {
        model: 'fake/jev',
        answers,
        usage: { input_tokens: 5, output_tokens: 2 },
        reportedCostUsd: 0.0001,
      }
    }) as ReturnType<typeof vi.fn<Decide>>
  }

  describe('--dry-run', () => {
    it('never calls decide, never reads the decision config, never writes a file', async () => {
      const decide = fakeDecide()
      const result = await runJevCheck(['--dry-run'], deps({ decide, env: {} }))
      expect(decide).not.toHaveBeenCalled()
      expect(result).toEqual({ exitCode: 0, resultPath: null })
      expect(written()).toEqual([])
    })

    it('prints every built request as JSON, with the case id', async () => {
      await runJevCheck(
        ['--dry-run', '--case', 'a01-clean-task-en', '--case', 'r01-category-idea'],
        deps(),
      )
      const text = lines.join('\n')
      expect(text).toContain('a01-clean-task-en')
      expect(text).toContain('r01-category-idea')
      const a01 = loadFixtureFiles(FIXTURES_DIR)[0].cases.find((c) => c.id === 'a01-clean-task-en')
      if (!a01 || !('capturedAt' in a01.input)) throw new Error('fixture a01 missing')
      expect(text).toContain(JSON.stringify(buildCaptureAuditRequest(a01.input), null, 2))
      expect(text).toContain('"reason"')
      expect(text).toContain('"wrong_category"')
    })

    it('runs without any decision config', async () => {
      await expect(
        runJevCheck(['--dry-run', '--kind', 'capture_reason'], deps({ env: {} })),
      ).resolves.toMatchObject({
        exitCode: 0,
      })
      expect(lines.join('\n')).toContain('r13-detail-dropped')
      expect(lines.join('\n')).not.toContain('a01-clean-task-en')
    })

    it('fails loud on an unknown case', async () => {
      await expect(runJevCheck(['--dry-run', '--case', 'nope'], deps())).rejects.toThrow(
        'unknown case "nope"',
      )
    })
  })

  describe('live', () => {
    it('throws with the env var names when the decision config is missing, before any call or file', async () => {
      await expect(runJevCheck(['--case', 'a01-clean-task-en'], deps({ env: {} }))).rejects.toThrow(
        /DECISION_SHADOW_ENABLED.*OPENROUTER_API_KEY.*DECISION_SHADOW_MODEL/s,
      )
      expect(lines).toEqual([])
      expect(written()).toEqual([])
    })

    it('throws naming what is missing when the config is incomplete', async () => {
      await expect(
        runJevCheck(
          ['--case', 'a01-clean-task-en'],
          deps({ env: { DECISION_SHADOW_ENABLED: 'true' } }),
        ),
      ).rejects.toThrow(/OPENROUTER_API_KEY, DECISION_SHADOW_MODEL/)
      expect(written()).toEqual([])
    })

    it('does not check the fixtures against a missing config first: a bad --case fails before the config', async () => {
      await expect(runJevCheck(['--case', 'nope'], deps({ env: {} }))).rejects.toThrow(
        'unknown case "nope"',
      )
    })

    it('asks once per selected case, prints a table and the totals, writes the result, exits 0 when nothing disagrees', async () => {
      const decide = fakeDecide(0.95)
      const result = await runJevCheck(['--case', 'a01-clean-task-en'], deps({ decide }))
      expect(decide).toHaveBeenCalledTimes(1)
      expect(result.exitCode).toBe(0)

      const text = lines.join('\n')
      expect(text).toContain('a01-clean-task-en')
      expect(text).toMatch(/question\s+expected\s+jev\s+prob\s+status/)
      expect(text).toMatch(/name:n1\s+right\s+right\s+0\.950\s+ok/)
      expect(text).toMatch(/missing_names\s+none_missing\s+none_missing\s+0\.950\s+ok/)
      expect(text).toMatch(/date:d1\s+right\s+right\s+0\.950\s+ok/)
      expect(text).toMatch(/questions 3\s+ok 3\s+low 0\s+mismatch 0\s+USD 0\.000100/)
    })

    it('writes the full result JSON to <outDir>/<timestamp>.json', async () => {
      const result = await runJevCheck(
        ['--case', 'a01-clean-task-en'],
        deps({ decide: fakeDecide() }),
      )
      expect(written()).toEqual(['2026-10-27T10-20-30-456Z.json'])
      expect(result.resultPath).toBe(join(outDir, '2026-10-27T10-20-30-456Z.json'))

      const saved = JSON.parse(readFileSync(result.resultPath as string, 'utf8'))
      expect(saved.startedAt).toBe('2026-10-27T10:20:30.456Z')
      expect(saved.filters).toEqual({ kind: null, caseIds: ['a01-clean-task-en'] })
      expect(saved.totals).toEqual({ questions: 3, ok: 3, low: 0, mismatch: 0 })
      expect(saved.reportedCostUsd).toBeCloseTo(0.0001, 10)
      expect(saved.rows).toHaveLength(3)
      expect(saved.cases[0].caseId).toBe('a01-clean-task-en')
      expect(saved.cases[0].request.state).toContain('Captured on Tuesday 27 October 2026')
    })

    it('exits 1 on a mismatch and lists it', async () => {
      const result = await runJevCheck(
        ['--case', 'a01-clean-task-en'],
        deps({ decide: fakeDecide(0.9, { 'date:d1': 'wrong' }) }),
      )
      expect(result.exitCode).toBe(1)
      expect(result.resultPath).not.toBeNull()
      const text = lines.join('\n')
      expect(text).toMatch(/date:d1\s+right\s+wrong\s+0\.900\s+mismatch/)
      expect(text).toMatch(/questions 3\s+ok 2\s+low 0\s+mismatch 1/)
      expect(text).toContain('Mismatches')
    })

    it('exits 0 when Jev agrees with low probability, and lists the low ones', async () => {
      const result = await runJevCheck(
        ['--case', 'a01-clean-task-en'],
        deps({ decide: fakeDecide(0.7) }),
      )
      expect(result.exitCode).toBe(0)
      const text = lines.join('\n')
      expect(text).toMatch(/name:n1\s+right\s+right\s+0\.700\s+low/)
      expect(text).toMatch(/questions 3\s+ok 0\s+low 3\s+mismatch 0/)
      expect(text).toContain('Low')
    })

    it('--kind runs only that kind', async () => {
      const decide = fakeDecide()
      const reasonCases = loadFixtureFiles(FIXTURES_DIR)[1].cases.length
      await runJevCheck(['--kind', 'capture_reason'], deps({ decide }))
      expect(decide).toHaveBeenCalledTimes(reasonCases)
      for (const [request] of decide.mock.calls)
        expect(Object.keys(request.questions)).toEqual(['reason'])
    })

    it('fails loud, writes nothing, when a call fails', async () => {
      const decide = vi.fn(async () => {
        throw new Error('Decision request failed (401): nope')
      })
      await expect(runJevCheck(['--case', 'a01-clean-task-en'], deps({ decide }))).rejects.toThrow(
        /a01-clean-task-en.*nope/s,
      )
      expect(written()).toEqual([])
    })

    it('--help prints the usage and does nothing else', async () => {
      const decide = fakeDecide()
      const result = await runJevCheck(['--help'], deps({ decide }))
      expect(result).toEqual({ exitCode: 0, resultPath: null })
      expect(lines.join('\n')).toBe(JEV_CHECK_USAGE)
      expect(decide).not.toHaveBeenCalled()
      expect(written()).toEqual([])
    })
  })
})
