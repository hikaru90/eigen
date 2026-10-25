import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, queueCaptureMock, encryptMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  queueCaptureMock: vi.fn(),
  encryptMock: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/capture/queue-capture', () => ({ queueCapture: queueCaptureMock }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ encryptTenantValue: encryptMock }))

import { queueSplitChild } from './queue-split-child'

const parent = {
  author: 'user' as const,
  authorLabel: null,
  authorKeyId: null,
  createdAt: new Date('2025-03-01T09:00:00.000Z'),
}

describe('queueSplitChild', () => {
  const setMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    setMock.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    getDbMock.mockReturnValue({ update: vi.fn(() => ({ set: setMock })) })
    queueCaptureMock.mockResolvedValue({ thoughtId: 'child-1', status: 'queued', normalizedText: 'x' })
  })

  it('queues the exact text as the parent’s author at the parent’s capture time and marks it a split child', async () => {
    const id = await queueSplitChild({
      userId: 'u1',
      parentThoughtId: 'parent-1',
      parent: { ...parent, authorLabel: 'Claude', authorKeyId: 'key-1' },
      text: 'My knee aches.',
    })

    expect(id).toBe('child-1')
    expect(queueCaptureMock).toHaveBeenCalledWith('u1', 'My knee aches.', {
      source: 'ui',
      author: 'user',
      authorLabel: 'Claude',
      authorKeyId: 'key-1',
      capturedAt: parent.createdAt,
    })
    const [set] = setMock.mock.calls[0] as [Record<string, unknown>]
    expect(JSON.parse(String(set.metadataEncrypted).slice(4))).toEqual({ splitFrom: 'parent-1' })
    // no kind is forced unless the fan-out already knows it: enrich classifies the child
    expect(set).not.toHaveProperty('category')
    expect(set).not.toHaveProperty('ontologyEntityKindId')
  })

  it('sets the kind up front when the fan-out knows it (multi-to-do tasks)', async () => {
    await queueSplitChild({
      userId: 'u1',
      parentThoughtId: 'parent-1',
      parent,
      text: 'Buy milk',
      category: { key: 'task', ontologyEntityKindId: 'kind-task' },
    })
    const [set] = setMock.mock.calls[0] as [Record<string, unknown>]
    expect(set).toMatchObject({ category: 'task', ontologyEntityKindId: 'kind-task' })
  })
})
