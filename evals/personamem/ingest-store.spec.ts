import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  loadTenantStructure: vi.fn(),
  withEvalDb: vi.fn(),
  insertEvalUserRow: vi.fn(),
  deleteEvalUserRow: vi.fn(),
  enrichedIds: [] as string[],
}))

vi.mock('./evidence-items-db', () => ({ loadTenantStructure: m.loadTenantStructure }))
vi.mock('../harness/eval-context', () => ({ withEvalDb: m.withEvalDb }))
vi.mock('$lib/eval/store', () => ({
  insertEvalUserRow: m.insertEvalUserRow,
  deleteEvalUserRow: m.deleteEvalUserRow,
}))

import { createIngestStore, familyThoughtIds, rootThoughtCount } from './ingest-store'

const thoughts = [
  { id: 'a', splitFrom: null },
  { id: 'a1', splitFrom: 'a' },
  { id: 'a1x', splitFrom: 'a1' },
  { id: 'b', splitFrom: null },
]

describe('family helpers', () => {
  it('lists a capture thought first, then its transitive split children', () => {
    const families = familyThoughtIds(['a', 'b'], thoughts)
    expect(families.get('a')).toEqual(['a', 'a1', 'a1x'])
    expect(families.get('b')).toEqual(['b'])
  })

  it('fails loud for a capture thought that is not in the tenant', () => {
    expect(() => familyThoughtIds(['zzz'], thoughts)).toThrow(/zzz/)
  })

  it('counts only thoughts that are not split children as roots', () => {
    expect(rootThoughtCount(thoughts)).toBe(2)
  })
})

describe('createIngestStore', () => {
  const billing = { billingUserId: 'public-bench-runner', chatModel: 'openai/gpt-4o-mini' }

  beforeEach(() => {
    vi.clearAllMocks()
    m.loadTenantStructure.mockResolvedValue({ thoughts, links: [] })
    m.enrichedIds = ['a', 'b']
    m.withEvalDb.mockImplementation(async (_u: string, fn: (db: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({ where: async () => m.enrichedIds.map((id) => ({ id })) }),
        }),
      }),
    )
  })

  it('resetTenant deletes then recreates; ensureTenant only creates', async () => {
    const store = createIngestStore(billing)
    await store.ensureTenant('t')
    expect(m.deleteEvalUserRow).not.toHaveBeenCalled()
    await store.resetTenant('t')
    expect(m.deleteEvalUserRow).toHaveBeenCalledWith('t')
    expect(m.insertEvalUserRow).toHaveBeenCalledTimes(2)
  })

  it('counts thoughts and roots from the tenant structure', async () => {
    const store = createIngestStore(billing)
    expect(await store.thoughtCount('t')).toBe(4)
    expect(await store.rootCount('t')).toBe(2)
  })

  it('verifyRecorded reports thoughts missing from the database and capture thoughts without enriched_at', async () => {
    const store = createIngestStore(billing)
    m.enrichedIds = ['a']
    const result = await store.verifyRecorded(
      't',
      new Map([
        [0, ['a', 'a1']],
        [1, ['b', 'ghost']],
      ]),
    )
    expect(result).toEqual({ missing: ['ghost'], unenriched: ['b'] })
  })
})
