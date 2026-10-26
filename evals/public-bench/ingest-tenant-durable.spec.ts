import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  insertEvalUserRow: vi.fn(),
  deleteEvalUserRow: vi.fn(),
  queueCapture: vi.fn(),
  processCaptureEnrichQueue: vi.fn(),
  withEvalDb: vi.fn(),
  waitForThoughtEnrichmentComplete: vi.fn(),
  loadThoughtEnrichmentTargets: vi.fn(),
  logEval: vi.fn(),
  events: [] as string[],
}))

vi.mock('$lib/eval/store', () => ({
  insertEvalUserRow: m.insertEvalUserRow,
  deleteEvalUserRow: m.deleteEvalUserRow,
}))
vi.mock('$lib/server/capture/queue-capture', () => ({ queueCapture: m.queueCapture }))
vi.mock('$lib/server/capture/enrich-queued-thought', () => ({
  processCaptureEnrichQueue: m.processCaptureEnrichQueue,
}))
vi.mock('../harness/eval-context', () => ({ withEvalDb: m.withEvalDb, logEval: m.logEval }))
vi.mock('../harness/wait-enrichment', () => ({
  waitForThoughtEnrichmentComplete: m.waitForThoughtEnrichmentComplete,
  loadThoughtEnrichmentTargets: m.loadThoughtEnrichmentTargets,
}))

import { RunStopped } from '../harness/stop-signal'
import { loadIngestProgress, appendEnriched, appendQueued } from './ingest-progress'
import { ingestTenant, type IngestStore } from './ingest-tenant'
import { readJsonl } from './run-output'

const TENANT = 'public-bench-test-t1'
const items = [0, 1, 2, 3].map((i) => ({
  rawText: `capture ${i}`,
  capturedAt: new Date(Date.UTC(2025, 0, 1 + i)),
}))

let dir: string
let progressPath: string

function fakeStore(overrides: Partial<IngestStore> = {}): IngestStore {
  return {
    resetTenant: vi.fn(async () => void m.events.push('reset')),
    ensureTenant: vi.fn(async () => void m.events.push('ensure')),
    thoughtCount: vi.fn(async () => 0),
    rootCount: vi.fn(async () => 0),
    families: vi.fn(
      async (_tenant: string, rootIds: string[]) =>
        new Map(rootIds.map((id) => [id, [id, `${id}-child`]])),
    ),
    verifyRecorded: vi.fn(async () => ({ missing: [], unenriched: [] })),
    ...overrides,
  }
}

function durable(
  store: IngestStore,
  extra: { fresh?: boolean; resuming?: boolean; stop?: () => boolean } = {},
) {
  const progress = loadIngestProgress(progressPath).get(TENANT) ?? {
    queued: [],
    enriched: new Map(),
  }
  return {
    progressPath,
    progress,
    fresh: extra.fresh ?? false,
    resuming: extra.resuming ?? false,
    store,
    counters: { skipped: 0, reenriched: 0, queued: 0 },
    ...(extra.stop ? { shouldStop: extra.stop } : {}),
  }
}

const base = {
  tenantUserId: TENANT,
  billingUserId: 'public-bench-runner',
  chatModel: 'openai/gpt-4o-mini',
  items,
  enrichConcurrency: 2,
}

