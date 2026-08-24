import type { EnrichmentContext } from '$lib/server/capture/enrichment-context'
import {
  formatCommunityContextBlock,
  formatKnownEntitiesBlock,
} from '$lib/server/capture/enrichment-context'
import {
  CUES_FROM_CAPTURE_RULE,
  capturePrimaryPromptBlock,
  groundingSupplementaryPromptBlock,
} from '$lib/server/capture/enrichment-prompt-sections'
/**
 * Single LLM call for tier-2 enrich prefetch: category, search cues, temporal, and entity graph.
 *
 * Single type axis: `category` (an active thought_category ontology kind) is the only type label
 * a thought has — there is no memoryType classification anymore. The allowed category set is
 * loaded from the DB before this call (via the enrichment context) and validation is
 * repair-before-fail via resolveCategoryFromLlmOutput, with exactly one strict forced-choice
 * retry when neither the primary key nor any alternative is valid.
 */
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import {
  graphEntityLabelsFromContext,
  parseEntityMentions,
  parseEntityTriples,
  type ExtractedEntityMention,
  type ExtractedEntityTriple,
  type OntologyEntityKindForExtraction,
} from '$lib/server/memory/entity-extraction'
import {
  formatCommunityExcerptsForEntityPrompt,
  formatKnownGraphEntitiesPromptBlock,
  type EntityGraphEnrichmentContext,
} from '$lib/server/memory/entity-graph-enrichment-context'
import {
  ENTITY_EXTRACTION_GRAPH_TRIPLE_GUIDANCE,
  ENTITY_EXTRACTION_OMIT_RULES,
  ENTITY_EXTRACTION_QUALITY_GUIDANCE,
  ENTITY_EXTRACTION_SURFACE_INTEGRITY_RULES,
  ENTITY_EXTRACTION_TYPE_GUIDANCE,
} from '$lib/server/memory/entity-mention-filter'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { parseSearchCues } from '$lib/server/memory/search-cues'
import {
  applyCaptureAnchoredMentions,
  parseTemporalMentions,
  type ExtractedTemporalMention,
} from '$lib/server/memory/temporal-normalize'
import { isGraphScaleQuiet } from '$lib/server/observability/graph-scale-quiet'
import { activeThoughtCategoryKinds } from '$lib/server/ontology-db/load-ontology'
import { ONTOLOGY_RECENT_THOUGHT_WINDOW } from '$lib/server/ontology/constants'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { ontologyKindsPromptBlock } from '$lib/server/ontology/types'
import {
  buildStrictCategoryRetryPrompt,
  isInvalidThoughtCategoryError,
  resolveCategoryFromLlmOutput,
  type ResolvedThoughtCategory,
} from '$lib/server/ontology/validate-thought-category'

export type EnrichThoughtBundleResult = {
  category: ResolvedThoughtCategory
  cues: string[]
  temporalMentions: ExtractedTemporalMention[]
  entityGraph: { mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] }
}

function buildSessionContextBlock(recentThoughts: EnrichmentContext['recentThoughts']): string {
  if (recentThoughts.length === 0) return ''
  const lines = recentThoughts.map((t, i) => `${i + 1}. [${t.category}] ${t.normalizedText}`)
  return `\nRecent captures (session context, most recent first):\n${lines.join('\n')}`
}

function buildCategoryDistributionBlock(categoryDistribution: Map<string, number>): string {
  if (categoryDistribution.size === 0) return ''
  const sorted = [...categoryDistribution.entries()].sort((a, b) => b[1] - a[1])
  const distLine = sorted.map(([k, n]) => `${k} x${n}`).join(', ')
  return `\nRecent category distribution (last ${ONTOLOGY_RECENT_THOUGHT_WINDOW}): ${distLine}`
}

