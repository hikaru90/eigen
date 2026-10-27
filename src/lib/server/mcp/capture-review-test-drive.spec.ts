/**
 * The agent test-drive of the capture review (docs/testing/agent-benchmark.md, the DoD gate;
 * docs/planning/capture-feedback.md §7): an MCP client drives `get_capture_review` and
 * `rate_capture` through the real MCP server layer (the SDK Server and Client over an in-memory
 * transport, the real registry, real argument checks, real result sanitising, real vote service
 * and review view). Nothing touches a network or a database: the thought service, the review
 * stores, the job queue and Jev's reason label are in-memory fakes, and "enrichment" and "the
 * audit" are two helper functions that write the review the way the background jobs do.
 *
 * Budget: capture_thought + get_capture_review + rate_capture = 3 tool calls for the happy path.
 * The reads that check the vote and the cleanup are verification, not part of that budget.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeThought = {
  id: string
  userId: string
  rawText: string
  normalizedText: string
  category: string
  lifecycleStatus: 'open' | 'completed' | 'archived'
  createdAt: Date
}

type FakeReview = {
  id: string
  userId: string
  thoughtId: string
  status: 'pending_audit' | 'scored' | 'audit_failed'
  score: number | null
  parts: unknown[]
  auditError: string | null
  verdict: 'up' | 'down' | null
  votedOn: 'capture' | 'mesh' | null
  reasonKind: string | null
  editAppliedAt: Date | null
  updatedAt: Date
}

const world = vi.hoisted(() => ({
  thoughts: new Map<string, unknown>(),
  reviews: new Map<string, unknown>(),
  jobs: [] as unknown[],
  labelCalls: 0,
  editCalls: [] as string[],
  reasonLabel: { kind: 'wrong_name', probability: 0.91 },
}))

const things = () => world.thoughts as Map<string, FakeThought>
const reviews = () => world.reviews as Map<string, FakeReview>

vi.mock('$lib/server/db', () => ({
  getDb: () => {
    throw new Error('the test-drive must not reach the database')
  },
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: async (input: { plaintext: string }) => `enc(${input.plaintext.length})`,
}))

vi.mock('$lib/server/capture/service', () => ({
  captureThought: async (userId: string, raw: string) => {
    const id = crypto.randomUUID()
    things().set(id, {
      id,
      userId,
      rawText: raw,
      normalizedText: raw,
      category: 'task',
      lifecycleStatus: 'open',
      createdAt: new Date(),
    })
    return { id, normalizedText: raw, category: 'task', queueStatus: 'pending', enrichedAt: null }
  },
  listThoughts: async (userId: string) =>
    [...things().values()]
      .filter((t) => t.userId === userId && t.lifecycleStatus !== 'archived')
      .map((t) => ({ id: t.id, category: t.category, normalizedText: t.normalizedText })),
  editStoredThought: async (userId: string, thoughtId: string, request: string) => {
    world.editCalls.push(request)
    const row = things().get(thoughtId)
    if (!row || row.userId !== userId) return { ok: false, reason: 'not_found' }
    row.normalizedText = 'Call my sister Greta on Friday about the tickets'
    return {
      ok: true,
      editSummary: 'changed the name',
      thought: { id: row.id, normalizedText: row.normalizedText, category: row.category },
    }
  },
}))

// What a vote compares before and after its edit: the fake world's own rows.
vi.mock('$lib/server/capture-review/recheck', () => ({
  snapshotStoredData: async (input: { thoughtId: string }) =>
    JSON.stringify(things().get(input.thoughtId) ?? null),
  recheckStoredData: async () => undefined,
}))

vi.mock('$lib/server/memory/lifecycle', () => ({
  archiveThoughtForUser: async (userId: string, thoughtId: string) => {
    const row = things().get(thoughtId)
    if (!row || row.userId !== userId) return { ok: false, reason: 'not_found' }
    row.lifecycleStatus = 'archived'
    return { ok: true }
  },
}))

vi.mock('$lib/server/job-queue/enqueue', () => ({
  enqueueUserJob: async (job: unknown) => {
    world.jobs.push(job)
    return { enqueued: true, jobId: `job-${world.jobs.length}` }
  },
}))

vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/llm/decision-plane')>()),
  runCaptureReasonLabel: async () => {
    world.labelCalls += 1
    return world.reasonLabel
  },
}))

// The review stores, in memory. The 'mcp' → voted_on NULL mapping is the real one.
vi.mock('$lib/server/capture-review/vote-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/capture-review/vote-store')>()
  return {
    ...actual,
    loadVoteTarget: async (input: { userId: string; thoughtId: string }) => {
      const row = things().get(input.thoughtId)
      return row && row.userId === input.userId ? { category: row.category } : null
    },
    createPendingCaptureReviewIfMissing: async (input: { userId: string; thoughtId: string }) => {
      if ([...reviews().values()].some((r) => r.thoughtId === input.thoughtId)) return null
      const id = `review-${reviews().size + 1}`
      reviews().set(id, {
        id,
        userId: input.userId,
        thoughtId: input.thoughtId,
        status: 'pending_audit',
        score: null,
        parts: [],
        auditError: null,
        verdict: null,
        votedOn: null,
        reasonKind: null,
        editAppliedAt: null,
        updatedAt: new Date(),
      })
      return id
    },
    deleteCaptureReview: async (input: { reviewId: string }) => {
      reviews().delete(input.reviewId)
    },
    saveCaptureVote: async (vote: {
      userId: string
      thoughtId: string
      verdict: 'up' | 'down'
      place: 'capture' | 'mesh' | 'mcp'
      reasonKind: string | null
      editAppliedAt?: Date | null
    }) => {
      const review = [...reviews().values()].find(
        (r) => r.thoughtId === vote.thoughtId && r.userId === vote.userId,
      )
      if (!review) throw new Error('[capture-review] no capture review to store the vote on')
      review.verdict = vote.verdict
      review.votedOn = actual.votedOnColumn(vote.place)
      review.reasonKind = vote.reasonKind
      if (vote.editAppliedAt !== undefined) review.editAppliedAt = vote.editAppliedAt
      // like the real store: updated_at belongs to the audit columns and is not touched by a vote
    },
  }
})

vi.mock('$lib/server/capture-review/review-store', () => ({
  loadCaptureReviewSnapshot: async (input: { userId: string; thoughtId: string }) => {
    const row = things().get(input.thoughtId)
    if (!row || row.userId !== input.userId) return null
    const review = [...reviews().values()].find((r) => r.thoughtId === input.thoughtId)
    return {
      category: row.category,
      lifecycleStatus: row.lifecycleStatus,
      review: review
        ? {
            status: review.status,
            score: review.score,
            parts: review.parts,
            auditError: review.auditError,
            verdict: review.verdict,
            votedOn: review.votedOn,
            reasonKind: review.reasonKind,
            editAppliedAt: review.editAppliedAt,
            updatedAt: review.updatedAt,
          }
        : null,
    }
  },
}))

vi.mock('$lib/server/capture-review/audit-input', () => ({
  loadCaptureAuditInput: async (input: { userId: string; thoughtId: string }) => {
    const row = things().get(input.thoughtId)
    if (!row || row.userId !== input.userId) return null
    return {
      capturedAt: '2026-10-27T10:00:00+01:00',
      timezone: 'Europe/Berlin',
      rawText: row.rawText,
      storedText: row.normalizedText,
      names: [{ ref: 'n1', surface: 'Anna' }],
      dates: [{ ref: 'd1', event: 'Call Anna', day: '2026-10-30', detail: null }],
      pieces: [],
    }
  },
}))

import {
  CAPTURE_REVIEW_THRESHOLD,
  computeReviewScore,
  parseCaptureReviewParts,
} from '$lib/server/capture-review/review-parts'
import { CHAT_AGENT_TOOL_NAMES } from './registry'
import { createMcpServer } from './server'

const USER = 'u1'
const RAW = 'Call my sister Anna on Friday about the tickets'
const REASON = 'it is about my sister Greta, not Anna'

/** The end of enrichment: the review exists with Jev's capture decisions, the audit still to run. */
function finishEnrichment(thoughtId: string): void {
  const thought = things().get(thoughtId)
  if (!thought) throw new Error('no such thought')
  const parts = parseCaptureReviewParts([
    { part: 'category', ref: 'category', engine: 'jev_decision', label: 'task', probability: 0.93 },
    { part: 'entity_type', ref: 'm1', engine: 'jev_decision', label: 'person', probability: 0.88 },
  ])
  reviews().set(`review-${reviews().size + 1}`, {
    id: `review-${reviews().size + 1}`,
    userId: thought.userId,
    thoughtId,
    status: 'pending_audit',
    score: null,
    parts,
    auditError: null,
    verdict: null,
    votedOn: null,
    reasonKind: null,
    editAppliedAt: null,
    updatedAt: new Date(),
  })
}

