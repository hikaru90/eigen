import { describe, expect, it } from 'vitest'
import { INGEST_MAX_RETRIES } from '$lib/server/ingest/retry'

/** Worker uses 1 initial attempt + INGEST_MAX_RETRIES retries (project policy). */
const MAX_JOB_ATTEMPTS = 1 + INGEST_MAX_RETRIES

describe('graph-sync-worker policy', () => {
  it('uses exactly three retries after the initial attempt', () => {
    expect(MAX_JOB_ATTEMPTS).toBe(4)
    expect(INGEST_MAX_RETRIES).toBe(3)
  })
})
