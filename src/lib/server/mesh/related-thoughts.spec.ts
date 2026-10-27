import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadRelatedThoughts, RELATED_LIMIT, RELATED_MIN_SIMILARITY } from './related-thoughts'

const { executeMock, decryptMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  decryptMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: () => ({ execute: executeMock }) }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ decryptTenantValue: decryptMock }))

/** Flatten a drizzle sql chunk tree into its SQL text and bound params. */
function render(query: { queryChunks: unknown[] }): { text: string; params: unknown[] } {
  let text = ''
  const params: unknown[] = []
  const walk = (chunks: unknown[]) => {
    for (const chunk of chunks) {
      if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) {
        walk((chunk as { queryChunks: unknown[] }).queryChunks)
      } else if (chunk && typeof chunk === 'object' && 'value' in chunk) {
        text += (chunk as { value: string[] }).value.join('')
      } else {
        params.push(chunk)
        text += '?'
      }
    }
  }
  walk(query.queryChunks)
  return { text, params }
}

const row = (sourceId: string, id: string, text: string, enc: string | null = null) => ({
  source_id: sourceId,
  id,
  normalized_text: text,
  normalized_text_encrypted: enc,
  created_at: new Date('2026-10-01T10:00:00Z'),
})

describe('loadRelatedThoughts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    decryptMock.mockImplementation(
      async ({ ciphertext }: { ciphertext: string }) => `dec:${ciphertext}`,
    )
  })

  it('does not query for an empty list', async () => {
    expect((await loadRelatedThoughts('u1', [])).size).toBe(0)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('runs one tenant-scoped LATERAL query for the whole list, with the floor, the limit and no embedding column selected', async () => {
    executeMock.mockResolvedValue([])
    await loadRelatedThoughts('u1', ['a', 'b', 'c'])
    expect(executeMock).toHaveBeenCalledTimes(1)
    const { text, params } = render(executeMock.mock.calls[0][0])
    expect(text).toContain('CROSS JOIN LATERAL')
    expect(text).toContain('t.id <> s.id')
    expect(text).toContain('<=>')
    expect(text.match(/t\.user_id = \?/)).not.toBeNull()
    expect(text.match(/s\.user_id = \?/)).not.toBeNull()
    expect(text.split('\n').find((l) => l.includes('SELECT s.id'))).not.toMatch(/embedding/)
    expect(params).toContain('u1')
    expect(params).toContain(1 - RELATED_MIN_SIMILARITY)
    expect(params).toContain(RELATED_LIMIT)
    expect(params).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })

  it('groups neighbours per source in query order, decrypting tenant-encrypted text', async () => {
    executeMock.mockResolvedValue([
      row('a', 'n1', 'plain one'),
      row('a', 'n2', '', 'cipher'),
      row('b', 'n3', 'plain three'),
    ])
    const related = await loadRelatedThoughts('u1', ['a', 'b', 'c'])
    expect(related.get('a')?.map((r) => r.text)).toEqual(['plain one', 'dec:cipher'])
    expect(related.get('b')?.[0]).toEqual({
      id: 'n3',
      text: 'plain three',
      createdAtIso: '2026-10-01T10:00:00.000Z',
    })
    expect(related.has('c')).toBe(false)
    expect(JSON.stringify([...related])).not.toMatch(/embedding/)
  })
})
