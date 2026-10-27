import { beforeEach, describe, expect, it, vi } from 'vitest'

// The temporal chain of a queued capture, end to end with a fake LLM: the enrich bundle reply is
// parsed by the real bundle code, `enrichQueuedThought` hands the mentions on, and the real
// temporal sync writes the `temporal_event` row. Only the LLM client, the database stub and the
// side services around them are faked. It pins what the operator saw go wrong at capture:
// "Yoga every Tuesday at 7pm" became one event with no recurrence rule, and an event whose summary
// was just "Friday". A reply that breaks the contract is asked again by the ingest retry ladder.

const {
  getDbMock,
  llmChatCompletionMock,
  applyCaptureContentSplitIfNeededMock,
  loadEnrichmentContextMock,
  decryptTenantValueMock,
  encryptTenantValueMock,
  getUserPreferredTimezoneMock,
  createThoughtEmbeddingMock,
  enqueueUserJobMock,
  enrichThoughtMock,
  markEnrichQueueFailedMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
  applyCaptureContentSplitIfNeededMock: vi.fn(),
  loadEnrichmentContextMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
  encryptTenantValueMock: vi.fn(),
  getUserPreferredTimezoneMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  enqueueUserJobMock: vi.fn(),
  enrichThoughtMock: vi.fn(),
  markEnrichQueueFailedMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/llm-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/llm/llm-client')>()),
  llmChatCompletion: llmChatCompletionMock,
}))
vi.mock('$lib/server/llm/embedding', () => ({ createThoughtEmbedding: createThoughtEmbeddingMock }))
vi.mock('$lib/server/capture/apply-capture-content-split', () => ({
  applyCaptureContentSplitIfNeeded: applyCaptureContentSplitIfNeededMock,
}))
vi.mock('$lib/server/capture/enrich', () => ({ enrichThought: enrichThoughtMock }))
vi.mock('$lib/server/capture/enrichment-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/capture/enrichment-context')>()),
  loadEnrichmentContext: loadEnrichmentContextMock,
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptTenantValueMock,
  encryptTenantValue: encryptTenantValueMock,
}))
vi.mock('$lib/server/capture/service', () => ({
  toPgVectorLiteral: (values: number[]) => `[${values.join(',')}]`,
}))
vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: getUserPreferredTimezoneMock,
}))
vi.mock('$lib/server/capture/queue-capture', () => ({
  markEnrichQueueComplete: vi.fn(async () => undefined),
  markEnrichQueueFailed: markEnrichQueueFailedMock,
}))
vi.mock('$lib/server/capture/enrich-queue-drain', () => ({ drainCaptureEnrichQueue: vi.fn() }))
vi.mock('$lib/server/agents/notify', () => ({ notifyThoughtEnriched: vi.fn() }))
vi.mock('$lib/server/agents/project-context', () => ({
  loadProjectContextForThought: vi.fn(async () => ({ projectEntityIds: [], projectLabels: [] })),
}))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: vi.fn(async () => undefined) }))
vi.mock('$lib/server/job-queue/enqueue', () => ({ enqueueUserJob: enqueueUserJobMock }))
// No Jev: nothing is enforced, so the decision plane stays out of the way.
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/llm/decision-client')>()),
  resolveDecisionShadowConfig: () => null,
  resolveDecisionEnforceKinds: () => new Set(),
}))
// Side services of the temporal sync that are not under test.
vi.mock('$lib/server/graph/graph-sync-worker', () => ({
  processPendingGraphSyncJobs: vi.fn(async () => undefined),
}))
vi.mock('$lib/server/memory/event-reminder-schedule', () => ({
  syncReminderScheduleForEvent: vi.fn(async () => undefined),
}))
vi.mock('$lib/server/memory/temporal-event-list', () => ({
  refreshFocusRanksForUser: vi.fn(async () => undefined),
}))

import { captureReview, graphSyncJob, temporalEvent } from '$lib/server/db/schema'
import { syncTemporalEventsFromThought } from '$lib/server/memory/temporal-graph-sync'
import type { ExtractedTemporalMention } from '$lib/server/memory/temporal-normalize'
import { enrichQueuedThought } from './enrich-queued-thought'

