import {
  upsertEntityNode,
  upsertEntityRelationEdge,
  upsertMentionEdge,
  upsertThoughtNode,
} from '$lib/server/graph/age'
import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { canonicalEntity, thought } from '$lib/server/db/schema'
import {
  extractEntityGraphBundle,
  extractEntityTriples,
  type ExtractedEntityMention,
  type ExtractedEntityTriple,
} from '$lib/server/memory/entity-extraction'
import {
  resolveOrCreateCanonicalEntity,
  clearEntityResolutionLogsForThought,
} from '$lib/server/memory/entity-resolution'
import { createThoughtEmbeddings } from '$lib/server/llm/embedding'
import { loadEntityHintsForThought } from '$lib/server/memory/entity-graph-hints'
import { loadEligibleGtdProjects } from '$lib/server/memory/project-list'
import {
  filterAcceptedEntityTriples,
  resolveTripleEndpointEntityId,
} from '$lib/server/memory/entity-extraction'
import {
  graphEntityIdByLabel,
  loadEntityGraphEnrichmentContext,
  type EntityGraphEnrichmentContext,
} from '$lib/server/memory/entity-graph-enrichment-context'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'
import { evaluateHubsForGtdPromotion } from '$lib/server/memory/promote-eligible-project-hubs'
import { resolveProjectIdentity } from '$lib/server/memory/resolve-project-identity'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import {
  graphAuthorProperty,
  type MemoryAuthorship,
} from '$lib/server/memory/authorship'

function logStep(thoughtId: string, name: string, start: number): void {
  console.info(`[entity-graph-sync] ${name} done`, { thoughtId, ms: Date.now() - start })
}

/**
 * Graphiti-style ingest: entity mentions → relation triples → canonical resolution → AGE graph.
 * Entity `entityType` values are **entity_type** ontology kind keys (person, place, org, etc.)
 * — a separate taxonomy from thought categories.
 * Invoked after thought-to-thought relation sync.
 */
