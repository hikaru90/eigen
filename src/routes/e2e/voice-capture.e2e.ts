import { expect, test, type Page } from '@playwright/test'
import { registerUser } from './test-helpers'
import {
  assertVoiceTranscribeApi,
  expectNoMicrophoneHeld,
  expectWholeClipUploaded,
  installVoiceMocks,
  mockCaptureWithoutLlm,
  mockTranscribeEndpoint,
  openCaptureForVoice,
  startVoiceMessage,
  VOICE_TRANSCRIPT,
} from './voice-capture-helpers'

/**
 * Voice messages (docs/planning/feature-voice-message-stt.md) on every surface with a mic:
 * Capture, Ask and Contribute. The mic and the transcribe endpoint are mocked (the fixture
 * clip stands in for the microphone; the endpoint answers without calling the provider), so
 * these cover the product flow: record → send → the transcript appears in the field and
 * nothing is submitted until the send button is tapped; discard; failure → Retry. The real provider is exercised by the second test.
 */
test.describe('Voice messages @release', () => {
  test('Capture, Ask and Contribute: record, send, the text waits in the field until the send button is tapped', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000)
    await context.grantPermissions(['microphone'], {
      origin: baseURL ?? 'http://localhost:5173',
    })

    // Harness accounts (test.eigen) skip the onboarding overlay (capture-gate.ts);
    // registerUser already accepted the Early Access Agreement.
    await registerUser(context, page)
    await installVoiceMocks(page)
    await mockCaptureWithoutLlm(page)
    const transcribe = await mockTranscribeEndpoint(page)

    await test.step('Capture: the transcript lands in the field and is submitted only by the send button', async () => {
      await openCaptureForVoice(page)
      await startVoiceMessage(page, transcribe)
      const submitted = trackCaptureSubmits(page)
      const captured = page.waitForRequest(
        (req) =>
          req.method() === 'POST' &&
          /\/api\/capture\/(submit|keep)$/.test(new URL(req.url()).pathname) &&
          (req.postData() ?? '').includes(VOICE_TRANSCRIPT),
        { timeout: 30_000 },
      )
      await page.getByTestId('voice-send').click()
      await expect(page.getByTestId('voice-status')).toBeVisible()
      await expect(page.getByTestId('voice-bar')).toBeHidden()
      expectWholeClipUploaded(transcribe, 1)
      await expect(page.getByTestId('capture-input')).toHaveValue(VOICE_TRANSCRIPT)
      await expect(page.getByTestId('capture-input')).toBeFocused()
      expect(submitted(), 'nothing is submitted before the send button').toHaveLength(0)
      await page.getByTestId('capture-submit').click()
      await captured
      await expectNoMicrophoneHeld(page)
    })

    await test.step('Ask: send asks the transcript as the question', async () => {
      // the agent run is not under test: record what Ask sends, then end the request
      const asked = page.waitForRequest(
        (req) =>
          req.method() === 'POST' &&
          new URL(req.url()).pathname === '/api/chat' &&
          (req.postData() ?? '').includes(VOICE_TRANSCRIPT),
        { timeout: 30_000 },
      )
      await page.route('**/api/chat', (route) =>
        route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
      )
      await page.goto('/chat')
      await expect(page.getByTestId('ask-input')).toBeVisible()
      await startVoiceMessage(page, transcribe)
      await page.getByTestId('voice-send').click()
      await expect(page.getByTestId('ask-input')).toHaveValue(VOICE_TRANSCRIPT)
      await page.waitForTimeout(500)
      await page.getByTestId('ask-submit').click()
      await asked
      expectWholeClipUploaded(transcribe, 2)
    })

    await test.step('Contribute: send shares the transcript through the idea check', async () => {
      const checked = page.waitForRequest(
        (req) =>
          req.method() === 'POST' &&
          new URL(req.url()).pathname === '/api/board/ideas/check' &&
          (req.postData() ?? '').includes(VOICE_TRANSCRIPT),
        { timeout: 30_000 },
      )
      await page.route('**/api/board/ideas/check', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'not under test' }),
        }),
      )
      await page.goto('/feedback')
      await expect(page.getByRole('textbox', { name: 'What could be better?' })).toBeVisible()
      await startVoiceMessage(page, transcribe)
      await page.getByTestId('voice-send').click()
      await expect(page.getByRole('textbox', { name: 'What could be better?' })).toHaveValue(
        VOICE_TRANSCRIPT,
      )
      await page.waitForTimeout(500)
      await page.getByTestId('glass-writer').locator('button[type="submit"]').click()
      await checked
      expectWholeClipUploaded(transcribe, 3)
    })
  })

  test('discard uploads nothing and restores what was typed (Capture)', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000)
    await context.grantPermissions(['microphone'], {
      origin: baseURL ?? 'http://localhost:5173',
    })
    await registerUser(context, page)
    await installVoiceMocks(page)
    await mockCaptureWithoutLlm(page)
    const transcribe = await mockTranscribeEndpoint(page)

    await openCaptureForVoice(page)
    const input = page.getByTestId('capture-input')
    await input.fill('half a thought')
    await startVoiceMessage(page, transcribe)
    await expect(input).toBeHidden()
    await page.getByTestId('voice-discard').click()

    await expect(page.getByTestId('voice-bar')).toBeHidden()
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('half a thought')
    expect(transcribe.bodies, 'discard uploads nothing').toHaveLength(0)
    await expectNoMicrophoneHeld(page)
  })

  test('a failed transcription keeps the clip: Retry uploads it again (Capture)', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000)
    await context.grantPermissions(['microphone'], {
      origin: baseURL ?? 'http://localhost:5173',
    })
    await registerUser(context, page)
    await installVoiceMocks(page)
    await mockCaptureWithoutLlm(page)
    const transcribe = await mockTranscribeEndpoint(page)
    transcribe.failNext(502, 'Transcription failed')

    await openCaptureForVoice(page)
    await startVoiceMessage(page, transcribe)
    const submitted = trackCaptureSubmits(page)
    await page.getByTestId('voice-send').click()

    await expect(page.getByTestId('voice-error')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('voice-retry')).toBeVisible()
    await expect(page.getByTestId('voice-discard')).toBeVisible()
    expect(submitted(), 'nothing is submitted on failure').toHaveLength(0)

    const captured = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        /\/api\/capture\/(submit|keep)$/.test(new URL(req.url()).pathname) &&
        (req.postData() ?? '').includes(VOICE_TRANSCRIPT),
      { timeout: 30_000 },
    )
    await page.getByTestId('voice-retry').click()
    // the same whole clip went up twice; the page never recorded again
    await expect(page.getByTestId('voice-bar')).toBeHidden()
    expectWholeClipUploaded(transcribe, 2)
    await expect(page.getByTestId('capture-input')).toHaveValue(VOICE_TRANSCRIPT)
    expect(submitted(), 'the retried transcript waits for the send button').toHaveLength(0)
    await page.getByTestId('capture-submit').click()
    await captured
  })

  test('the real transcribe endpoint turns the release clip into its words', async ({
    page,
    context,
  }) => {
    test.skip(
      !process.env.SERVICE_API_KEY_OPENROUTER?.trim() || !process.env.OPENROUTER_BASE_URL?.trim(),
      'OpenRouter STT env required',
    )
    test.skip(
      !process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim() ||
        !process.env.PAYPAL_SANDBOX_BUYER_PASSWORD?.trim(),
      'PayPal sandbox buyer required for platform credits',
    )
    await registerUser(context, page)
    await assertVoiceTranscribeApi(page)
  })
})

/** Capture submit calls seen so far (the keep / queue endpoints persist a thought). */
function trackCaptureSubmits(page: Page): () => string[] {
  const urls: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/capture\/(submit|keep)$/.test(new URL(req.url()).pathname)) {
      urls.push(req.url())
    }
  })
  return () => urls
}
