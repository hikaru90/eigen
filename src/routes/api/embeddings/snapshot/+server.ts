import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { getDb } from '$lib/server/db'
import {
  assertValidEmbeddingSnapshotRows,
  computeEmbeddingSnapshotRevision,
  embeddingSnapshotMetaFromRows,
  loadEmbeddingSnapshotRows,
} from '$lib/server/embeddings/embedding-snapshot'

export type EmbeddingSnapshotItem = {
  id: string
  kind: 'Thought' | 'Entity'
  label: string
  subtype: string
  embedding: number[]
  authorLayerKey?: string
  authorLayerKeys?: string[]
}

export type EmbeddingSnapshotResponse = {
  revision: string
  items: EmbeddingSnapshotItem[]
}

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const rows = await loadEmbeddingSnapshotRows(getDb(), user.id)

  try {
    assertValidEmbeddingSnapshotRows(rows)
  } catch (err) {
    error(500, err instanceof Error ? err.message : String(err))
  }

  const revision = computeEmbeddingSnapshotRevision(embeddingSnapshotMetaFromRows(rows))
  const items: EmbeddingSnapshotItem[] = rows.map(
    ({ id, kind, label, subtype, embedding, authorLayerKey, authorLayerKeys }) => ({
      id,
      kind,
      label,
      subtype,
      embedding,
      ...(authorLayerKey ? { authorLayerKey } : {}),
      ...(authorLayerKeys ? { authorLayerKeys } : {}),
    }),
  )

  return json({ revision, items } satisfies EmbeddingSnapshotResponse)
}
