import { desc, eq } from 'drizzle-orm'
import {
  capturePrimaryPromptBlock,
  groundingSupplementaryPromptBlock,
} from '$lib/server/capture/enrichment-prompt-sections'
import { getDb } from '$lib/server/db'
import { thought, userOntology } from '$lib/server/db/schema'
import type { GroundingProfileForEnrichment } from '$lib/server/grounding/types'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { isGraphScaleQuiet } from '$lib/server/observability/graph-scale-quiet'
import { loadOntologyForUser, validateEntityKindKeyForNewIngest } from '$lib/server/ontology-db'
import { ONTOLOGY_RECENT_THOUGHT_WINDOW } from './constants'
import { extractChatContent, userMessage } from './llm-json'
import { ontologyKindsPromptBlock, parseOntologyProfileJson } from './types'

function logOntology(...args: Parameters<typeof console.info>): void {
  if (!isGraphScaleQuiet()) console.info(...args)
}

export type ResolvedThoughtOntologyKind = {
  /** Same as `thought.category` and `ontology_entity_kind.key`. */
  key: string
  ontologyEntityKindId: string
  /** LLM-assigned confidence 0–1. Stored in thought.metadata.categoryConfidence. */
  confidence: number
  /** Runner-up candidates, if any. */
  alternatives: Array<{ key: string; confidence: number }>
}

export async function loadUserOntologyProfileRow(userId: string) {
  const [row] = await getDb()
    .select({ profile: userOntology.profile })
    .from(userOntology)
    .where(eq(userOntology.userId, userId))
    .limit(1)
  return row?.profile ? parseOntologyProfileJson(row.profile) : parseOntologyProfileJson({})
}

/** Last N thoughts with their categories (session context for classifier). */
export async function loadRecentThoughtsContext(
  userId: string,
  limit: number,
): Promise<Array<{ normalizedText: string; category: string }>> {
  return getDb()
    .select({ normalizedText: thought.normalizedText, category: thought.category })
    .from(thought)
    .where(eq(thought.userId, userId))
    .orderBy(desc(thought.createdAt), desc(thought.id))
    .limit(limit)
}

/** Category distribution across the last N thoughts for a soft prior. */
export async function loadCategoryDistribution(
  userId: string,
  limit: number,
): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({ category: thought.category })
    .from(thought)
    .where(eq(thought.userId, userId))
    .orderBy(desc(thought.createdAt), desc(thought.id))
    .limit(limit)

  const dist = new Map<string, number>()
  for (const r of rows) {
    dist.set(r.category, (dist.get(r.category) ?? 0) + 1)
  }
  return dist
}

