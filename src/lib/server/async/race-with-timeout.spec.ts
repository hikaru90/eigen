import { describe, expect, it, vi } from 'vitest'
import { raceWithTimeout } from './race-with-timeout'

describe('raceWithTimeout', () => {
  it('rejects when body exceeds the timeout', async () => {
    await expect(raceWithTimeout('test', () => new Promise(() => {}), 50)).rejects.toThrow(
      /test timeout after 50ms/,
    )
  })

  it('returns body result and clears the timer when body finishes first', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    await expect(raceWithTimeout('test', async () => 'ok', 60_000)).resolves.toBe('ok')
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
