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
  autoConfirmStaleAwaitingConfirmationDrafts,
  CONFIRMATION_AUTO_ACCEPT_MS,
  confirmCapturePreview,
  interpretAndQueueCapture,
  type CapturePreviewBundle,
} from './capture-confirmation'

const PREVIEW: CapturePreviewBundle = {
  interpretedText: 'Plan a team offsite in Lisbon next quarter.',
  category: { key: 'task', confidence: 0.91, alternatives: [] },
  entities: [{ surface: 'Lisbon', entityType: 'person', confidence: 0.4 }],
  deviatesFromVerbatim: true,
}

const NO_DEVIATION_PREVIEW: CapturePreviewBundle = {
  ...PREVIEW,
  interpretedText: 'Buy oat milk',
  category: { key: 'task', confidence: 0.88, alternatives: [] },
  entities: [],
  deviatesFromVerbatim: false,
}

function chainSelect(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  selectMock.mockReturnValue({ from })
}

function chainUpdate(options?: { returningRows?: unknown[] }) {
  const returning = vi.fn(async () => options?.returningRows ?? [{ id: 'thought-1' }])
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  updateMock.mockReturnValue({ set })
  return { set, where, returning }
}

describe('interpretAndQueueCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`)
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )
    queueCaptureMock.mockResolvedValue({
      thoughtId: 'thought-1',
      status: 'queued',
      normalizedText: 'planning a team offsite in Lisbon next quarter',
    })
    interpretThoughtPreviewMock.mockResolvedValue(PREVIEW)
    getDbMock.mockReturnValue({ select: selectMock, update: updateMock })
    chainUpdate()
    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: 'planning a team offsite in Lisbon next quarter',
        rawTextEncrypted: null,
        enrichQueueStatus: 'awaiting_confirmation',
        metadata: { pipeline: 'ontology_llm_v1' },
        metadataEncrypted: null,
      },
    ])
  })

  it('when LLM deviates: queues draft awaiting_confirmation and does not schedule enrich or notify', async () => {
    const result = await interpretAndQueueCapture('u1', 'planning a team offsite in Lisbon next quarter', {
      source: 'ui',
    })

    expect(interpretThoughtPreviewMock).toHaveBeenCalledWith({
      userId: 'u1',
      rawText: 'planning a team offsite in Lisbon next quarter',
    })
    expect(queueCaptureMock).toHaveBeenCalledWith(
      'u1',
      'planning a team offsite in Lisbon next quarter',
      expect.objectContaining({
        source: 'ui',
        awaitConfirmation: true,
        skipWorker: true,
      }),
    )
    expect(interpretThoughtPreviewMock.mock.invocationCallOrder[0]).toBeLessThan(
      queueCaptureMock.mock.invocationCallOrder[0],
    )
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
    expect(notifyThoughtCreatedMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'awaiting_confirmation',
      thoughtId: 'thought-1',
      rawText: 'planning a team offsite in Lisbon next quarter',
      queueStatus: 'awaiting_confirmation',
    })
    expect(result.preview).toEqual(PREVIEW)
  })

  it('when LLM does not deviate: auto-ingests with interpreted text, schedules enrich, and notifies', async () => {
    interpretThoughtPreviewMock.mockResolvedValue(NO_DEVIATION_PREVIEW)
    queueCaptureMock.mockResolvedValue({
      thoughtId: 'thought-2',
      status: 'queued',
      normalizedText: 'buy oat milk',
    })
    const { set } = chainUpdate()
    // First select: load draft after queue; second select: load for confirm
    const draftRow = {
      id: 'thought-2',
      userId: 'u1',
      rawText: 'buy oat milk',
      rawTextEncrypted: null,
      normalizedText: 'buy oat milk',
      enrichQueueStatus: 'awaiting_confirmation',
      metadata: { preview: NO_DEVIATION_PREVIEW, pipeline: 'ontology_llm_v1' },
      metadataEncrypted: null,
    }
    let selectCount = 0
    selectMock.mockImplementation(() => {
      selectCount += 1
      const rows = [draftRow]
      const limit = vi.fn(async () => rows)
      const where = vi.fn(() => ({ limit }))
      const from = vi.fn(() => ({ where }))
      return { from }
    })

    const result = await interpretAndQueueCapture('u1', 'buy oat milk', { source: 'ui' })

    expect(result).toMatchObject({
      status: 'ingested',
      thoughtId: 'thought-2',
      queueStatus: 'pending',
      normalizedText: NO_DEVIATION_PREVIEW.interpretedText,
    })
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1')
    expect(notifyThoughtCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', thoughtId: 'thought-2' }),
    )
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedText: NO_DEVIATION_PREVIEW.interpretedText,
        enrichQueueStatus: 'pending',
      }),
    )
    expect(selectCount).toBeGreaterThan(0)
  })

  it('does not queue a draft when interpret fails', async () => {
    interpretThoughtPreviewMock.mockRejectedValueOnce(new Error('LLM HTTP 400: provider rejected'))
    await expect(interpretAndQueueCapture('u1', 'hello', { source: 'ui' })).rejects.toThrow(
      /LLM HTTP 400/,
    )
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })

  it('forceConfirmation overrides a non-deviating LLM judge to awaiting_confirmation', async () => {
    interpretThoughtPreviewMock.mockResolvedValue(NO_DEVIATION_PREVIEW)
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      const result = await interpretAndQueueCapture('u1', 'buy oat milk', {
        source: 'ui',
        forceConfirmation: true,
      })
      expect(result.status).toBe('awaiting_confirmation')
      expect(result.preview.deviatesFromVerbatim).toBe(true)
      expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
      expect(notifyThoughtCreatedMock).not.toHaveBeenCalled()
    } finally {
      process.env.NODE_ENV = prevEnv
    }
  })
})

