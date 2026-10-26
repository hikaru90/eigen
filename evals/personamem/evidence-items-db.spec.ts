import { beforeEach, describe, expect, it, vi } from 'vitest'

const { selects, decryptMock } = vi.hoisted(() => ({
  selects: [] as unknown[][],
  decryptMock: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => 'eq') }))
vi.mock('../harness/eval-context', () => ({
  withEvalDb: async (_tenant: string, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      select: () => ({ from: () => ({ where: async () => selects.shift() }) }),
    }),
}))
vi.mock('$lib/server/db/schema', () => ({
  thought: {
    id: 'id',
    userId: 'userId',
    metadata: 'metadata',
    metadataEncrypted: 'metadataEncrypted',
  },
  thoughtTextFile: { thoughtId: 'thoughtId', textFileId: 'textFileId', userId: 'userId' },
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ decryptTenantValue: decryptMock }))

import { loadTenantStructure } from './evidence-items-db'

const billing = { billingUserId: 'public-bench-runner', chatModel: 'openai/gpt-4o-mini' }

beforeEach(() => {
  selects.length = 0
  decryptMock.mockReset()
})

describe('loadTenantStructure', () => {
  it('reads splitFrom from encrypted and plain metadata, and the note links', async () => {
    decryptMock.mockResolvedValue(JSON.stringify({ splitFrom: 'parent-1' }))
    selects.push(
      [
        { id: 'parent-1', metadata: {}, metadataEncrypted: null },
        { id: 'child-1', metadata: { encrypted: true }, metadataEncrypted: 'cipher' },
        { id: 'plain-child', metadata: { splitFrom: 'parent-1' }, metadataEncrypted: null },
      ],
      [{ thoughtId: 'parent-1', textFileId: 'note-1' }],
    )
    const structure = await loadTenantStructure('public-bench-t', billing)
    expect(structure).toEqual({
      thoughts: [
        { id: 'parent-1', splitFrom: null },
        { id: 'child-1', splitFrom: 'parent-1' },
        { id: 'plain-child', splitFrom: 'parent-1' },
      ],
      links: [{ thoughtId: 'parent-1', textFileId: 'note-1' }],
    })
    expect(decryptMock).toHaveBeenCalledWith({
      userId: 'public-bench-t',
      table: 'thought',
      column: 'metadata',
      ciphertext: 'cipher',
    })
  })

  it('fails loud when the encrypted metadata is not JSON', async () => {
    decryptMock.mockResolvedValue('not json')
    selects.push([{ id: 'a', metadata: {}, metadataEncrypted: 'cipher' }], [])
    await expect(loadTenantStructure('public-bench-t', billing)).rejects.toThrow()
  })
})
