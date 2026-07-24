/**
 * LLM interpret pass for the capture confirmation gate.
 * Produces interpreted text + category + memoryType + entity preview before enrich.
 */
import { getDb } from '$lib/server/db'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { MEMORY_TYPE_KEY_UNION, normalizeMemoryType } from '$lib/server/memory/memory-type-catalog'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { emptyOntologyProfile, ontologyKindsPromptBlock } from '$lib/server/ontology/types'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'
import { loadUserOntologyProfileRow } from '$lib/server/ontology/classify-thought-category'
import type { MemoryType } from '$lib/server/db/brain.schema'

export type CapturePreviewEntity = {
  surface: string
  entityType: string
  confidence: number
}

export type CapturePreviewCategory = {
  key: string
  confidence: number
  alternatives: Array<{ key: string; confidence: number }>
}

export type CapturePreviewBundle = {
  interpretedText: string
  category: CapturePreviewCategory
  memoryType: MemoryType | null
  entities: CapturePreviewEntity[]
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function parsePreviewBundle(
  payload: unknown,
  allowedCategoryKeys: Set<string>,
  allowedEntityKeys: Set<string>,
): CapturePreviewBundle {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Interpret LLM response must be a JSON object')
  }
  const obj = payload as Record<string, unknown>
  const interpretedText =
    typeof obj.interpretedText === 'string' ? obj.interpretedText.trim() : ''
  if (!interpretedText) {
    throw new Error('Interpret LLM response missing non-empty interpretedText')
  }

  const categoryRaw = obj.category
  if (!categoryRaw || typeof categoryRaw !== 'object') {
    throw new Error('Interpret LLM response missing category')
  }
  const cat = categoryRaw as Record<string, unknown>
  const categoryKey = typeof cat.key === 'string' ? cat.key.trim() : ''
  if (!categoryKey || !allowedCategoryKeys.has(categoryKey)) {
    throw new Error(
      `Interpret LLM returned invalid category key "${categoryKey || '(empty)'}"; expected one of: ${[...allowedCategoryKeys].sort().join(', ')}`,
    )
  }

  const alternativesRaw = Array.isArray(cat.alternatives) ? cat.alternatives : []
  const alternatives: Array<{ key: string; confidence: number }> = []
  for (const alt of alternativesRaw) {
    if (!alt || typeof alt !== 'object') continue
    const a = alt as Record<string, unknown>
    const key = typeof a.key === 'string' ? a.key.trim() : ''
    if (!key || !allowedCategoryKeys.has(key)) continue
    alternatives.push({ key, confidence: clampConfidence(a.confidence) })
  }

  const entitiesRaw = Array.isArray(obj.entities) ? obj.entities : []
  const entities: CapturePreviewEntity[] = []
  for (const ent of entitiesRaw) {
    if (!ent || typeof ent !== 'object') continue
    const e = ent as Record<string, unknown>
    const surface = typeof e.surface === 'string' ? e.surface.trim() : ''
    const entityType = typeof e.entityType === 'string' ? e.entityType.trim() : ''
    if (!surface || !entityType || !allowedEntityKeys.has(entityType)) continue
    entities.push({
      surface,
      entityType,
      confidence: clampConfidence(e.confidence),
    })
  }

  return {
    interpretedText,
    category: {
      key: categoryKey,
      confidence: clampConfidence(cat.confidence),
      alternatives,
    },
    memoryType: normalizeMemoryType(obj.memoryType),
    entities,
  }
}

/**
 * Run the interpret LLM pass. Optional correction loop passes priorPreview + correction.
 */
export async function interpretThoughtPreview(input: {
  userId: string
  rawText: string
  priorPreview?: CapturePreviewBundle
  correction?: string
}): Promise<CapturePreviewBundle> {
  const rawText = input.rawText.trim()
  if (!rawText) {
    throw new Error('raw text is required')
  }

  await ensureUserOntologySeeded(getDb(), input.userId)
  const ontology = await loadOntologyForUser(getDb(), input.userId)
  const profile = (await loadUserOntologyProfileRow(input.userId)) ?? emptyOntologyProfile()
  const categoryKinds = ontology.entityKinds.filter(
    (k) => k.active && k.kindType === 'thought_category',
  )
  const entityKinds = ontology.entityKinds.filter((k) => k.active && k.kindType === 'entity_type')
  const allowedCategoryKeys = new Set(categoryKinds.map((k) => k.key))
  const allowedEntityKeys = new Set(entityKinds.map((k) => k.key))
  const categoryKeyUnion = [...allowedCategoryKeys].sort().join('|')
  const entityKeyUnion = [...allowedEntityKeys].sort().join('|')
  const entityCatalog = entityKinds
    .map((k) => `- entityType must be exactly "${k.key}" (${k.name}): ${k.definition}`)
    .join('\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You interpret a raw personal capture into a clear stored form for the user to confirm.',
        'Return JSON only:',
        `{ "interpretedText": "<clear full thought body>", "category": { "key": "${categoryKeyUnion}", "confidence": 0-1, "alternatives": [{ "key": "...", "confidence": 0-1 }] }, "memoryType": ${MEMORY_TYPE_KEY_UNION} | null, "entities": [{ "surface": "...", "entityType": "${entityKeyUnion}", "confidence": 0-1 }] }`,
        'Rules:',
        '- interpretedText is the clarified/normalized form the user will store. Preserve meaning; fix obvious STT/typos; do not invent facts.',
        '- category.key must be an exact ontology thought_category key from the catalog (no synonyms).',
        '- memoryType must be a canonical storage shape key or null — never a thought_category key.',
        '- entities are provisional mentions for preview only; entityType must be an exact ontology entity_type key.',
        '- When a correction is provided, apply it to the priorPreview and return a full updated JSON object.',
        ontologyKindsPromptBlock(categoryKinds, profile),
        entityCatalog ? `Entity types:\n${entityCatalog}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    {
      role: 'user',
      content: input.priorPreview
        ? [
            `Raw capture:\n${rawText}`,
            `priorPreview:\n${JSON.stringify(input.priorPreview)}`,
            `Correction: ${input.correction?.trim() || '(none)'}`,
          ].join('\n\n')
        : `Raw capture:\n${rawText}`,
    },
  ]

  const response = await llmChatCompletion({
    userId: input.userId,
    messages,
    temperature: 0,
    logContext: 'interpret_thought_preview',
    responseFormat: 'json_object',
  })

  const content = extractChatContent(response)
  try {
    const parsed = parseLlmJsonPayload(content)
    return parsePreviewBundle(parsed, allowedCategoryKeys, allowedEntityKeys)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse interpret LLM response: ${message}`)
  }
}
