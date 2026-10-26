import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePersonaMemCli as parseStrict, PersonaMemUsageError } from './cli'

const required = [
  '--data-dir',
  'evals/.data/personamem-v2',
  '--chat-model',
  'openai/gpt-4o-mini',
  '--tenant-concurrency',
  '4',
  '--enrich-concurrency',
  '1',
  '--answer',
  'ask',
  '--split',
  'benchmark',
  '--relevance-floor',
  'product',
]
const sample = ['--personas', '20', '--seed', 'pilot-1']

/** Legacy cases are about other flags: they are dry runs unless they pass --run-id themselves. */
function parse(args: string[]) {
  return parseStrict(args.includes('--run-id') || args.includes('--dry-run') ? args : [...args, '--dry-run'])
}

function without(args: string[], flag: string): string[] {
  const i = args.indexOf(flag)
  return [...args.slice(0, i), ...args.slice(i + 2)]
}

describe('parsePersonaMemCli', () => {
  it('parses a full sampled invocation', () => {
    const cli = parse([...required, ...sample, '--dry-run'])
    expect(cli).toMatchObject({
      dataDir: resolve('evals/.data/personamem-v2'),
      chatModel: 'openai/gpt-4o-mini',
      tenantConcurrency: 4,
      enrichConcurrency: 1,
      answer: 'ask',
      split: 'benchmark',
      evidenceOnly: false,
      selection: { kind: 'sample', count: 20, seed: 'pilot-1' },
      dryRun: true,
      resume: false,
      reuseIngest: null,
      relevanceFloor: 'product',
      limitQueries: null,
      runId: null,
    })
  })

  it.each([
    '--data-dir',
    '--chat-model',
    '--tenant-concurrency',
    '--enrich-concurrency',
    '--answer',
    '--split',
    '--relevance-floor',
  ])('fails naming %s when it is missing', (flag) => {
    expect(() => parse([...without(required, flag), ...sample])).toThrow(
      new RegExp(flag),
    )
  })

  it('parses --answer ask and compose, and rejects any other value or the retired --ingest', () => {
    expect(parse([...required, ...sample]).answer).toBe('ask')
    const compose = [...without(required, '--answer'), '--answer', 'compose', ...sample]
    expect(parse(compose).answer).toBe('compose')
    const bad = [...without(required, '--answer'), '--answer', 'both', ...sample]
    expect(() => parse(bad)).toThrow(/--answer.*ask.*compose/)
    expect(() => parse([...required, ...sample, '--ingest', 'capture'])).toThrow(
      /--ingest/,
    )
  })

  it('--split takes benchmark or val and nothing else', () => {
    const val = [...without(required, '--split'), '--split', 'val', ...sample]
    expect(parse(val).split).toBe('val')
    const bad = [...without(required, '--split'), '--split', 'test', ...sample]
    expect(() => parse(bad)).toThrow(/--split.*benchmark.*val/)
  })

  it('--dev-set is a selection of its own, resolved to an absolute path, evidence-only', () => {
    const cli = parse([
      ...required,
      '--dev-set',
      'evals/personamem/dev-set.val.json',
      '--evidence-only',
    ])
    expect(cli.selection).toEqual({
      kind: 'devSet',
      path: resolve('evals/personamem/dev-set.val.json'),
    })
  })

  it('--dev-set requires --evidence-only', () => {
    expect(() => parse([...required, '--dev-set', 'dev.json'])).toThrow(
      /--dev-set.*--evidence-only/,
    )
  })

  it.each([
    [['--all']],
    [['--personas', '3', '--seed', 's']],
    [['--persona-ids', '7']],
    [['--question-ids', 'p7-aaaaaaaaaaaa']],
  ])('--dev-set cannot be combined with another selection (%j)', (other) => {
    expect(() =>
      parse([...required, '--evidence-only', '--dev-set', 'dev.json', ...other]),
    ).toThrow(/exactly one/)
  })

  it('--dev-set rejects --limit-queries and --seed', () => {
    const base = [...required, '--evidence-only', '--dev-set', 'dev.json']
    expect(() => parse([...base, '--limit-queries', '2'])).toThrow(
      /--limit-queries.*--dev-set/,
    )
    expect(() => parse([...base, '--seed', 'x'])).toThrow(/--seed/)
  })

  it('the selection error names --dev-set', () => {
    expect(() => parse(required)).toThrow(/--dev-set/)
  })

  it('parses --evidence-only', () => {
    expect(parse([...required, ...sample, '--evidence-only']).evidenceOnly).toBe(true)
  })

  it('--question-ids is a selection of its own and requires --evidence-only', () => {
    const ids = ['--question-ids', 'p7-aaaaaaaaaaaa, p9-bbbbbbbbbbbb,p7-aaaaaaaaaaaa']
    const cli = parse([...required, ...ids, '--evidence-only'])
    expect(cli.selection).toEqual({
      kind: 'questions',
      ids: ['p7-aaaaaaaaaaaa', 'p9-bbbbbbbbbbbb'],
    })
    expect(() => parse([...required, ...ids])).toThrow(
      /--question-ids.*--evidence-only/,
    )
    expect(() => parse([...required, ...ids, '--evidence-only', '--all'])).toThrow(
      /exactly one/,
    )
    expect(() =>
      parse([...required, ...ids, '--evidence-only', '--limit-queries', '2']),
    ).toThrow(/--limit-queries.*--question-ids/)
  })

  it('requires exactly one persona selection and names the options', () => {
    expect(() => parse(required)).toThrow(
      /--personas.*--persona-ids.*--all.*--question-ids/,
    )
  })

  it('rejects --personas together with --all', () => {
    expect(() => parse([...required, ...sample, '--all'])).toThrow(/exactly one/)
  })

  it('rejects --personas together with --persona-ids', () => {
    expect(() => parse([...required, ...sample, '--persona-ids', '1,2'])).toThrow(
      /exactly one/,
    )
  })

  it('requires --seed with --personas, and rejects --seed without it', () => {
    expect(() => parse([...required, '--personas', '5'])).toThrow(/--seed/)
    expect(() => parse([...required, '--all', '--seed', 'x'])).toThrow(/--seed/)
  })

  it('parses --persona-ids and --all', () => {
    expect(parse([...required, '--persona-ids', '10, 23,10']).selection).toEqual({
      kind: 'ids',
      ids: [10, 23],
    })
    expect(parse([...required, '--all']).selection).toEqual({ kind: 'all' })
  })

  it('rejects non-integer persona ids, bad concurrency, and a malformed chat model', () => {
    expect(() => parse([...required, '--persona-ids', 'a,b'])).toThrow(/--persona-ids/)
    expect(() =>
      parse([
        ...without(required, '--tenant-concurrency'),
        '--tenant-concurrency',
        '0',
        ...sample,
      ]),
    ).toThrow(/--tenant-concurrency/)
    expect(() =>
      parse([
        ...without(required, '--chat-model'),
        '--chat-model',
        'gpt-4o-mini',
        ...sample,
      ]),
    ).toThrow(/--chat-model/)
  })

  it('names a flag whose value is missing', () => {
    expect(() => parse([...required, ...sample, '--run-id'])).toThrow(/--run-id/)
  })

  it('rejects unknown arguments', () => {
    expect(() => parse([...required, ...sample, '--answer-model', 'x'])).toThrow(
      /--answer-model/,
    )
  })

  it('--resume needs an explicit --run-id', () => {
    expect(() => parse([...required, ...sample, '--resume'])).toThrow(/--run-id/)
    expect(parse([...required, ...sample, '--resume', '--run-id', 'r1']).resume).toBe(
      true,
    )
  })

  it('parses --limit-queries', () => {
    const cli = parse([...required, ...sample, '--limit-queries', '5'])
    expect(cli.limitQueries).toBe(5)
  })

  describe('--relevance-floor', () => {
    const withFloor = (value: string) => [
      ...without(required, '--relevance-floor'),
      '--relevance-floor',
      value,
      ...sample,
    ]

    it('takes product, or a number from 0 to 1', () => {
      expect(parse(withFloor('product')).relevanceFloor).toBe('product')
      expect(parse(withFloor('0.15')).relevanceFloor).toBe(0.15)
      expect(parse(withFloor('0.10')).relevanceFloor).toBe(0.1)
      expect(parse(withFloor('0')).relevanceFloor).toBe(0)
      expect(parse(withFloor('1')).relevanceFloor).toBe(1)
    })

    it.each(['1.01', '-0.1', '2', 'abc', 'Product', '', ' ', '0.1.2', '1e-1', 'NaN', 'Infinity'])(
      'rejects %j, naming the flag',
      (bad) => {
        expect(() => parse(withFloor(bad))).toThrow(/--relevance-floor/)
      },
    )
  })

  describe('--reuse-ingest', () => {
    it('takes the run id of an earlier run', () => {
      expect(
        parse([...required, ...sample, '--reuse-ingest', 'run-a']).reuseIngest,
      ).toBe('run-a')
    })

    it('rejects a value that is not a single path segment', () => {
      for (const bad of ['a/b', '..', 'a\\b']) {
        expect(() => parse([...required, ...sample, '--reuse-ingest', bad])).toThrow(
          /--reuse-ingest/,
        )
      }
    })

    it('needs its value', () => {
      expect(() => parse([...required, ...sample, '--reuse-ingest'])).toThrow(
        /--reuse-ingest/,
      )
    })

    it('cannot name the run it is creating', () => {
      expect(() =>
        parse([...required, ...sample, '--reuse-ingest', 'r1', '--run-id', 'r1']),
      ).toThrow(/--reuse-ingest.*--run-id/)
    })
  })

  it('the retired --skip-ingest is an unknown argument', () => {
    expect(() => parse([...required, ...sample, '--skip-ingest'])).toThrow(
      /unknown argument: --skip-ingest/,
    )
  })

  it('throws PersonaMemUsageError', () => {
    expect(() => parse([])).toThrow(PersonaMemUsageError)
  })

  describe('--run-id for real runs', () => {
    it('is required unless the run is a dry run, so a resume is always one known command', () => {
      expect(() => parseStrict([...required, ...sample])).toThrow(PersonaMemUsageError)
      expect(() => parseStrict([...required, ...sample])).toThrow(/--run-id is required/)
      expect(parseStrict([...required, ...sample, '--dry-run']).runId).toBeNull()
      expect(parseStrict([...required, ...sample, '--run-id', 'r1']).runId).toBe('r1')
    })
  })

  describe('--fresh', () => {
    const live = [...required, ...sample, '--run-id', 'r1']

    it('is off by default and parsed when given', () => {
      expect(parseStrict(live).fresh).toBe(false)
      expect(parseStrict([...live, '--fresh']).fresh).toBe(true)
    })

    it('cannot be combined with --resume (resume never deletes anything)', () => {
      expect(() => parseStrict([...live, '--fresh', '--resume'])).toThrow(/--fresh.*--resume/)
    })

    it('cannot be combined with --reuse-ingest (nothing is ingested)', () => {
      expect(() => parseStrict([...live, '--fresh', '--reuse-ingest', 'other'])).toThrow(
        /--fresh.*--reuse-ingest/,
      )
    })
  })

  describe('--max-history-turns (rehearsal)', () => {
    const live = [...required, ...sample, '--run-id', 'r1']

    it('is null by default and a positive integer when given', () => {
      expect(parseStrict(live).maxHistoryTurns).toBeNull()
      expect(parseStrict([...live, '--max-history-turns', '12']).maxHistoryTurns).toBe(12)
    })

    it.each(['0', '-1', '1.5', 'x', ''])('rejects %j', (bad) => {
      expect(() => parseStrict([...live, '--max-history-turns', bad])).toThrow(/--max-history-turns/)
    })

    it('has nothing to cap in an --evidence-only run', () => {
      expect(() =>
        parseStrict([...live, '--evidence-only', '--max-history-turns', '12']),
      ).toThrow(/--max-history-turns.*--evidence-only/)
    })
  })
})
