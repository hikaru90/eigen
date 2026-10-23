import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  queueCaptureMock,
  scheduleCaptureEnrichWorkerMock,
  interpretThoughtPreviewMock,
  getDbMock,
  encryptMock,
  decryptMock,
  selectMock,
  updateMock,
  notifyThoughtCreatedMock,
} = vi.hoisted(() => ({
  queueCaptureMock: vi.fn(),
  scheduleCaptureEnrichWorkerMock: vi.fn(),
  interpretThoughtPreviewMock: vi.fn(),
  getDbMock: vi.fn(),
  encryptMock: vi.fn(),
  decryptMock: vi.fn(),
  selectMock: vi.fn(),
  updateMock: vi.fn(),
  notifyThoughtCreatedMock: vi.fn(),
}))

vi.mock('$lib/server/capture/queue-capture', () => ({
  queueCapture: queueCaptureMock,
  QUEUE_PLACEHOLDER_CATEGORY: 'observation',
}))
vi.mock('$lib/server/capture/capture-enrich-worker', () => ({
  scheduleCaptureEnrichWorker: scheduleCaptureEnrichWorkerMock,
}))
vi.mock('$lib/server/capture/interpret-thought', () => ({
  interpretThoughtPreview: interpretThoughtPreviewMock,
}))
vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptMock,
  decryptTenantValue: decryptMock,
}))
vi.mock('$lib/server/agents/notify', () => ({
  notifyThoughtCreated: notifyThoughtCreatedMock,
}))
vi.mock('$lib/server/ontology-db', () => ({
  ensureUserOntologySeeded: vi.fn(async () => undefined),
  loadOntologyForUser: vi.fn(async () => ({
    entityKindsByKey: new Map([
      ['task', { id: 'kind-task' }],
      ['observation', { id: 'kind-obs' }],
    ]),
  })),
}))

import {
  keepCaptureWithReading,
  parseAcceptedReading,
  type AcceptedReading,
} from './capture-confirmation'

const RAW = '  call the studio about the frame order  '
const READING: AcceptedReading = {
  interpretedText: 'Call the studio about the frame order.',
  category: {
    key: 'task',
    confidence: 0.91,
    alternatives: [{ key: 'observation', confidence: 0.05 }],
  },
  entities: [{ surface: 'the studio', entityType: 'organization', confidence: 0.6 }],
  deviatesFromVerbatim: true,
}
/** What keep persists: the accepted reading plus the kind id the server resolved itself. */
const STORED_READING = {
  ...READING,
  category: { ...READING.category, ontologyEntityKindId: 'kind-task' },
}

function draftRow(over: Record<string, unknown> = {}) {
  return {
    id: 'thought-1',
    userId: 'u1',
    rawText: RAW,
    rawTextEncrypted: null,
    normalizedText: 'call the studio about the frame order',
    category: 'observation',
    enrichQueueStatus: 'awaiting_confirmation',
    metadata: { pipeline: 'ontology_llm_v1' },
    metadataEncrypted: null,
    ontologyEntityKindId: 'kind-obs',
    captureSource: 'ui',
    ...over,
  }
}

/**
 * The draft as the DB sees it over the flow: first load (after queueCapture) has no
 * preview yet; every load after persistPreviewMetadata carries the accepted reading.
 */
function chainSelectDraftSequence(reading: unknown) {
  let loads = 0
  selectMock.mockImplementation(() => {
    loads += 1
    const rows = [loads === 1 ? draftRow() : draftRow({ metadata: { preview: reading } })]
    const limit = vi.fn(async () => rows)
    const where = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ where }))
    return { from }
  })
}

function chainUpdate() {
  const returning = vi.fn(async () => [{ id: 'thought-1' }])
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  updateMock.mockReturnValue({ set })
  return { set, where, returning }
}

