import { createHash } from 'node:crypto'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { getDb } from '$lib/server/db'
import { thought, canonicalEntity } from '$lib/server/db/schema'
import { buildEntityAuthorLayerIndex } from '$lib/server/graph/author-layers'
import { authorLayerKeyFromThought } from '$lib/server/memory/authorship'

/** Maximum items (thoughts + entities) returned per snapshot request. */
export const EMBEDDING_SNAPSHOT_ITEM_CAP = 800

export type EmbeddingSnapshotMeta = {
  id: string
  kind: 'Thought' | 'Entity'
  updatedAt: Date
}

export type EmbeddingSnapshotRow = {
  id: string
  kind: 'Thought' | 'Entity'
  label: string
  subtype: string
  embedding: number[]
  updatedAt: Date
  authorLayerKey?: string
  authorLayerKeys?: string[]
}

export function computeEmbeddingSnapshotRevision(entries: EmbeddingSnapshotMeta[]): string {
  const sorted = [...entries].sort((a, b) => {
    const kindOrder = a.kind.localeCompare(b.kind)
    if (kindOrder !== 0) return kindOrder
    return a.id.localeCompare(b.id)
  })
  const payload = sorted
    .map((entry) => `${entry.kind}:${entry.id}:${entry.updatedAt.toISOString()}`)
    .join('\n')
  return createHash('sha256').update(payload).digest('hex')
}

type Db = ReturnType<typeof getDb>

export async function loadEmbeddingSnapshotRows(
  db: Db,
  userId: string,
): Promise<EmbeddingSnapshotRow[]> {
  const entityLayerIndex = await buildEntityAuthorLayerIndex(userId)

  const thoughts = await db
    .select({
      id: thought.id,
      rawText: thought.rawText,
      category: thought.category,
      author: thought.author,
      authorLabel: thought.authorLabel,
      authorKeyId: thought.authorKeyId,
      embedding: thought.embedding,
      updatedAt: thought.updatedAt,
    })
    .from(thought)
    .where(and(eq(thought.userId, userId), isNotNull(thought.embedding)))
    .orderBy(thought.createdAt)
    .limit(EMBEDDING_SNAPSHOT_ITEM_CAP)

  const thoughtRows: EmbeddingSnapshotRow[] = thoughts.map((t) => ({
    id: t.id,
    kind: 'Thought' as const,
    label: t.rawText.slice(0, 120),
    subtype: t.category,
    embedding: t.embedding as unknown as number[],
    updatedAt: t.updatedAt,
    authorLayerKey: authorLayerKeyFromThought({
      author: t.author,
      authorKeyId: t.authorKeyId,
      authorLabel: t.authorLabel,
    }),
  }))

  const remaining = EMBEDDING_SNAPSHOT_ITEM_CAP - thoughtRows.length

  const entities =
    remaining > 0
      ? await db
          .select({
            id: canonicalEntity.id,
            label: canonicalEntity.label,
            entityType: canonicalEntity.entityType,
            embedding: canonicalEntity.embedding,
            updatedAt: canonicalEntity.updatedAt,
          })
          .from(canonicalEntity)
          .where(and(eq(canonicalEntity.userId, userId), isNotNull(canonicalEntity.embedding)))
          .orderBy(canonicalEntity.createdAt)
          .limit(remaining)
      : []

  const entityRows: EmbeddingSnapshotRow[] = entities.map((e) => ({
    id: e.id,
    kind: 'Entity' as const,
    label: e.label,
    subtype: e.entityType,
    embedding: e.embedding as unknown as number[],
    updatedAt: e.updatedAt,
    authorLayerKeys: [...(entityLayerIndex.get(e.id) ?? new Set(['user']))].sort(),
  }))

  return [...thoughtRows, ...entityRows]
}

export function embeddingSnapshotMetaFromRows(
  rows: EmbeddingSnapshotRow[],
): EmbeddingSnapshotMeta[] {
  return rows.map(({ id, kind, updatedAt }) => ({ id, kind, updatedAt }))
}

export function assertValidEmbeddingSnapshotRows(rows: EmbeddingSnapshotRow[]): void {
  for (const row of rows) {
    if (!Array.isArray(row.embedding) || row.embedding.length !== 1536) {
      throw new Error(
        `Item ${row.id} has an invalid embedding (length=${Array.isArray(row.embedding) ? row.embedding.length : typeof row.embedding}). This is a data integrity error.`,
      )
    }
  }
}
