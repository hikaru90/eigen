import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  entityResolutionLog,
  temporalEvent,
  thought,
  thoughtEntity,
  thoughtRelation,
} from '$lib/server/db/schema'
import { listTextFilesForThought } from '$lib/server/text-files/service'

const RELATION_PREVIEW_LEN = 120

async function decryptNormalizedText(
  userId: string,
  row: { normalizedText: string; normalizedTextEncrypted?: string | null },
): Promise<string> {
  if (row.normalizedTextEncrypted) {
    return decryptTenantValue({
      userId,
      table: 'thought',
      column: 'normalized_text',
      ciphertext: row.normalizedTextEncrypted,
    })
  }
  return row.normalizedText
}

async function decryptThoughtMetadata(
  userId: string,
  row: { metadata: Record<string, unknown>; metadataEncrypted?: string | null },
): Promise<Record<string, unknown>> {
  if (row.metadataEncrypted) {
    const json = await decryptTenantValue({
      userId,
      table: 'thought',
      column: 'metadata',
      ciphertext: row.metadataEncrypted,
    })
    return JSON.parse(json) as Record<string, unknown>
  }
  return row.metadata ?? {}
}

export async function loadThoughtCaptureResult(
  userId: string,
  thoughtId: string,
): Promise<CaptureSubmitResult> {
  const [row] = await getDb()
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      category: thought.category,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      memoryType: thought.memoryType,
      cues: thought.cues,
      enrichedAt: thought.enrichedAt,
      enrichQueueStatus: thought.enrichQueueStatus,
      enrichQueueError: thought.enrichQueueError,
      author: thought.author,
      authorLabel: thought.authorLabel,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)

  if (!row) {
    throw new Error(`loadThoughtCaptureResult: thought not found (${thoughtId})`)
  }

  const [
    normalizedText,
    metadata,
    entityRows,
    temporalRows,
    relationRows,
    projectRows,
    nextActionRows,
    attachedFiles,
  ] = await Promise.all([
    decryptNormalizedText(userId, row),
    decryptThoughtMetadata(userId, row),
    getDb()
      .select({
        entityId: canonicalEntity.id,
        label: canonicalEntity.label,
        entityType: canonicalEntity.entityType,
        mentionSurface: entityResolutionLog.mentionSurface,
        decision: entityResolutionLog.decision,
      })
      .from(entityResolutionLog)
      .innerJoin(canonicalEntity, eq(entityResolutionLog.canonicalEntityId, canonicalEntity.id))
      .where(
        and(eq(entityResolutionLog.userId, userId), eq(entityResolutionLog.thoughtId, thoughtId)),
      ),
    getDb()
      .select({
        id: temporalEvent.id,
        kind: temporalEvent.kind,
        semanticSummary: temporalEvent.semanticSummary,
      })
      .from(temporalEvent)
      .where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.thoughtId, thoughtId))),
    getDb()
      .select({
        targetThoughtId: thoughtRelation.targetThoughtId,
        relationType: thoughtRelation.relationType,
      })
      .from(thoughtRelation)
      .where(
        and(eq(thoughtRelation.userId, userId), eq(thoughtRelation.sourceThoughtId, thoughtId)),
      ),
    getDb()
      .select({ label: canonicalEntity.label })
      .from(thoughtEntity)
      .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
      .where(
        and(
          eq(thoughtEntity.userId, userId),
          eq(thoughtEntity.thoughtId, thoughtId),
          isNotNull(canonicalEntity.projectStatus),
        ),
      )
      .limit(1),
    getDb()
      .select({ projectEntityId: canonicalEntity.id })
      .from(canonicalEntity)
      .where(
        and(
          eq(canonicalEntity.userId, userId),
          eq(canonicalEntity.nextActionThoughtId, thoughtId),
          isNotNull(canonicalEntity.projectStatus),
        ),
      )
      .limit(1),
    listTextFilesForThought(userId, thoughtId),
  ])

  const entities = entityRows
    .filter((entity) => entity.entityId)
    .map((entity) => ({
      entityId: entity.entityId!,
      label: entity.label,
      entityType: entity.entityType,
      mentionSurface: entity.mentionSurface,
      decision: entity.decision,
    }))

  const targetIds = relationRows.map((r) => r.targetThoughtId)
  const targetRows =
    targetIds.length > 0
      ? await getDb()
          .select({
            id: thought.id,
            normalizedText: thought.normalizedText,
            normalizedTextEncrypted: thought.normalizedTextEncrypted,
          })
          .from(thought)
          .where(and(eq(thought.userId, userId), inArray(thought.id, targetIds)))
      : []

  const previewById = new Map<string, string>()
  await Promise.all(
    targetRows.map(async (target) => {
      const text = await decryptNormalizedText(userId, target)
      previewById.set(target.id, text.slice(0, RELATION_PREVIEW_LEN))
    }),
  )

  const linkedThoughts = relationRows
    .map((rel) => ({
      thoughtId: rel.targetThoughtId,
      relationType: rel.relationType,
      preview: previewById.get(rel.targetThoughtId) ?? '',
    }))
    .filter((rel) => rel.preview.length > 0)

  return {
    id: row.id,
    normalizedText,
    category: row.category,
    metadata,
    memoryType: row.memoryType ?? null,
    cues: row.cues ?? [],
    enrichedAt: row.enrichedAt ? row.enrichedAt.toISOString() : null,
    entities,
    temporalEvents: temporalRows.map((t) => ({
      id: t.id,
      kind: t.kind,
      semanticSummary: t.semanticSummary,
    })),
    linkedThoughts,
    attachedFiles,
    enrichmentComplete: row.enrichedAt !== null,
    gtdProjectLabel: projectRows[0]?.label ?? null,
    gtdIsNextAction: nextActionRows.length > 0,
    queueStatus: row.enrichQueueStatus ?? null,
    queueError: row.enrichQueueError ?? null,
    author: row.author ?? 'user',
    authorLabel: row.authorLabel ?? null,
  }
}
