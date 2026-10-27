import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page, userEvent } from 'vitest/browser'
import { FakeMediaRecorder, installVoiceDoubles, micSignal } from '$lib/test/voice-doubles'
import VoiceHarness from './glass-writer-voice-harness.svelte'
import GlassWriter from './glass-writer.svelte'

const base = {
  placeholder: 'Write it down',
  submitLabel: 'Capture',
  inputTestId: 'writer-input',
  submitTestId: 'writer-send',
}

describe('glass-writer.svelte', () => {
  it('docks a glass pill above the bottom nav, portaled to <body>', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {} })
    const root = page.getByTestId('glass-writer')
    await expect.element(root).toBeInTheDocument()
    const el = root.element() as HTMLElement
    expect(el.parentElement).toBe(document.body)
    expect(el.className).toContain('fixed')
    expect(el.className).toContain('bottom-[calc(var(--bottom-nav)+12px)]')
    const field = page.getByTestId('glass-writer-field').element() as HTMLElement
    expect(field.className).toContain('glass-field')
    await expect.element(page.getByPlaceholder('Write it down')).toBeInTheDocument()
  })

  it('centres the text and the action slot in one space-between row', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {} })
    const field = page.getByTestId('glass-writer-field').element() as HTMLElement
    // the row centres (WebKit has no field-sizing: its one-line textarea is taller than the button)
    expect(field.className).toContain('items-center')
    expect(field.className).toContain('justify-between')
    expect(field.className).not.toContain('items-end')
    // the slot follows the row's centring (WebKit's one-line textarea is taller than the button)
    const slot = page.getByTestId('glass-writer-slot').element() as HTMLElement
    expect(slot.className).not.toContain('self-end')
    expect(slot.className).not.toContain('absolute')
  })

  it('mic while empty; once there are words send joins it and the mic stays for the next recording', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {}, ontranscript: () => {} })
    await expect.element(page.getByRole('button', { name: 'Start voice input' })).toBeInTheDocument()
    await expect.element(page.getByTestId('writer-send')).not.toBeInTheDocument()
    await userEvent.type(page.getByTestId('writer-input'), 'hello')
    await expect.element(page.getByTestId('writer-send')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Start voice input' })).toBeInTheDocument()
  })

  it('without voice the slot is send alone', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {} })
    await expect.element(page.getByTestId('writer-send')).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Start voice input' }))
      .not.toBeInTheDocument()
  })

  it('Enter submits, Shift+Enter is a newline, empty never submits', async () => {
    const onsubmit = vi.fn()
    render(GlassWriter, { ...base, onsubmit })
    const input = page.getByTestId('writer-input')
    await userEvent.click(input)
    await userEvent.keyboard('{Enter}')
    expect(onsubmit).not.toHaveBeenCalled()
    await userEvent.type(input, 'one')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect((input.element() as HTMLTextAreaElement).value).toBe('one\n')
    expect(onsubmit).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(onsubmit).toHaveBeenCalledTimes(1)
  })

  it('a consumer keydown that claims Enter wins; submitDisabled blocks sending', async () => {
    const onsubmit = vi.fn()
    render(GlassWriter, { ...base, value: 'words', submitDisabled: true, onsubmit })
    await expect.element(page.getByTestId('writer-send')).toBeDisabled()
    await userEvent.click(page.getByTestId('writer-input'))
    await userEvent.keyboard('{Enter}')
    expect(onsubmit).not.toHaveBeenCalled()
  })

  it('shows Stop while busy when the page can stop', async () => {
    const onstop = vi.fn()
    render(GlassWriter, { ...base, value: 'q', busy: true, onstop, onsubmit: () => {} })
    await userEvent.click(page.getByTestId('glass-writer-stop'))
    expect(onstop).toHaveBeenCalledTimes(1)
  })

  it('publishes its docked height for page padding', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {} })
    await expect
      .poll(() => document.documentElement.style.getPropertyValue('--glass-writer-height'))
      .toMatch(/px$/)
  })
})

