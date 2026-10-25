import { beforeEach, describe, expect, it, vi } from 'vitest'
import { envPaste, FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'

const {
  getDbMock,
  scheduleCaptureEnrichWorkerMock,
  assertAffordableMock,
  ensureOntologyMock,
  loadOntologyMock,
  encryptMock,
  upsertThoughtNodeMock,
  notifyThoughtCreatedMock,
  selectMock,
  updateMock,
  insertMock,
  transactionMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  scheduleCaptureEnrichWorkerMock: vi.fn(),
  assertAffordableMock: vi.fn(),
  ensureOntologyMock: vi.fn(),
  loadOntologyMock: vi.fn(),
  encryptMock: vi.fn(),
  upsertThoughtNodeMock: vi.fn(),
  notifyThoughtCreatedMock: vi.fn(),
  selectMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  transactionMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/capture/capture-enrich-worker', () => ({
  scheduleCaptureEnrichWorker: scheduleCaptureEnrichWorkerMock,
}))

vi.mock('$lib/server/billing/usage-gate', () => ({
  assertCapturePipelineAffordable: assertAffordableMock,
}))

vi.mock('$lib/server/ontology-db', () => ({
  ensureUserOntologySeeded: ensureOntologyMock,
  loadOntologyForUser: loadOntologyMock,
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptMock,
}))

vi.mock('$lib/server/graph/age', () => ({
  upsertThoughtNode: upsertThoughtNodeMock,
}))

vi.mock('$lib/server/agents/notify', () => ({
  notifyThoughtCreated: notifyThoughtCreatedMock,
}))

import {
  claimNextPendingThought,
  completeEnrichedQueueRows,
  countPendingEnrichRows,
  markEnrichQueueComplete,
  markEnrichQueueFailed,
  queueCapture,
  recoverStaleEnrichProcessingRows,
  requeueEnrichThought,
  requeueInFlightProcessingRows,
  requeueOrphanedCompleteEnrichRows,
  TIER1_GRAPH_ANCHOR_TIMEOUT_MS,
} from './queue-capture'

