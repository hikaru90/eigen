/**
 * LLM interpret pass for the capture confirmation gate.
 * Produces interpreted text + category + entity preview before enrich.
 */
import { getDb } from '$lib/server/db'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { ensureUserOntologySeeded, loadOntologyForUser, activeThoughtCategoryKinds, type LoadedUserOntology } from '$lib/server/ontology-db'
import { loadUserOntologyProfileRow } from '$lib/server/ontology/classify-thought-category'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { emptyOntologyProfile, ontologyKindsPromptBlock } from '$lib/server/ontology/types'
import {
  resolveCategoryFromLlmOutput,
  type ResolvedThoughtCategory,
} from '$lib/server/ontology/validate-thought-category'

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
  category: ResolvedThoughtCategory
  entities: CapturePreviewEntity[]
  /** LLM judge: true when interpretation changes meaning/entities beyond trivial cleanup. */
  deviatesFromVerbatim: boolean
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function parsePreviewBundle(
  payload: unknown,
  ontology: LoadedUserOntology,
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

  const category = resolveCategoryFromLlmOutput(ontology, obj.category)

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

  if (typeof obj.deviatesFromVerbatim !== 'boolean') {
    throw new Error('Interpret LLM response missing required boolean deviatesFromVerbatim')
  }
  const deviatesFromVerbatim = obj.deviatesFromVerbatim

  return { interpretedText, category, entities, deviatesFromVerbatim }
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
  const categoryKinds = activeThoughtCategoryKinds(ontology)
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
        'You interpret a raw personal capture into a clear stored form for the user to confirm when needed.',
        'Return JSON only:',
        `{ "interpretedText": "<clear full thought body>", "category": { "key": "${categoryKeyUnion}", "confidence": 0-1, "alternatives": [{ "key": "...", "confidence": 0-1 }] }, "entities": [{ "surface": "...", "entityType": "${entityKeyUnion}", "confidence": 0-1 }], "deviatesFromVerbatim": true|false }`,
        'Rules:',
        '- interpretedText is the clarified/normalized form the user will store. Preserve meaning; fix obvious STT/typos; do not invent facts.',
        '- category.key must be an exact ontology thought_category key from the catalog (no synonyms).',
        '- entities are provisional mentions for preview only; entityType must be an exact ontology entity_type key.',
        '- deviatesFromVerbatim must be a boolean. Set true when interpretedText changes meaning or reinterprets/links entities beyond what is literally in the raw capture (more than trivial whitespace/STT/typo cleanup). Set false when you only clarify formatting or fix obvious typos without altering meaning.',
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
    return parsePreviewBundle(parsed, ontology, allowedEntityKeys)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse interpret LLM response: ${message}`, { cause: err })
  }
}
