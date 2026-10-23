import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAskSuggestions } from './ask-suggestions'

const { getDbMock, readAskQuestionMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  readAskQuestionMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/capture/ask-question-store', () => ({ readAskQuestion: readAskQuestionMock }))

function makeDb(rows: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  }
  return chain
}

describe('loadAskSuggestions (Ask page load)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readAskQuestionMock.mockImplementation(
      async (_userId: string, row: { askQuestionEncrypted: string | null }) =>
        row.askQuestionEncrypted?.replace(/^enc\((.*)\)$/, '$1') ?? null,
    )
  })

  it('decrypts stored questions and returns at most three, deduped', async () => {
    const db = makeDb([
      { id: 't4', askQuestion: 'q4', askQuestionEncrypted: 'enc(Where is the offsite?)' },
      { id: 't3', askQuestion: 'q3', askQuestionEncrypted: 'enc(Where is the offsite?)' },
      { id: 't2', askQuestion: 'q2', askQuestionEncrypted: 'enc(Who recommended the book?)' },
      { id: 't1', askQuestion: 'q1', askQuestionEncrypted: 'enc(When is the dentist?)' },
      { id: 't0', askQuestion: 'q0', askQuestionEncrypted: 'enc(What about the plumber?)' },
    ])
    getDbMock.mockReturnValue(db)

    const out = await loadAskSuggestions('u1')

    expect(out).toEqual([
      { thoughtId: 't4', question: 'Where is the offsite?' },
      { thoughtId: 't2', question: 'Who recommended the book?' },
      { thoughtId: 't1', question: 'When is the dentist?' },
    ])
  })

  it('never selects the embedding column', async () => {
    const db = makeDb([])
    getDbMock.mockReturnValue(db)
    await loadAskSuggestions('u1')
    const projection = (db.select.mock.calls[0] as unknown[] | undefined)?.[0] as Record<string, unknown>
    expect(Object.keys(projection).sort()).toEqual(['askQuestion', 'askQuestionEncrypted', 'id'])
  })

  it('returns [] when no thought has a question (AC-6)', async () => {
    getDbMock.mockReturnValue(makeDb([]))
    expect(await loadAskSuggestions('u1')).toEqual([])
  })
})
