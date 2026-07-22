import { describe, expect, it } from 'vitest'
import { GraphScaleConsoleProgress } from './console-progress'

describe('GraphScaleConsoleProgress', () => {
  it('computes pct and eta from weighted steps', () => {
    const progress = new GraphScaleConsoleProgress({
      sizes: [50],
      tracks: new Set(['capture']),
    })
    expect(progress.report('N=50 seed queue', { force: true }).pct).toBe(0)
    const mid = progress.report('N=50 seed enrich', {
      seedEnriched: 25,
      seedEnrichTotal: 50,
      force: true,
    })
    expect(mid.pct).toBeGreaterThan(0)
    expect(mid.pct).toBeLessThan(50)
    const done = progress.report('N=50 seed done', { completeSeed: true, force: true })
    expect(done.pct).toBeGreaterThan(50)
    const finished = progress.report('N=50 capture', { bump: 'capture', force: true })
    expect(finished.pct).toBe(100)
  })

  it('does not treat queue completion as full seed weight before enrich', () => {
    const progress = new GraphScaleConsoleProgress({
      sizes: [50],
      tracks: new Set(['capture']),
    })
    progress.report('N=50 seed queue 50/50', { seedQueued: 50, seedTotal: 50, force: true })
    const atEnrichStart = progress.report('N=50 seed enrich 0/50', {
      seedEnriched: 0,
      seedEnrichTotal: 50,
      force: true,
    })
    expect(atEnrichStart.pct).toBeLessThan(10)
  })
})
