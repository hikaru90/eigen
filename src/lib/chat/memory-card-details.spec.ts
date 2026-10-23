import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMemoryCardDetails, pickThoughtDetails } from './memory-card-details'

describe('pickThoughtDetails', () => {
  it('prefers the normalized text and keeps the category', () => {
    expect(pickThoughtDetails({ normalizedText: ' Full ', rawText: 'raw', category: 'task' }, 'x')).toEqual({
      text: 'Full',
      category: 'task',
    })
  })

  it('falls back to the raw text, then the card text, and drops blank categories', () => {
    expect(pickThoughtDetails({ rawText: 'raw', category: ' ' }, 'x')).toEqual({ text: 'raw', category: null })
    expect(pickThoughtDetails(null, 'card')).toEqual({ text: 'card', category: null })
  })
})

describe('loadMemoryCardDetails', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the thought, then its linked thoughts without the thought itself', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/thoughts/t1') {
        return new Response(JSON.stringify({ normalizedText: 'Whole thought', category: 'observation' }))
      }
      return new Response(
        JSON.stringify({
          results: [
            { id: 't1', normalizedText: 'Whole thought' },
            { id: 't2', normalizedText: 'Neighbour', createdAt: '2026-10-20T10:00:00.000Z' },
          ],
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const details = await loadMemoryCardDetails('t1', 'Whole…')
    expect(details).toEqual({
      text: 'Whole thought',
      category: 'observation',
      linked: [{ id: 't2', text: 'Neighbour', createdAtIso: '2026-10-20T10:00:00.000Z' }],
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/retrieval/search')
  })

  it('fails explicitly when the thought cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(loadMemoryCardDetails('t1', 'x')).rejects.toThrow('404')
  })
})
