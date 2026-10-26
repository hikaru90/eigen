import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { getDb } from '$lib/server/db'
import { notePassage } from '$lib/server/db/schema'
import { chunkNoteIntoPassages } from './chunk-note-passages'
import {
  applyPassageSync,
  createDbNoteSearchSources,
  loadStoredPassages,
  NOTE_PASSAGE_EMBED_BATCH,
  preparePassageSync,
  type StoredPassage,
} from './note-passages'

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
  decryptTenantValue: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
  ),
}))

vi.mock('$lib/server/db', () => ({ getDb: vi.fn() }))

function sentences(count: number, offset = 0): string {
  return Array.from(
    { length: count },
    (_, i) =>
      `Sentence number ${offset + i} talks about topic ${offset + i} in some detail and more words.`,
  ).join(' ')
}

const fakeEmbedding = (seed: number) => Array.from({ length: 1536 }, (_, i) => (seed + i) / 10_000)

function embedSpy() {
  return vi.fn(async (_userId: string, texts: string[]) => texts.map((_, i) => fakeEmbedding(i)))
}

function stored(body: string): StoredPassage[] {
  return chunkNoteIntoPassages(body).map((c, i) => ({ id: `p${i}`, ...c }))
}

describe('preparePassageSync', () => {
  it('create: chunks the body and embeds every passage with the injected embed fn', async () => {
    const body = sentences(30)
    const embed = embedSpy()
    const prepared = await preparePassageSync('u1', { body, stored: [] }, embed)
    const chunks = chunkNoteIntoPassages(body)
    expect(prepared.deleteIds).toEqual([])
    expect(prepared.rows.map((r) => r.text)).toEqual(chunks.map((c) => c.text))
    expect(prepared.rows.map((r) => r.ordinal)).toEqual(chunks.map((_, i) => i))
    const embedded = embed.mock.calls.flatMap((call) => call[1])
    expect(embedded).toEqual(chunks.map((c) => c.text))
    for (const row of prepared.rows) {
      expect(row.embedding).toHaveLength(1536)
      expect(row.textEncrypted).toBe(`enc:${row.text}`)
      expect(row.lexicalText).toBe(row.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' '))
    }
  })

  it('append: embeds only the passages the tail changed, not the untouched head', async () => {
    const body = sentences(30)
    const head = stored(body)
    const appended = `${body} ${sentences(8, 900)}`
    const embed = embedSpy()
    const prepared = await preparePassageSync('u1', { body: appended, stored: head }, embed)
    const next = chunkNoteIntoPassages(appended)
    const embedded = embed.mock.calls.flatMap((call) => call[1])
    expect(embedded.length).toBeLessThan(next.length)
    expect(embedded.length).toBeLessThanOrEqual(prepared.rows.length)
    expect(embedded).toEqual(prepared.rows.map((r) => r.text))
    expect(prepared.deleteIds.length).toBeLessThanOrEqual(1)
    for (const text of embedded) expect(head.map((h) => h.text)).not.toContain(text)
  })

  it('edit: rebuilds the passages from the edit point so they match the new text', async () => {
    const body = sentences(30)
    const head = stored(body)
    const edited = body.replace('Sentence number 5 talks', 'A rewritten opening talks')
    const embed = embedSpy()
    const prepared = await preparePassageSync('u1', { body: edited, stored: head }, embed)
    const kept = head.filter((h) => !prepared.deleteIds.includes(h.id)).map((h) => h.text)
    const finalTexts = [...kept, ...prepared.rows.map((r) => r.text)]
    expect(new Set(finalTexts)).toEqual(new Set(chunkNoteIntoPassages(edited).map((c) => c.text)))
  })

  it('unchanged body: no embedding call, no writes (e.g. a title-only edit)', async () => {
    const body = sentences(20)
    const embed = embedSpy()
    const prepared = await preparePassageSync('u1', { body, stored: stored(body) }, embed)
    expect(embed).not.toHaveBeenCalled()
    expect(prepared).toEqual({ deleteIds: [], rows: [] })
  })

  it('emptied body: deletes all stored passages without embedding', async () => {
    const body = sentences(20)
    const head = stored(body)
    const embed = embedSpy()
    const prepared = await preparePassageSync('u1', { body: '', stored: head }, embed)
    expect(embed).not.toHaveBeenCalled()
    expect(prepared.rows).toEqual([])
    expect(prepared.deleteIds).toHaveLength(head.length)
  })

  it('batches the embedding gateway calls', async () => {
    const body = sentences(NOTE_PASSAGE_EMBED_BATCH * 8)
    const embed = embedSpy()
    await preparePassageSync('u1', { body, stored: [] }, embed)
    expect(embed.mock.calls.length).toBeGreaterThan(1)
    for (const call of embed.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(NOTE_PASSAGE_EMBED_BATCH)
    }
  })

  it('fails loudly when the gateway returns a different number of vectors (no partial index)', async () => {
    const embed = vi.fn(async () => [fakeEmbedding(0)])
    await expect(
      preparePassageSync('u1', { body: sentences(30), stored: [] }, embed),
    ).rejects.toThrow(/embedding count/i)
  })

  it('propagates an embedding failure instead of storing the note without passages', async () => {
    const embed = vi.fn(async () => {
      throw new Error('gateway down')
    })
    await expect(
      preparePassageSync('u1', { body: sentences(30), stored: [] }, embed),
    ).rejects.toThrow('gateway down')
  })
})

