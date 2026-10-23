import { test } from '@playwright/test'
import { registerUser } from './test-helpers'
import {
  assertVoiceTranscribeApi,
  exerciseVoiceCaptureUi,
  installVoiceCaptureMocks,
} from './voice-capture-helpers'

test.describe('Voice capture @release', () => {
  test('segment API and segmented mic recording fill the thought field', async ({
    page,
    context,
    baseURL,
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

    await context.grantPermissions(['microphone'], {
      origin: baseURL ?? 'http://localhost:5173',
    })

    // Harness accounts (test.eigen) skip the onboarding overlay (capture-gate.ts);
    // registerUser already accepted the Early Access Agreement.
    await registerUser(context, page)
    await installVoiceCaptureMocks(page)

    await test.step('transcribe-chunk API returns speech text for one segment', async () => {
      await assertVoiceTranscribeApi(page)
    })

    await test.step('mic UI shows partials, then the joined segments on stop', async () => {
      await exerciseVoiceCaptureUi(page)
    })
  })
})
