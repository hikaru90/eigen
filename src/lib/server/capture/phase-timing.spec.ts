import { describe, expect, it } from 'vitest'
import { createIngestPhaseTimer } from './phase-timing'

describe('capture phase-timing', () => {
  it('records per-phase durations and wall clock', async () => {
    const timer = createIngestPhaseTimer()
    await timer.time('normalize', async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    await timer.time('embedding', async () => {
      await new Promise((r) => setTimeout(r, 3))
    })
    const report = timer.finish()
    expect(report.phases).toHaveLength(2)
    expect(report.phases.map((p) => p.phase)).toEqual(['normalize', 'embedding'])
    expect(report.wallMs).toBeGreaterThanOrEqual(8)
    for (const entry of report.phases) {
      expect(entry.ms).toBeGreaterThanOrEqual(0)
    }
  })
})