export async function resolveThoughtCategory(input: {
  userId: string
  normalized: string
  rawText: string
  /** Canonical entities referenced in this capture (pre-ingest lexical hints). */
  knownEntities?: Array<{ label: string; entityType: string }>
  groundingProfile?: GroundingProfileForEnrichment
}): Promise<ResolvedThoughtOntologyKind> {
  const runStart = Date.now()
  const userShort = input.userId.length > 8 ? `${input.userId.slice(0, 8)}…` : input.userId
  logOntology('[capture.ontology] classify start', {
    userId: userShort,
    normalizedChars: input.normalized.length,
    rawChars: input.rawText.length,
  })

  const tLoad = Date.now()
  const loaded = await loadOntologyForUser(getDb(), input.userId)
  // Only thought_category kinds are used for classifying thoughts
  const activeKinds = loaded.entityKinds.filter(
    (k) => k.active && k.kindType === 'thought_category',
  )
  if (activeKinds.length === 0) {
    throw new Error('No active thought category kinds for user; cannot classify capture.')
  }
  const kindKeys = [...new Set(activeKinds.map((k) => k.key))].sort()
  logOntology('[capture.ontology] catalog loaded', {
    ms: Date.now() - tLoad,
    activeKindCount: activeKinds.length,
    kindKeys,
  })

  const tProfile = Date.now()
  const profile = await loadUserOntologyProfileRow(input.userId)
  logOntology('[capture.ontology] user ontology profile row loaded', { ms: Date.now() - tProfile })

  // Load recent session context and category distribution in parallel
  const tContext = Date.now()
  const [recentThoughts, categoryDist] = await Promise.all([
    loadRecentThoughtsContext(input.userId, 5),
    loadCategoryDistribution(input.userId, ONTOLOGY_RECENT_THOUGHT_WINDOW),
  ])
  logOntology('[capture.ontology] context loaded', { ms: Date.now() - tContext })

  const ontologyBlock = ontologyKindsPromptBlock(activeKinds, profile)
  const allowedList = kindKeys.join(', ')

  // Build recent session context block
  let sessionContextBlock = ''
  if (recentThoughts.length > 0) {
    const lines = recentThoughts.map((t, i) => `${i + 1}. [${t.category}] ${t.normalizedText}`)
    sessionContextBlock = `\nRecent captures (session context, most recent first):\n${lines.join('\n')}`
  }

  // Build category distribution block
  let distributionBlock = ''
  if (categoryDist.size > 0) {
    const sorted = [...categoryDist.entries()].sort((a, b) => b[1] - a[1])
    const distLine = sorted.map(([k, n]) => `${k} x${n}`).join(', ')
    distributionBlock = `\nRecent category distribution (last ${ONTOLOGY_RECENT_THOUGHT_WINDOW}): ${distLine}`
  }

  let knownEntitiesBlock = ''
  if (input.knownEntities && input.knownEntities.length > 0) {
    const lines = input.knownEntities.map((e) => `- ${e.label} (${e.entityType})`)
    knownEntitiesBlock = `\nKnown entities referenced in this capture:\n${lines.join('\n')}`
  }

  const captureBlock = capturePrimaryPromptBlock({
    normalizedText: input.normalized,
    rawText: input.rawText,
  })
  const groundingBlock = groundingSupplementaryPromptBlock(input.groundingProfile ?? null)

  const prompt = [
    captureBlock,
    '',
    'Return ONLY JSON with keys: "category" (string), "confidence" (number 0.0–1.0), "alternatives" (array of {key, confidence}).',
    `"category" must be exactly one of these ontology entity kind keys: ${allowedList}.`,
    '"confidence" is how certain you are about the primary category (1.0 = definitive, 0.0 = pure guess).',
    '"alternatives" lists other plausible category keys with their confidence scores (omit if none). Max 3.',
    'Pick the single best-matching kind for the capture text using the definitions below.',
    groundingBlock,
    `Kinds:\n${ontologyBlock}`,
    sessionContextBlock,
    distributionBlock,
    knownEntitiesBlock,
  ]
    .filter(Boolean)
    .join('\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You assign exactly one ontology thought category key per capture for a personal memory system. Output JSON only.',
    },
    userMessage(prompt),
  ]

  const tLlm = Date.now()
  logOntology('[capture.ontology] calling LLM for category (chat completion)', {
    promptChars: prompt.length,
    systemChars: messages[0]?.content.length ?? 0,
  })
  const response = await llmChatCompletion({
    userId: input.userId,
    messages,
    temperature: 0,
    logContext: 'thought_category',
  })
  logOntology('[capture.ontology] LLM returned for category', { llmMs: Date.now() - tLlm })

  const parsed = parseLlmJsonPayload(extractChatContent(response))
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Category classification output must be a JSON object')
  }
  const obj = parsed as { category?: unknown; confidence?: unknown; alternatives?: unknown }
  const cat = obj.category
  if (typeof cat !== 'string') {
    throw new Error('Category classification output has invalid category')
  }
  const trimmed = cat.trim()
  if (!validateEntityKindKeyForNewIngest(loaded, trimmed)) {
    throw new Error(`Category classification returned invalid ontology key: ${trimmed}`)
  }
  const row = loaded.entityKindsByKey.get(trimmed)
  if (!row) {
    throw new Error(`Missing ontology row for validated key: ${trimmed}`)
  }

  // Parse confidence (clamp to [0,1])
  const rawConf = obj.confidence
  const confidence =
    typeof rawConf === 'number' && Number.isFinite(rawConf)
      ? Math.min(1, Math.max(0, rawConf))
      : 0.5

  // Parse alternatives
  const rawAlts = obj.alternatives
  const alternatives: Array<{ key: string; confidence: number }> = []
  if (Array.isArray(rawAlts)) {
    for (const alt of rawAlts) {
      if (!alt || typeof alt !== 'object') continue
      const altKey = (alt as { key?: unknown }).key
      const altConf = (alt as { confidence?: unknown }).confidence
      if (typeof altKey !== 'string' || !validateEntityKindKeyForNewIngest(loaded, altKey.trim()))
        continue
      alternatives.push({
        key: altKey.trim(),
        confidence:
          typeof altConf === 'number' && Number.isFinite(altConf)
            ? Math.min(1, Math.max(0, altConf))
            : 0,
      })
    }
  }

  if (confidence < 0.65) {
    logOntology('[capture.ontology] low-confidence classification', {
      key: row.key,
      confidence,
      alternatives,
    })
  }

  logOntology('[capture.ontology] classify done', {
    key: row.key,
    confidence,
    alternativeCount: alternatives.length,
    totalMs: Date.now() - runStart,
  })
  return { key: row.key, ontologyEntityKindId: row.id, confidence, alternatives }
}
