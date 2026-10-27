import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  retrieveMock: vi.fn(),
  resolveTargetsMock: vi.fn(),
  judgeMock: vi.fn(),
  archiveMock: vi.fn(),
  editMock: vi.fn(),
  loadResultMock: vi.fn(),
  logActivityCallMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: () => ({ tag: 'db' }) }))
vi.mock('$lib/server/retrieval/retrieve-for-delete', () => ({
  retrieveThoughtRowsForDeleteRequest: m.retrieveMock,
}))
vi.mock('$lib/server/retrieval/resolve-delete-target', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$lib/server/retrieval/resolve-delete-target')>()
  return { ...actual, resolveDeleteTargets: m.resolveTargetsMock }
})
vi.mock('$lib/server/capture/judge-forget-target', () => ({ judgeForgetTarget: m.judgeMock }))
vi.mock('$lib/server/memory/lifecycle', () => ({ archiveThoughtForUser: m.archiveMock }))
vi.mock('$lib/server/capture/service', () => ({ editStoredThought: m.editMock }))
vi.mock('$lib/server/capture/capture-result', () => ({
  loadThoughtCaptureResult: m.loadResultMock,
}))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: m.logActivityCallMock }))

import { DeleteGateAmbiguousError } from '$lib/server/retrieval/resolve-delete-target'
import { applyForgetRequest } from './apply-forget-request'

const CAPTURE_AT = new Date('2026-06-02T10:00:00.000Z')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const CAPTURE = '99999999-9999-4999-8999-999999999999'

function hit(id: string, text: string) {
  return {
    id,
    normalizedText: text,
    category: 'observation',
    score: 0.9,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  }
}

function loaded(id: string, text: string, lifecycleStatus: 'open' | 'archived' = 'open') {
  return { id, normalizedText: text, lifecycleStatus }
}

function run() {
  return applyForgetRequest({
    userId: 'u1',
    captureThoughtId: CAPTURE,
    captureCreatedAt: CAPTURE_AT,
    request: 'Please forget that I like surfing',
  })
}

function auditContexts(): string[] {
  return m.logActivityCallMock.mock.calls.map((c) => (c[2] as { context: string }).context)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.logActivityCallMock.mockResolvedValue(undefined)
  m.archiveMock.mockResolvedValue({ ok: true })
  m.resolveTargetsMock.mockResolvedValue([])
})