describe('ingestTenant (durable)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'ingest-durable-'))
    progressPath = join(dir, 'ingest-progress.jsonl')
    m.events.length = 0
    m.withEvalDb.mockImplementation(async (_u: string, fn: (db: unknown) => Promise<unknown>) =>
      fn({ db: true }),
    )
    let n = 0
    m.queueCapture.mockImplementation(async (_u: string, text: string) => {
      n += 1
      m.events.push(`queue:${text}`)
      return { thoughtId: `t${n}` }
    })
    m.processCaptureEnrichQueue.mockImplementation(async () => void m.events.push('drain'))
    m.loadThoughtEnrichmentTargets.mockImplementation(
      async (_db: unknown, _u: string, ids: string[]) =>
        ids.map((id) => ({ id, normalizedText: id })),
    )
    m.waitForThoughtEnrichmentComplete.mockImplementation(async () => void m.events.push('wait'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes queued right after each queue and enriched after the wave drained and waited', async () => {
    const ids = await ingestTenant({ ...base, durable: durable(fakeStore(), { fresh: true }) })

    expect(ids).toEqual(['t1', 't2', 't3', 't4'])
    expect(readJsonl(progressPath).map((r) => `${r.type}:${r.index}`)).toEqual([
      'queued:0',
      'queued:1',
      'enriched:0',
      'enriched:1',
      'queued:2',
      'queued:3',
      'enriched:2',
      'enriched:3',
    ])
    expect(readJsonl(progressPath)[2]).toMatchObject({ thoughtIds: ['t1', 't1-child'] })
    // a queued row is on disk before the drain starts
    expect(m.events).toEqual([
      'reset',
      'queue:capture 0',
      'queue:capture 1',
      'drain',
      'wait',
      'queue:capture 2',
      'queue:capture 3',
      'drain',
      'wait',
    ])
  })

  it('resumes a tenant whose wave 1 is enriched: nothing is queued or enriched again for it', async () => {
    appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
    appendQueued(progressPath, { tenant: TENANT, index: 1, thoughtId: 'b' })
    appendEnriched(progressPath, { tenant: TENANT, index: 0, thoughtIds: ['a', 'a-child'] })
    appendEnriched(progressPath, { tenant: TENANT, index: 1, thoughtIds: ['b'] })
    const store = fakeStore({ rootCount: vi.fn(async () => 2) })
    const d = durable(store)

    const ids = await ingestTenant({ ...base, durable: d })

    expect(ids).toEqual(['a', 'b', 't1', 't2'])
    expect(m.events).toEqual(['queue:capture 2', 'queue:capture 3', 'drain', 'wait'])
    expect(store.resetTenant).not.toHaveBeenCalled()
    expect(store.ensureTenant).not.toHaveBeenCalled()
    expect(store.verifyRecorded).toHaveBeenCalledTimes(1)
    expect(d.counters).toEqual({ skipped: 2, reenriched: 0, queued: 2 })
  })

  it('a queued-but-not-enriched capture is re-enriched, never queued again', async () => {
    appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
    appendQueued(progressPath, { tenant: TENANT, index: 1, thoughtId: 'b' })
    appendEnriched(progressPath, { tenant: TENANT, index: 0, thoughtIds: ['a'] })
    const store = fakeStore({ rootCount: vi.fn(async () => 2) })
    const d = durable(store)

    await ingestTenant({ ...base, items: items.slice(0, 2), durable: d })

    expect(m.events).toEqual(['drain', 'wait'])
    expect(m.queueCapture).not.toHaveBeenCalled()
    expect(m.loadThoughtEnrichmentTargets).toHaveBeenCalledWith(expect.anything(), TENANT, [
      'a',
      'b',
    ])
    expect(readJsonl(progressPath).slice(-1)).toMatchObject([
      { type: 'enriched', index: 1, thoughtIds: ['b', 'b-child'] },
    ])
    expect(d.counters).toMatchObject({ skipped: 1, reenriched: 1, queued: 0 })
  })

  it('a half-queued wave queues only the missing capture and enriches the wave', async () => {
    appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
    const store = fakeStore({ rootCount: vi.fn(async () => 1) })

    const ids = await ingestTenant({ ...base, items: items.slice(0, 2), durable: durable(store) })

    expect(ids).toEqual(['a', 't1'])
    expect(m.events).toEqual(['queue:capture 1', 'drain', 'wait'])
  })

  it('a fully finished tenant makes no call at all', async () => {
    for (let i = 0; i < 4; i++) {
      appendQueued(progressPath, { tenant: TENANT, index: i, thoughtId: `x${i}` })
      appendEnriched(progressPath, { tenant: TENANT, index: i, thoughtIds: [`x${i}`] })
    }
    const store = fakeStore({ rootCount: vi.fn(async () => 4) })
    const ids = await ingestTenant({ ...base, durable: durable(store) })
    expect(ids).toEqual(['x0', 'x1', 'x2', 'x3'])
    expect(m.events).toEqual([])
    expect(m.withEvalDb).not.toHaveBeenCalled()
  })

  it('without --fresh a tenant that already holds thoughts is refused, not wiped and not doubled', async () => {
    const store = fakeStore({ thoughtCount: vi.fn(async () => 7) })
    await expect(ingestTenant({ ...base, durable: durable(store) })).rejects.toThrow(
      /already holds 7 thought.*--fresh/s,
    )
    expect(store.resetTenant).not.toHaveBeenCalled()
    expect(m.queueCapture).not.toHaveBeenCalled()
  })

  it('without --fresh an empty tenant is simply used (created if needed)', async () => {
    const store = fakeStore()
    await ingestTenant({ ...base, durable: durable(store) })
    expect(store.ensureTenant).toHaveBeenCalledWith(TENANT)
    expect(store.resetTenant).not.toHaveBeenCalled()
  })

  it('--fresh resets the tenant before its first capture', async () => {
    const store = fakeStore()
    await ingestTenant({ ...base, durable: durable(store, { fresh: true }) })
    expect(store.resetTenant).toHaveBeenCalledWith(TENANT)
    expect(m.events[0]).toBe('reset')
  })

  describe('a run created with --fresh, resumed (run.json fresh=true, this process --resume)', () => {
    const held = (n: number) => fakeStore({ thoughtCount: vi.fn(async () => n) })
    const logged = () => m.logEval.mock.calls.map((c) => String(c[0]))

    it('resets a tenant with no recorded progress, even though it holds thoughts from an older run, and ingests it from zero', async () => {
      const store = held(143)

      const ids = await ingestTenant({
        ...base,
        durable: durable(store, { fresh: true, resuming: true }),
      })

      expect(store.resetTenant).toHaveBeenCalledTimes(1)
      expect(store.resetTenant).toHaveBeenCalledWith(TENANT)
      expect(store.ensureTenant).not.toHaveBeenCalled()
      expect(m.events[0]).toBe('reset')
      expect(m.events.indexOf('reset')).toBeLessThan(m.events.indexOf('queue:capture 0'))
      expect(ids).toEqual(['t1', 't2', 't3', 't4'])
      expect(readJsonl(progressPath).filter((r) => r.type === 'enriched')).toHaveLength(4)
    })

    it('says so clearly: the tenant, that it had no recorded capture, that this is a resume of a --fresh run', async () => {
      await ingestTenant({ ...base, durable: durable(held(143), { fresh: true, resuming: true }) })

      const line = logged().find((l) => /reset/i.test(l))
      expect(line).toBeDefined()
      expect(line).toContain(TENANT)
      expect(line).toMatch(/resum/i)
      expect(line).toMatch(/--fresh/)
      expect(line).toMatch(/no (recorded )?capture/i)
    })

    it('a tenant that already has recorded captures is never reset (progress kept, nothing re-queued)', async () => {
      appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
      appendQueued(progressPath, { tenant: TENANT, index: 1, thoughtId: 'b' })
      appendEnriched(progressPath, { tenant: TENANT, index: 0, thoughtIds: ['a'] })
      appendEnriched(progressPath, { tenant: TENANT, index: 1, thoughtIds: ['b'] })
      const store = fakeStore({ rootCount: vi.fn(async () => 2) })
      const d = durable(store, { fresh: true, resuming: true })

      const ids = await ingestTenant({ ...base, durable: d })

      expect(store.resetTenant).not.toHaveBeenCalled()
      expect(store.ensureTenant).not.toHaveBeenCalled()
      expect(ids).toEqual(['a', 'b', 't1', 't2'])
      expect(m.events).toEqual(['queue:capture 2', 'queue:capture 3', 'drain', 'wait'])
      expect(d.counters).toEqual({ skipped: 2, reenriched: 0, queued: 2 })
      expect(logged().some((l) => /reset/i.test(l))).toBe(false)
    })

    it('a tenant with a single queued-but-not-enriched capture counts as started: never reset', async () => {
      appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
      const store = fakeStore({ rootCount: vi.fn(async () => 1) })

      await ingestTenant({
        ...base,
        items: items.slice(0, 2),
        durable: durable(store, { fresh: true, resuming: true }),
      })

      expect(store.resetTenant).not.toHaveBeenCalled()
      expect(m.events).toEqual(['queue:capture 1', 'drain', 'wait'])
    })

    it('a started tenant still goes through every resume check (orphan root thoughts fail loud, no reset)', async () => {
      appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
      const store = fakeStore({ rootCount: vi.fn(async () => 2) })
      await expect(
        ingestTenant({ ...base, durable: durable(store, { fresh: true, resuming: true }) }),
      ).rejects.toThrow(/2 root thought.*1 queued/s)
      expect(store.resetTenant).not.toHaveBeenCalled()
      expect(m.queueCapture).not.toHaveBeenCalled()
    })

    it('the first start of a --fresh run resets as before and does not claim to be a resume', async () => {
      const store = held(0)
      await ingestTenant({ ...base, durable: durable(store, { fresh: true, resuming: false }) })
      expect(store.resetTenant).toHaveBeenCalledWith(TENANT)
      expect(logged().some((l) => /resum/i.test(l) && /reset/i.test(l))).toBe(false)
    })
  })

  describe('a run created without --fresh, resumed (run.json fresh=false or absent)', () => {
    it('a tenant with no recorded progress that holds thoughts still fails loud: no reset, nothing queued', async () => {
      const store = fakeStore({ thoughtCount: vi.fn(async () => 143) })
      await expect(
        ingestTenant({ ...base, durable: durable(store, { fresh: false, resuming: true }) }),
      ).rejects.toThrow(/already holds 143 thought.*--fresh/s)
      expect(store.resetTenant).not.toHaveBeenCalled()
      expect(m.queueCapture).not.toHaveBeenCalled()
      expect(m.logEval.mock.calls.map((c) => String(c[0])).some((l) => /reset/i.test(l))).toBe(
        false,
      )
    })

    it('an empty tenant is simply used on resume (created if needed)', async () => {
      const store = fakeStore()
      await ingestTenant({ ...base, durable: durable(store, { fresh: false, resuming: true }) })
      expect(store.ensureTenant).toHaveBeenCalledWith(TENANT)
      expect(store.resetTenant).not.toHaveBeenCalled()
    })
  })

  it('fails loud when an enriched thought is missing in the database', async () => {
    appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
    appendEnriched(progressPath, { tenant: TENANT, index: 0, thoughtIds: ['a', 'gone'] })
    const store = fakeStore({
      rootCount: vi.fn(async () => 1),
      verifyRecorded: vi.fn(async () => ({ missing: ['gone'], unenriched: [] })),
    })
    await expect(ingestTenant({ ...base, durable: durable(store) })).rejects.toThrow(
      /not in the database.*gone/s,
    )
    expect(m.queueCapture).not.toHaveBeenCalled()
  })

  it('fails loud when a recorded-as-enriched thought has no enriched_at', async () => {
    appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
    appendEnriched(progressPath, { tenant: TENANT, index: 0, thoughtIds: ['a'] })
    const store = fakeStore({
      rootCount: vi.fn(async () => 1),
      verifyRecorded: vi.fn(async () => ({ missing: [], unenriched: ['a'] })),
    })
    await expect(ingestTenant({ ...base, durable: durable(store) })).rejects.toThrow(
      /enriched in the progress file.*not enriched/s,
    )
  })

  it('fails loud when the tenant holds a root thought the progress file never recorded (orphan)', async () => {
    appendQueued(progressPath, { tenant: TENANT, index: 0, thoughtId: 'a' })
    const store = fakeStore({ rootCount: vi.fn(async () => 2) })
    await expect(ingestTenant({ ...base, durable: durable(store) })).rejects.toThrow(
      /2 root thought.*1 queued/s,
    )
    expect(m.queueCapture).not.toHaveBeenCalled()
  })

  it('a stop request before a wave throws RunStopped and queues nothing more', async () => {
    let calls = 0
    const stop = () => ++calls > 1
    const store = fakeStore()
    await expect(
      ingestTenant({ ...base, durable: durable(store, { fresh: true, stop }) }),
    ).rejects.toBeInstanceOf(RunStopped)
    // wave 1 ran to completion, wave 2 never started
    expect(readJsonl(progressPath).map((r) => `${r.type}:${r.index}`)).toEqual([
      'queued:0',
      'queued:1',
      'enriched:0',
      'enriched:1',
    ])
  })
})
