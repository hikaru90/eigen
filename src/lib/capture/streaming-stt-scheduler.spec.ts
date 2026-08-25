import { describe, expect, it, vi } from 'vitest'
import { mockCallArg } from '$lib/test/vitest-mock-call'
import { createStreamingSttScheduler } from './streaming-stt-scheduler'

function makeChunk(byte: number, type = 'audio/webm') {
  return new Blob([new Uint8Array([byte])], { type })
}

describe('createStreamingSttScheduler', () => {
  it('transcribes a single chunk as one merged blob', async () => {
    const onTranscribe = vi.fn(async () => 'hello')
    const onPartial = vi.fn()
    const scheduler = createStreamingSttScheduler({ onTranscribe, onPartial })

    scheduler.appendChunk(makeChunk(1), 'audio/webm;codecs=opus')
    await vi.waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(1))

    const blob = mockCallArg<Blob>(onTranscribe, 0, 0)
    expect(blob.type).toBe('audio/webm;codecs=opus')
    expect(blob.size).toBe(1)
    expect(onPartial).toHaveBeenCalledWith('hello')
  })

  it('coalesces chunks that arrive while a request is in flight', async () => {
    let resolveFirst: ((value: string) => void) | undefined
    const onTranscribe = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          if (onTranscribe.mock.calls.length === 1) {
            resolveFirst = resolve
          } else {
            resolve('full transcript')
          }
        }),
    )
    const onPartial = vi.fn()
    const scheduler = createStreamingSttScheduler({ onTranscribe, onPartial })

    scheduler.appendChunk(makeChunk(1), 'audio/webm')
    await vi.waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(1))

    scheduler.appendChunk(makeChunk(2), 'audio/webm')
    expect(onTranscribe).toHaveBeenCalledTimes(1)

    resolveFirst?.('partial one')
    await vi.waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(2))

    const secondBlob = mockCallArg<Blob>(onTranscribe, 1, 0)
    expect(secondBlob.size).toBe(2)
    expect(onPartial).toHaveBeenLastCalledWith('full transcript')
  })

  it('replaces prior partial transcript instead of appending', async () => {
    const onTranscribe = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second full')
    const onPartial = vi.fn()
    const scheduler = createStreamingSttScheduler({ onTranscribe, onPartial })

    scheduler.appendChunk(makeChunk(1), 'audio/webm')
    await vi.waitFor(() => expect(onPartial).toHaveBeenCalledWith('first'))

    scheduler.appendChunk(makeChunk(2), 'audio/webm')
    await vi.waitFor(() => expect(onPartial).toHaveBeenCalledWith('second full'))

    expect(onPartial).not.toHaveBeenCalledWith('first second full')
  })

  it('ignores stale responses when a newer drain was scheduled', async () => {
    let resolveSlow: ((value: string) => void) | undefined
    const onTranscribe = vi.fn(async () => {
      if (onTranscribe.mock.calls.length === 1) {
        return new Promise<string>((resolve) => {
          resolveSlow = resolve
        })
      }
      return 'authoritative'
    })
    const onPartial = vi.fn()
    const scheduler = createStreamingSttScheduler({ onTranscribe, onPartial })

    scheduler.appendChunk(makeChunk(1), 'audio/webm')
    await vi.waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(1))

    scheduler.appendChunk(makeChunk(2), 'audio/webm')
    resolveSlow?.('stale partial')
    await vi.waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(onPartial).toHaveBeenCalledWith('authoritative'))

    expect(onPartial).not.toHaveBeenCalledWith('stale partial')
  })

  it('abort stops in-flight work and suppresses partial callbacks', async () => {
    let rejectInFlight: ((reason: unknown) => void) | undefined
    const onTranscribe = vi.fn(
      (_blob, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          rejectInFlight = reject
        }),
    )
    const onPartial = vi.fn()
    const scheduler = createStreamingSttScheduler({ onTranscribe, onPartial })

    scheduler.appendChunk(makeChunk(1), 'audio/webm')
    await vi.waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(1))

    scheduler.abort()
    rejectInFlight?.(new DOMException('Aborted', 'AbortError'))
    await Promise.resolve()

    expect(onPartial).not.toHaveBeenCalled()
  })

  it('reset clears state for a new recording', async () => {
    const onTranscribe = vi.fn(async () => 'partial')
    const onPartial = vi.fn()
    const scheduler = createStreamingSttScheduler({ onTranscribe, onPartial })

    scheduler.appendChunk(makeChunk(1), 'audio/webm')
    await vi.waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(1))

    scheduler.reset()
    onTranscribe.mockClear()
    onPartial.mockClear()

    scheduler.appendChunk(makeChunk(9), 'audio/webm')
    await vi.waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(1))

    const blob = mockCallArg<Blob>(onTranscribe, 0, 0)
    expect(blob.size).toBe(1)
    expect(blob.type).toBe('audio/webm')
  })
})
