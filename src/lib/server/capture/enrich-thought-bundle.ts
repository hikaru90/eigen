/**
 * Single LLM call for tier-2 enrich prefetch: category, metadata, temporal, and entity graph.
 * Grounding profile and shared context are injected once per capture.
 */
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { validateEntityKindKeyForNewIngest } from '$lib/server/ontology-db'
import { ONTOLOGY_RECENT_THOUGHT_WINDOW } from '$lib/server/ontology/constants'
import { ontologyKindsPromptBlock } from '$lib/server/ontology/types'
import type { ResolvedThoughtOntologyKind } from '$lib/server/ontology/classify-thought-category'
import {
  CUES_FROM_CAPTURE_RULE,
  capturePrimaryPromptBlock,
  groundingSupplementaryPromptBlock,
} from '$lib/server/capture/enrichment-prompt-sections'
import type { EnrichmentContext } from '$lib/server/capture/enrichment-context'
import {
  formatCommunityContextBlock,
  formatKnownEntitiesBlock,
} from '$lib/server/capture/enrichment-context'
import {
  graphEntityLabelsFromContext,
  parseEntityMentions,
  parseEntityTriples,
  type ExtractedEntityMention,
  type ExtractedEntityTriple,
  type OntologyEntityKindForExtraction,
} from '$lib/server/memory/entity-extraction'
import {
  ENTITY_EXTRACTION_GRAPH_TRIPLE_GUIDANCE,
  ENTITY_EXTRACTION_OMIT_RULES,
  ENTITY_EXTRACTION_QUALITY_GUIDANCE,
  ENTITY_EXTRACTION_SURFACE_INTEGRITY_RULES,
  ENTITY_EXTRACTION_TYPE_GUIDANCE,
} from '$lib/server/memory/entity-mention-filter'
import {
  formatCommunityExcerptsForEntityPrompt,
  formatKnownGraphEntitiesPromptBlock,
  type EntityGraphEnrichmentContext,
} from '$lib/server/memory/entity-graph-enrichment-context'
import {
  InvalidMemoryTypeError,
  parseThoughtMetadataFields,
  type ThoughtMetadataExtraction,
} from '$lib/server/memory/extract-thought-metadata'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import {
  applyCaptureAnchoredMentions,
  parseTemporalMentions,
  type ExtractedTemporalMention,
} from '$lib/server/memory/temporal-normalize'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { isGraphScaleQuiet } from '$lib/server/observability/graph-scale-quiet'

import {
  CATEGORY_VS_MEMORY_TYPE_DISAMBIGUATION,
  categoryConfusionRetryRule,
  MEMORY_TYPE_KEY_UNION,
} from '$lib/server/memory/memory-type-catalog'

export type EnrichThoughtBundleResult = {
  category: ResolvedThoughtOntologyKind
  metadata: ThoughtMetadataExtraction
  temporalMentions: ExtractedTemporalMention[]
  entityGraph: { mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] }
}

