import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  insertEvalUserRow: vi.fn(),
  deleteEvalUserRow: vi.fn(),
  queueCapture: vi.fn(),
  processCaptureEnrichQueue: vi.fn(),
  withEvalDb: vi.fn(),
  waitForThoughtEnrichmentComplete: vi.fn(),
  loadThoughtEnrichmentTargets: vi.fn(),
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
vi.mock('../harness/eval-context', () => ({ withEvalDb: m.withEvalDb, logEval: vi.fn() }))
vi.mock('../harness/wait-enrichment', () => ({
  waitForThoughtEnrichmentComplete: m.waitForThoughtEnrichmentComplete,
  loadThoughtEnrichmentTargets: m.loadThoughtEnrichmentTargets,
}))

import { ingestTenant } from './ingest-tenant'

const items = [
  { rawText: 'first', capturedAt: new Date('2025-01-01T00:00:00Z') },
  { rawText: 'second', capturedAt: new Date('2025-01-01T00:01:00Z') },
  { rawText: 'third', capturedAt: new Date('2025-01-01T00:02:00Z') },
]

const base = {
  tenantUserId: 'public-bench-test-t1',
  billingUserId: 'public-bench-runner',
  items,
  enrichConcurrency: 1,
  chatModel: 'openai/gpt-4o-mini',
}