describe('parseAcceptedReading (strict CapturePreviewBundle contract)', () => {
  it('accepts a well-formed reading and normalises nothing but whitespace', () => {
    const parsed = parseAcceptedReading({ ...READING, interpretedText: '  Call the studio.  ' })
    expect(parsed.interpretedText).toBe('Call the studio.')
    expect(parsed.category).toEqual(READING.category)
    expect(parsed.entities).toEqual(READING.entities)
    expect(parsed.deviatesFromVerbatim).toBe(true)
  })

  it.each([
    ['not an object', null],
    ['missing interpretedText', { ...READING, interpretedText: '   ' }],
    ['missing category', { ...READING, category: null }],
    ['empty category key', { ...READING, category: { ...READING.category, key: '' } }],
    ['confidence out of range', { ...READING, category: { ...READING.category, confidence: 1.4 } }],
    ['alternatives not an array', { ...READING, category: { ...READING.category, alternatives: 'x' } }],
    [
      'alternative without key',
      { ...READING, category: { ...READING.category, alternatives: [{ confidence: 0.2 }] } },
    ],
    ['entities not an array', { ...READING, entities: {} }],
    ['entity without surface', { ...READING, entities: [{ entityType: 'person', confidence: 0.3 }] }],
    ['deviatesFromVerbatim not boolean', { ...READING, deviatesFromVerbatim: 'yes' }],
  ])('rejects %s instead of guessing', (_label, input) => {
    expect(() => parseAcceptedReading(input)).toThrow()
  })
})

describe('keepCaptureWithReading (persist the accepted reading exactly once)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(
      async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`,
    )
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )
    queueCaptureMock.mockResolvedValue({
      thoughtId: 'thought-1',
      status: 'queued',
      normalizedText: 'call the studio about the frame order',
    })
    getDbMock.mockReturnValue({ select: selectMock, update: updateMock })
    chainUpdate()
    chainSelectDraftSequence(STORED_READING)
  })

  it('queues the raw words once, persists the accepted reading, confirms, and schedules enrich', async () => {
    const { set } = chainUpdate()
    const result = await keepCaptureWithReading('u1', RAW, READING, { source: 'ui' })

    // nothing is re-interpreted — the reading the user accepted is what gets kept
    expect(interpretThoughtPreviewMock).not.toHaveBeenCalled()

    // exactly one row, raw text exactly as typed (verbatim invariant)
    expect(queueCaptureMock).toHaveBeenCalledTimes(1)
    expect(queueCaptureMock).toHaveBeenCalledWith('u1', RAW, {
      source: 'ui',
      awaitConfirmation: true,
      skipWorker: true,
    })

    // preview metadata persisted with the accepted category, then promoted to pending
    const setCalls = set.mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(setCalls[0]).toMatchObject({
      category: 'task',
      ontologyEntityKindId: 'kind-task',
      enrichQueueStatus: 'awaiting_confirmation',
    })
    expect(setCalls[1]).toMatchObject({
      normalizedText: READING.interpretedText,
      category: 'task',
      ontologyEntityKindId: 'kind-task',
      enrichQueueStatus: 'pending',
    })
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledTimes(1)
    expect(notifyThoughtCreatedMock).toHaveBeenCalledTimes(1)

    expect(result).toMatchObject({
      thoughtId: 'thought-1',
      rawText: RAW,
      normalizedText: READING.interpretedText,
      category: 'task',
      queueStatus: 'pending',
    })
    expect(result.preview).toEqual(STORED_READING)
  })

  it('passes capturedAt through to the queued row', async () => {
    const capturedAt = new Date('2026-10-20T10:00:00.000Z')
    await keepCaptureWithReading('u1', RAW, READING, { source: 'ui', capturedAt })
    expect(queueCaptureMock).toHaveBeenCalledWith(
      'u1',
      RAW,
      expect.objectContaining({ awaitConfirmation: true, skipWorker: true, capturedAt }),
    )
  })

  it('rejects a malformed reading before anything is persisted', async () => {
    await expect(
      keepCaptureWithReading('u1', RAW, { interpretedText: 'x' }, { source: 'ui' }),
    ).rejects.toThrow(/reading\.category/)
    expect(queueCaptureMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('rejects a category key outside the user ontology before anything is persisted', async () => {
    await expect(
      keepCaptureWithReading(
        'u1',
        RAW,
        { ...READING, category: { ...READING.category, key: 'reminder' } },
        { source: 'ui' },
      ),
    ).rejects.toThrow(/Unknown category key "reminder"/)
    expect(queueCaptureMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('rejects empty raw text before anything is persisted', async () => {
    await expect(keepCaptureWithReading('u1', '   ', READING)).rejects.toThrow(/raw/)
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })
})