type BundlePass = 'default' | 'retry_category_confusion' | 'retry_strict_memory_type'

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
  pass: BundlePass
  rejectedMemoryType?: string
}): string {
  const { context, capturedAt, timezone, entityEnrichmentContext, ontologyEntityKinds } = input
  const activeCategoryKinds = context.ontology.entityKinds.filter(
    (k) => k.active && k.kindType === 'thought_category',
  )
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

  const strictMemoryRule =
    input.pass === 'retry_strict_memory_type'
      ? [
          input.rejectedMemoryType
            ? `Your previous memoryType "${input.rejectedMemoryType}" was rejected.`
            : 'Your previous memoryType was rejected.',
          `memoryType must be copied exactly from: ${MEMORY_TYPE_KEY_UNION}.`,
          'Do not use thought category keys or free-form labels.',
        ].join(' ')
      : input.pass === 'retry_category_confusion' && input.rejectedMemoryType
        ? categoryConfusionRetryRule(input.rejectedMemoryType)
        : ''

  const capturedIso = capturedAt.toISOString()

  return [
    captureBlock,
    '',
    CATEGORY_VS_MEMORY_TYPE_DISAMBIGUATION,
    '',
    'Return ONLY JSON with this shape:',
    '{',
    '  "category": { "key": "<thought_category_key>", "confidence": 0.0-1.0, "alternatives": [{"key":"...","confidence":0.0}] },',
    `  "memoryType": "${MEMORY_TYPE_KEY_UNION}",`,
    '  "cues": ["2-8 word search phrase", "..."],',
    '  "temporalMentions": [],',
    '  "mentions": [{"surface":"<text as written>","entityType":"<key>","confidence":0.0-1.0}],',
    '  "triples": [{"subject":"<surface>","object":"<surface>","predicate":"related_to","confidence":0.0-1.0}]',
    '}',
    '',
    `category.key must be exactly one of: ${categoryKeys.join(', ')}.`,
    'alternatives: max 3 other plausible category keys with confidence.',
    '',
    `memoryType must be exactly one of: ${MEMORY_TYPE_KEY_UNION} — never copy category.key into memoryType.`,
    CUES_FROM_CAPTURE_RULE,
    strictMemoryRule,
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

function parseCategoryFromBundle(
  loaded: EnrichmentContext['ontology'],
  raw: unknown,
): ResolvedThoughtOntologyKind {
  if (!raw || typeof raw !== 'object') {
    throw new Error('enrichThoughtBundle: category must be an object')
  }
  const obj = raw as { key?: unknown; confidence?: unknown; alternatives?: unknown }
  const cat = obj.key
  if (typeof cat !== 'string') {
    throw new Error('enrichThoughtBundle: category.key is required')
  }
  const trimmed = cat.trim()
  if (!validateEntityKindKeyForNewIngest(loaded, trimmed)) {
    throw new Error(`enrichThoughtBundle: invalid category key "${trimmed}"`)
  }
  const row = loaded.entityKindsByKey.get(trimmed)
  if (!row) {
    throw new Error(`enrichThoughtBundle: missing ontology row for "${trimmed}"`)
  }
  const rawConf = obj.confidence
  const confidence =
    typeof rawConf === 'number' && Number.isFinite(rawConf)
      ? Math.min(1, Math.max(0, rawConf))
      : 0.5
  const alternatives: Array<{ key: string; confidence: number }> = []
  const rawAlts = obj.alternatives
  if (Array.isArray(rawAlts)) {
    for (const alt of rawAlts) {
      if (!alt || typeof alt !== 'object') continue
      const altKey = (alt as { key?: unknown }).key
      const altConf = (alt as { confidence?: unknown }).confidence
      if (typeof altKey !== 'string' || !validateEntityKindKeyForNewIngest(loaded, altKey.trim())) {
        continue
      }
      alternatives.push({
        key: altKey.trim(),
        confidence:
          typeof altConf === 'number' && Number.isFinite(altConf)
            ? Math.min(1, Math.max(0, altConf))
            : 0,
      })
    }
  }
  return { key: row.key, ontologyEntityKindId: row.id, confidence, alternatives }
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
}): EnrichThoughtBundleResult {
  const parsed = JSON.parse(stripMarkdownJsonFences(input.content)) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('enrichThoughtBundle: output must be a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const allowedEntityKeys = new Set(input.ontologyEntityKinds.map((k) => k.key))

  return {
    category: parseCategoryFromBundle(input.context.ontology, obj.category),
    metadata: parseThoughtMetadataFields(obj),
    temporalMentions: parseTemporalFromBundle(obj.temporalMentions, input.capturedAt),
    entityGraph: parseEntityGraphFromBundle(
      obj,
      allowedEntityKeys,
      input.entityEnrichmentContext?.graphEntities ?? [],
    ),
  }
}

async function extractEnrichThoughtBundleOnce(input: {
  context: EnrichmentContext
  capturedAt: Date
  timezone: string
  entityEnrichmentContext?: EntityGraphEnrichmentContext
  ontologyEntityKinds: OntologyEntityKindForExtraction[]
  pass: BundlePass
  rejectedMemoryType?: string
}): Promise<EnrichThoughtBundleResult> {
  const userPrompt = buildEnrichThoughtBundlePrompt({ ...input, pass: input.pass })
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You enrich one personal memory capture: assign category, memory type, search cues, temporal mentions, and entity graph structure. Use grounding and graph context only to disambiguate the capture — every field must be justified by the capture text. Output JSON only.',
    },
    { role: 'user', content: userPrompt },
  ]

  if (!isGraphScaleQuiet()) {
    console.info('[enrich-thought-bundle] LLM request', {
      userId: input.context.userId.slice(0, 8),
      promptChars: userPrompt.length,
      pass: input.pass,
    })
  }

  const response = await llmChatCompletion({
    userId: input.context.userId,
    messages,
    temperature: 0,
    logContext: 'enrich_thought_bundle',
    responseFormat: 'json_object',
  })

  return parseEnrichThoughtBundleContent({
    content: extractChatContent(response),
    context: input.context,
    capturedAt: input.capturedAt,
    ontologyEntityKinds: input.ontologyEntityKinds,
    entityEnrichmentContext: input.entityEnrichmentContext,
  })
}

export async function extractEnrichThoughtBundle(input: {
  context: EnrichmentContext
  capturedAt: Date
  timezone: string
  entityEnrichmentContext?: EntityGraphEnrichmentContext
  ontologyEntityKinds: OntologyEntityKindForExtraction[]
}): Promise<EnrichThoughtBundleResult> {
  try {
    return await extractEnrichThoughtBundleOnce({ ...input, pass: 'default' })
  } catch (err) {
    if (!(err instanceof InvalidMemoryTypeError)) throw err
    if (err.categoryKeyConfusion) {
      console.warn('[enrich-thought-bundle] category key in memoryType slot; retrying', {
        userId: input.context.userId,
        rejected: err.raw,
      })
      try {
        return await extractEnrichThoughtBundleOnce({
          ...input,
          pass: 'retry_category_confusion',
          rejectedMemoryType: err.raw,
        })
      } catch (retryErr) {
        if (!(retryErr instanceof InvalidMemoryTypeError)) throw retryErr
        console.warn('[enrich-thought-bundle] category confusion retry failed; strict pass', {
          userId: input.context.userId,
          rejected: retryErr.raw,
        })
        return extractEnrichThoughtBundleOnce({
          ...input,
          pass: 'retry_strict_memory_type',
          rejectedMemoryType: retryErr.raw,
        })
      }
    }
    console.warn('[enrich-thought-bundle] invalid memoryType; retrying strict', {
      userId: input.context.userId,
      rejected: err.raw,
    })
    return extractEnrichThoughtBundleOnce({
      ...input,
      pass: 'retry_strict_memory_type',
      rejectedMemoryType: err.raw,
    })
  }
}

/** @internal — tests */
export const enrichThoughtBundleInternals = {
  buildEnrichThoughtBundlePrompt,
  parseEnrichThoughtBundleContent,
}
