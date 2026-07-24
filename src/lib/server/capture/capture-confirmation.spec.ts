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
} = vi.hoisted(() => ({
  queueCaptureMock: vi.fn(),
  scheduleCaptureEnrichWorkerMock: vi.fn(),
  interpretThoughtPreviewMock: vi.fn(),
  getDbMock: vi.fn(),
  encryptMock: vi.fn(),
  decryptMock: vi.fn(),
  selectMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('$lib/server/capture/queue-capture', () => ({
  queueCapture: queueCaptureMock,
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
  confirmCapturePreview,
  correctCapturePreview,
  interpretAndQueueCapture,
  type CapturePreviewBundle,
} from './capture-confirmation'

const PREVIEW: CapturePreviewBundle = {
  interpretedText: 'Plan a team offsite in Lisbon next quarter.',
  category: { key: 'task', confidence: 0.91, alternatives: [] },
  memoryType: 'episode',
  entities: [{ surface: 'Lisbon', entityType: 'person', confidence: 0.4 }],
}

function chainSelect(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  selectMock.mockReturnValue({ from })
}

function chainUpdate() {
  const where = vi.fn(async () => undefined)
  const set = vi.fn(() => ({ where }))
  updateMock.mockReturnValue({ set })
  return { set, where }
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

  it('interprets first, then queues draft with awaiting_confirmation and does not schedule enrich', async () => {
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
    // Interpret must complete before persist so LLM failures leave no orphan draft.
    expect(interpretThoughtPreviewMock.mock.invocationCallOrder[0]).toBeLessThan(
      queueCaptureMock.mock.invocationCallOrder[0],
    )
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
    expect(result.thoughtId).toBe('thought-1')
    expect(result.rawText).toBe('planning a team offsite in Lisbon next quarter')
    expect(result.preview).toEqual(PREVIEW)
    expect(result.queueStatus).toBe('awaiting_confirmation')
  })

  it('does not queue a draft when interpret fails', async () => {
    interpretThoughtPreviewMock.mockRejectedValueOnce(new Error('LLM HTTP 400: provider rejected'))
    await expect(
      interpretAndQueueCapture('u1', 'hello', { source: 'ui' }),
    ).rejects.toThrow(/LLM HTTP 400/)
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })
})

describe('correctCapturePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`)
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )
    getDbMock.mockReturnValue({ select: selectMock, update: updateMock })
    chainUpdate()
  })

  it('re-runs interpret with prior preview + correction and stays awaiting_confirmation', async () => {
    const corrected: CapturePreviewBundle = {
      ...PREVIEW,
      interpretedText: 'Plan a team offsite in Porto next quarter.',
      entities: [{ surface: 'Porto', entityType: 'person', confidence: 0.5 }],
    }
    interpretThoughtPreviewMock.mockResolvedValue(corrected)

    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: 'planning a team offsite in Lisbon next quarter',
        rawTextEncrypted: null,
        enrichQueueStatus: 'awaiting_confirmation',
        metadata: { preview: PREVIEW },
        metadataEncrypted: null,
      },
    ])

    const result = await correctCapturePreview('u1', 'thought-1', 'Change the city to Porto')

    expect(interpretThoughtPreviewMock).toHaveBeenCalledWith({
      userId: 'u1',
      rawText: 'planning a team offsite in Lisbon next quarter',
      priorPreview: PREVIEW,
      correction: 'Change the city to Porto',
    })
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
    expect(result.preview.interpretedText).toContain('Porto')
    expect(result.queueStatus).toBe('awaiting_confirmation')
  })

  it('rejects correct when thought is not awaiting confirmation', async () => {
    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: 'hello',
        rawTextEncrypted: null,
        enrichQueueStatus: 'pending',
        metadata: {},
        metadataEncrypted: null,
      },
    ])

    await expect(correctCapturePreview('u1', 'thought-1', 'fix it')).rejects.toThrow(
      /awaiting_confirmation|not awaiting/i,
    )
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

  it('writes interpreted text to normalized_text, keeps raw_text, and schedules enrich', async () => {
    const raw = 'planning a team offsite in Lisbon next quarter'
    const { set } = chainUpdate()
    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: raw,
        rawTextEncrypted: null,
        normalizedText: raw,
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

  it('rejects confirm when thought is not awaiting confirmation', async () => {
    chainUpdate()
    chainSelect([
      {
        id: 'thought-1',
        userId: 'u1',
        rawText: 'hello',
        rawTextEncrypted: null,
        normalizedText: 'hello',
        enrichQueueStatus: 'complete',
        metadata: {},
        metadataEncrypted: null,
      },
    ])

    await expect(confirmCapturePreview('u1', 'thought-1')).rejects.toThrow(
      /awaiting_confirmation|not awaiting/i,
    )
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
  })
})
