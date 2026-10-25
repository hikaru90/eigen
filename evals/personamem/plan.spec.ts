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

function cliFor(selection: string[], extra: string[] = []) {
  return parsePersonaMemCli([
    '--data-dir',
    dataDir,
    '--chat-model',
    'openai/gpt-4o-mini',
    '--tenant-concurrency',
    '2',
    '--enrich-concurrency',
    '1',
    ...selection,
    ...extra,
  ])
}

describe('tenantUserIdFor', () => {
  it('embeds the model slug and persona id under the public-bench prefix', () => {
    expect(tenantUserIdFor('openai/gpt-4o-mini', 521)).toBe(
      'public-bench-personamem-v2-gpt-4o-mini-p521',
    )
    expect(tenantUserIdFor('deepseek/deepseek-v4.1-flash-1017', 7)).toBe(
      'public-bench-personamem-v2-deepseek-v4.1-flash-1017-p7',
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
    expect(persona7.tenantUserId).toBe('public-bench-personamem-v2-gpt-4o-mini-p7')
    expect(persona7.captures).toHaveLength(5)
    expect(persona7.questions).toHaveLength(3)
    const q = persona7.questions[0]!
    expect(q.options[q.correctLetter]).toBe(q.row.correctAnswer)
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
    expect(text).toContain('public-bench-personamem-v2-gpt-4o-mini-p9')
  })
})
