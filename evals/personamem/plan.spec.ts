import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parsePersonaMemCli } from './cli'
import { buildPlan, estimateUsd, formatPlan, tenantUserIdFor } from './plan'
import { writeFixtureDataDir } from './test-fixtures'

let dataDir = ''

beforeAll(() => {
  dataDir = writeFixtureDataDir()
  const res = spawnSync(
    'python3',
    ['-I', resolve(import.meta.dirname, 'prepare.py'), '--data-dir', dataDir],
    { encoding: 'utf8' },
  )
  if (res.status !== 0) throw new Error(res.stderr)
})

function cliFor(selection: string[], extra: string[] = [], answer = 'compose') {
  return parsePersonaMemCli([
    '--data-dir',
    dataDir,
    '--chat-model',
    'openai/gpt-4o-mini',
    '--tenant-concurrency',
    '2',
    '--enrich-concurrency',
    '1',
    '--answer',
    answer,
    ...selection,
    ...extra,
  ])
}

describe('tenantUserIdFor', () => {
  it('embeds the model slug and persona id under the public-bench prefix', () => {
    expect(tenantUserIdFor('openai/gpt-4o-mini', 521)).toBe(
      'public-bench-personamem-v2-capture-gpt-4o-mini-p521',
    )
  })

  it('adds the question id suffix for a per-question tenant', () => {
    expect(tenantUserIdFor('openai/gpt-4o-mini', 7, 'p7-0123456789ab')).toBe(
      'public-bench-personamem-v2-capture-gpt-4o-mini-p7-q0123456789ab',
    )
  })
})

describe('estimateUsd', () => {
  it('is captures x 0.0015 + queries x 0.008', () => {
    expect(estimateUsd(10, 5)).toBeCloseTo(0.055, 10)
  })
})

describe('buildPlan', () => {
  it('plans every persona with --all', () => {
    const plan = buildPlan(cliFor(['--all']))
    expect(plan.personas.map((p) => p.personaId)).toEqual([7, 9])
    expect(plan.totals).toMatchObject({ personas: 2, captures: 10, queries: 6 })
    const persona7 = plan.personas[0]!
    expect(persona7.tenantUserId).toBe('public-bench-personamem-v2-capture-gpt-4o-mini-p7')
    expect(persona7.captures).toHaveLength(5)
    expect(persona7.questions).toHaveLength(3)
    const q = persona7.questions[0]!
    expect(q.options[q.correctLetter]).toBe(q.row.correctAnswer)
  })

  it('does not change tenants or captures with the answer mode', () => {
    const ask = buildPlan(cliFor(['--persona-ids', '7'], [], 'ask')).personas[0]!
    const compose = buildPlan(cliFor(['--persona-ids', '7'])).personas[0]!
    expect(ask.tenantUserId).toBe(compose.tenantUserId)
    expect(ask.captures).toEqual(compose.captures)
  })

  it('references the query time one day after the last captured turn', () => {
    const persona = buildPlan(cliFor(['--persona-ids', '7'])).personas[0]!
    expect(persona.referenceTime.toISOString()).toBe('2025-01-06T00:00:00.000Z')
  })

  it('keeps the whole fixture span (first capture to query time) under 180 days', () => {
    for (const persona of buildPlan(cliFor(['--all'])).personas) {
      const spanMs = persona.referenceTime.getTime() - persona.captures[0]!.capturedAt.getTime()
      expect(spanMs).toBeLessThan(180 * 24 * 60 * 60 * 1000)
    }
  })

  it('selects by id and applies --limit-queries per persona', () => {
    const plan = buildPlan(cliFor(['--persona-ids', '9'], ['--limit-queries', '2']))
    expect(plan.personas.map((p) => p.personaId)).toEqual([9])
    expect(plan.personas[0]!.questions).toHaveLength(2)
    expect(plan.totals.queries).toBe(2)
  })

  it('fails naming a persona id that is not in the dataset', () => {
    expect(() => buildPlan(cliFor(['--persona-ids', '7,8']))).toThrow(/persona 8/)
  })

  it('samples deterministically for a seed and fails when asking for too many', () => {
    const a = buildPlan(cliFor(['--personas', '1', '--seed', 's1'])).personas.map(
      (p) => p.personaId,
    )
    const b = buildPlan(cliFor(['--personas', '1', '--seed', 's1'])).personas.map(
      (p) => p.personaId,
    )
    expect(a).toEqual(b)
    expect(() => buildPlan(cliFor(['--personas', '3', '--seed', 's1']))).toThrow()
  })
})