describe('ingestTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.events.length = 0
    m.deleteEvalUserRow.mockImplementation(async () => void m.events.push('delete'))
    m.insertEvalUserRow.mockImplementation(async () => void m.events.push('insert'))
    m.withEvalDb.mockImplementation(async (_user: string, fn: (db: unknown) => Promise<unknown>) =>
      fn({ db: true }),
    )
    let n = 0
    m.queueCapture.mockImplementation(async (_user: string, text: string) => {
      m.events.push(`queue:${text}`)
      n += 1
      return { thoughtId: `t${n}` }
    })
    m.processCaptureEnrichQueue.mockImplementation(async () => void m.events.push('drain'))
    m.loadThoughtEnrichmentTargets.mockImplementation(
      async (_db: unknown, _user: string, ids: string[]) =>
        ids.map((id) => ({ id, normalizedText: `n-${id}` })),
    )
    m.waitForThoughtEnrichmentComplete.mockImplementation(async () => void m.events.push('wait'))
  })

  it('resets the tenant, queues in order, drains with the explicit concurrency, waits', async () => {
    const ids = await ingestTenant({ ...base, enrichConcurrency: 3 })

    expect(ids).toEqual(['t1', 't2', 't3'])
    expect(m.events).toEqual([
      'delete',
      'insert',
      'queue:first',
      'queue:second',
      'queue:third',
      'drain',
      'wait',
    ])
    expect(m.deleteEvalUserRow).toHaveBeenCalledWith('public-bench-test-t1')
    expect(m.insertEvalUserRow).toHaveBeenCalledWith('public-bench-test-t1', expect.any(String))

    expect(m.queueCapture).toHaveBeenNthCalledWith(1, 'public-bench-test-t1', 'first', {
      source: 'eval',
      skipWorker: true,
      capturedAt: items[0].capturedAt,
    })
    expect(m.processCaptureEnrichQueue).toHaveBeenCalledWith('public-bench-test-t1', {
      concurrency: 3,
    })
    expect(m.waitForThoughtEnrichmentComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'public-bench-test-t1',
        targets: [
          { id: 't1', normalizedText: 'n-t1' },
          { id: 't2', normalizedText: 'n-t2' },
          { id: 't3', normalizedText: 'n-t3' },
        ],
        withEvalDbOptions: {
          billingUserId: 'public-bench-runner',
          chatModel: 'openai/gpt-4o-mini',
        },
      }),
    )
    for (const call of m.withEvalDb.mock.calls) {
      expect(call[0]).toBe('public-bench-test-t1')
      expect(call[2]).toEqual({
        billingUserId: 'public-bench-runner',
        chatModel: 'openai/gpt-4o-mini',
      })
    }
  })

  it('passes chatModel to every withEvalDb call, including the wait kick options', async () => {
    await ingestTenant({ ...base, chatModel: 'deepseek/deepseek-v4.1-flash-1017' })

    expect(m.withEvalDb.mock.calls.length).toBeGreaterThan(0)
    for (const call of m.withEvalDb.mock.calls) {
      expect(call[2]).toEqual({
        billingUserId: 'public-bench-runner',
        chatModel: 'deepseek/deepseek-v4.1-flash-1017',
      })
    }
    expect(m.waitForThoughtEnrichmentComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        withEvalDbOptions: {
          billingUserId: 'public-bench-runner',
          chatModel: 'deepseek/deepseek-v4.1-flash-1017',
        },
      }),
    )
  })

  it('requires a non-blank chatModel before any DB work', async () => {
    await expect(ingestTenant({ ...base, chatModel: ' ' })).rejects.toThrow(/chatModel/)
    expect(m.deleteEvalUserRow).not.toHaveBeenCalled()
    expect(m.withEvalDb).not.toHaveBeenCalled()
  })

  it('does not swallow a failing tenant reset', async () => {
    m.deleteEvalUserRow.mockRejectedValue(new Error('db down'))
    await expect(ingestTenant({ ...base })).rejects.toThrow('db down')
    expect(m.queueCapture).not.toHaveBeenCalled()
  })

  it('propagates a queueCapture failure and never drains', async () => {
    m.queueCapture.mockRejectedValueOnce(new Error('402 no credits'))
    await expect(ingestTenant({ ...base })).rejects.toThrow('402 no credits')
    expect(m.processCaptureEnrichQueue).not.toHaveBeenCalled()
  })

  it('ingests in waves of enrichConcurrency: queue a wave, drain, wait, then the next wave', async () => {
    const events: string[] = []
    let n = 0
    const queueItem = vi.fn(async (_tenant: string, item: { rawText: string }) => {
      events.push('queue')
      n += 1
      return `w${n}:${item.rawText}`
    })
    const drainQueue = vi.fn(async () => void events.push('drain'))
    m.waitForThoughtEnrichmentComplete.mockImplementation(async () => void events.push('wait'))
    const five = Array.from({ length: 5 }, (_, i) => ({
      rawText: `item${i + 1}`,
      capturedAt: new Date(Date.UTC(2025, 0, 1, 0, i)),
    }))

    const ids = await ingestTenant({
      ...base,
      items: five,
      enrichConcurrency: 2,
      queueItem,
      drainQueue,
    })

    expect(events.filter((e) => e !== 'wait')).toEqual([
      'queue',
      'queue',
      'drain',
      'queue',
      'queue',
      'drain',
      'queue',
      'drain',
    ])
    // each wave is fully enriched before the next one is queued
    expect(events).toEqual([
      'queue',
      'queue',
      'drain',
      'wait',
      'queue',
      'queue',
      'drain',
      'wait',
      'queue',
      'drain',
      'wait',
    ])
    expect(ids).toEqual(['w1:item1', 'w2:item2', 'w3:item3', 'w4:item4', 'w5:item5'])
    expect(drainQueue).toHaveBeenCalledWith('public-bench-test-t1', { concurrency: 2 })
    expect(m.waitForThoughtEnrichmentComplete.mock.calls.map((c) => c[0].targets.length)).toEqual([
      2, 2, 1,
    ])
  })

  it('enrichConcurrency 1 is strictly incremental', async () => {
    const events: string[] = []
    await ingestTenant({
      ...base,
      enrichConcurrency: 1,
      queueItem: async () => {
        events.push('queue')
        return `x${events.length}`
      },
      drainQueue: async () => void events.push('drain'),
    })
    expect(events).toEqual(['queue', 'drain', 'queue', 'drain', 'queue', 'drain'])
  })

  it('rejects a tenant whose harness billing wallet is not the given billing user', async () => {
    await expect(ingestTenant({ ...base, billingUserId: 'longmemeval-runner' })).rejects.toThrow(
      /public-bench-test-t1.*public-bench-runner.*longmemeval-runner/s,
    )
    await expect(ingestTenant({ ...base, tenantUserId: 'not-a-harness-tenant' })).rejects.toThrow(
      /not-a-harness-tenant/,
    )
    expect(m.deleteEvalUserRow).not.toHaveBeenCalled()
    expect(m.withEvalDb).not.toHaveBeenCalled()
  })

  it('keeps LongMemEval tenants valid', async () => {
    await expect(
      ingestTenant({
        ...base,
        tenantUserId: 'longmemeval-corpus-q1',
        billingUserId: 'longmemeval-runner',
      }),
    ).resolves.toHaveLength(3)
  })

  it('rejects an invalid enrichConcurrency before any DB work', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(ingestTenant({ ...base, enrichConcurrency: bad })).rejects.toThrow(
        /enrichConcurrency/,
      )
    }
    expect(m.deleteEvalUserRow).not.toHaveBeenCalled()
    expect(m.withEvalDb).not.toHaveBeenCalled()
  })

  it('rejects empty items and blank ids', async () => {
    await expect(ingestTenant({ ...base, items: [] })).rejects.toThrow(/items/)
    await expect(ingestTenant({ ...base, tenantUserId: ' ' })).rejects.toThrow(/tenantUserId/)
    await expect(ingestTenant({ ...base, billingUserId: '' })).rejects.toThrow(/billingUserId/)
  })
})