const TEXT = 'Yoga every Tuesday at 7pm at Studio Nord'
const CREATED_AT = new Date('2026-10-27T09:00:00.000Z')

/** One row that serves every select of the enrich flow and of the temporal sync. */
const THOUGHT_ROW = {
  id: 't1',
  rawText: TEXT,
  normalizedText: TEXT,
  rawTextEncrypted: null,
  normalizedTextEncrypted: null,
  createdAt: CREATED_AT,
  metadata: {},
  metadataEncrypted: null,
  n: 5,
  enrichedAt: new Date('2026-10-27T09:05:00.000Z'),
  category: 'task',
  author: 'user',
  authorLabel: null,
  authorKeyId: null,
}

/** A database stub that keeps the temporal_event rows the real sync inserts. */
function makeDb() {
  const temporalRows: Array<Record<string, unknown>> = []
  const selectStep = (table: unknown) => {
    const rows = table === temporalEvent ? [] : [THOUGHT_ROW]
    return {
      where: () => ({
        limit: async () => rows,
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(ok, bad),
      }),
    }
  }
  const insert = (table: unknown) => {
    if (table === captureReview) {
      return { values: () => ({ onConflictDoUpdate: async () => undefined }) }
    }
    if (table === temporalEvent) {
      return {
        values: (v: Record<string, unknown>) => {
          temporalRows.push(v)
          return { returning: async () => [{ id: `ev-${temporalRows.length}` }] }
        },
      }
    }
    if (table === graphSyncJob) {
      return { values: () => ({ returning: async () => [{ id: 'job-1' }] }) }
    }
    return { values: async () => undefined }
  }
  const db = {
    select: () => ({ from: selectStep }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert,
    transaction: async (cb: (tx: { insert: typeof insert }) => unknown) => cb({ insert }),
  }
  return { db, temporalRows }
}

function ontology() {
  const kinds = [
    {
      id: 'ek-task',
      key: 'task',
      name: 'Task',
      definition: 'Something to do',
      kindType: 'thought_category' as const,
      active: true,
      neverStale: false,
    },
  ]
  return { entityKinds: kinds, entityKindsByKey: new Map(kinds.map((k) => [k.key, k])) }
}

const YOGA = {
  surface: 'every Tuesday at 7pm',
  kind: 'appointment',
  startAt: '2026-10-27T19:00:00+01:00',
  timePrecision: 'exact',
  timezone: 'Europe/Berlin',
  isAllDay: false,
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
  confidence: 0.9,
  semanticSummary: 'Yoga at Studio Nord',
}

function bundleReply(temporalMentions: unknown[]) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            category: { key: 'task', confidence: 0.9, alternatives: [] },
            cues: [],
            askQuestion: 'When is yoga at Studio Nord?',
            temporalMentions,
            mentions: [],
            triples: [],
          }),
        },
      },
    ],
  }
}

let temporalRows: Array<Record<string, unknown>>