describe('formatPlan', () => {
  it('prints personas, captures, queries and the estimate', () => {
    const cli = cliFor(['--all'])
    const text = formatPlan(buildPlan(cli), cli).join('\n')
    expect(text).toMatch(/personas: 2/)
    expect(text).toMatch(/captures: 10/)
    expect(text).toMatch(/queries: 6/)
    expect(text).toMatch(/estimated USD: \$0\.063/)
    expect(text).toContain('ingest: capture')
    expect(text).toContain('public-bench-personamem-v2-capture-gpt-4o-mini-p9')
  })

  it('prints the answer mode', () => {
    const cli = cliFor(['--all'], [], 'ask')
    const text = formatPlan(buildPlan(cli), cli).join('\n')
    expect(text).toContain('answer: ask')
    expect(text).toMatch(/Ask agent loop/)
  })
})

describe('buildPlan --evidence-only', () => {
  it('plans one tenant per question holding only that question evidence user turns', () => {
    const plan = buildPlan(cliFor(['--persona-ids', '7'], ['--evidence-only']))
    expect(plan.personas).toHaveLength(3)
    expect(new Set(plan.personas.map((p) => p.tenantUserId)).size).toBe(3)
    for (const p of plan.personas) {
      expect(p.questions).toHaveLength(1)
      const suffix = p.questions[0]!.row.questionId.split('-')[1]
      expect(p.tenantUserId).toBe(`public-bench-personamem-v2-capture-gpt-4o-mini-p7-q${suffix}`)
      expect(p.captures.map((c) => c.rawText)).toEqual([
        'I like calm evenings.',
        'Really, nothing loud after dinner.',
      ])
      expect(p.captures.map((c) => c.capturedAt.toISOString())).toEqual([
        '2025-01-01T00:00:00.000Z',
        '2025-01-02T00:00:00.000Z',
      ])
      expect(p.referenceTime.toISOString()).toBe('2025-01-03T00:00:00.000Z')
    }
    expect(plan.totals).toMatchObject({ captures: 6, queries: 3 })
  })

  it('applies --limit-queries and selects exact --question-ids', () => {
    expect(
      buildPlan(cliFor(['--persona-ids', '7'], ['--evidence-only', '--limit-queries', '2']))
        .personas,
    ).toHaveLength(2)
    const all = buildPlan(cliFor(['--all'], ['--evidence-only']))
    const wanted = all.personas[4]!.questions[0]!.row.questionId
    const picked = buildPlan(cliFor(['--question-ids', wanted], ['--evidence-only']))
    expect(picked.personas.map((p) => p.questions[0]!.row.questionId)).toEqual([wanted])
  })

  it('fails naming an unknown question id', () => {
    expect(() =>
      buildPlan(cliFor(['--question-ids', 'p7-000000000000'], ['--evidence-only'])),
    ).toThrow(/p7-000000000000/)
  })

  it('dry run prints evidence turns and the estimate per question, marked SMOKE', () => {
    const cli = cliFor(['--persona-ids', '7'], ['--evidence-only', '--limit-queries', '1'])
    const text = formatPlan(buildPlan(cli), cli).join('\n')
    expect(text).toMatch(/SMOKE \(evidence-only\)/)
    expect(text).toMatch(/evidence turns: 2/)
    expect(text).toMatch(
      /-q[0-9a-f]{12} {2}question=p7-[0-9a-f]{12} {2}evidence turns=2 {2}estimate=\$0\.011/,
    )
  })
})
