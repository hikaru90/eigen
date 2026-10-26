import type { IngestStore } from '../public-bench/ingest-tenant'
import type { FamilyThought } from './evidence-items'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { withEvalDb } from '../harness/eval-context'
import { loadTenantStructure } from './evidence-items-db'

/** For each capture thought: itself first, then its transitive split children (thoughts only, no notes). */
export function familyThoughtIds(
  rootIds: readonly string[],
  thoughts: readonly FamilyThought[],
): Map<string, string[]> {
  const known = new Set(thoughts.map((t) => t.id))
  const childrenOf = new Map<string, string[]>()
  for (const t of thoughts) {
    if (t.splitFrom === null) continue
    const list = childrenOf.get(t.splitFrom) ?? []
    list.push(t.id)
    childrenOf.set(t.splitFrom, list)
  }
  const families = new Map<string, string[]>()
  for (const rootId of rootIds) {
    if (!known.has(rootId)) {
      throw new Error(`[personamem] capture thought ${rootId} is not in the tenant`)
    }
    const family: string[] = []
    const queue = [rootId]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (family.includes(id)) continue
      family.push(id)
      queue.push(...(childrenOf.get(id) ?? []))
    }
    families.set(rootId, family)
  }
  return families
}

/** Thoughts that are not split children: what the ingest progress file calls captures. */
export const rootThoughtCount = (thoughts: readonly FamilyThought[]): number =>
  thoughts.filter((t) => t.splitFrom === null).length

/** The database side of a durable PersonaMem ingest. Live path only. */
export function createIngestStore(billing: {
  billingUserId: string
  chatModel: string
}): IngestStore {
  return {
    async resetTenant(tenantUserId) {
      const { deleteEvalUserRow, insertEvalUserRow } = await import('$lib/eval/store')
      await deleteEvalUserRow(tenantUserId)
      await insertEvalUserRow(tenantUserId, `Public bench tenant ${tenantUserId}`)
    },
    async ensureTenant(tenantUserId) {
      const { insertEvalUserRow } = await import('$lib/eval/store')
      await insertEvalUserRow(tenantUserId, `Public bench tenant ${tenantUserId}`)
    },
    async thoughtCount(tenantUserId) {
      return (await loadTenantStructure(tenantUserId, billing)).thoughts.length
    },
    async rootCount(tenantUserId) {
      return rootThoughtCount((await loadTenantStructure(tenantUserId, billing)).thoughts)
    },
    async families(tenantUserId, rootIds) {
      const { thoughts } = await loadTenantStructure(tenantUserId, billing)
      return familyThoughtIds(rootIds, thoughts)
    },
    async verifyRecorded(tenantUserId, families) {
      const { thoughts } = await loadTenantStructure(tenantUserId, billing)
      const present = new Set(thoughts.map((t) => t.id))
      const missing = [...families.values()].flat().filter((id) => !present.has(id))
      const roots = [...families.values()]
        .map((family) => family[0]!)
        .filter((id) => present.has(id))
      const { thought } = await import('$lib/server/db/schema')
      const enriched = await withEvalDb(
        tenantUserId,
        (db) =>
          db
            .select({ id: thought.id })
            .from(thought)
            .where(
              and(
                eq(thought.userId, tenantUserId),
                inArray(thought.id, roots),
                isNotNull(thought.enrichedAt),
              ),
            ),
        billing,
      )
      const enrichedIds = new Set(enriched.map((r) => r.id))
      return { missing, unenriched: roots.filter((id) => !enrichedIds.has(id)) }
    },
  }
}
