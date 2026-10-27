import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import { FakeMediaRecorder, installVoiceDoubles } from '$lib/test/voice-doubles'
import ShareComposer from './share-composer.svelte'

describe('share-composer.svelte', () => {
  let doubles: ReturnType<typeof installVoiceDoubles>
  const fetchMock = vi.fn()

  beforeEach(() => {
    doubles = installVoiceDoubles()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    doubles.restore()
    vi.unstubAllGlobals()
  })

  function renderComposer(oncheck = vi.fn(async () => null)) {
    render(ShareComposer, {
      maxLength: 4000,
      oncheck,
      oncreate: async () => false,
      onvoteinstead: () => {},
    })
    return oncheck
  }

  it('offers voice input on the Contribute message field', async () => {
    renderComposer()
    await expect.element(page.getByRole('button', { name: 'Start voice input' })).toBeInTheDocument()
  })

  it('a voice message is transcribed and then shared through the normal share path', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ transcript: 'The mic is broken' }), { status: 200 }),
    )
    const oncheck = renderComposer()
    await page.getByTestId('voice-mic').click()
    await expect.element(page.getByTestId('voice-bar')).toBeInTheDocument()
    FakeMediaRecorder.instances.at(-1)!.emitChunk([1, 2, 3])
    await page.getByTestId('voice-send').click()
    // the same judge a typed idea goes through, fed the transcript
    await expect.poll(() => oncheck.mock.calls.length).toBe(1)
    expect(oncheck).toHaveBeenCalledWith('The mic is broken')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/capture/transcribe')
  })

  it('a failed transcription shares nothing and offers Retry', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: 'Transcription failed' }), { status: 502 }),
    )
    const oncheck = renderComposer()
    await page.getByTestId('voice-mic').click()
    FakeMediaRecorder.instances.at(-1)!.emitChunk([1])
    await page.getByTestId('voice-send').click()
    await expect.element(page.getByTestId('voice-retry')).toBeInTheDocument()
    expect(oncheck).not.toHaveBeenCalled()
  })
})