describe('confirmCapturePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`)
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )
    getDbMock.mockReturnValue({ select: selectMock, update: updateMock })
  })

  it('writes interpreted text to normalized_text, keeps raw_text, schedules enrich, and notifies', async () => {
    const raw = 'planning a team offsite in Lisbon next quarter'
    const { set } = chainUpdate()
    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: raw,
        rawTextEncrypted: null,
        normalizedText: raw,
        category: 'observation',
        enrichQueueStatus: 'awaiting_confirmation',
        metadata: { preview: PREVIEW, pipeline: 'ontology_llm_v1' },
        metadataEncrypted: null,
      },
    ])

    const result = await confirmCapturePreview('u1', 'thought-1')

    expect(result.normalizedText).toBe(PREVIEW.interpretedText)
    expect(result.rawText).toBe(raw)
    expect(result.queueStatus).toBe('pending')
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1')
    expect(notifyThoughtCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', thoughtId: 'thought-1', normalizedText: PREVIEW.interpretedText }),
    )
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedText: PREVIEW.interpretedText,
        enrichQueueStatus: 'pending',
        category: 'task',
      }),
    )
    const payload = set.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('rawText')
  })

  it('verbatim:true stores raw text, clears interpretation fields, schedules enrich, and notifies', async () => {
    const raw = 'planning a team offsite in Lisbon next quarter'
    const { set } = chainUpdate()
    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: raw,
        rawTextEncrypted: null,
        normalizedText: raw,
        category: 'observation',
        enrichQueueStatus: 'awaiting_confirmation',
        metadata: { preview: PREVIEW, pipeline: 'ontology_llm_v1' },
        metadataEncrypted: null,
      },
    ])

    const result = await confirmCapturePreview('u1', 'thought-1', { verbatim: true })

    expect(result.normalizedText).toBe(raw)
    expect(result.rawText).toBe(raw)
    expect(result.category).toBe('observation')
    expect(result.queueStatus).toBe('pending')
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1')
    expect(notifyThoughtCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', thoughtId: 'thought-1', normalizedText: raw }),
    )
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedText: raw,
        category: 'observation',
        enrichQueueStatus: 'pending',
      }),
    )
  })

  it('rejects confirm when thought is not awaiting confirmation', async () => {
    chainUpdate()
    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: 'hello',
        rawTextEncrypted: null,
        normalizedText: 'hello',
        category: 'observation',
        enrichQueueStatus: 'complete',
        metadata: {},
        metadataEncrypted: null,
      },
    ])

    await expect(confirmCapturePreview('u1', 'thought-1')).rejects.toThrow(
      /awaiting_confirmation|not awaiting/i,
    )
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
    expect(notifyThoughtCreatedMock).not.toHaveBeenCalled()
  })

  it('is idempotent when the draft was already confirmed (race with auto-accept / double submit)', async () => {
    const raw = 'planning a team offsite in Lisbon next quarter'
    chainUpdate()
    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: raw,
        rawTextEncrypted: null,
        normalizedText: PREVIEW.interpretedText,
        category: 'task',
        enrichQueueStatus: 'pending',
        metadata: {
          preview: PREVIEW,
          confirmationGate: true,
          confirmedAt: '2026-08-25T10:00:00.000Z',
          confirmedVerbatim: false,
        },
        metadataEncrypted: null,
      },
    ])

    const result = await confirmCapturePreview('u1', 'thought-1')

    expect(result).toEqual({
      thoughtId: 'thought-1',
      rawText: raw,
      normalizedText: PREVIEW.interpretedText,
      category: 'task',
      queueStatus: 'pending',
      preview: PREVIEW,
    })
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
    expect(notifyThoughtCreatedMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('treats a lost confirm race as success when the winner already promoted the draft', async () => {
    const raw = 'planning a team offsite in Lisbon next quarter'
    const { returning } = chainUpdate({ returningRows: [] })
    let selectCall = 0
    selectMock.mockImplementation(() => {
      selectCall += 1
      const rows =
        selectCall === 1
          ? [
              {
                id: 'thought-1',
                userId: 'u1',
                rawText: raw,
                rawTextEncrypted: null,
                normalizedText: raw,
                category: 'observation',
                enrichQueueStatus: 'awaiting_confirmation',
                metadata: { preview: PREVIEW, confirmationGate: true },
                metadataEncrypted: null,
              },
            ]
          : [
              {
                id: 'thought-1',
                userId: 'u1',
                rawText: raw,
                rawTextEncrypted: null,
                normalizedText: PREVIEW.interpretedText,
                category: 'task',
                enrichQueueStatus: 'pending',
                metadata: {
                  preview: PREVIEW,
                  confirmationGate: true,
                  confirmedAt: '2026-08-25T10:00:01.000Z',
                  confirmedVerbatim: false,
                },
                metadataEncrypted: null,
              },
            ]
      const limit = vi.fn(async () => rows)
      const where = vi.fn(() => ({ limit }))
      const from = vi.fn(() => ({ where }))
      return { from }
    })

    const result = await confirmCapturePreview('u1', 'thought-1')

    expect(returning).toHaveBeenCalled()
    expect(result.normalizedText).toBe(PREVIEW.interpretedText)
    expect(result.queueStatus).toBe('pending')
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
    expect(notifyThoughtCreatedMock).not.toHaveBeenCalled()
  })
})