describe('glass-writer.svelte voice message', () => {
  let doubles: ReturnType<typeof installVoiceDoubles>
  const fetchMock = vi.fn()

  const transcriptResponse = (transcript: string) =>
    new Response(JSON.stringify({ transcript }), { status: 200 })
  const errorResponse = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status })
  const recorder = () => FakeMediaRecorder.instances.at(-1)!
  const bytesSent = async (call: number) =>
    [...new Uint8Array(await (fetchMock.mock.calls[call]![1].body as Blob).arrayBuffer())]

  beforeEach(() => {
    doubles = installVoiceDoubles()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    doubles.restore()
    vi.unstubAllGlobals()
  })

  async function startRecording() {
    await page.getByTestId('voice-mic').click()
    await expect.element(page.getByTestId('voice-bar')).toBeInTheDocument()
  }

  it('AC-1: tapping the mic swaps the field for the voice bar and makes no request', async () => {
    render(VoiceHarness, { onsubmitted: vi.fn() })
    await expect.element(page.getByTestId('writer-input')).toBeVisible()
    await startRecording()
    await expect.element(page.getByTestId('writer-input')).not.toBeVisible()
    await expect.element(page.getByTestId('voice-timer')).toBeInTheDocument()
    await expect.element(page.getByTestId('voice-waveform')).toBeInTheDocument()
    // the writer's own send and mic are not offered while the bar is up
    await expect.element(page.getByTestId('voice-mic')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('writer-send')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('AC-1: the waveform moves with the mic and the timer runs', async () => {
    render(VoiceHarness, { onsubmitted: vi.fn() })
    await startRecording()
    const lastBar = () =>
      Number.parseFloat(
        ((page.getByTestId('voice-waveform').element() as HTMLElement).lastElementChild as HTMLElement).style.getPropertyValue(
          '--lvl',
        ),
      )
    const quiet = lastBar()
    micSignal.loud = true
    await expect.poll(lastBar).toBeGreaterThan(quiet + 0.3)
    await expect
      .poll(() => page.getByTestId('voice-timer').element().textContent, { timeout: 4000 })
      .toMatch(/^\s*0:0[1-9]/)
  })

  it('records with the right recorder settings and keeps the clip in memory only', async () => {
    const storageBefore = [localStorage.length, sessionStorage.length]
    render(VoiceHarness, { onsubmitted: vi.fn() })
    await startRecording()
    expect(recorder().startCalls).toEqual([1000])
    expect(recorder().options).toMatchObject({
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 32000,
    })
    recorder().emitChunk([1, 2, 3])
    await page.getByTestId('voice-discard').click()
    expect([localStorage.length, sessionStorage.length]).toEqual(storageBefore)
  })

  it('AC-2: send shows transcribing, uploads the whole clip once, then submits the text after what was typed', async () => {
    let answer: (r: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (answer = r)))
    const onsubmitted = vi.fn()
    render(VoiceHarness, { initial: 'Buy milk', onsubmitted })
    await startRecording()
    recorder().emitChunk([1, 2, 3])
    recorder().emitChunk([4, 5])
    await page.getByTestId('voice-send').click()

    await expect.element(page.getByTestId('voice-status')).toHaveTextContent('Transcribing…')
    await expect.poll(() => fetchMock.mock.calls.length).toBe(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/capture/transcribe')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' })
    expect(await bytesSent(0)).toEqual([1, 2, 3, 4, 5, 0xee, 0xee])
    // nothing is submitted until the transcript is in
    expect(onsubmitted).not.toHaveBeenCalled()
    // the field is locked meanwhile
    await expect.element(page.getByTestId('writer-input')).not.toBeVisible()

    answer(transcriptResponse('and eggs'))
    await expect.poll(() => onsubmitted.mock.calls.length).toBe(1)
    expect(onsubmitted).toHaveBeenCalledWith('Buy milk and eggs')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // the bar is gone, the field is back
    await expect.element(page.getByTestId('voice-bar')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('writer-input')).toBeVisible()
    for (const track of doubles.stream.tracks) expect(track.stop).toHaveBeenCalled()
  })

  it('submits the transcript alone when nothing was typed', async () => {
    fetchMock.mockImplementation(async () => transcriptResponse('Remember the dentist'))
    const onsubmitted = vi.fn()
    render(VoiceHarness, { onsubmitted })
    await startRecording()
    recorder().emitChunk([1])
    await page.getByTestId('voice-send').click()
    await expect.poll(() => onsubmitted.mock.calls.length).toBe(1)
    expect(onsubmitted).toHaveBeenCalledWith('Remember the dentist')
  })

  it('leaves the transcript in the field, unsent, when the page cannot send right now', async () => {
    fetchMock.mockImplementation(async () => transcriptResponse('later'))
    const onsubmitted = vi.fn()
    render(VoiceHarness, { initial: 'now', submitDisabled: true, onsubmitted })
    await startRecording()
    recorder().emitChunk([1])
    await page.getByTestId('voice-send').click()
    await expect.element(page.getByTestId('writer-input')).toHaveValue('now later')
    expect(onsubmitted).not.toHaveBeenCalled()
  })

  it('AC-3: discard uploads nothing and the field shows what was typed', async () => {
    const onsubmitted = vi.fn()
    render(VoiceHarness, { onsubmitted })
    await userEvent.type(page.getByTestId('writer-input'), 'half a thought')
    await startRecording()
    recorder().emitChunk([1, 2, 3])
    await page.getByTestId('voice-discard').click()
    await expect.element(page.getByTestId('voice-bar')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('writer-input')).toHaveValue('half a thought')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onsubmitted).not.toHaveBeenCalled()
    for (const track of doubles.stream.tracks) expect(track.stop).toHaveBeenCalled()
  })

  it('AC-4: a failed request shows the error with Retry and Discard, submits nothing, and Retry uploads the same clip', async () => {
    fetchMock
      .mockImplementationOnce(async () => errorResponse(502, 'Transcription failed'))
      .mockImplementationOnce(async () => transcriptResponse('worked'))
    const onsubmitted = vi.fn()
    const onvoiceerror = vi.fn()
    render(VoiceHarness, { onsubmitted, onvoiceerror })
    await startRecording()
    recorder().emitChunk([9, 8, 7])
    await page.getByTestId('voice-send').click()

    await expect
      .element(page.getByTestId('voice-error'))
      .toHaveTextContent("Couldn't transcribe the recording")
    await expect.element(page.getByTestId('voice-retry')).toBeInTheDocument()
    await expect.element(page.getByTestId('voice-discard')).toBeInTheDocument()
    expect(onsubmitted).not.toHaveBeenCalled()
    expect(onvoiceerror).toHaveBeenCalledWith("Couldn't transcribe the recording")
    // the page can read the field only after the error is dealt with
    await expect.element(page.getByTestId('writer-input')).not.toBeVisible()

    await page.getByTestId('voice-retry').click()
    await expect.poll(() => onsubmitted.mock.calls.length).toBe(1)
    expect(onsubmitted).toHaveBeenCalledWith('worked')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await bytesSent(1)).toEqual(await bytesSent(0))
    expect(FakeMediaRecorder.instances).toHaveLength(1)
  })

  it('a failed message can be discarded: nothing is submitted and the field is back', async () => {
    fetchMock.mockImplementation(async () => errorResponse(502, 'Transcription failed'))
    const onsubmitted = vi.fn()
    render(VoiceHarness, { initial: 'kept words', onsubmitted })
    await startRecording()
    recorder().emitChunk([1])
    await page.getByTestId('voice-send').click()
    await expect.element(page.getByTestId('voice-error')).toBeInTheDocument()
    await page.getByTestId('voice-discard').click()
    await expect.element(page.getByTestId('writer-input')).toHaveValue('kept words')
    expect(onsubmitted).not.toHaveBeenCalled()
  })

  it('AC-5: a 402 shows the billing message and submits nothing', async () => {
    fetchMock.mockImplementation(async () => errorResponse(402, 'Insufficient credits'))
    const onsubmitted = vi.fn()
    render(VoiceHarness, { onsubmitted })
    await startRecording()
    recorder().emitChunk([1])
    await page.getByTestId('voice-send').click()
    await expect.element(page.getByTestId('voice-error')).toHaveTextContent('Insufficient credits')
    expect(onsubmitted).not.toHaveBeenCalled()
  })

  it('AC-6: an empty transcript shows "No speech detected" and submits nothing', async () => {
    fetchMock.mockImplementation(async () => transcriptResponse(''))
    const onsubmitted = vi.fn()
    render(VoiceHarness, { onsubmitted })
    await startRecording()
    recorder().emitChunk([1])
    await page.getByTestId('voice-send').click()
    await expect.element(page.getByTestId('voice-error')).toHaveTextContent('No speech detected')
    await expect.element(page.getByTestId('voice-retry')).toBeInTheDocument()
    expect(onsubmitted).not.toHaveBeenCalled()
  })

  it('AC-7: a clip of flat silence is still uploaded: there is no level gate', async () => {
    fetchMock.mockImplementation(async () => transcriptResponse('whispered'))
    const onsubmitted = vi.fn()
    render(VoiceHarness, { onsubmitted })
    micSignal.loud = false
    await startRecording()
    recorder().emitChunk([1, 2])
    await page.getByTestId('voice-send').click()
    await expect.poll(() => onsubmitted.mock.calls.length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a denied microphone shows its reason in the bar with Dismiss, and nothing is recorded', async () => {
    doubles.getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    )
    const onvoiceerror = vi.fn()
    render(VoiceHarness, { initial: 'typed', onsubmitted: vi.fn(), onvoiceerror })
    await page.getByTestId('voice-mic').click()
    await expect
      .element(page.getByTestId('voice-error'))
      .toHaveTextContent('Microphone permission denied')
    expect(onvoiceerror).toHaveBeenCalledWith('Microphone permission denied')
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect.element(page.getByTestId('writer-input')).toHaveValue('typed')
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it('announces the start of a recording', async () => {
    const onvoicestart = vi.fn()
    render(VoiceHarness, { onsubmitted: vi.fn(), onvoicestart })
    await startRecording()
    expect(onvoicestart).toHaveBeenCalledTimes(1)
  })

  it('hands the page a stop that discards the message (Capture/Ask call it before their own send)', async () => {
    const { component } = render(VoiceHarness, { onsubmitted: vi.fn() })
    expect(component.hasVoiceStop()).toBe(false)
    await startRecording()
    expect(component.hasVoiceStop()).toBe(true)
    component.stopVoice()
    await expect.element(page.getByTestId('voice-bar')).not.toBeInTheDocument()
    expect(component.hasVoiceStop()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    for (const track of doubles.stream.tracks) expect(track.stop).toHaveBeenCalled()
  })

  it('stops the microphone when the writer goes away mid-recording', async () => {
    const { unmount } = render(VoiceHarness, { onsubmitted: vi.fn() })
    await startRecording()
    unmount()
    for (const track of doubles.stream.tracks) expect(track.stop).toHaveBeenCalled()
    expect(recorder().state).toBe('inactive')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

