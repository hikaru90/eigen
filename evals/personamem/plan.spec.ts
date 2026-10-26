import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parsePersonaMemCli } from './cli'
import { buildDevSetFile } from './dev-set'
import { buildPlan, estimateUsd, formatPlan, tenantUserIdFor } from './plan'
import {
  FIXTURE_EVIDENCE,
  FIXTURE_ROWS,
  toCsv,
  writeFixtureDataDir,
  type CsvRow,
} from './test-fixtures'

let dataDir = ''
/** A `val` data dir with no history files, the way val is downloaded. */
let valDir = ''

function prepare(dir: string, split: string) {
  const res = spawnSync(
    'python3',
    ['-I', resolve(import.meta.dirname, 'prepare.py'), '--data-dir', dir, '--split', split],
    { encoding: 'utf8' },
  )
  if (res.status !== 0) throw new Error(res.stderr)
}

beforeAll(() => {
  dataDir = writeFixtureDataDir()
  prepare(dataDir, 'benchmark')
  valDir = writeFixtureDataDir({ split: 'val', skipHistoryFor: 'all' })
  prepare(valDir, 'val')
})

function cliFor(
  selection: string[],
  extra: string[] = [],
  answer = 'compose',
  split = 'benchmark',
) {
  return parsePersonaMemCli([
    '--data-dir',
    split === 'val' ? valDir : dataDir,
    '--split',
    split,
    '--chat-model',
    'openai/gpt-4o-mini',
    '--tenant-concurrency',
    '2',
    '--enrich-concurrency',
    '1',
    '--answer',
    answer,
    '--relevance-floor',
    'product',
    '--dry-run',
    ...selection,
    ...extra,
  ])
}