describe('applyForgetRequest', () => {
  it('finds targets with the delete matcher, restricted to thoughts captured BEFORE the forget capture', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['surfing'], results: [] })
    await run()
    expect(m.retrieveMock).toHaveBeenCalledWith({
      userId: 'u1',
      deleteRequest: 'Please forget that I like surfing',
      createdBefore: CAPTURE_AT,
    })
  })

  it('archives a target the judge says is only about the forgotten thing (existing lifecycle service)', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['surfing'], results: [hit(A, 'I love surfing')] })
    m.resolveTargetsMock.mockResolvedValue([
      { thoughtId: A, snippet: 'I love surfing', scoreNormalized: 0.9 },
    ])
    m.loadResultMock.mockResolvedValue(loaded(A, 'I love surfing'))
    m.judgeMock.mockResolvedValue({ action: 'archive' })

    const outcome = await run()

    expect(m.archiveMock.mock.calls).toEqual([
      ['u1', A],
      ['u1', CAPTURE],
    ])
    expect(m.editMock).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'applied', archived: [A], edited: [] })
  })

  it('edit_out: removes only the detail through the natural-language edit service', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['surfing'], results: [hit(A, 'x')] })
    m.resolveTargetsMock.mockResolvedValue([{ thoughtId: A, snippet: 'x', scoreNormalized: 0.9 }])
    m.loadResultMock.mockResolvedValue(loaded(A, 'I like surfing and I work as a nurse'))
    m.judgeMock.mockResolvedValue({ action: 'edit_out', detail: 'that I like surfing' })
    m.editMock.mockResolvedValue({
      ok: true,
      thought: { id: A, normalizedText: 'I work as a nurse' },
      editSummary: 'removed surfing',
    })

    const outcome = await run()

    expect(m.archiveMock.mock.calls).toEqual([['u1', CAPTURE]])
    expect(m.editMock).toHaveBeenCalledTimes(1)
    const [userId, thoughtId, editRequest] = m.editMock.mock.calls[0]
    expect([userId, thoughtId]).toEqual(['u1', A])
    expect(editRequest).toContain('that I like surfing')
    expect(editRequest).toMatch(/^Remove only/)
    expect(outcome).toEqual({ status: 'applied', archived: [], edited: [A] })
  })

  it('judges every target separately: one archived, one edited out', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['q'], results: [] })
    m.resolveTargetsMock.mockResolvedValue([
      { thoughtId: A, snippet: 'a', scoreNormalized: 0.9 },
      { thoughtId: B, snippet: 'b', scoreNormalized: 0.9 },
    ])
    m.loadResultMock.mockImplementation(async (_u: string, id: string) =>
      loaded(id, id === A ? 'only surfing' : 'surfing plus nursing'),
    )
    m.judgeMock.mockImplementation(async ({ targetText }: { targetText: string }) =>
      targetText === 'only surfing'
        ? { action: 'archive' }
        : { action: 'edit_out', detail: 'surfing' },
    )
    m.editMock.mockResolvedValue({
      ok: true,
      thought: { id: B, normalizedText: 'nursing' },
      editSummary: 's',
    })

    const outcome = await run()
    expect(outcome).toEqual({ status: 'applied', archived: [A], edited: [B] })
    expect(m.judgeMock).toHaveBeenCalledTimes(2)
    expect(m.judgeMock.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      forgetRequest: 'Please forget that I like surfing',
      targetText: 'only surfing',
    })
  })

  it('nothing matched: no archive, no edit, and the audit says so', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['q'], results: [] })
    m.resolveTargetsMock.mockResolvedValue([])

    const outcome = await run()

    expect(outcome).toEqual({ status: 'nothing_matched', archived: [], edited: [] })
    // the forget capture itself is still archived
    expect(m.archiveMock.mock.calls).toEqual([['u1', CAPTURE]])
    expect(m.editMock).not.toHaveBeenCalled()
    const summary = auditContexts().at(-1)
    expect(summary).toContain(`capture=${CAPTURE}`)
    expect(summary).toContain('status=nothing_matched')
  })

  it('an ambiguous request (delete gate) forgets nothing and the audit says so', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['q'], results: [] })
    m.resolveTargetsMock.mockRejectedValue(new DeleteGateAmbiguousError(0.55))

    const outcome = await run()

    expect(outcome).toEqual({ status: 'ambiguous', archived: [], edited: [] })
    expect(m.archiveMock.mock.calls).toEqual([['u1', CAPTURE]])
    expect(auditContexts().at(-1)).toContain('status=ambiguous')
  })

  it('any other matcher failure propagates (fail loud, into the retry ladder)', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['q'], results: [] })
    m.resolveTargetsMock.mockRejectedValue(new Error('gateway 502'))
    await expect(run()).rejects.toThrow(/gateway 502/)
    expect(m.archiveMock).not.toHaveBeenCalled()
  })

  it('skips a target that is no longer active (archived since retrieval)', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['q'], results: [] })
    m.resolveTargetsMock.mockResolvedValue([{ thoughtId: A, snippet: 'a', scoreNormalized: 0.9 }])
    m.loadResultMock.mockResolvedValue(loaded(A, 'old', 'archived'))

    const outcome = await run()
    expect(m.judgeMock).not.toHaveBeenCalled()
    expect(m.archiveMock.mock.calls).toEqual([['u1', CAPTURE]])
    expect(outcome).toEqual({ status: 'nothing_matched', archived: [], edited: [] })
  })

  it('edit_out that leaves the text unchanged fails loudly (the detail would still be remembered)', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['q'], results: [] })
    m.resolveTargetsMock.mockResolvedValue([{ thoughtId: A, snippet: 'a', scoreNormalized: 0.9 }])
    m.loadResultMock.mockResolvedValue(loaded(A, 'surfing and nursing'))
    m.judgeMock.mockResolvedValue({ action: 'edit_out', detail: 'surfing' })
    m.editMock.mockResolvedValue({
      ok: true,
      thought: { id: A, normalizedText: 'surfing and nursing' },
      editSummary: 'nothing',
    })
    await expect(run()).rejects.toThrow(/unchanged/)
    // not finished: the forget capture stays un-archived so the retry ladder redoes it
    expect(m.archiveMock).not.toHaveBeenCalledWith('u1', CAPTURE)
  })

  it('writes one audit row per action plus a summary: ids and counts only, never thought text', async () => {
    m.retrieveMock.mockResolvedValue({ queries: ['q'], results: [] })
    m.resolveTargetsMock.mockResolvedValue([
      { thoughtId: A, snippet: 'my password hint is HUNTER2', scoreNormalized: 0.9 },
      { thoughtId: B, snippet: 'b', scoreNormalized: 0.9 },
    ])
    m.loadResultMock.mockImplementation(async (_u: string, id: string) =>
      loaded(id, id === A ? 'my password hint is HUNTER2' : 'HUNTER2 and nursing'),
    )
    m.judgeMock.mockImplementation(async ({ targetText }: { targetText: string }) =>
      targetText.startsWith('my password')
        ? { action: 'archive' }
        : { action: 'edit_out', detail: 'HUNTER2' },
    )
    m.editMock.mockResolvedValue({
      ok: true,
      thought: { id: B, normalizedText: 'nursing' },
      editSummary: 's',
    })

    await run()

    expect(auditContexts()).toEqual([
      `forget capture=${CAPTURE} archived=${A}`,
      `forget capture=${CAPTURE} edited=${B}`,
      `forget capture=${CAPTURE} status=applied archived=1 edited=1`,
    ])
    for (const call of m.logActivityCallMock.mock.calls) {
      expect(call[1]).toBe('u1')
      expect(call[2]).toMatchObject({
        provider: 'memory',
        operation: 'forget_request',
        baseCostUsd: 0,
      })
      expect(JSON.stringify(call[2])).not.toContain('HUNTER2')
    }
  })
})
