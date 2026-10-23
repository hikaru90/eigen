import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { pickAskSuggestions, type AskSuggestion } from '$lib/chat/ask-suggestions'
import { readAskQuestion } from '$lib/server/capture/ask-question-store'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { activeThoughtLifecycleCondition } from '$lib/server/memory/thought-lifecycle-filter'

/** Read a few extra rows so duplicate questions still leave three to show. */
const SUGGESTION_SOURCE_LIMIT = 12

/**
 * Ask page load: the newest stored enrichment questions for this user (tenant-scoped by
 * user_id + RLS). Archived/completed thoughts are excluded; deleted thoughts are gone.
 * Never returns thought text — no question stored means no suggestion.
 */
export async function loadAskSuggestions(userId: string): Promise<AskSuggestion[]> {
  const rows = await getDb()
    .select({
      id: thought.id,
      askQuestion: thought.askQuestion,
      askQuestionEncrypted: thought.askQuestionEncrypted,
    })
    .from(thought)
    .where(
      and(eq(thought.userId, userId), isNotNull(thought.askQuestion), activeThoughtLifecycleCondition()),
    )
    .orderBy(desc(thought.createdAt), desc(thought.id))
    .limit(SUGGESTION_SOURCE_LIMIT)
  const decrypted = await Promise.all(
    rows.map(async (row) => ({ thoughtId: row.id, question: await readAskQuestion(userId, row) })),
  )
  return pickAskSuggestions(decrypted)
}
