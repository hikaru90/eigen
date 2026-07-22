import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getDb } from '$lib/server/db'
import {
  computeEmbeddingSnapshotRevision,
  embeddingSnapshotMetaFromRows,
  loadEmbeddingSnapshotRows,
} from '$lib/server/embeddings/embedding-snapshot'

export type EmbeddingRevisionResponse = {
  revision: string
}

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const rows = await loadEmbeddingSnapshotRows(getDb(), user.id)
  const revision = computeEmbeddingSnapshotRevision(embeddingSnapshotMetaFromRows(rows))

  return json({ revision } satisfies EmbeddingRevisionResponse)
}
