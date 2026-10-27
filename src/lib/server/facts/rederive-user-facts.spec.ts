import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  rows: [] as unknown[][],
  deriveMock: vi.fn(),
  releaseMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => m.rows.shift() ?? [] }),
      }),
    }),
  }),
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.replace(/^enc:/, ''),
  ),
}))
vi.mock('./derive-user-facts', () => ({ deriveUserFactsForThought: m.deriveMock }))
vi.mock('./user-fact-lifecycle', () => ({ releaseThoughtFacts: m.releaseMock }))

import { FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import { rederiveUserFactsForThought } from './rederive-user-facts'

const CREATED = new Date('2026-06-01T08:00:00.000Z')

function thoughtRow(over: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
  return {
    normalizedText: 'enc:I swim at the local pool',
    normalizedTextEncrypted: 'enc:I swim at the local pool',
    metadata: { encrypted: true },
    metadataEncrypted: `enc:${JSON.stringify(metadata)}`,
    lifecycleStatus: 'open',
    createdAt: CREATED,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.rows = []
  m.deriveMock.mockResolvedValue({ added: 1, superseded: 0, confirmed: 0, droppedLowConfidence: 0 })
  m.releaseMock.mockResolvedValue(undefined)
})

describe('rederiveUserFactsForThought (after an edit changed the thought)', () => {
  it('derives again from the edited text, as of the original capture time', async () => {
    m.rows = [[thoughtRow()]]
    const out = await rederiveUserFactsForThought('u1', 't1')
    expect(out).toMatchObject({ added: 1 })
    expect(m.deriveMock).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: 't1',
      text: 'I swim at the local pool',
      attachedFileId: null,
      capturedAt: CREATED,
    })
  })

  it('hands over redacted text only', async () => {
    const raw = `deploy token ${FAKE_SECRETS.githubClassic}, I swim daily`
    m.rows = [[thoughtRow({ normalizedTextEncrypted: `enc:${raw}` })]]
    await rederiveUserFactsForThought('u1', 't1')
    expect(leaks(JSON.stringify(m.deriveMock.mock.calls))).toBe(false)
  })

  it('a capture that split off a reference note keeps reading that note', async () => {
    m.rows = [
      [
        thoughtRow(
          {},
          {
            captureContentSplit: {
              role: 'reference',
              rationale: 'r',
              spans: [],
              spanThoughtIds: [],
              note: null,
              attachedFileId: 'file-1',
            },
          },
        ),
      ],
    ]
    await rederiveUserFactsForThought('u1', 't1')
    expect(m.deriveMock).toHaveBeenCalledWith(expect.objectContaining({ attachedFileId: 'file-1' }))
  })

  it('a span child is its span: no note of its own', async () => {
    m.rows = [[thoughtRow({}, { splitFrom: 'parent-1' })]]
    await rederiveUserFactsForThought('u1', 't1')
    expect(m.deriveMock).toHaveBeenCalledWith(expect.objectContaining({ attachedFileId: null }))
  })

  it('a kept forget instruction is not a fact source: its facts are released, none derived', async () => {
    m.rows = [
      [
        thoughtRow(
          {},
          {
            captureIntent: 'forget',
            forgetInstruction: { status: 'nothing_found', unresolved: [] },
          },
        ),
      ],
    ]
    const out = await rederiveUserFactsForThought('u1', 't1')
    expect(m.releaseMock).toHaveBeenCalledWith('u1', 't1')
    expect(m.deriveMock).not.toHaveBeenCalled()
    expect(out).toEqual({ added: 0, superseded: 0, confirmed: 0, droppedLowConfidence: 0 })
  })

  it('an archived thought is not a fact source either', async () => {
    m.rows = [[thoughtRow({ lifecycleStatus: 'archived' })]]
    await rederiveUserFactsForThought('u1', 't1')
    expect(m.releaseMock).toHaveBeenCalledWith('u1', 't1')
    expect(m.deriveMock).not.toHaveBeenCalled()
  })

  it('fails loud when the thought is gone', async () => {
    m.rows = [[]]
    await expect(rederiveUserFactsForThought('u1', 't1')).rejects.toThrow(/t1/)
  })

  it('a derive failure propagates (the edit fails loudly, no half-updated facts hidden)', async () => {
    m.rows = [[thoughtRow()]]
    m.deriveMock.mockRejectedValue(new Error('user fact extraction: response is not valid JSON'))
    await expect(rederiveUserFactsForThought('u1', 't1')).rejects.toThrow(/user fact extraction/)
  })
})
