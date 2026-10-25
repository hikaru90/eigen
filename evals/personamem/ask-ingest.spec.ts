import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  insertEvalUserRow: vi.fn(),
  deleteEvalUserRow: vi.fn(),
  getOrCreateSession: vi.fn(),
  runAskTurn: vi.fn(),
  processCaptureEnrichQueue: vi.fn(),
  withEvalDb: vi.fn(),
  events: [] as string[],
}))

vi.mock('$lib/eval/store', () => ({
  insertEvalUserRow: m.insertEvalUserRow,
  deleteEvalUserRow: m.deleteEvalUserRow,
}))
vi.mock('$lib/server/chat/run-ask-turn', () => ({
  getOrCreateSession: m.getOrCreateSession,
  runAskTurn: m.runAskTurn,
}))
vi.mock('$lib/server/capture/enrich-queued-thought', () => ({
  processCaptureEnrichQueue: m.processCaptureEnrichQueue,
}))
vi.mock('../harness/eval-context', () => ({ withEvalDb: m.withEvalDb, logEval: vi.fn() }))
vi.mock('../harness/wait-enrichment', () => ({
  waitForThoughtEnrichmentComplete: vi.fn(),
  loadThoughtEnrichmentTargets: vi.fn(),
}))
vi.mock('../public-bench/cost', () => ({ tenantTotalUsd: vi.fn() }))

import type { AskToolCall } from '$lib/server/chat/run-ask-turn'
import { ingestTenantViaAsk, type AskIngestDeps } from './ask-ingest'

const D1 = new Date('2025-01-01T00:00:00.000Z')
const D2 = new Date('2025-01-02T00:00:00.000Z')
const D3 = new Date('2025-01-03T00:00:00.000Z')
const turns = [
  { rawText: 'first', capturedAt: D1 },
  { rawText: 'second', capturedAt: D2 },
  { rawText: 'third', capturedAt: D3 },
]

const base = {
  tenantUserId: 'public-bench-personamem-v2-ask-gpt-4o-mini-p7',
  personaId: 7,
  billingUserId: 'public-bench-runner',
  chatModel: 'openai/gpt-4o-mini',
  turns,
  enrichConcurrency: 1,
}

type Thought = { id: string; createdAt: Date }

/** Fake world: the Ask turn n stores whatever `script[n]` says. */
function makeDeps(
  script: {
    toolCalls: AskToolCall[]
    stores?: Thought[]
  }[],
) {
  const stored: Thought[] = []
  let turn = -1
  let usd = 0
  const deps: AskIngestDeps = {
    runTurn: vi.fn(async ({ message, sessionId }) => {
      turn += 1
      m.events.push(`turn:${message}:${sessionId}`)
      stored.push(...(script[turn]!.stores ?? []))
      usd += 0.01
      return { toolCalls: script[turn]!.toolCalls }
    }),
    listThoughts: vi.fn(async () => stored.map((t) => ({ ...t }))),
    drainQueue: vi.fn(async () => {
      m.events.push('drain')
      usd += 0.001
    }),
    waitEnriched: vi.fn(async (_tenant, ids) => void m.events.push(`wait:${ids.join(',')}`)),
    totalUsd: vi.fn(async () => usd),
  }
  return deps
}

const call = (tool: string, failed = false) => ({ tool, arguments: {}, failed })

