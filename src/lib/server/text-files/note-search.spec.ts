import { describe, expect, it, vi } from 'vitest'
import { runNoteSearch, type NoteSearchSources } from './note-search'

type FakePassage = { startChar: number; endChar: number; text: string }

/**
 * Three notes: a long "trip" note (passages 0-9), a recipe, and a title-only list.
 * Sources are injected, so merge, cap, neighbours and note metadata run without DB or LLM.
 */
function makeSources(patch: Partial<NoteSearchSources> = {}): {
  sources: NoteSearchSources
  loadPassages: ReturnType<typeof vi.fn>
} {
  const passageText = (noteId: string, ordinal: number): FakePassage => ({
    startChar: ordinal * 100,
    endChar: ordinal * 100 + 100,
    text: `${noteId} passage ${ordinal}`,
  })
  const loadPassages = vi.fn(async (pairs: Array<{ textFileId: string; ordinal: number }>) =>
    pairs
      .filter((p) => !(p.textFileId === 'trip' && p.ordinal > 9))
      .map((p) => ({ textFileId: p.textFileId, ordinal: p.ordinal, ...passageText(p.textFileId, p.ordinal) })),
  )
  const sources: NoteSearchSources = {
    passageCandidates: async () => [],
    noteLexical: async () => [],
    loadNotes: async (ids) =>
      ids.map((id) => ({
        id,
        title: `${id} title`,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-02T10:00:00.000Z'),
        author: 'user' as const,
        authorLabel: null,
        authorKeyId: null,
      })),
    loadPassages,
    ...patch,
  }
  return { sources, loadPassages }
}

const params = { minScore: 0.2, noteLimit: 5 }

describe('runNoteSearch', () => {
  it('returns the matched passage with its +-1 neighbours, the note title and dates', async () => {
    const { sources, loadPassages } = makeSources({
      passageCandidates: async () => [
        { passageId: 'trip-4', textFileId: 'trip', ordinal: 4, vectorDistance: 0.4 },
      ],
    })
    const hits = await runNoteSearch(sources, params)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      id: 'trip',
      title: 'trip title',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-02T10:00:00.000Z',
      matchedOrdinals: [4],
    })
    expect(loadPassages).toHaveBeenCalledWith(
      expect.arrayContaining([
        { textFileId: 'trip', ordinal: 3 },
        { textFileId: 'trip', ordinal: 4 },
        { textFileId: 'trip', ordinal: 5 },
      ]),
    )
    expect(hits[0]!.excerpt).toContain('trip passage 4')
    expect(hits[0]!.excerpt).toContain('trip passage 3')
    expect(hits[0]!.excerpt).toContain('trip passage 5')
    expect(hits[0]!.excerpt).not.toContain('trip passage 6')
    expect(hits[0]!.preview).toBe('trip passage 4')
  })

  it('caps matched passages per note even when many passages of one note match', async () => {
    const { sources } = makeSources({
      passageCandidates: async () =>
        [0, 1, 2, 3, 4, 5, 6, 7].map((ordinal) => ({
          passageId: `trip-${ordinal}`,
          textFileId: 'trip',
          ordinal,
          vectorDistance: 0.3 + ordinal * 0.02,
        })),
    })
    const hits = await runNoteSearch(sources, params)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.matchedOrdinals).toEqual([0, 1, 2])
  })

  it('returns one hit per note (citations point to the note), best note first, limited to noteLimit', async () => {
    const { sources } = makeSources({
      passageCandidates: async () => [
        { passageId: 'a-1', textFileId: 'a', ordinal: 1, vectorDistance: 0.5 },
        { passageId: 'b-1', textFileId: 'b', ordinal: 1, vectorDistance: 0.3 },
        { passageId: 'b-2', textFileId: 'b', ordinal: 2, vectorDistance: 0.35 },
        { passageId: 'c-1', textFileId: 'c', ordinal: 1, vectorDistance: 0.6 },
      ],
    })
    const hits = await runNoteSearch(sources, { ...params, noteLimit: 2 })
    expect(hits.map((h) => h.id)).toEqual(['b', 'a'])
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  it('finds a passage purely by keyword (lexical rank) when the embedding is far away', async () => {
    const { sources } = makeSources({
      passageCandidates: async () => [
        { passageId: 'trip-7', textFileId: 'trip', ordinal: 7, vectorDistance: 0.95 },
        { passageId: 'trip-7', textFileId: 'trip', ordinal: 7, lexicalRank: 0.3 },
      ],
    })
    const hits = await runNoteSearch(sources, params)
    expect(hits[0]!.matchedOrdinals).toEqual([7])
  })

  it('returns nothing, and loads nothing, when no passage clears the relevance floor', async () => {
    const { sources, loadPassages } = makeSources({
      passageCandidates: async () => [
        { passageId: 'trip-7', textFileId: 'trip', ordinal: 7, vectorDistance: 0.97 },
      ],
    })
    expect(await runNoteSearch(sources, params)).toEqual([])
    expect(loadPassages).not.toHaveBeenCalled()
  })

  it('keeps a note-level keyword hit (title match) with its opening passage', async () => {
    const { sources } = makeSources({
      noteLexical: async () => [{ textFileId: 'list', lexicalRank: 0.2 }],
    })
    const hits = await runNoteSearch(sources, params)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: 'list', matchedOrdinals: [0] })
  })

  it('omits a hit whose note is no longer visible (deleted or filtered by author)', async () => {
    const { sources } = makeSources({
      passageCandidates: async () => [
        { passageId: 'gone-1', textFileId: 'gone', ordinal: 1, vectorDistance: 0.3 },
        { passageId: 'trip-1', textFileId: 'trip', ordinal: 1, vectorDistance: 0.4 },
      ],
      loadNotes: async (ids) =>
        ids
          .filter((id) => id !== 'gone')
          .map((id) => ({
            id,
            title: id,
            createdAt: new Date('2026-03-01T10:00:00.000Z'),
            updatedAt: new Date('2026-03-01T10:00:00.000Z'),
            author: 'user' as const,
            authorLabel: null,
            authorKeyId: null,
          })),
    })
    const hits = await runNoteSearch(sources, params)
    expect(hits.map((h) => h.id)).toEqual(['trip'])
  })

  it('produces tool-safe hits: plain text fields, no embedding key anywhere', async () => {
    const { sources } = makeSources({
      passageCandidates: async () => [
        { passageId: 'trip-4', textFileId: 'trip', ordinal: 4, vectorDistance: 0.4 },
      ],
    })
    const hits = await runNoteSearch(sources, params)
    expect(JSON.stringify(hits).toLowerCase()).not.toContain('embedding')
  })
})
