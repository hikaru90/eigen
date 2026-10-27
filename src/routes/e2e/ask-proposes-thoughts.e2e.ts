import { test } from '@playwright/test'
import {
  askMixedMessageAndSeeProposal,
  confirmProposalAndSeeStoreCall,
  expectStoredThoughtInYarn,
  ignoreProposalThenLateYesStoresNothing,
} from './ask-proposes-thoughts-helpers'
import { registerUser } from './test-helpers'

/**
 * Ask proposes thoughts, stores them on "yes" (docs/planning/feature-ask-proposes-thoughts.md).
 * Real LLMs and the decision model: skipped unless OpenRouter and Jev are configured.
 */
test.describe('Ask proposes thoughts @ask-proposes-thoughts', () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.SERVICE_API_KEY_OPENROUTER?.trim() ||
        !process.env.OPENROUTER_BASE_URL?.trim() ||
        process.env.DECISION_SHADOW_ENABLED?.trim().toLowerCase() !== 'true',
      'OpenRouter env and DECISION_SHADOW_ENABLED=true (Jev) required',
    )
  })

  test('a mixed message is answered and proposed; "yes" stores it, visibly; it lands in Yarn', async ({
    page,
    context,
  }) => {
    test.setTimeout(420_000)
    await registerUser(context, page)
    await askMixedMessageAndSeeProposal(page)
    await confirmProposalAndSeeStoreCall(page)
    await expectStoredThoughtInYarn(page)
  })

  test('ignoring a proposal stores nothing, and a later "yes" cannot store the old one', async ({
    page,
    context,
  }) => {
    test.setTimeout(420_000)
    await registerUser(context, page)
    await ignoreProposalThenLateYesStoresNothing(page)
  })
})
