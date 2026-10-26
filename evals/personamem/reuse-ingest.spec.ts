import type { PlannedPersona } from './plan'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PERSONAMEM_EPOCH } from './history-to-captures'
import { captureDigest, type IngestRecord } from './ingest-record'
import { loadIngestSource, verifyIngestRecords, verifyLiveTenant } from './reuse-ingest'
import { openRun, type RunIdentity } from './run-meta'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'personamem-reuse-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const identity: RunIdentity = {
  split: 'val',
  chatModel: 'deepseek/deepseek-v4.1-flash-1017',
  answer: 'ask',
  evidenceOnly: false,
  personaIds: [7, 9],
  questionIds: [],
  limitQueries: null,
  enrichConcurrency: 1,
  relevanceFloor: 'product',
  reuseIngest: null,
  maxHistoryTurns: null,
}

const captures = (...texts: string[]) =>
  texts.map((rawText, i) => ({
    rawText,
    capturedAt: new Date(PERSONAMEM_EPOCH.getTime() + i * 864e5),
  }))

const persona = (personaId: number, ...texts: string[]): PlannedPersona =>
  ({
    personaId,
    tenantUserId: `tenant-${personaId}`,
    captures: captures(...texts),
    referenceTime: new Date(),
    questions: [],
  }) as unknown as PlannedPersona

const recordFor = (p: PlannedPersona, extra: Partial<IngestRecord> = {}): IngestRecord => ({
  personaId: p.personaId,
  tenantUserId: p.tenantUserId,
  captures: p.captures.length,
  captureDigest: captureDigest(p.captures),
  thoughtIds: p.captures.map((_, i) => `th-${p.personaId}-${i}`),
  thoughtCount: p.captures.length + 1,
  usd: 1,
  ms: 1,
  ...extra,
})

const p7 = persona(7, 'a', 'b')
const p9 = persona(9, 'c')

function writeSource(runId: string, records: unknown[], id: RunIdentity = identity): void {
  const { paths } = openRun({ runId, identity: id, resume: false, reportsRoot: root })
  writeFileSync(paths.ingest, records.map((r) => `${JSON.stringify(r)}\n`).join(''))
}
const current = {
  split: 'val',
  chatModel: identity.chatModel,
  evidenceOnly: false,
  enrichConcurrency: 1,
} as const
const verify = (
  planned: PlannedPersona[],
  opts: { requireAll?: boolean; runId?: string; now?: typeof current } = {},
) => {
  const source = loadIngestSource(opts.runId ?? 'src', root)
  return verifyIngestRecords({
    sourceRunId: opts.runId ?? 'src',
    source,
    current: opts.now ?? current,
    planned,
    requireAll: opts.requireAll ?? true,
  })
}

describe('loadIngestSource', () => {
  it('reads the run identity and its ingest records', () => {
    writeSource('src', [recordFor(p7)])
    const source = loadIngestSource('src', root)
    expect(source.meta.identity.chatModel).toBe(identity.chatModel)
    expect(source.records).toEqual([recordFor(p7)])
  })

  it('fails loud when the run does not exist', () => {
    expect(() => loadIngestSource('nope', root)).toThrow(/nope.*not found/)
  })

  it('fails loud on a record that predates thought ids, telling the operator to re-ingest', () => {
    writeSource('src', [{ personaId: 7, tenantUserId: 'tenant-7', captures: 2, usd: 1, ms: 1 }])
    expect(() => loadIngestSource('src', root)).toThrow(/ingest\.jsonl row 1.*re-ingest/s)
  })
})

