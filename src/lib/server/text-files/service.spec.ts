import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendTextFile,
  createTextFile,
  deleteTextFile,
  getTextFile,
  linkTextFileToThought,
  listTextFilesForThought,
  listTextFilesForThoughtIds,
  listThoughtsForTextFile,
  searchTextFiles,
  unlinkTextFileFromThought,
  updateTextFile,
} from './service'

const {
  getDbMock,
  encryptTenantValueMock,
  decryptTenantValueMock,
  preparePassageSyncMock,
  applyPassageSyncMock,
  loadStoredPassagesMock,
  createDbNoteSearchSourcesMock,
  createThoughtEmbeddingMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  preparePassageSyncMock: vi.fn(),
  applyPassageSyncMock: vi.fn(),
  loadStoredPassagesMock: vi.fn(),
  createDbNoteSearchSourcesMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  encryptTenantValueMock: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
  decryptTenantValueMock: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
  ),
}))

// getDb() returns the per-test mock db plus a transaction() that runs its callback on that db.
vi.mock('$lib/server/db', () => ({
  getDb: () => {
    const db = getDbMock()
    return { ...db, transaction: async (fn: (tx: unknown) => unknown) => fn(db) }
  },
}))

vi.mock('./note-passages', () => ({
  preparePassageSync: preparePassageSyncMock,
  applyPassageSync: applyPassageSyncMock,
  loadStoredPassages: loadStoredPassagesMock,
  createDbNoteSearchSources: createDbNoteSearchSourcesMock,
}))

vi.mock('$lib/server/llm/embedding', () => ({
  createThoughtEmbedding: createThoughtEmbeddingMock,
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptTenantValueMock,
  decryptTenantValue: decryptTenantValueMock,
}))

function makeReturningInsert(row: unknown) {
  return {
    values: vi.fn(() => ({
      returning: vi.fn(async () => [row]),
    })),
  }
}

