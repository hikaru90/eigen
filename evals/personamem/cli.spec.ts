import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePersonaMemCli, PersonaMemUsageError } from './cli'

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
]
const sample = ['--personas', '20', '--seed', 'pilot-1']

function without(args: string[], flag: string): string[] {
  const i = args.indexOf(flag)
  return [...args.slice(0, i), ...args.slice(i + 2)]
}

describe('parsePersonaMemCli', () => {
  it('parses a full sampled invocation', () => {
    const cli = parsePersonaMemCli([...required, ...sample, '--dry-run'])
    expect(cli).toMatchObject({
      dataDir: resolve('evals/.data/personamem-v2'),
      chatModel: 'openai/gpt-4o-mini',
      tenantConcurrency: 4,
      enrichConcurrency: 1,
      answer: 'ask',
      evidenceOnly: false,
      selection: { kind: 'sample', count: 20, seed: 'pilot-1' },
      dryRun: true,
      resume: false,
      skipIngest: false,
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
  ])('fails naming %s when it is missing', (flag) => {
    expect(() => parsePersonaMemCli([...without(required, flag), ...sample])).toThrow(
      new RegExp(flag),
    )
  })

  it('parses --answer ask and compose, and rejects any other value or the retired --ingest', () => {
    expect(parsePersonaMemCli([...required, ...sample]).answer).toBe('ask')
    const compose = [...without(required, '--answer'), '--answer', 'compose', ...sample]
    expect(parsePersonaMemCli(compose).answer).toBe('compose')
    const bad = [...without(required, '--answer'), '--answer', 'both', ...sample]
    expect(() => parsePersonaMemCli(bad)).toThrow(/--answer.*ask.*compose/)
    expect(() => parsePersonaMemCli([...required, ...sample, '--ingest', 'capture'])).toThrow(
      /--ingest/,
    )
  })

  it('parses --evidence-only', () => {
    expect(parsePersonaMemCli([...required, ...sample, '--evidence-only']).evidenceOnly).toBe(true)
  })

  it('--question-ids is a selection of its own and requires --evidence-only', () => {
    const ids = ['--question-ids', 'p7-aaaaaaaaaaaa, p9-bbbbbbbbbbbb,p7-aaaaaaaaaaaa']
    const cli = parsePersonaMemCli([...required, ...ids, '--evidence-only'])
    expect(cli.selection).toEqual({
      kind: 'questions',
      ids: ['p7-aaaaaaaaaaaa', 'p9-bbbbbbbbbbbb'],
    })
    expect(() => parsePersonaMemCli([...required, ...ids])).toThrow(
      /--question-ids.*--evidence-only/,
    )
    expect(() => parsePersonaMemCli([...required, ...ids, '--evidence-only', '--all'])).toThrow(
      /exactly one/,
    )
    expect(() =>
      parsePersonaMemCli([...required, ...ids, '--evidence-only', '--limit-queries', '2']),
    ).toThrow(/--limit-queries.*--question-ids/)
  })

  it('requires exactly one persona selection and names the options', () => {
    expect(() => parsePersonaMemCli(required)).toThrow(
      /--personas.*--persona-ids.*--all.*--question-ids/,
    )
  })

  it('rejects --personas together with --all', () => {
    expect(() => parsePersonaMemCli([...required, ...sample, '--all'])).toThrow(/exactly one/)
  })

  it('rejects --personas together with --persona-ids', () => {
    expect(() => parsePersonaMemCli([...required, ...sample, '--persona-ids', '1,2'])).toThrow(
      /exactly one/,
    )
  })

  it('requires --seed with --personas, and rejects --seed without it', () => {
    expect(() => parsePersonaMemCli([...required, '--personas', '5'])).toThrow(/--seed/)
    expect(() => parsePersonaMemCli([...required, '--all', '--seed', 'x'])).toThrow(/--seed/)
  })

  it('parses --persona-ids and --all', () => {
    expect(parsePersonaMemCli([...required, '--persona-ids', '10, 23,10']).selection).toEqual({
      kind: 'ids',
      ids: [10, 23],
    })
    expect(parsePersonaMemCli([...required, '--all']).selection).toEqual({ kind: 'all' })
  })

  it('rejects non-integer persona ids, bad concurrency, and a malformed chat model', () => {
    expect(() => parsePersonaMemCli([...required, '--persona-ids', 'a,b'])).toThrow(/--persona-ids/)
    expect(() =>
      parsePersonaMemCli([
        ...without(required, '--tenant-concurrency'),
        '--tenant-concurrency',
        '0',
        ...sample,
      ]),
    ).toThrow(/--tenant-concurrency/)
    expect(() =>
      parsePersonaMemCli([
        ...without(required, '--chat-model'),
        '--chat-model',
        'gpt-4o-mini',
        ...sample,
      ]),
    ).toThrow(/--chat-model/)
  })

  it('names a flag whose value is missing', () => {
    expect(() => parsePersonaMemCli([...required, ...sample, '--run-id'])).toThrow(/--run-id/)
  })

  it('rejects unknown arguments', () => {
    expect(() => parsePersonaMemCli([...required, ...sample, '--answer-model', 'x'])).toThrow(
      /--answer-model/,
    )
  })

  it('--resume needs an explicit --run-id', () => {
    expect(() => parsePersonaMemCli([...required, ...sample, '--resume'])).toThrow(/--run-id/)
    expect(parsePersonaMemCli([...required, ...sample, '--resume', '--run-id', 'r1']).resume).toBe(
      true,
    )
  })

  it('parses --limit-queries and --skip-ingest', () => {
    const cli = parsePersonaMemCli([
      ...required,
      ...sample,
      '--limit-queries',
      '5',
      '--skip-ingest',
    ])
    expect(cli.limitQueries).toBe(5)
    expect(cli.skipIngest).toBe(true)
  })

  it('throws PersonaMemUsageError', () => {
    expect(() => parsePersonaMemCli([])).toThrow(PersonaMemUsageError)
  })
})
