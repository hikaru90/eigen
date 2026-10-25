import { describe, expect, it } from 'vitest'
import { keptSecretsRedacted, keptStage } from './kept-progress'

const result = (queueStatus: string | null, enrichmentComplete = false) =>
  ({ queueStatus, enrichmentComplete }) as never

describe('keptStage', () => {
  it('is indexing while the enrich queue holds it', () => {
    expect(keptStage(result('pending'))).toBe('indexing')
    expect(keptStage(result('processing'))).toBe('indexing')
  })

  it('is linked once enrichment completed', () => {
    expect(keptStage(result('complete'))).toBe('linked')
    expect(keptStage(result(null, true))).toBe('linked')
  })

  it('is failed when the queue failed', () => {
    expect(keptStage(result('failed'))).toBe('failed')
  })
})

describe('keptSecretsRedacted', () => {
  it('is true when the capture recorded a redacted credential', () => {
    expect(
      keptSecretsRedacted({
        metadata: { secretsRedacted: [{ kind: 'api_key', name: 'LLM_API_KEY' }] },
      } as never),
    ).toBe(true)
  })

  it('is false when nothing was redacted or the metadata is absent or malformed', () => {
    expect(keptSecretsRedacted({ metadata: {} } as never)).toBe(false)
    expect(keptSecretsRedacted({ metadata: { secretsRedacted: [] } } as never)).toBe(false)
    expect(keptSecretsRedacted({ metadata: { secretsRedacted: 'yes' } } as never)).toBe(false)
    expect(keptSecretsRedacted({} as never)).toBe(false)
  })
})