describe('queueCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertAffordableMock.mockResolvedValue(undefined)
    ensureOntologyMock.mockResolvedValue(undefined)
    loadOntologyMock.mockResolvedValue({
      entityKindsByKey: new Map([['observation', { id: 'kind-obs' }]]),
    })
    encryptMock.mockImplementation(
      async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`,
    )
    upsertThoughtNodeMock.mockResolvedValue(undefined)
    notifyThoughtCreatedMock.mockReturnValue(undefined)

    const sessionInsert = {
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'session-1' }]),
      })),
    }
    const thoughtInsert = {
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'thought-1' }]),
      })),
    }
    let insertCall = 0
    insertMock.mockImplementation(() => {
      insertCall += 1
      return insertCall === 1 ? sessionInsert : thoughtInsert
    })
    transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ insert: insertMock }),
    )
    getDbMock.mockReturnValue({
      // No root-level `insert`: tier 1 must write through the transaction handle.
      select: selectMock,
      update: updateMock,
      transaction: transactionMock,
    })
  })

  it('persists queued thought, schedules worker, and notifies', async () => {
    const result = await queueCapture('u1', '  hello   world  ', { source: 'web' })
    expect(result).toEqual({
      thoughtId: 'thought-1',
      status: 'queued',
      normalizedText: 'hello world',
    })
    expect(assertAffordableMock).toHaveBeenCalledWith('u1')
    expect(upsertThoughtNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thought-1', userId: 'u1', category: 'observation' }),
    )
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1')
    expect(notifyThoughtCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', thoughtId: 'thought-1', source: 'web' }),
    )
  })

  it('skips worker when skipWorker is set and honors capturedAt', async () => {
    const capturedAt = new Date('2024-01-02T00:00:00.000Z')
    await queueCapture('u1', 'note', { skipWorker: true, capturedAt })
    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
    expect(notifyThoughtCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: capturedAt }),
    )
  })

  it('persists awaiting_confirmation draft without scheduling enrich', async () => {
    const thoughtInsert = {
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'thought-1' }]),
      })),
    }
    // Reset insert sequence for this test (session then thought)
    let insertCall = 0
    const sessionInsert = {
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'session-1' }]),
      })),
    }
    insertMock.mockImplementation(() => {
      insertCall += 1
      return insertCall === 1 ? sessionInsert : thoughtInsert
    })

    await queueCapture('u1', 'confirm me', { awaitConfirmation: true, source: 'ui' })

    expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled()
    expect(notifyThoughtCreatedMock).not.toHaveBeenCalled()
    const thoughtValues = thoughtInsert.values.mock.calls[0]?.[0] as {
      enrichQueueStatus?: string
      metadata?: Record<string, unknown>
    }
    expect(thoughtValues.enrichQueueStatus).toBe('awaiting_confirmation')
    expect(thoughtValues.metadata?.confirmationGate).toBe(true)
  })

  it('inserts session and thought atomically inside one transaction', async () => {
    await queueCapture('u1', 'atomic check')
    expect(transactionMock).toHaveBeenCalledTimes(1)
    // Both inserts ran on the transaction handle (insertMock is only exposed via tx).
    expect(insertMock).toHaveBeenCalledTimes(2)
  })

  it('still queues and schedules enrich when the tier-1 graph anchor upsert fails', async () => {
    upsertThoughtNodeMock.mockRejectedValueOnce(new Error('age down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await queueCapture('u1', 'graph down')

    expect(result).toEqual({
      thoughtId: 'thought-1',
      status: 'queued',
      normalizedText: 'graph down',
    })
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1')
    expect(notifyThoughtCreatedMock).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[queue-capture] tier-1 graph anchor upsert failed'),
      expect.objectContaining({ userId: 'u1', thoughtId: 'thought-1' }),
    )
    errorSpy.mockRestore()
  })

  it('still returns when the tier-1 graph anchor hangs (does not strand interpret)', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // AGE lock-wait / hung query: never settles. try/catch alone cannot recover.
    upsertThoughtNodeMock.mockReturnValueOnce(new Promise(() => {}))

    try {
      const resultPromise = queueCapture('u1', 'graph hang')
      await vi.advanceTimersByTimeAsync(TIER1_GRAPH_ANCHOR_TIMEOUT_MS)
      const result = await resultPromise

      expect(result).toEqual({
        thoughtId: 'thought-1',
        status: 'queued',
        normalizedText: 'graph hang',
      })
      expect(notifyThoughtCreatedMock).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[queue-capture] tier-1 graph anchor upsert failed'),
        expect.objectContaining({
          userId: 'u1',
          thoughtId: 'thought-1',
          message: expect.stringMatching(/timed out/i),
        }),
      )
    } finally {
      errorSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  describe('secret hygiene (docs/planning/secret-hygiene.md)', () => {
    function captureInserts() {
      const sessionInsert = {
        values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'session-1' }]) })),
      }
      const thoughtInsert = {
        values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'thought-1' }]) })),
      }
      let call = 0
      insertMock.mockImplementation(() => {
        call += 1
        return call === 1 ? sessionInsert : thoughtInsert
      })
      return {
        session: () => sessionInsert.values.mock.calls[0]?.[0] as Record<string, unknown>,
        thought: () => thoughtInsert.values.mock.calls[0]?.[0] as Record<string, unknown>,
      }
    }

    function encryptedThoughtMetadata(): string {
      const call = encryptMock.mock.calls
        .map(([arg]) => arg as { table: string; column: string; plaintext: string })
        .find((arg) => arg.table === 'thought' && arg.column === 'metadata')
      return call!.plaintext
    }

    it('keeps the verbatim original only in raw_text and derives every other surface from redacted text', async () => {
      const inserts = captureInserts()
      const raw = envPaste()

      const result = await queueCapture('u1', raw, { source: 'ui' })

      const thoughtRow = inserts.thought()
      // verbatim invariant: raw_text is exactly what the user submitted
      expect(thoughtRow.rawText).toBe(raw)
      expect(thoughtRow.rawTextEncrypted).toBe(`enc:${raw}`)
      // the capture session is a write-only audit row: it must not hold a second verbatim copy
      expect(leaks(String(inserts.session().rawInput))).toBe(false)
      expect(leaks(String(inserts.session().rawInputEncrypted))).toBe(false)
      // everything derived is clean
      for (const derived of [
        thoughtRow.normalizedText,
        thoughtRow.normalizedTextEncrypted,
        thoughtRow.lexicalText,
        inserts.session().normalizedPreview,
        inserts.session().normalizedPreviewEncrypted,
        result.normalizedText,
        JSON.stringify(notifyThoughtCreatedMock.mock.calls),
      ]) {
        expect(leaks(String(derived))).toBe(false)
        expect(String(derived)).not.toContain('user:Tr0ub')
      }
      expect(result.normalizedText).toContain('LLM_API_KEY=[redacted secret]')
      expect(result.normalizedText).toContain('PORT=3000')
    })

    it('records secretsRedacted ({kind, name}, no value) on the thought metadata and the result', async () => {
      const inserts = captureInserts()

      const result = await queueCapture('u1', envPaste())

      const expected = [
        { kind: 'connection_string', name: null },
        { kind: 'api_key', name: 'LLM_API_KEY' },
      ]
      expect(result.secretsRedacted).toEqual(expected)
      expect(JSON.parse(encryptedThoughtMetadata()).secretsRedacted).toEqual(expected)
      // credential names are tenant data: they live in the encrypted metadata, never the plaintext column
      expect(inserts.thought().metadata).not.toHaveProperty('secretsRedacted')
      expect(
        leaks(JSON.stringify([result, inserts.thought().metadata, encryptedThoughtMetadata()])),
      ).toBe(false)
    })

    it('redacts a provider token mid-sentence and remembers only that one exists', async () => {
      captureInserts()
      const result = await queueCapture(
        'u1',
        `my GitHub token is ${FAKE_SECRETS.githubClassic}, use it for the deploy`,
      )
      expect(result.normalizedText).toBe(
        'my GitHub token is [redacted secret], use it for the deploy',
      )
      expect(result.secretsRedacted).toEqual([{ kind: 'access_token', name: 'github' }])
    })

    it('redacts before normalizing, so a multi-line PEM block does not survive whitespace collapse', async () => {
      captureInserts()
      const result = await queueCapture('u1', `key:\n${FAKE_SECRETS.pemPrivateKey}\nend`)
      expect(result.normalizedText).toBe('key: [redacted secret] end')
    })

    it('adds nothing and redacts nothing for ordinary ids and hashes', async () => {
      const inserts = captureInserts()
      const text = 'fixed in commit 9f3a2c1, order #A12B, my password manager is great'
      const result = await queueCapture('u1', text)
      expect(result).toEqual({ thoughtId: 'thought-1', status: 'queued', normalizedText: text })
      expect(JSON.parse(encryptedThoughtMetadata())).not.toHaveProperty('secretsRedacted')
      expect(inserts.thought().normalizedText).toBe(text)
    })

    it('marks the redaction on awaiting_confirmation drafts too', async () => {
      const inserts = captureInserts()
      await queueCapture('u1', `token ${FAKE_SECRETS.githubClassic}`, { awaitConfirmation: true })
      expect(JSON.parse(encryptedThoughtMetadata()).secretsRedacted).toEqual([
        { kind: 'access_token', name: 'github' },
      ])
      expect(leaks(String(inserts.thought().normalizedText))).toBe(false)
    })
  })

  it('throws when placeholder ontology kind is missing', async () => {
    loadOntologyMock.mockResolvedValue({ entityKindsByKey: new Map() })
    await expect(queueCapture('u1', 'x')).rejects.toThrow(/placeholder category "observation"/)
  })
})

describe('claimNextPendingThought', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    })
  })

  it('returns null when queue is empty', async () => {
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      })),
    })
    await expect(claimNextPendingThought('u1')).resolves.toBeNull()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('claims the next pending row', async () => {
    const claimed = {
      id: 't1',
      rawText: 'raw',
      normalizedText: 'raw',
      rawTextEncrypted: null,
      normalizedTextEncrypted: null,
    }
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => [claimed]),
          })),
        })),
      })),
    })
    updateMock.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [claimed]),
        })),
      })),
    })
    await expect(claimNextPendingThought('u1')).resolves.toEqual(claimed)
  })

  it('returns null when concurrent claim loses the race', async () => {
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => [{ id: 't1' }]),
          })),
        })),
      })),
    })
    updateMock.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
    })
    await expect(claimNextPendingThought('u1')).resolves.toBeNull()
  })
})

describe('enrich queue status helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    })
    updateMock.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })
  })

  it('markEnrichQueueComplete clears error', async () => {
    await markEnrichQueueComplete('t1')
    expect(updateMock).toHaveBeenCalled()
  })

  it('markEnrichQueueFailed truncates long errors', async () => {
    await markEnrichQueueFailed('t1', 'x'.repeat(3000))
    expect(updateMock).toHaveBeenCalled()
  })

  it('countPendingEnrichRows returns count', async () => {
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ n: 4 }]),
      })),
    })
    await expect(countPendingEnrichRows('u1')).resolves.toBe(4)
  })

  it('countPendingEnrichRows returns 0 when row missing', async () => {
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })
    await expect(countPendingEnrichRows('u1')).resolves.toBe(0)
  })
})

describe('recoverStaleEnrichProcessingRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    })
  })

  it('returns 0 when no stale rows', async () => {
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    const recovered = await recoverStaleEnrichProcessingRows('u1')
    expect(recovered).toBe(0)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('requeues stale processing rows', async () => {
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
      }),
    })
    updateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })

    const recovered = await recoverStaleEnrichProcessingRows('u1', 60_000)
    expect(recovered).toBe(2)
    expect(updateMock).toHaveBeenCalled()
  })
})

describe('requeueInFlightProcessingRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    })
  })

  it('returns 0 when none in flight', async () => {
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })
    await expect(requeueInFlightProcessingRows('u1')).resolves.toBe(0)
  })

  it('requeues in-flight processing rows', async () => {
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ id: 't1' }]),
      })),
    })
    updateMock.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })
    await expect(requeueInFlightProcessingRows('u1')).resolves.toBe(1)
  })
})

describe('completeEnrichedQueueRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    })
  })

  it('returns 0 when none enriched', async () => {
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })
    await expect(completeEnrichedQueueRows('u1')).resolves.toBe(0)
  })

  it('marks enriched pending/processing rows complete', async () => {
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ id: 't1' }]),
      })),
    })
    updateMock.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })
    await expect(completeEnrichedQueueRows('u1')).resolves.toBe(1)
  })
})

describe('requeueEnrichThought', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    })
  })

  it('returns not_found when thought missing', async () => {
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    const result = await requeueEnrichThought('u1', 'missing')
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_retryable for complete rows with enriched_at', async () => {
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockResolvedValue([
              { id: 't1', enrichQueueStatus: 'complete', enrichedAt: new Date() },
            ]),
        }),
      }),
    })

    const result = await requeueEnrichThought('u1', 't1')
    expect(result).toEqual({ ok: false, reason: 'not_retryable' })
  })

  it('requeues failed rows and schedules worker', async () => {
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockResolvedValue([{ id: 't1', enrichQueueStatus: 'failed', enrichedAt: null }]),
        }),
      }),
    })
    updateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })

    const result = await requeueEnrichThought('u1', 't1')
    expect(result).toEqual({ ok: true })
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1')
  })

  it('requeues complete rows missing enriched_at', async () => {
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockResolvedValue([{ id: 't1', enrichQueueStatus: 'complete', enrichedAt: null }]),
        }),
      }),
    })
    updateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })

    const result = await requeueEnrichThought('u1', 't1')
    expect(result).toEqual({ ok: true })
    expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1')
  })
})

describe('requeueOrphanedCompleteEnrichRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    })
  })

  it('returns 0 when no orphaned rows', async () => {
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    const requeued = await requeueOrphanedCompleteEnrichRows('u1')
    expect(requeued).toBe(0)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('requeues complete rows without enriched_at', async () => {
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 't1' }]),
      }),
    })
    updateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })

    const requeued = await requeueOrphanedCompleteEnrichRows('u1')
    expect(requeued).toBe(1)
    expect(updateMock).toHaveBeenCalled()
  })
})
