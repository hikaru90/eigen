import { sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { rowsFromDbExecute } from '$lib/server/db/execute-rows'
import {
  authorLayerKeyFromThought,
  listAuthorLayersForUser,
  type AuthorLayerMeta,
} from '$lib/server/memory/authorship'

export type { AuthorLayerMeta }

export { authorLayerKeyFromThought, listAuthorLayersForUser }

type EntityLayerRow = {
  entity_id: string
  author: string
  author_key_id: string | null
  author_label: string | null
}

type CoMentionLayerRow = {
  source_id: string
  target_id: string
  author: string
  author_key_id: string | null
  author_label: string | null
}

function layerKeyFromRow(row: {
  author: string
  author_key_id: string | null
  author_label: string | null
}): string {
  return authorLayerKeyFromThought({
    author: row.author === 'agent' ? 'agent' : 'user',
    authorKeyId: row.author_key_id,
    authorLabel: row.author_label,
  })
}

function addToIndex(index: Map<string, Set<string>>, id: string, layerKey: string): void {
  let set = index.get(id)
  if (!set) {
    set = new Set()
    index.set(id, set)
  }
  set.add(layerKey)
}

/** Entity id → author layer keys that mentioned it via entity_resolution_log. */
export async function buildEntityAuthorLayerIndex(
  userId: string,
): Promise<Map<string, Set<string>>> {
  const result = await getDb().execute(sql`
		SELECT DISTINCT
			erl.canonical_entity_id::text AS entity_id,
			t.author,
			t.author_key_id::text AS author_key_id,
			t.author_label
		FROM entity_resolution_log erl
		INNER JOIN thought t
			ON t.id = erl.thought_id
			AND t.user_id = erl.user_id
		WHERE
			erl.user_id = ${userId}
			AND erl.canonical_entity_id IS NOT NULL
	`)

  const index = new Map<string, Set<string>>()
  const rows = rowsFromDbExecute<EntityLayerRow>(result)
  for (const row of rows) {
    if (!row.entity_id) continue
    addToIndex(index, row.entity_id, layerKeyFromRow(row))
  }
  return index
}

/** Co-mention edge key "sourceId:targetId" → author layer keys from contributing thoughts. */
export async function buildCoMentionEdgeLayerIndex(
  userId: string,
): Promise<Map<string, Set<string>>> {
  const result = await getDb().execute(sql`
		SELECT DISTINCT
			LEAST(e1.canonical_entity_id::text, e2.canonical_entity_id::text) AS source_id,
			GREATEST(e1.canonical_entity_id::text, e2.canonical_entity_id::text) AS target_id,
			t.author,
			t.author_key_id::text AS author_key_id,
			t.author_label
		FROM entity_resolution_log e1
		INNER JOIN entity_resolution_log e2
			ON e2.user_id = e1.user_id
			AND e2.thought_id = e1.thought_id
			AND e1.canonical_entity_id < e2.canonical_entity_id
		INNER JOIN thought t
			ON t.id = e1.thought_id
			AND t.user_id = e1.user_id
		WHERE
			e1.user_id = ${userId}
			AND e1.canonical_entity_id IS NOT NULL
			AND e2.canonical_entity_id IS NOT NULL
	`)

  const index = new Map<string, Set<string>>()
  const rows = rowsFromDbExecute<CoMentionLayerRow>(result)
  for (const row of rows) {
    if (!row.source_id || !row.target_id) continue
    const edgeKey = `${row.source_id}:${row.target_id}`
    addToIndex(index, edgeKey, layerKeyFromRow(row))
  }
  return index
}

export function serializeAuthorLayerIndex(
  index: Map<string, Set<string>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [id, layers] of index) {
    out[id] = [...layers].sort()
  }
  return out
}

export async function loadAuthorLayerGraphData(userId: string): Promise<{
  authorLayers: AuthorLayerMeta[]
  entityAuthorLayerKeys: Record<string, string[]>
  coMentionEdgeLayerKeys: Record<string, string[]>
}> {
  const [authorLayers, entityIndex, coMentionIndex] = await Promise.all([
    listAuthorLayersForUser(userId),
    buildEntityAuthorLayerIndex(userId),
    buildCoMentionEdgeLayerIndex(userId),
  ])
  return {
    authorLayers,
    entityAuthorLayerKeys: serializeAuthorLayerIndex(entityIndex),
    coMentionEdgeLayerKeys: serializeAuthorLayerIndex(coMentionIndex),
  }
}
