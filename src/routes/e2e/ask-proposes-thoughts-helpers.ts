import { expect, type Locator, type Page } from '@playwright/test'
import {
  askChatQuestion,
  assertChatLogHasNoRawJson,
  startNewChatSession,
  waitForChatIdle,
} from './test-helpers'

/**
 * Ask proposes thoughts (docs/planning/feature-ask-proposes-thoughts.md): Ask never stores on
 * its own — it proposes what it judges worth keeping in plain chat text, and a "yes" in the
 * very next message stores it, visibly, as a tool call.
 *
 * The flows run against real LLMs and the decision model (Jev), so they only run where that
 * environment is configured (see the skip in the spec).
 */

export const MIXED_MESSAGE =
  'I started bouldering on Tuesdays with Jonas, what should I plan for the weekend?'
export const UNRELATED_QUESTION = "What's on my list for next week?"

/** The plain-text lead-in the proposal always starts with (messages/en.json ask_proposal_lead_in). */
export const PROPOSAL_LEAD_IN = "I'd store these in your mesh"
/** The tool card's title once store_thoughts ran (CHAT_TOOL_COPY.store_thoughts). */
export const STORE_TOOL_TITLE = 'Saving to memory'

export function chatLog(page: Page): Locator {
  return page.getByRole('log', { name: 'Chat messages' })
}

/** New chat → send the mixed message → the reply answers AND proposes, in ordinary text. */
export async function askMixedMessageAndSeeProposal(page: Page): Promise<void> {
  await startNewChatSession(page)
  await askChatQuestion(page, MIXED_MESSAGE)
  await expect(chatLog(page)).toContainText(PROPOSAL_LEAD_IN, { timeout: 150_000 })
  await waitForChatIdle(page)
  // nothing is stored by asking: no store tool card yet
  await expect(chatLog(page).getByText(STORE_TOOL_TITLE)).toHaveCount(0)
  assertChatLogHasNoRawJson(await chatLog(page).innerText())
}

/** "yes" in the next message → the store tool call shows in the chat. */
export async function confirmProposalAndSeeStoreCall(page: Page): Promise<void> {
  await askChatQuestion(page, 'yes')
  await expect(chatLog(page).getByText(STORE_TOOL_TITLE).first()).toBeVisible({
    timeout: 150_000,
  })
  await waitForChatIdle(page)
  assertChatLogHasNoRawJson(await chatLog(page).innerText())
}

/** The stored thought is a normal thought: it is listed in Yarn. */
export async function expectStoredThoughtInYarn(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto('/mesh/yarn')
        return page.getByText(/bouldering/i).count()
      },
      { timeout: 120_000, intervals: [3_000, 5_000, 10_000] },
    )
    .toBeGreaterThan(0)
}

/** Ignoring a proposal stores nothing, and a later "yes" cannot reach the old proposal (AC-4). */
export async function ignoreProposalThenLateYesStoresNothing(page: Page): Promise<void> {
  await askMixedMessageAndSeeProposal(page)

  await askChatQuestion(page, UNRELATED_QUESTION)
  await waitForChatIdle(page, 150_000)

  // the proposal is two user turns away now: the server guard refuses it whatever the model does
  await askChatQuestion(page, 'yes')
  await waitForChatIdle(page, 150_000)
  await expect(chatLog(page).getByText(STORE_TOOL_TITLE)).toHaveCount(0)

  await page.goto('/mesh/yarn')
  await expect(page.getByText(/bouldering/i)).toHaveCount(0)
}
