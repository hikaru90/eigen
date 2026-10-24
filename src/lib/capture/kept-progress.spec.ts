import { describe, expect, it } from 'vitest'
import { keptStage } from './kept-progress'

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
