import { test } from '@playwright/test'
import { assertAskSuggestionFromCapture } from './ask-suggestions-helpers'
import { registerUser } from './test-helpers'

/**
 * Suggested questions on Ask, on a Playwright harness account: its capture is enriched
 * by the dev worker and billed to the eval operator service wallet (no PayPal top-up).
 */
test.describe('Ask suggested questions @ask-suggestions', () => {
  test('a capture becomes a question pill under the Ask heading', async ({ page, context }) => {
    test.skip(
      !process.env.SERVICE_API_KEY_OPENROUTER?.trim() || !process.env.OPENROUTER_BASE_URL?.trim(),
      'OpenRouter env required for real enrichment',
    )
    test.setTimeout(240_000)
    await registerUser(context, page)
    await assertAskSuggestionFromCapture(page)
  })
})
