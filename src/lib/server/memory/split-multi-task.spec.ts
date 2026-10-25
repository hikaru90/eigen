import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  llmChatCompletionMock,
  queueCaptureMock,
  scheduleCaptureEnrichWorkerMock,
  loadProjectMembershipEntityIdsMock,
  linkThoughtToProjectMock,
  selectMock,
  updateMock,
  encryptMock,
  decryptMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
  queueCaptureMock: vi.fn(),
  scheduleCaptureEnrichWorkerMock: vi.fn(),
  loadProjectMembershipEntityIdsMock: vi.fn(async (): Promise<string[]> => []),
  linkThoughtToProjectMock: vi.fn(async () => undefined),
  selectMock: vi.fn(),
  updateMock: vi.fn(),
  encryptMock: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
  decryptMock: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
  ),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))
vi.mock('$lib/server/capture/queue-capture', () => ({
  queueCapture: queueCaptureMock,
  QUEUE_PLACEHOLDER_CATEGORY: 'observation',
}))
vi.mock('$lib/server/capture/capture-enrich-worker', () => ({
  scheduleCaptureEnrichWorker: scheduleCaptureEnrichWorkerMock,
}))
vi.mock('$lib/server/memory/project-membership', () => ({
  loadProjectMembershipEntityIds: loadProjectMembershipEntityIdsMock,
}))
vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: linkThoughtToProjectMock,
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptMock,
  decryptTenantValue: decryptMock,
}))
vi.mock('$lib/server/ontology-db', () => ({
  ensureUserOntologySeeded: vi.fn(async () => undefined),
  loadOntologyForUser: vi.fn(async () => ({
    entityKindsByKey: new Map([['task', { id: 'kind-task' }]]),
  })),
}))
vi.mock('$lib/paraglide/messages.js', () => ({
  m: { llm_multi_task_system: () => 'Split multiple to-dos.' },
}))

import { fanOutMultipleTasks, MULTI_TASK_FANOUT_MAX } from './split-multi-task'

function thoughtRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'parent-1',
    userId: 'u1',
    category: 'task',
    author: 'user',
    authorLabel: null,
    authorKeyId: null,
    createdAt: new Date('2025-03-01T09:00:00.000Z'),
    metadata: {},
    metadataEncrypted: null,
    ...overrides,
  }
}

function chainSelect(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  selectMock.mockReturnValue({ from })
}

function chainUpdate() {
  const where = vi.fn(async () => undefined)
  const set = vi.fn(() => ({ where }))
  updateMock.mockReturnValue({ set })
  return { set }
}

