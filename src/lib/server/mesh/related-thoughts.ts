import { sql } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { rowsFromDbExecute } from '$lib/server/db/execute-rows'

/**
 * The thoughts nearest to each thought on a list, computed from the stored
 * embeddings inside Postgres — no embedding call, no per-row request. One
 * query for the whole list: for every source thought, a LATERAL top-N over the
 * tenant's other thoughts by cosine distance (`<=>`), cut at a similarity
 * floor so "has related thoughts" means something. Tenant-scoped on both
 * sides (`user_id`, plus RLS). Embeddings are compared in SQL and never
 * selected (they are DB-only).
 */

/** At most this many related thoughts per thought (ei app.js:1326 echoes). */
export const RELATED_LIMIT = 3

/**
 * Minimum cosine similarity (1 − `<=>` distance) for a neighbour to count as
 * related. The 1536-d embeddings put unrelated thoughts well under 0.4 and
 * same-subject thoughts above 0.6; 0.55 keeps only the clear matches so a
 * missing pill is honest rather than a weak guess. Tune here, nowhere else.
 */
export const RELATED_MIN_SIMILARITY = 0.55

export type RelatedThought = {
  id: string
  text: string
  createdAtIso: string
}

type NeighbourRow = {
  source_id: string
  id: string
  normalized_text: string
  normalized_text_encrypted: string | null
  created_at: Date | string
}

/** Related thoughts per source id (ids without any are absent from the map). */
export async function loadRelatedThoughts(
  userId: string,
  thoughtIds: readonly string[],
): Promise<Map<string, RelatedThought[]>> {
  const related = new Map<string, RelatedThought[]>()
  if (thoughtIds.length === 0) return related

  const maxDistance = 1 - RELATED_MIN_SIMILARITY
  const ids = sql.join(
    thoughtIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )
  const result = await getDb().execute(sql`
    SELECT s.id AS source_id, n.id, n.normalized_text, n.normalized_text_encrypted, n.created_at
    FROM thought s
    CROSS JOIN LATERAL (
      SELECT t.id, t.normalized_text, t.normalized_text_encrypted, t.created_at
      FROM thought t
      WHERE t.user_id = ${userId}
        AND t.id <> s.id
        AND t.embedding IS NOT NULL
        AND t.lifecycle_status IN ('open', 'completed')
        AND (t.embedding <=> s.embedding) <= ${maxDistance}
      ORDER BY t.embedding <=> s.embedding
      LIMIT ${RELATED_LIMIT}
    ) n
    WHERE s.user_id = ${userId}
      AND s.id IN (${ids})
      AND s.embedding IS NOT NULL
  `)

  const rows = rowsFromDbExecute<NeighbourRow>(result)
  // decrypt in parallel, group in query order (closest first per source)
  const entries = await Promise.all(
    rows.map(async (row) => {
      const text = row.normalized_text_encrypted
        ? await decryptTenantValue({
            userId,
            table: 'thought',
            column: 'normalized_text',
            ciphertext: row.normalized_text_encrypted,
          })
        : row.normalized_text
      return {
        sourceId: row.source_id,
        entry: { id: row.id, text, createdAtIso: new Date(row.created_at).toISOString() },
      }
    }),
  )
  for (const { sourceId, entry } of entries) {
    related.set(sourceId, [...(related.get(sourceId) ?? []), entry satisfies RelatedThought])
  }
  return related
}