describe('verifyIngestRecords', () => {
  it('returns the record of every planned tenant', () => {
    writeSource('src', [recordFor(p7), recordFor(p9)])
    const verified = verify([p7, p9])
    expect([...verified.keys()]).toEqual(['tenant-7', 'tenant-9'])
    expect(verified.get('tenant-7')!.thoughtIds).toEqual(['th-7-0', 'th-7-1'])
  })

  it('accepts a plan that is a subset of what the source ingested', () => {
    writeSource('src', [recordFor(p7), recordFor(p9)])
    expect([...verify([p9]).keys()]).toEqual(['tenant-9'])
  })

  it.each([
    ['split', { split: 'benchmark' }, /--split.*val.*benchmark/],
    ['chat model', { chatModel: 'openai/gpt-4o-mini' }, /--chat-model.*deepseek.*gpt-4o-mini/],
    ['evidence-only', { evidenceOnly: true }, /--evidence-only/],
    ['enrich concurrency', { enrichConcurrency: 3 }, /--enrich-concurrency.*1.*3/],
  ])('refuses a source run with another %s', (_label, change, message) => {
    writeSource('src', [recordFor(p7)])
    expect(() => verify([p7], { now: { ...current, ...change } as typeof current })).toThrow(
      message,
    )
  })

  it('refuses a tenant the source run did not ingest, naming tenant and run', () => {
    writeSource('src', [recordFor(p7)])
    expect(() => verify([p7, p9])).toThrow(/src did not ingest tenant tenant-9/)
  })

  it('refuses when the planned history has another number of captures than was ingested', () => {
    writeSource('src', [recordFor(p7)])
    expect(() => verify([persona(7, 'a', 'b', 'extra')])).toThrow(/tenant-7.*2.*3/s)
  })

  it('refuses when the captures differ although their number matches', () => {
    writeSource('src', [recordFor(p7)])
    expect(() => verify([persona(7, 'a', 'CHANGED')])).toThrow(/tenant-7.*different captures/s)
  })

  it('refuses a record whose thought ids do not match its capture count', () => {
    writeSource('src', [recordFor(p7, { thoughtIds: ['only-one'] })])
    expect(() => verify([p7])).toThrow(/tenant-7.*1 thought id.*2 capture/s)
  })

  it('refuses two records for one tenant', () => {
    writeSource('src', [recordFor(p7), recordFor(p7)])
    expect(() => verify([p7])).toThrow(/tenant-7.*more than once/s)
  })

  it('refuses a record that lists the same thought twice', () => {
    writeSource('src', [recordFor(p7, { thoughtIds: ['x', 'x'] })])
    expect(() => verify([p7])).toThrow(/tenant-7.*twice/s)
  })

  describe('own run (resume): tenants not ingested yet are fine, wrong ones are not', () => {
    it('skips tenants without a record', () => {
      writeSource('src', [recordFor(p7)])
      expect([...verify([p7, p9], { requireAll: false }).keys()]).toEqual(['tenant-7'])
    })

    it('still refuses a record that does not match the plan', () => {
      writeSource('src', [recordFor(p7)])
      expect(() => verify([persona(7, 'a', 'CHANGED'), p9], { requireAll: false })).toThrow(
        /different captures/,
      )
    })
  })
})

describe('verifyLiveTenant', () => {
  const record = recordFor(p7)
  const live = (ids: string[], count = record.thoughtCount) => ({
    thoughtIds: new Set(ids),
    thoughtCount: count,
  })

  it('accepts a tenant that still holds the ingested thoughts', () => {
    expect(() =>
      verifyLiveTenant({ sourceRunId: 'src', record, live: live([...record.thoughtIds, 'child']) }),
    ).not.toThrow()
  })

  it('refuses a tenant that lost or never had a recorded thought, naming it', () => {
    expect(() =>
      verifyLiveTenant({ sourceRunId: 'src', record, live: live(['th-7-0', 'child']) }),
    ).toThrow(/tenant-7.*th-7-1/s)
  })

  it('refuses a tenant whose thought count changed (re-ingested, edited or answered into)', () => {
    expect(() =>
      verifyLiveTenant({ sourceRunId: 'src', record, live: live(record.thoughtIds, 9) }),
    ).toThrow(/tenant-7.*3.*9/s)
  })
})