describe('ingestTenantViaAsk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.events.length = 0
    m.deleteEvalUserRow.mockImplementation(async () => void m.events.push('delete'))
    m.insertEvalUserRow.mockImplementation(async () => void m.events.push('insert'))
    m.getOrCreateSession.mockImplementation(async () => {
      m.events.push('session')
      return { sessionId: 's1', mode: 'default' }
    })
    m.withEvalDb.mockImplementation(async (_u: string, fn: (db: unknown) => Promise<unknown>) =>
      fn({ db: true }),
    )
  })

  it('resets the tenant, opens one session, then runs turn -> drain -> wait per turn in order', async () => {
    const deps = makeDeps([
      { toolCalls: [call('capture_thought')], stores: [{ id: 'a', createdAt: D1 }] },
      { toolCalls: [call('answer_question')] },
      {
        toolCalls: [call('capture_thought'), call('capture_thought')],
        stores: [
          { id: 'b', createdAt: D3 },
          { id: 'c', createdAt: D3 },
        ],
      },
    ])
    await ingestTenantViaAsk({ ...base, deps })

    expect(m.events).toEqual([
      'delete',
      'insert',
      'session',
      'turn:first:s1',
      'drain',
      'wait:a',
      'turn:second:s1',
      'drain',
      'turn:third:s1',
      'drain',
      'wait:b,c',
    ])
    expect(m.getOrCreateSession).toHaveBeenCalledTimes(1)
    expect(m.getOrCreateSession.mock.calls[0]!.slice(1)).toEqual([
      base.tenantUserId,
      null,
      'default',
    ])
  })

  it("runs each turn under the tenant with billing, chat model and that turn's clock", async () => {
    await ingestTenantViaAsk({
      ...base,
      deps: makeDeps([{ toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }]),
    })
    const billing = { billingUserId: 'public-bench-runner', chatModel: 'openai/gpt-4o-mini' }
    const clocks = m.withEvalDb.mock.calls
      .filter(([, , options]) => options && 'clock' in options)
      .map(([user, , options]) => {
        expect(user).toBe(base.tenantUserId)
        expect(options).toMatchObject(billing)
        return (options as { clock: Date }).clock.toISOString()
      })
    expect(clocks).toEqual([D1, D2, D3].map((d) => d.toISOString()))
    // session, drain and wait run without a clock (only the Ask tools read it)
    const clockless = m.withEvalDb.mock.calls.filter(([, , o]) => !o || !('clock' in o))
    expect(clockless.length).toBeGreaterThan(0)
    for (const [, , options] of clockless) expect(options).toEqual(billing)
  })

  it('drains with the persona enrich concurrency', async () => {
    const deps = makeDeps([{ toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }])
    await ingestTenantViaAsk({ ...base, enrichConcurrency: 3, deps })
    expect(deps.drainQueue).toHaveBeenCalledWith(base.tenantUserId, { concurrency: 3 })
  })

  it('records one row per turn: counts, tool names, USD split, clock mismatches', async () => {
    const deps = makeDeps([
      {
        toolCalls: [
          call('capture_thought'),
          call('capture_thought', true),
          call('answer_question'),
        ],
        stores: [{ id: 'a', createdAt: new Date('2025-06-01T00:00:00.000Z') }],
      },
      { toolCalls: [call('delete_thought'), call('delete_thoughts_by_request', true)] },
      { toolCalls: [] },
    ])
    const seen: unknown[] = []
    const records = await ingestTenantViaAsk({ ...base, deps, onTurn: (r) => seen.push(r) })

    expect(seen).toEqual(records)
    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({
      personaId: 7,
      tenantUserId: base.tenantUserId,
      turn: 0,
      clock: D1.toISOString(),
      captures: 1,
      deletes: 0,
      toolNames: ['capture_thought', 'capture_thought', 'answer_question'],
      thoughtsCreated: 1,
      clockMismatches: 1,
    })
    expect(records[0]!.askUsd).toBeCloseTo(0.01, 9)
    expect(records[0]!.enrichUsd).toBeCloseTo(0.001, 9)
    expect(records[0]!.usd).toBeCloseTo(0.011, 9)
    expect(records[0]!.ms).toBeGreaterThanOrEqual(0)
    expect(records[1]).toMatchObject({ turn: 1, captures: 0, deletes: 1, thoughtsCreated: 0 })
    expect(records[2]).toMatchObject({ turn: 2, captures: 0, deletes: 0, toolNames: [] })
  })

  it("finds a turn's thoughts by diffing the tenant's thought ids around the Ask turn", async () => {
    const deps = makeDeps([
      {
        toolCalls: [call('capture_thought')],
        stores: [
          { id: 'parent', createdAt: D1 },
          { id: 'child', createdAt: D1 },
        ],
      },
      { toolCalls: [call('capture_thought')], stores: [{ id: 'later', createdAt: D2 }] },
      { toolCalls: [] },
    ])
    const records = await ingestTenantViaAsk({ ...base, deps })
    expect(deps.waitEnriched).toHaveBeenNthCalledWith(
      1,
      base.tenantUserId,
      ['parent', 'child'],
      expect.anything(),
    )
    expect(deps.waitEnriched).toHaveBeenNthCalledWith(
      2,
      base.tenantUserId,
      ['later'],
      expect.anything(),
    )
    expect(deps.waitEnriched).toHaveBeenCalledTimes(2)
    // one capture call, two thoughts (split child) - both counted as created
    expect(records[0]).toMatchObject({ captures: 1, thoughtsCreated: 2, clockMismatches: 0 })
  })

  it('the default turn runner calls runAskTurn with persisted steps on the session', async () => {
    m.runAskTurn.mockResolvedValue({ answer: 'ok', toolCalls: [], messageId: 'm', messages: [] })
    const deps = makeDeps([{ toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }])
    const { listThoughts, drainQueue, waitEnriched, totalUsd } = deps
    await ingestTenantViaAsk({
      ...base,
      deps: { listThoughts, drainQueue, waitEnriched, totalUsd },
    })
    expect(m.runAskTurn).toHaveBeenCalledTimes(3)
    expect(m.runAskTurn.mock.calls[1]![0]).toMatchObject({
      userId: base.tenantUserId,
      sessionId: 's1',
      message: 'second',
      persistSteps: true,
    })
  })

  it('fails loud on a bad enrich concurrency, no turns, or a tenant that bills elsewhere', async () => {
    const deps = makeDeps([])
    await expect(ingestTenantViaAsk({ ...base, enrichConcurrency: 0, deps })).rejects.toThrow(
      /enrichConcurrency/,
    )
    await expect(ingestTenantViaAsk({ ...base, turns: [], deps })).rejects.toThrow(/turns/)
    await expect(
      ingestTenantViaAsk({ ...base, tenantUserId: 'someone-else', deps }),
    ).rejects.toThrow(/billing wallet/)
    expect(m.deleteEvalUserRow).not.toHaveBeenCalled()
  })

  it('stops at a failing Ask turn and does not drain or continue', async () => {
    const deps = makeDeps([{ toolCalls: [] }])
    deps.runTurn = vi.fn(async () => {
      throw new Error('agent exploded')
    })
    await expect(ingestTenantViaAsk({ ...base, deps })).rejects.toThrow(/agent exploded/)
    expect(deps.drainQueue).not.toHaveBeenCalled()
  })
})
