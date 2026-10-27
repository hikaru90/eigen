/**
 * Re-derive the facts of a thought whose text was edited (docs/planning/user-facts-layer.md,
 * "Edit / forget integration"): the thought stops being a source of what it said before, the facts
 * only it carried are retired, and the facts of the edited text are extracted and reconciled like
 * a fresh capture. Facts that other captures or notes still carry stay.
 *
 * A thought that is a kept forget instruction or is archived is not a fact source: its facts are
 * released and none are derived.
 */

import { and, eq } from 'drizzle-orm'
import { readCaptureIntent } from '$lib/server/capture/capture-intent'
import { readCaptureSplitState } from '$lib/server/capture/content-role'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { redactedText } from '$lib/server/security/detect-secrets'
import { deriveUserFactsForThought } from './derive-user-facts'
import { NO_DERIVED_FACTS, type DerivedFactCounts } from './fact-operations'
import { releaseThoughtFacts } from './user-fact-lifecycle'

export async function rederiveUserFactsForThought(
  userId: string,
  thoughtId: string,
): Promise<DerivedFactCounts> {
  const [row] = await getDb()
    .select({
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      lifecycleStatus: thought.lifecycleStatus,
      createdAt: thought.createdAt,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  if (!row) throw new Error(`rederiveUserFactsForThought: thought ${thoughtId} not found`)

  const metadata: Record<string, unknown> = row.metadataEncrypted
    ? (JSON.parse(
        await decryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          ciphertext: row.metadataEncrypted,
        }),
      ) as Record<string, unknown>)
    : { ...((row.metadata as Record<string, unknown> | null) ?? {}) }

  if (readCaptureIntent(metadata) === 'forget' || row.lifecycleStatus === 'archived') {
    await releaseThoughtFacts(userId, thoughtId)
    return NO_DERIVED_FACTS
  }

  const normalizedText = row.normalizedTextEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: row.normalizedTextEncrypted,
      })
    : row.normalizedText

  // the reference note this capture saved is read for facts too; a span child is only its span
  const split = readCaptureSplitState(metadata)
  const attachedFileId =
    split.phase === 'applied'
      ? split.plan.attachedFileId
      : split.phase === 'legacy_applied'
        ? split.attachedFileId
        : null

  return deriveUserFactsForThought({
    userId,
    thoughtId,
    text: redactedText(normalizedText),
    attachedFileId,
    capturedAt: row.createdAt,
  })
}
