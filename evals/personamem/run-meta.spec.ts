import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadRunMeta, openRun, type RunIdentity } from './run-meta'

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
const open = (id: RunIdentity, resume: boolean, fresh = false) =>
  openRun({ runId: 'r1', identity: id, resume, fresh, reportsRoot: root })

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

  describe('fresh (whether the run was created with --fresh)', () => {
    it('is recorded in run.json at creation, true and false', () => {
      const fresh = open(identity, false, true)
      expect(JSON.parse(readFileSync(fresh.paths.meta, 'utf8')).fresh).toBe(true)
      expect(fresh.meta.fresh).toBe(true)

      const other = openRun({
        runId: 'r2',
        identity,
        resume: false,
        fresh: false,
        reportsRoot: root,
      })
      expect(JSON.parse(readFileSync(other.paths.meta, 'utf8')).fresh).toBe(false)
      expect(other.meta.fresh).toBe(false)
    })

    it('a resume (which cannot say --fresh) gets the recorded value back, not its own', () => {
      open(identity, false, true)
      expect(open(identity, true).meta.fresh).toBe(true)
    })

    it('a run created without --fresh stays fresh=false on resume', () => {
      open(identity, false, false)
      expect(open(identity, true).meta.fresh).toBe(false)
    })

    it('is not part of what a resume compares: a fresh run resumes with the identical invocation', () => {
      const first = open(identity, false, true)
      expect(open(identity, true).meta.startedAt).toBe(first.meta.startedAt)
    })

    it('a run.json written before the field existed was not created with --fresh (fresh=false)', () => {
      // Those files predate the field, so nothing recorded whether they were started with
      // --fresh. They are read as fresh=false and never guessed otherwise (e.g. from
      // processes.jsonl): a resume of such a run keeps refusing a tenant that holds thoughts.
      const first = open(identity, false, true)
      const legacy = JSON.parse(readFileSync(first.paths.meta, 'utf8'))
      delete legacy.fresh
      writeFileSync(first.paths.meta, JSON.stringify(legacy))
      expect(open(identity, true).meta.fresh).toBe(false)
      expect(loadRunMeta('r1', root).meta.fresh).toBe(false)
    })

    it('openRun refuses --fresh together with resume (the CLI already does; a silent ignore would hide it)', () => {
      open(identity, false, true)
      expect(() => open(identity, true, true)).toThrow(/--fresh.*--resume/s)
    })
  })

  it('writes run.json atomically (no temp file is left next to it)', () => {
    const { paths } = open(identity, false)
    expect(readdirSync(paths.dir)).toEqual(['run.json'])
  })
})