beforeEach(() => {
  vi.clearAllMocks()
  const made = makeDb()
  temporalRows = made.temporalRows
  getDbMock.mockReturnValue(made.db)
  applyCaptureContentSplitIfNeededMock.mockImplementation(
    async ({ rawText }: { rawText: string }) => ({
      rawText,
      normalizedText: rawText,
      split: {
        mode: 'thought_only' as const,
        thoughtText: rawText,
        attachmentTitle: '',
        attachmentBody: '',
        rationale: '',
      },
      attachedFileId: null,
    }),
  )
  loadEnrichmentContextMock.mockResolvedValue({
    userId: 'u1',
    thoughtId: 't1',
    normalizedText: TEXT,
    rawText: TEXT,
    ontology: ontology(),
    profile: { version: 2 },
    groundingProfile: null,
    knownEntities: [],
    recentThoughts: [],
    categoryDistribution: new Map(),
    communityExcerpts: [],
    completeness: {
      knownEntityCount: 0,
      recentThoughtCount: 0,
      communitySummaryCount: 0,
      hasProfileNotes: false,
      hasGroundingProfile: false,
    },
  })
  createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2])
  getUserPreferredTimezoneMock.mockResolvedValue('Europe/Berlin')
  encryptTenantValueMock.mockImplementation(
    async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`,
  )
  decryptTenantValueMock.mockImplementation(
    async ({ ciphertext }: { ciphertext: string }) => ciphertext,
  )
  enqueueUserJobMock.mockResolvedValue({ enqueued: true, jobId: 'job-1' })
  markEnrichQueueFailedMock.mockResolvedValue(undefined)
  // enrichThought is the part after the bundle: it runs the REAL temporal sync with the mentions
  // the queued path precomputed, as the real enrichThought does.
  enrichThoughtMock.mockImplementation(
    async (
      userId: string,
      thoughtId: string,
      normalizedText: string,
      options: {
        thoughtEmbedding?: number[]
        precomputedTemporalMentions?: ExtractedTemporalMention[]
      },
    ) => {
      await syncTemporalEventsFromThought({
        userId,
        thoughtId,
        normalizedText,
        thoughtEmbedding: options.thoughtEmbedding,
        capturedAt: CREATED_AT,
        timezone: 'Europe/Berlin',
        precomputedMentions: options.precomputedTemporalMentions,
      })
    },
  )
})

describe('a repeating capture through the queued enrich path (fake LLM)', () => {
  it('stores the repeat as ONE event with its RRULE and the event itself as summary', async () => {
    llmChatCompletionMock.mockResolvedValue(bundleReply([YOGA]))

    await enrichQueuedThought('u1', 't1')

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(temporalRows).toHaveLength(1)
    expect(temporalRows[0]).toMatchObject({
      kind: 'appointment',
      timePrecision: 'exact',
      timezone: 'Europe/Berlin',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
      semanticSummary: 'Yoga at Studio Nord',
      sourceTextSpan: 'every Tuesday at 7pm',
      parseMetadata: expect.objectContaining({ startAt: '2026-10-27T19:00:00+01:00' }),
    })
    // 19:00 Berlin (UTC+1) is 18:00 UTC: the first occurrence keeps its clock time.
    expect(String(temporalRows[0].activePeriod)).toMatch(/^\[2026-10-27T18:00:00\.000Z,/)
    expect(markEnrichQueueFailedMock).not.toHaveBeenCalled()
  })

  it('stores an event without a repeat with no rule', async () => {
    const { recurrenceRule: _rule, ...once } = YOGA
    llmChatCompletionMock.mockResolvedValue(
      bundleReply([
        { ...once, surface: 'on Friday at 9am', semanticSummary: 'Dentist appointment' },
      ]),
    )

    await enrichQueuedThought('u1', 't1')

    expect(temporalRows).toHaveLength(1)
    expect(temporalRows[0]).toMatchObject({
      recurrenceRule: null,
      semanticSummary: 'Dentist appointment',
    })
  })

  it('asks the model again after a reply with an unsupported RRULE, and stores the good one', async () => {
    llmChatCompletionMock
      .mockResolvedValueOnce(bundleReply([{ ...YOGA, recurrenceRule: 'FREQ=HOURLY' }]))
      .mockResolvedValueOnce(bundleReply([YOGA]))

    await enrichQueuedThought('u1', 't1')

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(temporalRows).toHaveLength(1)
    expect(temporalRows[0]).toMatchObject({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU' })
  })

  it('asks the model again after a reply without a semanticSummary, and stores the good one', async () => {
    const { semanticSummary: _summary, ...withoutSummary } = YOGA
    llmChatCompletionMock
      .mockResolvedValueOnce(bundleReply([withoutSummary]))
      .mockResolvedValueOnce(bundleReply([YOGA]))

    await enrichQueuedThought('u1', 't1')

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(temporalRows).toHaveLength(1)
    expect(temporalRows[0]).toMatchObject({ semanticSummary: 'Yoga at Studio Nord' })
  })

  it('fails loud after 1 + 3 attempts when every reply breaks the contract, and stores nothing', async () => {
    llmChatCompletionMock.mockResolvedValue(
      bundleReply([{ ...YOGA, recurrenceRule: 'every Tuesday' }]),
    )

    await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(
      /after 4 attempts.*recurrenceRule.*"every Tuesday"/s,
    )

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(4)
    expect(temporalRows).toHaveLength(0)
    expect(markEnrichQueueFailedMock).toHaveBeenCalledTimes(1)
  })
})