/** The audit job: Jev's answers about what the chat model wrote, then the score. */
function finishAudit(thoughtId: string): void {
  const review = [...reviews().values()].find((r) => r.thoughtId === thoughtId)
  if (!review) throw new Error('no review to audit')
  const parts = parseCaptureReviewParts([
    ...(review.parts as object[]),
    { part: 'name', ref: 'name:n1', engine: 'jev_audit', label: 'right', probability: 0.97 },
    {
      part: 'missing_names',
      ref: 'missing_names',
      engine: 'jev_audit',
      label: 'none_missing',
      probability: 0.9,
    },
    { part: 'date', ref: 'date:d1', engine: 'jev_audit', label: 'right', probability: 0.88 },
    {
      part: 'missing_dates',
      ref: 'missing_dates',
      engine: 'jev_audit',
      label: 'none_missing',
      probability: 0.92,
    },
  ])
  review.parts = parts
  review.score = computeReviewScore(parts)
  review.status = 'scored'
  review.updatedAt = new Date()
}

type PartPayload = {
  part: string
  ref: string
  about: string | null
  counts_toward_score: boolean
}

/** What the test-drive reads from a tool answer; every tool's answer fits this loose shape. */
type ToolPayload = {
  thoughtId: string
  status: string
  score: number | null
  below_threshold: boolean | null
  note: string | null
  parts: PartPayload[]
  vote: { verdict: string } | null
  results: Array<{ id: string }>
  [key: string]: unknown
}