describe('tenantUserIdFor', () => {
  it('embeds the model slug and persona id under the public-bench prefix', () => {
    expect(tenantUserIdFor('openai/gpt-4o-mini', 'benchmark', 521)).toBe(
      'public-bench-personamem-v2-capture-gpt-4o-mini-p521',
    )
  })

  it('adds the question id suffix for a per-question tenant', () => {
    expect(tenantUserIdFor('openai/gpt-4o-mini', 'benchmark', 7, 'p7-0123456789ab')).toBe(
      'public-bench-personamem-v2-capture-gpt-4o-mini-p7-q0123456789ab',
    )
  })

  it('keeps val tenants apart from benchmark tenants (persona 78 is in both splits)', () => {
    expect(tenantUserIdFor('openai/gpt-4o-mini', 'val', 78)).toBe(
      'public-bench-personamem-v2-capture-gpt-4o-mini-val-p78',
    )
    expect(tenantUserIdFor('openai/gpt-4o-mini', 'val', 78, 'p78-0123456789ab')).toBe(
      'public-bench-personamem-v2-capture-gpt-4o-mini-val-p78-q0123456789ab',
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

describe('--max-history-turns (rehearsal)', () => {
  const capped = () => buildPlan(cliFor(['--persona-ids', '7'], ['--max-history-turns', '2']))

  it('ingests only each persona\'s first N user turns, queried one day after the last of them', () => {
    const persona = capped().personas[0]!
    const full = buildPlan(cliFor(['--persona-ids', '7'])).personas[0]!
    expect(persona.captures).toEqual(full.captures.slice(0, 2))
    expect(persona.referenceTime.toISOString()).toBe('2025-01-03T00:00:00.000Z')
    expect(capped().totals.captures).toBe(2)
  })

  it('keeps every question: evidence cut off by the cap becomes "not in history", the rest stays aligned inside the cap', () => {
    const full = buildPlan(cliFor(['--persona-ids', '7'])).personas[0]!.questions
    const cut = capped().personas[0]!.questions
    expect(cut.map((q) => q.row.questionId)).toEqual(full.map((q) => q.row.questionId))
    for (const question of cut) {
      if (question.evidence.kind === 'aligned') {
        expect(Math.max(...question.evidence.captureIndexes)).toBeLessThan(2)
      } else {
        expect(question.evidence.kind).toBe('not-in-history')
      }
    }
    const fullAlignedBeyond = full.some(
      (q) => q.evidence.kind === 'aligned' && Math.max(...q.evidence.captureIndexes) >= 2,
    )
    expect(fullAlignedBeyond).toBe(true)
    expect(cut.some((q) => q.evidence.kind === 'not-in-history')).toBe(true)
  })

  it('is a no-op when the cap is larger than the history', () => {
    const big = buildPlan(cliFor(['--persona-ids', '7'], ['--max-history-turns', '999']))
    const full = buildPlan(cliFor(['--persona-ids', '7']))
    expect(big.personas[0]!.captures).toEqual(full.personas[0]!.captures)
  })

  it('formatPlan labels the plan as a rehearsal, not a score', () => {
    const cli = cliFor(['--persona-ids', '7'], ['--max-history-turns', '2'])
    const text = formatPlan(buildPlan(cli), cli).join('\n')
    expect(text).toContain('REHEARSAL - not a score (first 2 user turn(s) of each history)')
  })

  it('formatPlan names the run id and whether the run starts fresh, resumes or neither', () => {
    const text = (extra: string[]) => {
      const cli = cliFor(['--persona-ids', '7'], extra)
      return formatPlan(buildPlan(cli), cli).join('\n')
    }
    expect(text([])).toContain('run id: (none - a real run requires --run-id)')
    expect(text(['--run-id', 'r1'])).toContain('run id: r1 (new run, tenants holding thoughts are refused)')
    expect(text(['--run-id', 'r1', '--fresh'])).toContain('run id: r1 (new run, --fresh: each tenant is reset before its first capture)')
    expect(text(['--run-id', 'r1', '--resume'])).toContain('run id: r1 (resume: nothing is re-done, nothing is deleted)')
  })

  it('a plan without the cap carries no rehearsal label', () => {
    const cli = cliFor(['--persona-ids', '7'])
    expect(formatPlan(buildPlan(cli), cli).join('\n')).not.toMatch(/REHEARSAL/)
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
      expect(p.captures.map((c) => c.rawText)).toEqual(
        p.questions[0]!.row.evidenceTurns.filter((t) => t.role === 'user').map((t) => t.content),
      )
      expect(p.captures[0]!.capturedAt.toISOString()).toBe('2025-01-01T00:00:00.000Z')
    }
    expect(plan.totals).toMatchObject({ captures: 4, queries: 3 })
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
    expect(text).not.toMatch(/evidence alignment/)
  })
})

describe('buildPlan --split val', () => {
  it('plans val questions in evidence-only mode without any history file', () => {
    const plan = buildPlan(cliFor(['--persona-ids', '7'], ['--evidence-only'], 'compose', 'val'))
    expect(plan.personas).toHaveLength(3)
    for (const p of plan.personas) {
      expect(p.tenantUserId).toMatch(
        /^public-bench-personamem-v2-capture-gpt-4o-mini-val-p7-q[0-9a-f]{12}$/,
      )
      expect(p.captures.length).toBeGreaterThan(0)
    }
  })

  it('reads the val file, not the benchmark file', () => {
    const plan = buildPlan(cliFor(['--all'], ['--evidence-only'], 'compose', 'val'))
    expect(plan.totals.queries).toBe(6)
    expect(() =>
      buildPlan(cliFor(['--all'], ['--evidence-only'], 'compose', 'benchmark')),
    ).not.toThrow()
  })

  it('full-history mode on val fails loud when the val histories are not downloaded', () => {
    expect(() => buildPlan(cliFor(['--persona-ids', '7'], [], 'compose', 'val'))).toThrow(
      /val histories not downloaded/,
    )
  })

  it('the failure names the missing file and points at --evidence-only', () => {
    expect(() => buildPlan(cliFor(['--all'], [], 'compose', 'val'))).toThrow(
      /chat_history_fixture_persona7\.json/,
    )
    expect(() => buildPlan(cliFor(['--all'], [], 'compose', 'val'))).toThrow(/--evidence-only/)
  })

  it('full-history mode on val works once the history files exist', () => {
    const full = writeFixtureDataDir({ split: 'val' })
    prepare(full, 'val')
    const cli = parsePersonaMemCli([
      '--data-dir',
      full,
      '--split',
      'val',
      '--chat-model',
      'openai/gpt-4o-mini',
      '--tenant-concurrency',
      '1',
      '--enrich-concurrency',
      '1',
      '--answer',
      'compose',
      '--relevance-floor',
      'product',
    '--dry-run',
      '--all',
    ])
    expect(buildPlan(cli).totals).toMatchObject({ personas: 2, captures: 10, queries: 6 })
  })

  it('a missing benchmark history keeps the plain history-file error', () => {
    const broken = writeFixtureDataDir()
    prepare(broken, 'benchmark')
    rmSync(join(broken, 'data/chat_history_32k/chat_history_fixture_persona9.json'))
    const cli = parsePersonaMemCli([
      '--data-dir',
      broken,
      '--split',
      'benchmark',
      '--chat-model',
      'openai/gpt-4o-mini',
      '--tenant-concurrency',
      '1',
      '--enrich-concurrency',
      '1',
      '--answer',
      'compose',
      '--relevance-floor',
      'product',
    '--dry-run',
      '--persona-ids',
      '9',
    ])
    expect(() => buildPlan(cli)).toThrow(/history file not found/)
  })

  it('formatPlan prints the split', () => {
    const cli = cliFor(['--all'], ['--evidence-only'], 'compose', 'val')
    expect(formatPlan(buildPlan(cli), cli).join('\n')).toMatch(/split: val/)
  })
})

describe('buildPlan --dev-set', () => {
  function devSetFile(split: 'val' | 'benchmark' = 'val'): string {
    const plan = buildPlan(cliFor(['--all'], ['--evidence-only'], 'compose', 'val'))
    const candidates = plan.personas.map((p) => ({
      questionId: p.questions[0]!.row.questionId,
      personaId: p.personaId,
      prefType: p.questions[0]!.row.prefType,
    }))
    const file = {
      ...buildDevSetFile(candidates, {
        seed: 'fixture',
        size: 6,
        minPerPrefType: 1,
        maxPerPersona: 3,
        excludePersonaIds: [],
      }),
      split,
    }
    const dir = mkdtempSync(join(tmpdir(), 'personamem-devset-'))
    const path = join(dir, 'dev-set.json')
    writeFileSync(path, JSON.stringify(file))
    return path
  }

  it('plans exactly the dev-set questions, one tenant each, in val', () => {
    const path = devSetFile()
    const plan = buildPlan(cliFor(['--dev-set', path], ['--evidence-only'], 'ask', 'val'))
    expect(plan.totals).toMatchObject({ personas: 6, queries: 6 })
    expect(new Set(plan.personas.map((p) => p.tenantUserId)).size).toBe(6)
  })

  it('refuses a dev set made for another split', () => {
    const path = devSetFile('benchmark')
    expect(() => buildPlan(cliFor(['--dev-set', path], ['--evidence-only'], 'ask', 'val'))).toThrow(
      /dev set.*benchmark.*val/,
    )
  })

  it('refuses a dev set that names a question the split does not have', () => {
    const path = devSetFile()
    const file = JSON.parse(readFileSync(path, 'utf8')) as { questionIds: string[] }
    file.questionIds[0] = 'p7-000000000000'
    writeFileSync(path, JSON.stringify(file))
    expect(() => buildPlan(cliFor(['--dev-set', path], ['--evidence-only'], 'ask', 'val'))).toThrow(
      /p7-000000000000/,
    )
  })

  it('formatPlan names the dev set', () => {
    const path = devSetFile()
    const cli = cliFor(['--dev-set', path], ['--evidence-only'], 'ask', 'val')
    expect(formatPlan(buildPlan(cli), cli).join('\n')).toContain(`dev set ${path}`)
  })
})

describe('evidence alignment (full history)', () => {
  const questionsOf = (plan: ReturnType<typeof buildPlan>) =>
    plan.personas.flatMap((p) => p.questions.map((q) => ({ prefType: q.row.prefType, ...q })))

  it('maps each question evidence user turns to the history captures they came from', () => {
    const questions = questionsOf(buildPlan(cliFor(['--all'])))
    expect(questions.map((q) => [q.row.prefType, q.evidence])).toEqual([
      ['neutral', { kind: 'aligned', captureIndexes: [0, 1] }],
      ['health_and_medical', { kind: 'aligned', captureIndexes: [2] }],
      ['sensitive_info', { kind: 'not-in-history' }],
      ['stereotypical_pref', { kind: 'aligned', captureIndexes: [1] }],
      ['anti_stereotypical_pref', { kind: 'aligned', captureIndexes: [2] }],
      ['ask_to_forget', { kind: 'aligned', captureIndexes: [3, 4] }],
    ])
  })

  it('the aligned capture is exactly the evidence text', () => {
    const plan = buildPlan(cliFor(['--persona-ids', '7']))
    const tea = plan.personas[0]!.questions[0]!
    expect(tea.evidence).toEqual({ kind: 'aligned', captureIndexes: [0, 1] })
    expect(plan.personas[0]!.captures.slice(0, 2).map((c) => c.rawText)).toEqual(
      FIXTURE_EVIDENCE.tea.filter((t) => t.role === 'user').map((t) => t.content),
    )
  })

  it('evidence-only questions carry no alignment: every item of their tenant is evidence', () => {
    const plan = buildPlan(cliFor(['--persona-ids', '7'], ['--evidence-only']))
    for (const q of questionsOf(plan)) expect(q.evidence).toEqual({ kind: 'evidence-only' })
  })

  function brokenDir(patch: (rows: CsvRow[]) => CsvRow[]): string {
    const dir = writeFixtureDataDir({ rows: patch(FIXTURE_ROWS) })
    prepare(dir, 'benchmark')
    return dir
  }
  const cliForDir = (dir: string, extra: string[] = []) =>
    parsePersonaMemCli([
      '--data-dir',
      dir,
      '--split',
      'benchmark',
      '--chat-model',
      'openai/gpt-4o-mini',
      '--tenant-concurrency',
      '1',
      '--enrich-concurrency',
      '1',
      '--answer',
      'compose',
      '--relevance-floor',
      'product',
    '--dry-run',
      '--all',
      ...extra,
    ])
  const withEvidence = (index: number, evidence: unknown) => (rows: CsvRow[]) =>
    rows.map((r, i) =>
      i === index ? { ...r, related_conversation_snippet: JSON.stringify(evidence) } : r,
    )

  it('fails loud, naming the question and the turn, when an evidence turn is not in the history', () => {
    const dir = brokenDir(withEvidence(1, [{ role: 'user', content: 'A turn nobody said.' }]))
    const questionId = JSON.parse(
      readFileSync(join(dir, 'personamem.benchmark.jsonl'), 'utf8').split('\n')[1]!,
    ).questionId as string
    const run = () => buildPlan(cliForDir(dir))
    expect(run).toThrow(questionId)
    expect(run).toThrow(/A turn nobody said\./)
  })

  it('names every unaligned question, not only the first', () => {
    const dir = brokenDir((rows) =>
      withEvidence(0, [{ role: 'user', content: 'Ghost one.' }])(
        withEvidence(4, [{ role: 'user', content: 'Ghost two.' }])(rows),
      ),
    )
    const run = () => buildPlan(cliForDir(dir))
    expect(run).toThrow(/Ghost one\./)
    expect(run).toThrow(/Ghost two\./)
    expect(run).toThrow(/2 question/)
  })

  it('an evidence-only plan does not need the evidence to be in a history', () => {
    const dir = brokenDir(withEvidence(0, [{ role: 'user', content: 'A turn nobody said.' }]))
    expect(() => buildPlan(cliForDir(dir, ['--evidence-only']))).not.toThrow()
  })

  it('formatPlan prints the alignment totals, the questions without history evidence, and the floor', () => {
    const cli = cliForDir(brokenDir((rows) => rows))
    const text = formatPlan(buildPlan(cli), cli).join('\n')
    expect(text).toMatch(
      /evidence alignment: 5 of 6 question\(s\) aligned to 7 history capture\(s\)/,
    )
    expect(text).toMatch(/1 question\(s\) without history evidence \(sensitive_info\)/)
    expect(text).toMatch(/relevance floor: product/)
  })

  it('formatPlan names an eval-only floor override', () => {
    const cli = cliForDir(
      brokenDir((rows) => rows),
      [],
    )
    const withFloor = { ...cli, relevanceFloor: 0.15 }
    expect(formatPlan(buildPlan(withFloor), withFloor).join('\n')).toMatch(
      /relevance floor: 0\.15 \(eval-only override/,
    )
  })
})

describe('val full-history persona selection', () => {
  /** A val data dir where persona 9 is also a benchmark persona, both splits prepared. */
  function valWithBenchmark(): string {
    const dir = writeFixtureDataDir({ split: 'val' })
    const benchmarkRows = FIXTURE_ROWS.filter((r) => r.persona_id === '9')
    writeFileSync(join(dir, 'benchmark/text/benchmark.csv'), toCsv(benchmarkRows))
    prepare(dir, 'val')
    prepare(dir, 'benchmark')
    return dir
  }
  const valCli = (dir: string, selection: string[]) =>
    parsePersonaMemCli([
      '--data-dir',
      dir,
      '--split',
      'val',
      '--chat-model',
      'openai/gpt-4o-mini',
      '--tenant-concurrency',
      '1',
      '--enrich-concurrency',
      '1',
      '--answer',
      'compose',
      '--relevance-floor',
      'product',
    '--dry-run',
      ...selection,
    ])

  it('a seeded sample never contains a benchmark persona', () => {
    const dir = valWithBenchmark()
    for (const seed of ['a', 'b', 'c', 'd']) {
      const plan = buildPlan(valCli(dir, ['--personas', '1', '--seed', seed]))
      expect(plan.personas.map((p) => p.personaId)).toEqual([7])
    }
  })

  it('asking for more val personas than are not in the benchmark fails loud', () => {
    const dir = valWithBenchmark()
    expect(() => buildPlan(valCli(dir, ['--personas', '2', '--seed', 'a']))).toThrow(
      /only 1 .* eligible/,
    )
  })

  it('needs the prepared benchmark split to know which personas to exclude', () => {
    const dir = writeFixtureDataDir({ split: 'val' })
    prepare(dir, 'val')
    expect(() => buildPlan(valCli(dir, ['--personas', '1', '--seed', 'a']))).toThrow(
      /personamem\.benchmark\.jsonl not found/,
    )
  })

  it('explicit --persona-ids are the operator choice and are not filtered', () => {
    const dir = valWithBenchmark()
    expect(buildPlan(valCli(dir, ['--persona-ids', '9'])).personas.map((p) => p.personaId)).toEqual(
      [9],
    )
  })

  it('missing histories: the error lists the selected personas and the exact command to fetch just them', () => {
    const dir = valWithBenchmark()
    for (const persona of ['persona7', 'persona9']) {
      rmSync(join(dir, `data/chat_history_32k/chat_history_fixture_${persona}.json`))
    }
    const run = () => buildPlan(valCli(dir, ['--personas', '1', '--seed', 'a']))
    expect(run).toThrow(/--print-history-urls --persona-ids 7\b/)
  })
})
