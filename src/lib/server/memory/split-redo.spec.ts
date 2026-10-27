import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  llmChatCompletion: vi.fn(),
  queueCapture: vi.fn(),
  scheduleCaptureEnrichWorker: vi.fn(),
  loadProjectMembershipEntityIds: vi.fn(async (): Promise<string[]> => []),
  linkThoughtToProject: vi.fn(async () => undefined),
  select: vi.fn(),
  update: vi.fn(),
  setThoughtLifecycleStatus: vi.fn(),
  encrypt: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
  decrypt: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
  ),
}))

vi.mock('$lib/server/db', () => ({ getDb: mocks.getDb }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: mocks.llmChatCompletion }))
vi.mock('$lib/server/capture/queue-capture', () => ({ queueCapture: mocks.queueCapture }))
vi.mock('$lib/server/capture/capture-enrich-worker', () => ({
  scheduleCaptureEnrichWorker: mocks.scheduleCaptureEnrichWorker,
}))
vi.mock('$lib/server/memory/project-membership', () => ({
  loadProjectMembershipEntityIds: mocks.loadProjectMembershipEntityIds,
}))
vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: mocks.linkThoughtToProject,
}))
vi.mock('$lib/server/memory/lifecycle', () => ({
  setThoughtLifecycleStatus: mocks.setThoughtLifecycleStatus,
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: mocks.encrypt,
  decryptTenantValue: mocks.decrypt,
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

import { readSplitFamily, redoCaptureSplit } from './split-multi-task'

const CREATED = new Date('2026-10-27T09:00:00.000Z')
const CORRECTION = 'should be one shopping list, not three'
const PIECES = ['buy milk', 'buy eggs', 'buy bread']

function row(over: Record<string, unknown>) {
  return {
    id: 'x',
    author: 'user',
    authorLabel: null,
    authorKeyId: null,
    createdAt: CREATED,
    normalizedText: 'buy milk, eggs and bread',
    normalizedTextEncrypted: null,
    rawText: 'buy milk',
    rawTextEncrypted: null,
    lifecycleStatus: 'open',
    metadata: {},
    metadataEncrypted: null,
    ...over,
  }
}

const parent = row({
  id: 'parent',
  metadataEncrypted: `enc:${JSON.stringify({ splitInto: PIECES })}`,
})
const child = (id: string, rawText: string, extra: Record<string, unknown> = {}, meta = {}) =>
  row({
    id,
    rawText,
    metadataEncrypted: `enc:${JSON.stringify({ splitFrom: 'parent', ...meta })}`,
    ...extra,
  })

/** Answers the selects in the order the code asks: `limit(1)` lookups, then the plain children query. */
function queueSelects(...results: unknown[][]) {
  const queue = [...results]
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => {
        const rows = queue.shift() ?? []
        return Object.assign(Promise.resolve(rows), { limit: async () => rows })
      },
    }),
  }))
}

let metadataWrites: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  metadataWrites = []
  mocks.getDb.mockReturnValue({ select: mocks.select, update: mocks.update })
  mocks.update.mockReturnValue({
    set: (values: { metadataEncrypted?: string }) => {
      if (values.metadataEncrypted) metadataWrites.push(values.metadataEncrypted)
      return { where: async () => undefined }
    },
  })
  mocks.setThoughtLifecycleStatus.mockResolvedValue({ ok: true })
  mocks.queueCapture.mockImplementation(async (_u: string, raw: string) => ({
    thoughtId: `new-${raw.slice(0, 4)}`,
  }))
  mocks.llmChatCompletion.mockResolvedValue({
    choices: [{ message: { content: '{"tasks":["buy milk, eggs and bread"]}' } }],
  })
})