describe('text-files service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preparePassageSyncMock.mockResolvedValue({ deleteIds: [], rows: [] })
    applyPassageSyncMock.mockResolvedValue(undefined)
    loadStoredPassagesMock.mockResolvedValue([])
    createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2])
  })

  it('createTextFile encrypts body and returns decrypted record', async () => {
    const createdAt = new Date('2026-06-05T12:00:00.000Z')
    getDbMock.mockReturnValue({
      insert: vi.fn(() =>
        makeReturningInsert({
          id: 'f1',
          title: 'Notes',
          bodyText: '',
          bodyTextEncrypted: 'enc:hello world',
          createdAt,
          updatedAt: createdAt,
        }),
      ),
    })

    const result = await createTextFile('u1', { title: 'Notes', body: 'hello world' })

    expect(encryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', table: 'text_file', column: 'body_text' }),
    )
    expect(result).toMatchObject({
      id: 'f1',
      title: 'Notes',
      body: 'hello world',
    })
  })

  it('rejects create when title and body are both empty', async () => {
    await expect(createTextFile('u1', { body: '   ' })).rejects.toThrow(/title or body is required/)
    await expect(createTextFile('u1', { title: '   ' })).rejects.toThrow(
      /title or body is required/,
    )
  })

  it('createTextFile stamps createdAt and updatedAt with the given source time, else leaves them to the database', async () => {
    const stored = new Date('2025-03-01T09:00:00.000Z')
    const insertSpy = makeReturningInsert({
      id: 'f1',
      title: 'Notes',
      bodyText: '',
      bodyTextEncrypted: 'enc:hello',
      createdAt: stored,
      updatedAt: stored,
    })
    getDbMock.mockReturnValue({ insert: vi.fn(() => insertSpy) })

    await createTextFile('u1', { title: 'Notes', body: 'hello', createdAt: stored })
    expect(insertSpy.values).toHaveBeenLastCalledWith(
      expect.objectContaining({ createdAt: stored, updatedAt: stored }),
    )

    await createTextFile('u1', { title: 'Notes', body: 'hello' })
    const plain = insertSpy.values.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(plain).not.toHaveProperty('createdAt')
    expect(plain).not.toHaveProperty('updatedAt')
  })

  it('createTextFile allows title-only notes with empty body', async () => {
    const createdAt = new Date('2026-06-05T12:00:00.000Z')
    getDbMock.mockReturnValue({
      insert: vi.fn(() =>
        makeReturningInsert({
          id: 'f2',
          title: 'shopping list',
          bodyText: '',
          bodyTextEncrypted: 'enc:',
          createdAt,
          updatedAt: createdAt,
        }),
      ),
    })

    const result = await createTextFile('u1', { title: 'shopping list' })

    expect(encryptTenantValueMock).toHaveBeenCalledWith(expect.objectContaining({ plaintext: '' }))
    expect(result).toMatchObject({
      id: 'f2',
      title: 'shopping list',
      body: '',
    })
  })

  it('updateTextFile returns null when missing', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      })),
    })

    const result = await updateTextFile('u1', 'missing', { body: 'next' })
    expect(result).toBeNull()
  })

  it('appendTextFile returns null when missing', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      })),
    })

    const result = await appendTextFile('u1', 'missing', { text: 'milk' })
    expect(result).toBeNull()
  })

  it('appendTextFile rejects blank text', async () => {
    await expect(appendTextFile('u1', 'f1', { text: '   ' })).rejects.toThrow(/text is required/)
  })

  it('appendTextFile inserts a newline between existing body and new text', async () => {
    const createdAt = new Date('2026-06-05T12:00:00.000Z')
    const updatedAt = new Date('2026-06-05T13:00:00.000Z')
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: 'f1',
                title: 'shopping list',
                bodyText: '',
                bodyTextEncrypted: 'enc:eggs',
                author: 'user',
                authorLabel: null,
                authorKeyId: null,
                createdAt,
                updatedAt: createdAt,
              },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [
              {
                id: 'f1',
                title: 'shopping list',
                bodyText: '',
                bodyTextEncrypted: 'enc:eggs\nmilk',
                author: 'user',
                authorLabel: null,
                authorKeyId: null,
                createdAt,
                updatedAt,
              },
            ]),
          })),
        })),
      })),
    })

    const result = await appendTextFile('u1', 'f1', { text: 'milk' })

    expect(encryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ plaintext: 'eggs\nmilk' }),
    )
    expect(result).toMatchObject({
      id: 'f1',
      title: 'shopping list',
      body: 'eggs\nmilk',
    })
  })

  it('appendTextFile does not double-newline when body already ends with newline', async () => {
    const createdAt = new Date('2026-06-05T12:00:00.000Z')
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: 'f1',
                title: 'list',
                bodyText: '',
                bodyTextEncrypted: 'enc:eggs\n',
                author: 'user',
                authorLabel: null,
                authorKeyId: null,
                createdAt,
                updatedAt: createdAt,
              },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [
              {
                id: 'f1',
                title: 'list',
                bodyText: '',
                bodyTextEncrypted: 'enc:eggs\nmilk',
                author: 'user',
                authorLabel: null,
                authorKeyId: null,
                createdAt,
                updatedAt: createdAt,
              },
            ]),
          })),
        })),
      })),
    })

    await appendTextFile('u1', 'f1', { text: 'milk' })
    expect(encryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ plaintext: 'eggs\nmilk' }),
    )
  })

  it('appendTextFile appends without separator when body is empty', async () => {
    const createdAt = new Date('2026-06-05T12:00:00.000Z')
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: 'f1',
                title: 'shopping list',
                bodyText: '',
                bodyTextEncrypted: 'enc:',
                author: 'user',
                authorLabel: null,
                authorKeyId: null,
                createdAt,
                updatedAt: createdAt,
              },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [
              {
                id: 'f1',
                title: 'shopping list',
                bodyText: '',
                bodyTextEncrypted: 'enc:milk',
                author: 'user',
                authorLabel: null,
                authorKeyId: null,
                createdAt,
                updatedAt: createdAt,
              },
            ]),
          })),
        })),
      })),
    })

    const result = await appendTextFile('u1', 'f1', { text: 'milk' })
    expect(encryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ plaintext: 'milk' }),
    )
    expect(result?.body).toBe('milk')
  })

  it('deleteTextFile reports whether a row was removed', async () => {
    getDbMock.mockReturnValue({
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: 'f1' }]),
        })),
      })),
    })
    expect(await deleteTextFile('u1', 'f1')).toBe(true)
  })

  it('getTextFile decrypts stored body', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: 'f1',
                title: '',
                bodyText: '',
                bodyTextEncrypted: 'enc:secret note',
                createdAt: new Date('2026-06-05T12:00:00.000Z'),
                updatedAt: new Date('2026-06-05T12:00:00.000Z'),
              },
            ]),
          })),
        })),
      })),
    })

    const file = await getTextFile('u1', 'f1')
    expect(file?.body).toBe('secret note')
  })

  it('linkTextFileToThought validates ownership', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      })),
    })

    const result = await linkTextFileToThought('u1', 't1', 'f1')
    expect(result).toEqual({ linked: false, reason: 'thought_not_found' })
  })

  it('listTextFilesForThought returns previews', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(async () => [
                {
                  id: 'f1',
                  title: 'Doc',
                  bodyText: '',
                  bodyTextEncrypted: 'enc:long body text here',
                  updatedAt: new Date('2026-06-05T12:00:00.000Z'),
                },
              ]),
            })),
          })),
        })),
      })),
    })

    const rows = await listTextFilesForThought('u1', 't1')
    expect(rows).toEqual([
      {
        id: 'f1',
        title: 'Doc',
        preview: 'long body text here',
        updatedAt: '2026-06-05T12:00:00.000Z',
      },
    ])
  })

  it('unlinkTextFileFromThought returns false when link missing', async () => {
    getDbMock.mockReturnValue({
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
    })
    expect(await unlinkTextFileFromThought('u1', 't1', 'f1')).toBe(false)
  })

  it('listTextFilesForThoughtIds groups attachments by thought', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(async () => [
                {
                  thoughtId: 't1',
                  id: 'f1',
                  title: 'Doc',
                  bodyText: '',
                  bodyTextEncrypted: 'enc:recipe body',
                  updatedAt: new Date('2026-06-05T12:00:00.000Z'),
                },
                {
                  thoughtId: 't2',
                  id: 'f2',
                  title: 'Other',
                  bodyText: '',
                  bodyTextEncrypted: 'enc:other',
                  updatedAt: new Date('2026-06-05T12:00:00.000Z'),
                },
              ]),
            })),
          })),
        })),
      })),
    })

    const map = await listTextFilesForThoughtIds('u1', ['t1', 't2'])
    expect(map.get('t1')).toEqual([
      {
        id: 'f1',
        title: 'Doc',
        preview: 'recipe body',
        updatedAt: '2026-06-05T12:00:00.000Z',
      },
    ])
    expect(map.get('t2')).toHaveLength(1)
  })

  it('listThoughtsForTextFile returns empty when note missing', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      })),
    })

    const rows = await listThoughtsForTextFile('u1', 'missing')
    expect(rows).toEqual([])
  })

  it('listThoughtsForTextFile returns linked thought snippets', async () => {
    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(async () => [{ id: 'f1' }]),
              })),
            })),
          }
        }
        return {
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn(async () => [{ id: 't1', normalizedText: 'Buy groceries' }]),
              })),
            })),
          })),
        }
      }),
    })

    const rows = await listThoughtsForTextFile('u1', 'f1')
    expect(rows).toEqual([{ id: 't1', normalizedText: 'Buy groceries' }])
  })

  it('createTextFile embeds the passages before the insert and writes them in the same transaction', async () => {
    const createdAt = new Date('2026-06-05T12:00:00.000Z')
    const prepared = { deleteIds: [], rows: [{ ordinal: 0 }] }
    preparePassageSyncMock.mockResolvedValue(prepared)
    const callOrder: string[] = []
    preparePassageSyncMock.mockImplementation(async () => {
      callOrder.push('prepare')
      return prepared
    })
    applyPassageSyncMock.mockImplementation(async () => {
      callOrder.push('apply')
    })
    getDbMock.mockReturnValue({
      insert: vi.fn(() => {
        callOrder.push('insert')
        return makeReturningInsert({
          id: 'f1',
          title: 'Trip',
          bodyText: '',
          bodyTextEncrypted: 'enc:long body',
          createdAt,
          updatedAt: createdAt,
        })
      }),
    })

    await createTextFile('u1', { title: 'Trip', body: 'long body' })

    expect(preparePassageSyncMock).toHaveBeenCalledWith('u1', { body: 'long body', stored: [] })
    expect(applyPassageSyncMock).toHaveBeenCalledWith(expect.anything(), 'u1', 'f1', prepared)
    expect(callOrder).toEqual(['prepare', 'insert', 'apply'])
  })

  it('createTextFile writes nothing when the passage embedding fails (no note without an index)', async () => {
    preparePassageSyncMock.mockRejectedValue(new Error('gateway down'))
    const insert = vi.fn()
    getDbMock.mockReturnValue({ insert })

    await expect(createTextFile('u1', { title: 'Trip', body: 'long body' })).rejects.toThrow(
      'gateway down',
    )
    expect(insert).not.toHaveBeenCalled()
  })

  it('updateTextFile and appendTextFile sync passages against the stored ones', async () => {
    const createdAt = new Date('2026-06-05T12:00:00.000Z')
    const existing = {
      id: 'f1',
      title: 'list',
      bodyText: '',
      bodyTextEncrypted: 'enc:eggs',
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
      createdAt,
      updatedAt: createdAt,
    }
    const storedPassages = [{ id: 'p0', ordinal: 0, startChar: 0, endChar: 4, text: 'eggs' }]
    loadStoredPassagesMock.mockResolvedValue(storedPassages)
    const updatedRow = { ...existing, bodyTextEncrypted: 'enc:eggs\nmilk' }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [existing]) })) })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => [updatedRow]) })) })),
      })),
    }
    getDbMock.mockReturnValue(db)

    await appendTextFile('u1', 'f1', { text: 'milk' })
    expect(loadStoredPassagesMock).toHaveBeenLastCalledWith('u1', 'f1')
    expect(preparePassageSyncMock).toHaveBeenLastCalledWith('u1', {
      body: 'eggs\nmilk',
      stored: storedPassages,
    })
    expect(applyPassageSyncMock).toHaveBeenCalledTimes(1)

    await updateTextFile('u1', 'f1', { body: 'eggs, milk, bread' })
    expect(preparePassageSyncMock).toHaveBeenLastCalledWith('u1', {
      body: 'eggs, milk, bread',
      stored: storedPassages,
    })
    expect(applyPassageSyncMock).toHaveBeenCalledTimes(2)
  })

  it('searchTextFiles embeds the query once and searches with the embedding-backed sources', async () => {
    const sources = {
      passageCandidates: vi.fn(async () => [
        { passageId: 'p1', textFileId: 'f1', ordinal: 0, vectorDistance: 0.3 },
      ]),
      noteLexical: vi.fn(async () => []),
      loadNotes: vi.fn(async () => [
        {
          id: 'f1',
          title: 'Trip',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-02T00:00:00.000Z'),
          author: 'user' as const,
          authorLabel: null,
          authorKeyId: null,
        },
      ]),
      loadPassages: vi.fn(async () => [
        { textFileId: 'f1', ordinal: 0, startChar: 0, endChar: 22, text: 'early morning surfing' },
      ]),
    }
    createDbNoteSearchSourcesMock.mockReturnValue(sources)

    const hits = await searchTextFiles('u1', {
      query: 'fun activities on a coastal trip',
      authorFilter: 'user',
    })

    expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(1)
    expect(createDbNoteSearchSourcesMock).toHaveBeenCalledWith('u1', {
      query: 'fun activities on a coastal trip',
      queryEmbedding: [0.1, 0.2],
      authorFilter: 'user',
      authorLayerKey: undefined,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: 'f1', title: 'Trip', excerpt: 'early morning surfing' })
  })

  it('searchTextFiles reuses a caller-supplied query embedding (no second embedding call)', async () => {
    createDbNoteSearchSourcesMock.mockReturnValue({
      passageCandidates: async () => [],
      noteLexical: async () => [],
      loadNotes: async () => [],
      loadPassages: async () => [],
    })
    await searchTextFiles('u1', { query: 'anything', queryEmbedding: [9, 9] })
    expect(createThoughtEmbeddingMock).not.toHaveBeenCalled()
    expect(createDbNoteSearchSourcesMock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ queryEmbedding: [9, 9] }),
    )
  })
})