export async function syncEntityGraphFromThought(input: {
  userId: string
  thoughtId: string
  normalizedText: string
  /** Hints computed before persist (lexical + text-derived). */
  preloadedKnownEntities?: Array<{ entityId?: string; label: string; entityType: string }>
  /** Semantic graph context for entity extraction (tier 2). */
  precomputedEntityEnrichmentContext?: EntityGraphEnrichmentContext
  /** Thought embedding for building enrichment context when not precomputed. */
  thoughtEmbedding?: number[]
  /** Community + grounding bundle when building enrichment context inline. */
  enrichmentContextBundle?: {
    communityExcerpts: EntityGraphEnrichmentContext['communityExcerpts']
    groundingProfile: EntityGraphEnrichmentContext['groundingProfile']
  }
  /** Pre-fetched LLM extraction (batch ingest). Skips extractEntityGraphBundle when set. */
  precomputedEntityGraph?: { mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] }
}): Promise<{
  mentionCount: number
  projectLikeEntities: Array<{ entityId: string; label: string }>
}> {
  await ensureUserOntologySeeded(getDb(), input.userId)
  const loaded = await loadOntologyForUser(getDb(), input.userId)

  const [thoughtAuthorshipRow] = await getDb()
    .select({
      author: thought.author,
      authorLabel: thought.authorLabel,
      authorKeyId: thought.authorKeyId,
    })
    .from(thought)
    .where(and(eq(thought.userId, input.userId), eq(thought.id, input.thoughtId)))
    .limit(1)
  const thoughtAuthorship: MemoryAuthorship = {
    author: thoughtAuthorshipRow?.author ?? 'user',
    authorLabel: thoughtAuthorshipRow?.authorLabel ?? null,
    authorKeyId: thoughtAuthorshipRow?.authorKeyId ?? null,
  }

  // Use entity_type kinds — the real-world entity taxonomy, not the thought category taxonomy
  const ontologyEntityKinds = loaded.entityKinds
    .filter((k) => k.active && k.kindType === 'entity_type')
    .map((k) => ({ key: k.key, name: k.name, definition: k.definition }))

  if (ontologyEntityKinds.length === 0) {
    throw new Error('Entity graph sync requires at least one active entity_type kind')
  }

  let knownEntities: Array<{ entityId?: string; label: string; entityType: string }> = []
  try {
    // When enrichment context already loaded hints, do not hit the DB again.
    const graphHints =
      input.preloadedKnownEntities !== undefined
        ? []
        : await loadEntityHintsForThought({
            userId: input.userId,
            thoughtId: input.thoughtId,
            normalizedText: input.normalizedText,
          })
    const byLabel = new Map<string, { entityId?: string; label: string; entityType: string }>()
    for (const hint of [...(input.preloadedKnownEntities ?? []), ...graphHints]) {
      const key = hint.label.trim().toLowerCase()
      if (!key || byLabel.has(key)) continue
      byLabel.set(key, hint)
    }
    try {
      const projectEntities = await loadEligibleGtdProjects(input.userId)
      for (const project of projectEntities) {
        const key = project.label.trim().toLowerCase()
        if (!key || byLabel.has(key)) continue
        byLabel.set(key, { label: project.label, entityType: 'project' })
      }
    } catch (err) {
      console.warn('[entity-graph-sync] project known-entity prefetch failed', {
        thoughtId: input.thoughtId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
    knownEntities = [...byLabel.values()].sort((a, b) => {
      if (a.entityType === 'project' && b.entityType !== 'project') return -1
      if (b.entityType === 'project' && a.entityType !== 'project') return 1
      return a.label.localeCompare(b.label)
    })
  } catch (err) {
    console.warn('[entity-graph-sync] graph known-entity hints failed, proceeding without hints', {
      thoughtId: input.thoughtId,
      message: err instanceof Error ? err.message : String(err),
    })
  }

  await clearEntityResolutionLogsForThought({
    userId: input.userId,
    thoughtId: input.thoughtId,
  })

  const entityEnrichmentContext =
    input.precomputedEntityEnrichmentContext ??
    (input.enrichmentContextBundle
      ? await loadEntityGraphEnrichmentContext({
          userId: input.userId,
          normalizedText: input.normalizedText,
          thoughtEmbedding: input.thoughtEmbedding,
          communityExcerpts: input.enrichmentContextBundle.communityExcerpts,
          groundingProfile: input.enrichmentContextBundle.groundingProfile,
        })
      : undefined)

  const { mentions, triples } = input.precomputedEntityGraph
    ? input.precomputedEntityGraph
    : await extractEntityGraphBundle({
        userId: input.userId,
        normalizedText: input.normalizedText,
        ontologyEntityKinds,
        knownEntities: knownEntities.length > 0 ? knownEntities : undefined,
        enrichmentContext: entityEnrichmentContext,
      })

  if (mentions.length === 0) {
    console.warn('[entity-graph-sync] zero entity mentions extracted', {
      thoughtId: input.thoughtId,
      textLen: input.normalizedText.trim().length,
    })
    return { mentionCount: 0, projectLikeEntities: [] }
  }

  const [anchorRow] = await getDb()
    .select({ category: thought.category })
    .from(thought)
    .where(and(eq(thought.id, input.thoughtId), eq(thought.userId, input.userId)))
    .limit(1)
  if (!anchorRow) {
    throw new Error(`Entity graph sync: thought not found (${input.thoughtId})`)
  }
  // MENTIONS edges MATCH the Thought node — always (re-)ensure the anchor. The upsert is an
  // idempotent MERGE; this also heals tier-1 anchor failures (queue-capture treats its AGE
  // upsert as best-effort) and graph grant repairs.
  const anchorStart = Date.now()
  await upsertThoughtNode({
    id: input.thoughtId,
    userId: input.userId,
    category: anchorRow.category,
    author: graphAuthorProperty(thoughtAuthorship),
  })
  logStep(input.thoughtId, 'anchor_upsert', anchorStart)

  const surfaceToEntityId = new Map<string, string>()
  const coMentionEntityIds: string[] = []
  const projectLikeEntities: Array<{ entityId: string; label: string }> = []

  const uniqueSurfaces = [...new Set(mentions.map((m) => m.surface.trim()).filter(Boolean))]
  const surfaceEmbStart = Date.now()
  const prefetchedEmbeddings =
    uniqueSurfaces.length > 0 ? await createThoughtEmbeddings(input.userId, uniqueSurfaces) : []
  logStep(input.thoughtId, 'surface_embeddings', surfaceEmbStart)
  const embeddingBySurface = new Map(
    uniqueSurfaces.map((surface, index) => [surface, prefetchedEmbeddings[index]!]),
  )

  for (const mention of mentions) {
    const surfaceKey = mention.surface.trim()
    let entityId: string
    let canonicalKey: string
    let entityTypeForNode = mention.entityType
    const mentionStart = Date.now()

    if (mention.entityType === 'project') {
      const identity = await resolveProjectIdentity({
        userId: input.userId,
        surfaceLabel: mention.surface,
        thoughtId: input.thoughtId,
        mode: 'promote',
      })
      entityId = identity.entityId
      const [entityRow] = await getDb()
        .select({
          canonicalKey: canonicalEntity.canonicalKey,
          entityType: canonicalEntity.entityType,
          label: canonicalEntity.label,
        })
        .from(canonicalEntity)
        .where(and(eq(canonicalEntity.userId, input.userId), eq(canonicalEntity.id, entityId)))
        .limit(1)
      canonicalKey = entityRow?.canonicalKey ?? computeLexicalText(identity.canonicalLabel)
      entityTypeForNode = entityRow?.entityType ?? identity.hubEntityType
      projectLikeEntities.push({
        entityId,
        label: entityRow?.label ?? identity.canonicalLabel,
      })
    } else {
      const resolved = await resolveOrCreateCanonicalEntity({
        userId: input.userId,
        thoughtId: input.thoughtId,
        surface: mention.surface,
        entityType: mention.entityType,
        confidence: mention.confidence,
        coMentionEntityIds: [...coMentionEntityIds],
        precomputedEmbedding: embeddingBySurface.get(surfaceKey),
        authorship: thoughtAuthorship,
      })
      entityId = resolved.entityId
      canonicalKey = resolved.canonicalKey
    }

    surfaceToEntityId.set(mention.surface.trim(), entityId)
    coMentionEntityIds.push(entityId)

    const nodeStart = Date.now()
    await upsertEntityNode({
      id: entityId,
      userId: input.userId,
      canonicalKey,
      label: mention.surface.trim(),
      entityType: entityTypeForNode,
    })
    logStep(input.thoughtId, `upsert_entity_node(${mention.surface.trim()})`, nodeStart)

    const edgeStart = Date.now()
    await upsertMentionEdge({
      userId: input.userId,
      thoughtId: input.thoughtId,
      entityId,
    })
    logStep(input.thoughtId, `upsert_mention_edge(${mention.surface.trim()})`, edgeStart)
    logStep(input.thoughtId, `mention_loop(${mention.surface.trim()})`, mentionStart)
  }

  const linkedEntityIds = [...new Set(surfaceToEntityId.values())]
  const evalStart = Date.now()
  await evaluateHubsForGtdPromotion(input.userId, linkedEntityIds)
  logStep(input.thoughtId, 'evaluate_hubs_for_gtd_promotion', evalStart)

  const triplesStart = Date.now()
  await upsertEntityRelationTriples({
    userId: input.userId,
    normalizedText: input.normalizedText,
    mentions,
    surfaceToEntityId,
    triples,
    graphEntityIdByLabel: entityEnrichmentContext
      ? graphEntityIdByLabel(entityEnrichmentContext.graphEntities)
      : undefined,
  })
  logStep(input.thoughtId, 'upsert_entity_relation_triples', triplesStart)

  return { mentionCount: mentions.length, projectLikeEntities }
}

/** Writes ENTITY_RELATES edges for extracted triples. Returns count of edges upserted. */
export async function upsertEntityRelationTriples(input: {
  userId: string
  normalizedText: string
  mentions: ExtractedEntityMention[]
  surfaceToEntityId: Map<string, string>
  triples?: ExtractedEntityTriple[]
  graphEntityIdByLabel?: Map<string, string>
}): Promise<number> {
  const rawTriples =
    input.triples ??
    (await extractEntityTriples({
      userId: input.userId,
      normalizedText: input.normalizedText,
      mentions: input.mentions,
    }))
  const triples = filterAcceptedEntityTriples({
    triples: rawTriples,
    normalizedText: input.normalizedText,
  })

  const graphIds = input.graphEntityIdByLabel ?? new Map<string, string>()

  let written = 0
  for (const triple of triples) {
    const sourceId = resolveTripleEndpointEntityId(
      triple.subject,
      input.surfaceToEntityId,
      graphIds,
    )
    const targetId = resolveTripleEndpointEntityId(triple.object, input.surfaceToEntityId, graphIds)
    if (!sourceId || !targetId || sourceId === targetId) continue

    await upsertEntityRelationEdge({
      userId: input.userId,
      sourceEntityId: sourceId,
      targetEntityId: targetId,
      predicate: triple.predicate,
    })
    written++
  }
  return written
}