describe('applyPassageSync', () => {
  function fakeTx() {
    const calls: string[] = []
    const inserted: unknown[] = []
    const tx = {
      delete: vi.fn(() => ({
        where: vi.fn(async () => {
          calls.push('delete')
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(async (rows: unknown[]) => {
          calls.push('insert')
          inserted.push(...rows)
        }),
      })),
    }
    return { tx, calls, inserted }
  }

  it('deletes stale passages first, then inserts the new ones under the note and tenant', async () => {
    const { tx, calls, inserted } = fakeTx()
    await applyPassageSync(tx as never, 'u1', 'note-1', {
      deleteIds: ['p9'],
      rows: [
        {
          ordinal: 9,
          startChar: 10,
          endChar: 20,
          text: 'abc',
          textEncrypted: 'enc:abc',
          lexicalText: 'abc',
          embedding: fakeEmbedding(1),
        },
      ],
    })
    expect(calls).toEqual(['delete', 'insert'])
    expect(inserted).toEqual([
      expect.objectContaining({
        userId: 'u1',
        textFileId: 'note-1',
        ordinal: 9,
        startChar: 10,
        endChar: 20,
        textEncrypted: 'enc:abc',
        lexicalText: 'abc',
      }),
    ])
    // plaintext never lands in the row (only the encrypted copy and the folded lexical surface)
    expect(inserted[0]).not.toHaveProperty('text')
  })

  it('skips both statements when there is nothing to do', async () => {
    const { tx, calls } = fakeTx()
    await applyPassageSync(tx as never, 'u1', 'note-1', { deleteIds: [], rows: [] })
    expect(calls).toEqual([])
  })
})

describe('embedding stays DB-only', () => {
  /** A chainable, awaitable query builder that records the column map passed to select(). */
  function recordingDb(selected: Array<Record<string, unknown>>, rows: unknown[] = []) {
    const chain: Record<string, unknown> = {}
    for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) chain[m] = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => resolve(rows)
    return {
      select: (fields: Record<string, unknown>) => {
        selected.push(fields)
        return chain
      },
    }
  }

  function expectNoEmbeddingColumn(selected: Array<Record<string, unknown>>): void {
    expect(selected.length).toBeGreaterThan(0)
    for (const fields of selected) {
      for (const [key, column] of Object.entries(fields)) {
        expect(key.toLowerCase()).not.toContain('embedding')
        expect(column).not.toBe(notePassage.embedding)
      }
    }
  }

  it('search sources never select the embedding column', async () => {
    const selected: Array<Record<string, unknown>> = []
    vi.mocked(getDb).mockReturnValue(recordingDb(selected) as never)
    const sources = createDbNoteSearchSources('u1', {
      query: 'coastal trip activities',
      queryEmbedding: fakeEmbedding(1),
    })
    await sources.passageCandidates()
    await sources.noteLexical()
    await sources.loadNotes(['n1'])
    await sources.loadPassages([{ textFileId: 'n1', ordinal: 0 }])
    expectNoEmbeddingColumn(selected)
  })

  it('loadStoredPassages never selects the embedding column', async () => {
    const selected: Array<Record<string, unknown>> = []
    vi.mocked(getDb).mockReturnValue(recordingDb(selected) as never)
    await loadStoredPassages('u1', 'n1')
    expectNoEmbeddingColumn(selected)
  })

  it('returns decrypted text and offsets only, as plain tool-safe objects', async () => {
    const selected: Array<Record<string, unknown>> = []
    vi.mocked(getDb).mockReturnValue(
      recordingDb(selected, [
        { textFileId: 'n1', ordinal: 2, startChar: 5, endChar: 20, textEncrypted: 'enc:surf at dawn' },
      ]) as never,
    )
    const sources = createDbNoteSearchSources('u1', { query: 'surf', queryEmbedding: fakeEmbedding(1) })
    const passages = await sources.loadPassages([{ textFileId: 'n1', ordinal: 2 }])
    expect(passages).toEqual([
      { textFileId: 'n1', ordinal: 2, startChar: 5, endChar: 20, text: 'surf at dawn' },
    ])
    expect(JSON.stringify(passages).toLowerCase()).not.toContain('embedding')
  })
})

describe('archived notes never match (docs/planning/personamem-score-plan.md, S2b)', () => {
  const dialect = new PgDialect()

  it('every search source (vector, passage FTS, whole-note keyword, note load) filters archived notes out', async () => {
    const wheres: string[] = []
    const chain: Record<string, unknown> = {}
    for (const m of ['from', 'innerJoin', 'orderBy', 'limit']) chain[m] = () => chain
    chain.where = (condition: unknown) => {
      wheres.push(dialect.sqlToQuery(condition as Parameters<PgDialect['sqlToQuery']>[0]).sql)
      return chain
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve([])
    vi.mocked(getDb).mockReturnValue({ select: () => chain } as never)

    const sources = createDbNoteSearchSources('u1', {
      query: 'coastal trip activities',
      queryEmbedding: fakeEmbedding(1),
    })
    await sources.passageCandidates()
    await sources.noteLexical()
    await sources.loadNotes(['n1'])

    // vector ANN, passage FTS, note keyword, loadNotes
    expect(wheres).toHaveLength(4)
    for (const where of wheres) {
      expect(where).toContain('"text_file"."archived_at" is null')
    }
  })
})