describe('fanOutMultipleTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({ select: selectMock, update: updateMock })
    chainUpdate()
    queueCaptureMock.mockImplementation(async (_userId: string, raw: string, _opts?: unknown) => ({
      thoughtId: `child-${raw.slice(0, 6)}`,
      status: 'queued',
      normalizedText: raw,
    }))
  })

  const llm = (content: string) =>
    llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content } }] })

  it('non-task thoughts are never split — the judge does not even run', async () => {
    chainSelect([thoughtRow({ category: 'decision' })])
    const result = await fanOutMultipleTasks({
      userId: 'u1',
      thoughtId: 'parent-1',
      normalizedText: 'Buy milk. Call mom.',
    })
    expect(result).toEqual([])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('a single to-do stays one thought — no children, no worker churn', async () => {
    chainSelect([thoughtRow()])
    llm('{"multiple":false}')
    const result = await fanOutMultipleTasks({
      userId: 'u1',
      thoughtId: 'parent-1',
      normalizedText: 'Buy milk',
    })
    expect(result).toEqual([])
    expect(queueCaptureMock).not.toHaveBeenCalled()
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
  })

  it('splits a multi-to-do capture: one child thought per task, each on the parent thread', async () => {
    chainSelect([thoughtRow()])
    llm('{"multiple":true,"tasks":["Buy milk","Call mom","Fix the tap"]}')
    loadProjectMembershipEntityIdsMock.mockResolvedValue(['p1'])

    const result = await fanOutMultipleTasks({
      userId: 'u1',
      thoughtId: 'parent-1',
      normalizedText: 'Buy milk. Call mom. Fix the tap.',
    })

    expect(result).toHaveLength(3)
    expect(queueCaptureMock).toHaveBeenCalledTimes(3)
    // children speak as the parent's author and carry the split provenance
    expect(queueCaptureMock).toHaveBeenCalledWith(
      'u1',
      'Buy milk',
      expect.objectContaining({ author: 'user' }),
    )
    // each child is a task (the parent's kind), marked as a split child — never re-split
    // (set call 0 is the parent's fan-out marker; each child's update follows)
    const set = (updateMock.mock.results[0]!.value as { set: ReturnType<typeof vi.fn> }).set
    const [setArgs] = set.mock.calls[1] as unknown as [Record<string, unknown>]
    expect(setArgs).toMatchObject({ category: 'task', ontologyEntityKindId: 'kind-task' })
    const childMetadata = JSON.parse(
      String(setArgs.metadataEncrypted).startsWith('enc:')
        ? String(setArgs.metadataEncrypted).slice(4)
        : '{}',
    ) as Record<string, unknown>
    expect(childMetadata).toMatchObject({ splitFrom: 'parent-1' })
    // the children land on the parent's thread — as the pipeline's decision, never as 'manual'
    expect(linkThoughtToProjectMock).toHaveBeenCalledTimes(3)
    for (const childId of result) {
      expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p1', childId, 'project')
    }
    // one worker schedule for the whole batch
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledTimes(1)
  })

  it('children inherit the parent createdAt as their capture time, not wall clock', async () => {
    const parentCreatedAt = new Date('2024-11-05T08:30:00.000Z')
    chainSelect([thoughtRow({ createdAt: parentCreatedAt })])
    llm('{"multiple":true,"tasks":["Buy milk","Call mom"]}')

    await fanOutMultipleTasks({
      userId: 'u1',
      thoughtId: 'parent-1',
      normalizedText: 'Buy milk. Call mom.',
    })

    expect(queueCaptureMock).toHaveBeenCalledTimes(2)
    for (const call of queueCaptureMock.mock.calls) {
      expect((call[2] as { capturedAt?: Date }).capturedAt).toEqual(parentCreatedAt)
    }
  })

  it('a split child (metadata.splitFrom) is never split again', async () => {
    chainSelect([thoughtRow({ metadata: { splitFrom: 'grandparent-1' } })])
    llm('{"multiple":true,"tasks":["A","B"]}')

    const result = await fanOutMultipleTasks({
      userId: 'u1',
      thoughtId: 'parent-1',
      normalizedText: 'A. B.',
    })

    expect(result).toEqual([])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })

  it('a parent that already fanned out (metadata.splitInto) never duplicates children on a retried enrich', async () => {
    chainSelect([thoughtRow({ metadata: { splitInto: ['A', 'B'] } })])
    llm('{"multiple":true,"tasks":["A","B"]}')

    const result = await fanOutMultipleTasks({
      userId: 'u1',
      thoughtId: 'parent-1',
      normalizedText: 'A. B.',
    })

    expect(result).toEqual([])
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })

  it('a broken judge answer fails loudly (the enrich worker retries, then the error is explicit)', async () => {
    chainSelect([thoughtRow()])
    llm('not json at all')

    await expect(
      fanOutMultipleTasks({
        userId: 'u1',
        thoughtId: 'parent-1',
        normalizedText: 'Buy milk. Call mom.',
      }),
    ).rejects.toThrow()
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })

  it('a contract violation — multiple with fewer than two tasks — fails loudly', async () => {
    chainSelect([thoughtRow()])
    llm('{"multiple":true,"tasks":["Buy milk"]}')

    await expect(
      fanOutMultipleTasks({
        userId: 'u1',
        thoughtId: 'parent-1',
        normalizedText: 'Buy milk',
      }),
    ).rejects.toThrow(/at least two/)
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })

  it(`more than ${MULTI_TASK_FANOUT_MAX} tasks is a contract violation, not a silent truncation`, async () => {
    chainSelect([thoughtRow()])
    const tasks = Array.from({ length: MULTI_TASK_FANOUT_MAX + 1 }, (_, i) => `Task ${i + 1}`)
    llm(JSON.stringify({ multiple: true, tasks }))

    await expect(
      fanOutMultipleTasks({
        userId: 'u1',
        thoughtId: 'parent-1',
        normalizedText: 'a lot',
      }),
    ).rejects.toThrow(new RegExp(String(MULTI_TASK_FANOUT_MAX + 1)))
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })

  it('empty or whitespace-only task texts in the judge answer are a contract violation', async () => {
    chainSelect([thoughtRow()])
    llm('{"multiple":true,"tasks":["Buy milk","   "]}')

    await expect(
      fanOutMultipleTasks({
        userId: 'u1',
        thoughtId: 'parent-1',
        normalizedText: 'Buy milk',
      }),
    ).rejects.toThrow()
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })
})
