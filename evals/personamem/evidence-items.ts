import type { QuestionEvidence } from './plan'
import type { EvidenceHit } from './types'

/**
 * The stored items a question's evidence became. A history capture is queued as one thought,
 * which enrichment may split: Phase A fan-out creates children carrying `metadata.splitFrom`
 * (the capture's id), and a reference/mixed capture also leaves a note linked to a thought.
 * The items of a capture are the thought, its (transitive) children and their linked notes —
 * structural facts about what ingest wrote, no text is interpreted. Pure; the database reads
 * live in `evidence-items-db.ts`.
 */

export type FamilyThought = { id: string; splitFrom: string | null }
export type NoteLink = { thoughtId: string; textFileId: string }

/** `metadata.splitFrom` of a decrypted thought metadata object, or null when it has none. */
export function splitFromOf(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null || !('splitFrom' in metadata)) return null
  const value = (metadata as { splitFrom: unknown }).splitFrom
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `[personamem] thought metadata has a splitFrom that is not an id: ${JSON.stringify(value)}`,
    )
  }
  return value
}

/** For each capture thought id: itself, its split descendants and the notes linked to any of them. */
export function captureFamilies(
  rootIds: readonly string[],
  thoughts: readonly FamilyThought[],
  links: readonly NoteLink[],
): Map<string, Set<string>> {
  const known = new Set(thoughts.map((t) => t.id))
  const childrenOf = new Map<string, string[]>()
  for (const t of thoughts) {
    if (t.splitFrom === null) continue
    const list = childrenOf.get(t.splitFrom) ?? []
    list.push(t.id)
    childrenOf.set(t.splitFrom, list)
  }
  const notesOf = new Map<string, string[]>()
  for (const link of links) {
    const list = notesOf.get(link.thoughtId) ?? []
    list.push(link.textFileId)
    notesOf.set(link.thoughtId, list)
  }

  const families = new Map<string, Set<string>>()
  for (const rootId of rootIds) {
    if (!known.has(rootId)) {
      throw new Error(`[personamem] capture thought ${rootId} is not in the tenant`)
    }
    const family = new Set<string>()
    const queue = [rootId]
    while (queue.length > 0) {
      const id = queue.pop()!
      if (family.has(id)) continue
      family.add(id)
      queue.push(...(childrenOf.get(id) ?? []))
      for (const noteId of notesOf.get(id) ?? []) family.add(noteId)
    }
    families.set(rootId, family)
  }
  return families
}

/** The ids (thoughts and notes) that are evidence of a question: the families of its captures. */
export function evidenceItemIds(
  thoughtIds: readonly string[],
  captureIndexes: readonly number[],
  families: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const ids = new Set<string>()
  for (const index of captureIndexes) {
    const thoughtId = thoughtIds[index]
    const family = thoughtId === undefined ? undefined : families.get(thoughtId)
    if (family === undefined) {
      throw new Error(`[personamem] capture ${index} has no thought in the ingest record`)
    }
    for (const id of family) ids.add(id)
  }
  return ids
}

/**
 * The evidence field of a question's eigen answer row: did the chooser context hold any item
 * the question's evidence captures became. undefined for --evidence-only runs (no alignment).
 */
export function evidenceHitFor(
  evidence: QuestionEvidence,
  thoughtIds: readonly string[],
  families: ReadonlyMap<string, ReadonlySet<string>>,
  context: readonly { id: string }[],
): EvidenceHit | undefined {
  if (evidence.kind === 'evidence-only') return undefined
  if (evidence.kind === 'not-in-history') return { inHistory: false }
  const ids = evidenceItemIds(thoughtIds, evidence.captureIndexes, families)
  return { inHistory: true, items: ids.size, hit: context.some((item) => ids.has(item.id)) }
}
