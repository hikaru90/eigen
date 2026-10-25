import { mkdtempSync, rmSync } from 'node:fs'
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
}
const open = (id: RunIdentity, resume: boolean) =>
  openRun({ runId: 'r1', identity: id, resume, reportsRoot: root })

describe('openRun', () => {
  it('creates the run directory and refuses to reuse it without --resume', () => {
    const { paths } = open(identity, false)
    expect(paths.smoke).toBe(join(paths.dir, 'smoke.jsonl'))
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
})