/** An agent on the other end of the MCP wire: it only ever sees tool names, arguments and JSON text. */
async function connectAgent(userId = USER) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer({ userId }, { boardAccess: false, boardAdmin: false })
  const client = new Client({ name: 'test-drive-agent', version: '1.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const calls: string[] = []
  const seen: string[] = []

  async function call(name: string, args: Record<string, unknown>): Promise<ToolPayload> {
    calls.push(name)
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean
      content: Array<{ type: string; text: string }>
    }
    const text = result.content[0].text
    seen.push(text)
    if (result.isError) throw new Error(text)
    return JSON.parse(text) as ToolPayload
  }

  async function failure(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      await call(name, args)
    } catch (err) {
      return (err as Error).message
    }
    throw new Error(`expected ${name} to fail`)
  }

  return { client, call, failure, calls, seen, close: () => client.close() }
}

beforeEach(() => {
  world.thoughts.clear()
  world.reviews.clear()
  world.jobs.length = 0
  world.labelCalls = 0
  world.editCalls.length = 0
  world.reasonLabel = { kind: 'wrong_name', probability: 0.91 }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('capture review test-drive: the happy path stays within its budget', () => {
  it('capture_thought → get_capture_review → rate_capture is 3 calls, and each tells the truth', async () => {
    const BUDGET = 3
    const agent = await connectAgent()

    const captured = await agent.call('capture_thought', { raw: RAW, as_user: true })
    const thoughtId = captured.thoughtId as string
    // background work between the calls — not a tool call
    finishEnrichment(thoughtId)
    finishAudit(thoughtId)

    const review = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(review).toMatchObject({
      thought_id: thoughtId,
      status: 'scored',
      score: 0.88,
      threshold: CAPTURE_REVIEW_THRESHOLD,
      below_threshold: false,
      vote: null,
      note: null,
    })
    expect(review.parts.map((p) => [p.part, p.counts_toward_score, p.about])).toEqual([
      ['category', true, 'task'],
      ['entity_type', false, null],
      ['name', true, 'Anna'],
      ['missing_names', true, null],
      [
        'date',
        true,
        '"Call Anna" — the Friday after the capture day (3 days later), once (not repeating)',
      ],
      ['missing_dates', true, null],
    ])

    const rated = await agent.call('rate_capture', { thought_id: thoughtId, verdict: 'up' })
    expect(rated).toEqual({
      verdict: 'up',
      reason_kind: null,
      edit_applied: false,
      changed: false,
      edit_error: null,
    })

    expect(agent.calls).toEqual(['capture_thought', 'get_capture_review', 'rate_capture'])
    expect(agent.calls.length).toBeLessThanOrEqual(BUDGET)
    expect(world.labelCalls).toBe(0)
    expect(world.editCalls).toEqual([])
    await agent.close()
  })

  it('a read after the vote shows it: an MCP vote has no place (voted_on null)', async () => {
    const agent = await connectAgent()
    const { thoughtId } = await agent.call('capture_thought', { raw: RAW, as_user: true })
    finishEnrichment(thoughtId)
    finishAudit(thoughtId)
    await agent.call('rate_capture', { thought_id: thoughtId, verdict: 'up' })

    const review = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(review.vote).toEqual({
      verdict: 'up',
      voted_on: null,
      reason_kind: null,
      edit_applied: false,
    })
    expect(review.status).toBe('scored')
    await agent.close()
  })
})

describe('capture review test-drive: reads tell the truth while the work is still running', () => {
  it('none before enrichment, pending_audit after it, scored after the audit', async () => {
    const agent = await connectAgent()
    const { thoughtId } = await agent.call('capture_thought', { raw: RAW, as_user: true })

    const none = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(none).toMatchObject({
      status: 'none',
      score: null,
      below_threshold: null,
      parts: [],
      vote: null,
    })
    expect(none.note).toMatch(/not reviewed yet/i)
    expect(none.note).toMatch(/rate_capture starts its review/)

    finishEnrichment(thoughtId)
    const pending = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(pending.status).toBe('pending_audit')
    expect(pending.score).toBeNull()
    expect(pending.parts.map((p) => p.part)).toEqual(['category', 'entity_type'])
    expect(pending.note).toMatch(/audit has not finished/)

    finishAudit(thoughtId)
    const scored = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(scored.status).toBe('scored')
    expect(scored.score).toBe(0.88)
    expect(scored.note).toBeNull()
    await agent.close()
  })

  it('rating a thought that has no review yet starts its review (pending, audit job queued) and the read shows the vote', async () => {
    const agent = await connectAgent()
    const { thoughtId } = await agent.call('capture_thought', { raw: RAW, as_user: true })

    await agent.call('rate_capture', { thought_id: thoughtId, verdict: 'up' })

    expect(world.jobs).toHaveLength(1)
    expect(world.jobs[0]).toMatchObject({
      jobType: 'capture_review_audit',
      payload: { thoughtId },
    })
    const review = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(review.status).toBe('pending_audit')
    expect(review.vote?.verdict).toBe('up')
    await agent.close()
  })
})

describe('capture review test-drive: a thumbs-down with a reason', () => {
  it('is applied as an edit, labelled, never echoed back, and the read says the parts are older than the edit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const agent = await connectAgent()
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'))
    const { thoughtId } = await agent.call('capture_thought', { raw: RAW, as_user: true })
    finishEnrichment(thoughtId)
    vi.setSystemTime(new Date('2026-10-27T10:05:00Z'))
    finishAudit(thoughtId)

    vi.setSystemTime(new Date('2026-10-27T10:09:00Z'))
    const rated = await agent.call('rate_capture', {
      thought_id: thoughtId,
      verdict: 'down',
      reason: REASON,
    })
    expect(rated).toMatchObject({
      verdict: 'down',
      reason_kind: 'wrong_name',
      edit_applied: true,
      changed: true,
      edit_error: null,
      thought: {
        id: thoughtId,
        normalizedText: 'Call my sister Greta on Friday about the tickets',
      },
    })
    expect(world.editCalls).toEqual([REASON])
    expect(world.labelCalls).toBe(1)

    const review = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(review.vote).toEqual({
      verdict: 'down',
      voted_on: null,
      reason_kind: 'wrong_name',
      edit_applied: true,
    })
    expect(review.note).toBe('The parts describe the capture before its latest edit.')

    // the reason is the owner's words: it is applied as an edit and never comes back over MCP
    expect(agent.seen.join('\n')).not.toContain(REASON)
    await agent.close()
  })
})

describe('capture review test-drive: cleanup works and is verified', () => {
  it('delete_thought archives the thought: it leaves retrieve_thoughts, and its review is still there to read', async () => {
    const agent = await connectAgent()
    const { thoughtId } = await agent.call('capture_thought', { raw: RAW, as_user: true })
    finishEnrichment(thoughtId)
    finishAudit(thoughtId)
    await agent.call('rate_capture', { thought_id: thoughtId, verdict: 'up' })

    const before = await agent.call('retrieve_thoughts', { order: 'created_at', detail: 'full' })
    expect(before.results.map((r) => r.id)).toContain(thoughtId)

    const removed = await agent.call('delete_thought', { thought_id: thoughtId })
    expect(removed).toEqual({ archived: true, thoughtId, status: 'archived' })

    const after = await agent.call('retrieve_thoughts', { order: 'created_at', detail: 'full' })
    expect(after.results.map((r) => r.id)).not.toContain(thoughtId)

    // archived thoughts keep their review, and the read says so instead of pretending otherwise
    const review = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(review).toMatchObject({ status: 'scored', score: 0.88, vote: { verdict: 'up' } })
    expect(review.note).toBe(
      'The thought is archived (delete_thought archives it); an archived thought keeps its review.',
    )
    await agent.close()
  })
})

describe('capture review test-drive: negative probes fail loud with the exact constraint', () => {
  async function drivenThought() {
    const agent = await connectAgent()
    const { thoughtId } = await agent.call('capture_thought', { raw: RAW, as_user: true })
    finishEnrichment(thoughtId)
    finishAudit(thoughtId)
    return { agent, thoughtId: thoughtId as string }
  }

  it('verdict "maybe" is refused, and nothing is stored', async () => {
    const { agent, thoughtId } = await drivenThought()
    const message = await agent.failure('rate_capture', { thought_id: thoughtId, verdict: 'maybe' })
    expect(message).toContain('verdict must be up or down')

    const review = await agent.call('get_capture_review', { thought_id: thoughtId })
    expect(review.vote).toBeNull()
    await agent.close()
  })

  it('a reason with "up" is refused with its constraint, and no label or edit ran', async () => {
    const { agent, thoughtId } = await drivenThought()
    const message = await agent.failure('rate_capture', {
      thought_id: thoughtId,
      verdict: 'up',
      reason: REASON,
    })
    expect(message).toContain('reason is only allowed with verdict down')
    expect(world.labelCalls).toBe(0)
    expect(world.editCalls).toEqual([])
    expect((await agent.call('get_capture_review', { thought_id: thoughtId })).vote).toBeNull()
    await agent.close()
  })

  it('a thought_id that is not a uuid is refused by both tools', async () => {
    const { agent } = await drivenThought()
    expect(await agent.failure('rate_capture', { thought_id: 'abc', verdict: 'up' })).toContain(
      'thought_id must be a uuid',
    )
    expect(await agent.failure('get_capture_review', { thought_id: 'abc' })).toContain(
      'thought_id must be a uuid',
    )
    await agent.close()
  })

  it('an unknown argument names the allowed ones', async () => {
    const { agent, thoughtId } = await drivenThought()
    expect(await agent.failure('get_capture_review', { thoughtId })).toContain(
      'Unknown argument: thoughtId. Allowed: thought_id',
    )
    await agent.close()
  })

  it('a thought that does not exist, or is another user’s, is Thought not found for both tools', async () => {
    const { agent } = await drivenThought()
    const stranger = await connectAgent('u2')
    const { thoughtId: foreign } = await stranger.call('capture_thought', {
      raw: 'x',
      as_user: true,
    })
    const missing = crypto.randomUUID()

    for (const id of [missing, foreign]) {
      expect(await agent.failure('get_capture_review', { thought_id: id })).toContain(
        'Thought not found',
      )
      expect(await agent.failure('rate_capture', { thought_id: id, verdict: 'up' })).toContain(
        'Thought not found',
      )
    }
    // the other user's thought has no review and was not given one
    expect([...reviews().values()].filter((r) => r.thoughtId === foreign)).toEqual([])
    await agent.close()
    await stranger.close()
  })
})

describe('capture review test-drive: the tools an MCP client is offered', () => {
  it('lists get_capture_review and rate_capture with their contracts', async () => {
    const agent = await connectAgent()
    const { tools } = await agent.client.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))

    expect(byName.get('get_capture_review')?.inputSchema).toMatchObject({
      required: ['thought_id'],
      additionalProperties: false,
    })
    expect(byName.get('rate_capture')?.inputSchema).toMatchObject({
      required: ['thought_id', 'verdict'],
      properties: { verdict: { enum: ['up', 'down'] } },
    })
    await agent.close()
  })

  it('the in-app Ask agent does not have them: the vote in the app lives in two places only', () => {
    expect(CHAT_AGENT_TOOL_NAMES).not.toContain('get_capture_review')
    expect(CHAT_AGENT_TOOL_NAMES).not.toContain('rate_capture')
  })
})