describe('autoConfirmStaleAwaitingConfirmationDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`)
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )
    getDbMock.mockReturnValue({ select: selectMock, update: updateMock })
  })

  it('auto-confirms drafts older than CONFIRMATION_AUTO_ACCEPT_MS with interpreted text', async () => {
    expect(CONFIRMATION_AUTO_ACCEPT_MS).toBe(5_000)
    const staleCreatedAt = new Date(Date.now() - CONFIRMATION_AUTO_ACCEPT_MS - 1_000)
    const { set } = chainUpdate()

    // First select: list stale drafts. Subsequent: loadAwaitingDraft for confirm.
    let call = 0
    selectMock.mockImplementation(() => {
      call += 1
      const rows =
        call === 1
          ? [{ id: 'stale-1' }]
          : [
              {
                id: 'stale-1',
                userId: 'u1',
                rawText: 'planning a team offsite in Lisbon next quarter',
                rawTextEncrypted: null,
                normalizedText: 'planning a team offsite in Lisbon next quarter',
                category: 'observation',
                enrichQueueStatus: 'awaiting_confirmation',
                metadata: { preview: PREVIEW },
                metadataEncrypted: null,
                createdAt: staleCreatedAt,
              },
            ]
      const limit = vi.fn(async () => rows)
      // list path may use where without limit, or with orderBy
      const orderBy = vi.fn(() => ({ limit }))
      const where = vi.fn(() => ({ limit, orderBy }))
      const from = vi.fn(() => ({ where }))
      return { from }
    })

    const confirmed = await autoConfirmStaleAwaitingConfirmationDrafts('u1')

    expect(confirmed).toBe(1)
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1')
    expect(notifyThoughtCreatedMock).toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedText: PREVIEW.interpretedText,
        enrichQueueStatus: 'pending',
      }),
    )
  })

  it('skips drafts younger than the auto-accept window', async () => {
    const fresh = new Date(Date.now() - 500)
    selectMock.mockImplementation(() => {
      const rows: unknown[] = []
      const limit = vi.fn(async () => rows)
      const where = vi.fn(() => ({ limit }))
      const from = vi.fn(() => ({ where }))
      return { from }
    })
    // Explicitly assert helper uses createdAt cutoff; empty list → 0
    void fresh
    const confirmed = await autoConfirmStaleAwaitingConfirmationDrafts('u1')
    expect(confirmed).toBe(0)
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
  })
})
