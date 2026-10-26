import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRun, type RunIdentity } from './run-meta'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'personamem-run-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const identity: RunIdentity = {
  split: 'benchmark',
  chatModel: 'openai/gpt-4o-mini',
  answer: 'ask',
  evidenceOnly: false,
  personaIds: [7, 9],
  questionIds: ['p7-aaaaaaaaaaaa'],
  limitQueries: 5,
  enrichConcurrency: 1,
  relevanceFloor: 'product',
  reuseIngest: null,
  maxHistoryTurns: null,
}
const open = (id: RunIdentity, resume: boolean) =>
  openRun({ runId: 'r1', identity: id, resume, reportsRoot: root })

describe('openRun', () => {
  it('creates the run directory and refuses to reuse it without --resume', () => {
    const { paths } = open(identity, false)
    expect(paths.smoke).toBe(join(paths.dir, 'smoke.jsonl'))
    expect(paths.ingestProgress).toBe(join(paths.dir, 'ingest-progress.jsonl'))
    expect(paths.answerStages).toBe(join(paths.dir, 'answer-stages.jsonl'))
    expect(paths.failures).toBe(join(paths.dir, 'failures.jsonl'))
    expect(paths.processes).toBe(join(paths.dir, 'processes.jsonl'))
    expect(() => open(identity, false)).toThrow(/already exists/)
  })

  it('resumes an identical invocation and keeps the original start time', () => {
    const first = open(identity, false)
    expect(open(identity, true).meta.startedAt).toBe(first.meta.startedAt)
  })

  it('refuses to resume a run that used a different --answer, naming both', () => {
    open(identity, false)
    expect(() => open({ ...identity, answer: 'compose' }, true)).toThrow(/--answer.*ask.*compose/)
  })

  it('refuses to resume a run that used a different --split, naming both', () => {
    open(identity, false)
    expect(() => open({ ...identity, split: 'val' }, true)).toThrow(/--split.*benchmark.*val/)
  })

  it('refuses to resume a run that used a different --relevance-floor, naming both', () => {
    open({ ...identity, relevanceFloor: 0.15 }, false)
    expect(() => open({ ...identity, relevanceFloor: 'product' }, true)).toThrow(
      /--relevance-floor.*0\.15.*product/,
    )
    expect(() => open({ ...identity, relevanceFloor: 0.1 }, true)).toThrow(
      /--relevance-floor.*0\.15.*0\.1/,
    )
  })

  it('resumes a run with the same numeric floor', () => {
    const first = open({ ...identity, relevanceFloor: 0.15 }, false)
    expect(open({ ...identity, relevanceFloor: 0.15 }, true).meta.startedAt).toBe(
      first.meta.startedAt,
    )
  })

  it('refuses to resume a run that reused another run ingest differently, naming both', () => {
    open({ ...identity, reuseIngest: 'run-a' }, false)
    expect(() => open({ ...identity, reuseIngest: 'run-b' }, true)).toThrow(
      /--reuse-ingest.*run-a.*run-b/,
    )
    expect(() => open({ ...identity, reuseIngest: null }, true)).toThrow(/--reuse-ingest/)
  })

  it('records the floor and the reused ingest in run.json', () => {
    const { paths } = open({ ...identity, relevanceFloor: 0.1, reuseIngest: 'run-a' }, false)
    const saved = JSON.parse(readFileSync(paths.meta, 'utf8'))
    expect(saved.identity).toMatchObject({ relevanceFloor: 0.1, reuseIngest: 'run-a' })
  })

  it('refuses to resume when any other identity field differs', () => {
    open(identity, false)
    expect(() => open({ ...identity, personaIds: [7] }, true)).toThrow(/differs/)
  })

  it('refuses to resume when --evidence-only differs', () => {
    open(identity, false)
    expect(() => open({ ...identity, evidenceOnly: true }, true)).toThrow(/differs/)
  })

  it('cannot resume a run that does not exist', () => {
    expect(() => open(identity, true)).toThrow(/cannot resume/)
  })

  it('refuses to resume a run that used a different --max-history-turns, naming both', () => {
    open({ ...identity, maxHistoryTurns: 12 }, false)
    expect(() => open({ ...identity, maxHistoryTurns: null }, true)).toThrow(
      /--max-history-turns.*12.*\(none\)/,
    )
    expect(() => open({ ...identity, maxHistoryTurns: 20 }, true)).toThrow(
      /--max-history-turns.*12.*20/,
    )
  })

  it('resumes a run.json written before --max-history-turns existed as an uncapped run', () => {
    const first = open(identity, false)
    const legacy = JSON.parse(readFileSync(first.paths.meta, 'utf8'))
    delete legacy.identity.maxHistoryTurns
    writeFileSync(first.paths.meta, JSON.stringify(legacy))
    expect(open(identity, true).meta.identity.maxHistoryTurns).toBeNull()
  })

  it('writes run.json atomically (no temp file is left next to it)', () => {
    const { paths } = open(identity, false)
    expect(readdirSync(paths.dir)).toEqual(['run.json'])
  })
})