describe('redoCaptureSplit', () => {
  it('gives the split judge the owner correction as context, and reads the parent when the vote was on a child', async () => {
    queueSelects([child('c1', 'buy milk')], [parent], [])

    await redoCaptureSplit({ userId: 'u1', thoughtId: 'c1', ownerCorrection: CORRECTION })

    const prompt = JSON.stringify(mocks.llmChatCompletion.mock.calls[0][0].messages)
    expect(prompt).toContain('The owner said the last reading of this thought was wrong')
    expect(prompt).toContain(CORRECTION)
    expect(prompt).toContain('buy milk, eggs and bread')
  })

  it('archives the untouched old children through the lifecycle (never deletes) and keeps the new single thought', async () => {
    queueSelects(
      [parent],
      [child('c1', 'buy milk'), child('c2', 'buy eggs'), child('c3', 'buy bread')],
    )

    const result = await redoCaptureSplit({
      userId: 'u1',
      thoughtId: 'parent',
      ownerCorrection: CORRECTION,
    })

    expect(result.archivedChildIds).toEqual(['c1', 'c2', 'c3'])
    expect(result.keptChildIds).toEqual([])
    expect(mocks.setThoughtLifecycleStatus.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['c1', 'archived'],
      ['c2', 'archived'],
      ['c3', 'archived'],
    ])
    // the judge now sees one thought: no new children, the parent's marker is removed
    expect(result.tasks).toEqual(['buy milk, eggs and bread'])
    expect(result.newChildIds).toEqual([])
    expect(mocks.queueCapture).not.toHaveBeenCalled()
    expect(metadataWrites).toHaveLength(1)
    expect(JSON.parse(metadataWrites[0].slice(4))).not.toHaveProperty('splitInto')
  })

  it('leaves children the owner completed, edited or rewrote alone', async () => {
    queueSelects(
      [parent],
      [
        child('open', 'buy milk'),
        child('done', 'buy eggs', { lifecycleStatus: 'completed' }),
        child('edited', 'buy bread', {}, { lastEditRequest: 'make it whole grain bread' }),
        child('rewritten', 'buy oat milk instead'),
      ],
    )

    const result = await redoCaptureSplit({
      userId: 'u1',
      thoughtId: 'parent',
      ownerCorrection: CORRECTION,
    })

    expect(result.archivedChildIds).toEqual(['open'])
    expect(result.keptChildIds).toEqual(['done', 'edited', 'rewritten'])
    expect(mocks.setThoughtLifecycleStatus).toHaveBeenCalledTimes(1)
  })

  it('creates the new children when the judge still splits, and records the new pieces on the parent first', async () => {
    mocks.llmChatCompletion.mockResolvedValue({
      choices: [{ message: { content: '{"tasks":["buy milk and eggs","buy bread"]}' } }],
    })
    queueSelects([parent], [child('c1', 'buy milk')])

    const result = await redoCaptureSplit({
      userId: 'u1',
      thoughtId: 'parent',
      ownerCorrection: CORRECTION,
    })

    expect(result.newChildIds).toHaveLength(2)
    expect(mocks.queueCapture).toHaveBeenCalledTimes(2)
    expect(JSON.parse(metadataWrites[0].slice(4)).splitInto).toEqual([
      'buy milk and eggs',
      'buy bread',
    ])
    expect(mocks.scheduleCaptureEnrichWorker).toHaveBeenCalledTimes(1)
  })

  it('changes nothing when the judge fails: no archive, no marker, no children', async () => {
    mocks.llmChatCompletion.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] })
    queueSelects([parent], [child('c1', 'buy milk')])

    await expect(
      redoCaptureSplit({ userId: 'u1', thoughtId: 'parent', ownerCorrection: CORRECTION }),
    ).rejects.toThrow()

    expect(mocks.setThoughtLifecycleStatus).not.toHaveBeenCalled()
    expect(metadataWrites).toEqual([])
    expect(mocks.queueCapture).not.toHaveBeenCalled()
  })

  it('never logs the correction', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    )
    queueSelects([parent], [child('c1', 'buy milk')])
    await redoCaptureSplit({ userId: 'u1', thoughtId: 'parent', ownerCorrection: CORRECTION })
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    expect(logged).not.toContain('shopping list')
    expect(logged).toContain(String(CORRECTION.length))
  })
})

describe('readSplitFamily', () => {
  it('is null for a thought that is neither split nor a split child', async () => {
    queueSelects([row({ id: 'plain' })])
    expect(await readSplitFamily({ userId: 'u1', thoughtId: 'plain' })).toBeNull()
  })

  it('lists the children with their lifecycle status, for the parent and for a child alike', async () => {
    queueSelects(
      [parent],
      [child('c1', 'buy milk'), child('c2', 'buy eggs', { lifecycleStatus: 'archived' })],
    )
    expect(await readSplitFamily({ userId: 'u1', thoughtId: 'parent' })).toEqual({
      parentId: 'parent',
      pieces: PIECES,
      children: [
        { id: 'c1', lifecycleStatus: 'open' },
        { id: 'c2', lifecycleStatus: 'archived' },
      ],
    })
  })
})