function buildEnrichThoughtBundlePrompt(input: {
  context: EnrichmentContext
  capturedAt: Date
  timezone: string
  entityEnrichmentContext?: EntityGraphEnrichmentContext
  ontologyEntityKinds: OntologyEntityKindForExtraction[]
}): string {
  const { context, capturedAt, timezone, entityEnrichmentContext, ontologyEntityKinds } = input
  const activeCategoryKinds = activeThoughtCategoryKinds(context.ontology)
  const categoryKeys = [...new Set(activeCategoryKinds.map((k) => k.key))].sort()
  const entityKindKeys = new Set(ontologyEntityKinds.map((k) => k.key))
  const entityKeyUnion = [...entityKindKeys].sort().join('|')
  const entityCatalog = ontologyEntityKinds
    .map((k) => `- entityType must be exactly "${k.key}" (${k.name}): ${k.definition}`)
    .join('\n')

  const captureBlock = capturePrimaryPromptBlock({
    normalizedText: context.normalizedText,
    rawText: context.rawText,
  })
  const groundingBlock = groundingSupplementaryPromptBlock(context.groundingProfile)
  const ontologyBlock = ontologyKindsPromptBlock(activeCategoryKinds, context.profile)
  const communityBlock =
    entityEnrichmentContext != null
      ? formatCommunityExcerptsForEntityPrompt(entityEnrichmentContext.communityExcerpts)
      : formatCommunityContextBlock(context.communityExcerpts)
  const graphEntitiesBlock = formatKnownGraphEntitiesPromptBlock(
    entityEnrichmentContext?.graphEntities ?? [],
  )
  const knownEntitiesBlock = formatKnownEntitiesBlock(context.knownEntities)

  const capturedIso = capturedAt.toISOString()

  return [
    captureBlock,
    '',
    'Return ONLY JSON with this shape:',
    '{',
    '  "category": { "key": "<thought_category_key>", "confidence": 0.0-1.0, "alternatives": [{"key":"...","confidence":0.0}] },',
    '  "cues": ["2-8 word search phrase", "..."],',
    '  "temporalMentions": [],',
    '  "mentions": [{"surface":"<text as written>","entityType":"<key>","confidence":0.0-1.0}],',
    '  "triples": [{"subject":"<surface>","object":"<surface>","predicate":"related_to","confidence":0.0-1.0}]',
    '}',
    '',
    `category.key must be exactly one of: ${categoryKeys.join(', ')}.`,
    'alternatives: max 3 other plausible category keys with confidence.',
    '',
    CUES_FROM_CAPTURE_RULE,
    '',
    `temporalMentions: array of temporal objects for dates/deadlines in the capture; use [] when none.`,
    `Capture anchor: ${capturedIso}, timezone ${timezone}. Set timezone to "${timezone}" unless text names another.`,
    'Each temporal element: surface, kind (deadline|appointment|milestone|period|reminder|inferred_event), startAt (ISO-8601), timePrecision, timezone, isAllDay, confidence, semanticSummary; optional relativeSpec for relative phrases.',
    '',
    `mentions: 0–12 items; entityType must be one of: ${entityKeyUnion}.`,
    'Extract surfaces exactly as written. person is ONLY for human beings.',
    ...ENTITY_EXTRACTION_QUALITY_GUIDANCE,
    ...ENTITY_EXTRACTION_OMIT_RULES,
    ...ENTITY_EXTRACTION_SURFACE_INTEGRITY_RULES,
    ...ENTITY_EXTRACTION_TYPE_GUIDANCE,
    'Allowed triple predicates: related_to, depends_on, part_of, located_in, knows, works_at.',
    ...ENTITY_EXTRACTION_GRAPH_TRIPLE_GUIDANCE,
    '',
    groundingBlock,
    communityBlock,
    graphEntitiesBlock,
    knownEntitiesBlock,
    `Thought category kinds:\n${ontologyBlock}`,
    buildSessionContextBlock(context.recentThoughts),
    buildCategoryDistributionBlock(context.categoryDistribution),
    entityCatalog ? `\nEntity type catalog:\n${entityCatalog}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function parseEntityGraphFromBundle(
  obj: Record<string, unknown>,
  allowedEntityKindKeys: Set<string>,
  graphEntities: EntityGraphEnrichmentContext['graphEntities'],
): { mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] } {
  const mentionsRaw = Array.isArray(obj.mentions) ? obj.mentions : []
  const triplesRaw = Array.isArray(obj.triples) ? obj.triples : []
  const mentions = parseEntityMentions(JSON.stringify(mentionsRaw), allowedEntityKindKeys)
  const allowedMentionSurfaces = new Set(mentions.map((m) => m.surface))
  const allowedGraphLabels = graphEntityLabelsFromContext(graphEntities)
  const triples = parseEntityTriples(
    JSON.stringify(triplesRaw),
    allowedMentionSurfaces,
    allowedGraphLabels.size > 0 ? allowedGraphLabels : undefined,
  )
  return { mentions, triples }
}

function parseTemporalFromBundle(raw: unknown, capturedAt: Date): ExtractedTemporalMention[] {
  if (!Array.isArray(raw)) return []
  return applyCaptureAnchoredMentions(parseTemporalMentions(JSON.stringify(raw)), capturedAt)
}

function parseEnrichThoughtBundleContent(input: {
  content: string
  context: EnrichmentContext
  capturedAt: Date
  ontologyEntityKinds: OntologyEntityKindForExtraction[]
  entityEnrichmentContext?: EntityGraphEnrichmentContext
  /** Category already resolved by the strict forced-choice retry — skips re-validation. */
  forcedCategory?: ResolvedThoughtCategory
}): EnrichThoughtBundleResult {
  const parsed = JSON.parse(stripMarkdownJsonFences(input.content)) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('enrichThoughtBundle: output must be a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const allowedEntityKeys = new Set(input.ontologyEntityKinds.map((k) => k.key))

  return {
    category:
      input.forcedCategory ?? resolveCategoryFromLlmOutput(input.context.ontology, obj.category),
    cues: parseSearchCues(obj.cues),
    temporalMentions: parseTemporalFromBundle(obj.temporalMentions, input.capturedAt),
    entityGraph: parseEntityGraphFromBundle(
      obj,
      allowedEntityKeys,
      input.entityEnrichmentContext?.graphEntities ?? [],
    ),
  }
}

/**
 * Strict forced-choice retry for an out-of-set category: only the active keys, no catalog
 * descriptions (no priming). Runs at most once per bundle extraction.
 */
async function runStrictCategoryRetry(input: {
  context: EnrichmentContext
  allowedKeys: readonly string[]
}): Promise<ResolvedThoughtCategory> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You assign exactly one ontology thought category key per capture for a personal memory system. Output JSON only.',
    },
    {
      role: 'user',
      content: buildStrictCategoryRetryPrompt({
        normalizedText: input.context.normalizedText,
        allowedKeys: input.allowedKeys,
      }),
    },
  ]
  const response = await llmChatCompletion({
    userId: input.context.userId,
    messages,
    temperature: 0,
    logContext: 'enrich_thought_bundle_category_retry',
    responseFormat: 'json_object',
  })
  const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('enrichThoughtBundle category retry: output must be a JSON object')
  }
  return resolveCategoryFromLlmOutput(input.context.ontology, parsed)
}

export async function extractEnrichThoughtBundle(input: {
  context: EnrichmentContext
  capturedAt: Date
  timezone: string
  entityEnrichmentContext?: EntityGraphEnrichmentContext
  ontologyEntityKinds: OntologyEntityKindForExtraction[]
}): Promise<EnrichThoughtBundleResult> {
  const userPrompt = buildEnrichThoughtBundlePrompt(input)
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You enrich one personal memory capture: assign a thought category, search cues, temporal mentions, and entity graph structure. Use grounding and graph context only to disambiguate the capture — every field must be justified by the capture text. Output JSON only.',
    },
    { role: 'user', content: userPrompt },
  ]

  if (!isGraphScaleQuiet()) {
    console.info('[enrich-thought-bundle] LLM request', {
      userId: input.context.userId.slice(0, 8),
      promptChars: userPrompt.length,
    })
  }

  const response = await llmChatCompletion({
    userId: input.context.userId,
    messages,
    temperature: 0,
    logContext: 'enrich_thought_bundle',
    responseFormat: 'json_object',
  })

  const content = extractChatContent(response)
  try {
    return parseEnrichThoughtBundleContent({
      content,
      context: input.context,
      capturedAt: input.capturedAt,
      ontologyEntityKinds: input.ontologyEntityKinds,
      entityEnrichmentContext: input.entityEnrichmentContext,
    })
  } catch (err) {
    if (!isInvalidThoughtCategoryError(err)) throw err
    const rejected = err instanceof Error && 'raw' in err ? String(err.raw) : '(unknown)'
    console.warn('[enrich-thought-bundle] invalid category; strict forced-choice retry', {
      userId: input.context.userId.slice(0, 8),
      rejected,
    })
    const allowedKeys = activeThoughtCategoryKinds(input.context.ontology).map((k) => k.key)
    const forcedCategory = await runStrictCategoryRetry({
      context: input.context,
      allowedKeys,
    })
    return parseEnrichThoughtBundleContent({
      content,
      context: input.context,
      capturedAt: input.capturedAt,
      ontologyEntityKinds: input.ontologyEntityKinds,
      entityEnrichmentContext: input.entityEnrichmentContext,
      forcedCategory,
    })
  }
}

/** @internal — tests */
export const enrichThoughtBundleInternals = {
  buildEnrichThoughtBundlePrompt,
  parseEnrichThoughtBundleContent,
}
