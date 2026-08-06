import { llmChatCompletion } from '$lib/server/llm/llm-client'
import type { MemoryType } from '$lib/server/db/brain.schema'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { m } from '$lib/paraglide/messages.js'
import {
  CUES_FROM_CAPTURE_RULE,
  capturePrimaryPromptBlock,
  groundingSupplementaryPromptBlock,
} from '$lib/server/capture/enrichment-prompt-sections'
import type { GroundingProfileForEnrichment } from '$lib/server/grounding/types'
import {
  CATEGORY_VS_MEMORY_TYPE_DISAMBIGUATION,
  categoryConfusionRetryRule,
  isThoughtCategoryKeyConfusion,
  MEMORY_TYPE_KEY_UNION,
  normalizeMemoryType,
  STRICT_MEMORY_TYPE_FORCED_CHOICE,
} from '$lib/server/memory/memory-type-catalog'

export { normalizeMemoryType } from '$lib/server/memory/memory-type-catalog'

export class InvalidMemoryTypeError extends Error {
  readonly raw: string
  readonly categoryKeyConfusion: boolean

  constructor(raw: string) {
    super(`extractThoughtMetadata: invalid memoryType "${raw}"`)
    this.name = 'InvalidMemoryTypeError'
    this.raw = raw
    this.categoryKeyConfusion = isThoughtCategoryKeyConfusion(raw)
  }
}

const MIN_CUE_LENGTH = 3
const MAX_CUE_LENGTH = 80
const MAX_CUES = 5

function readMemoryTypeRaw(obj: Record<string, unknown>): unknown {
  if ('memoryType' in obj) return obj.memoryType
  if ('memory_type' in obj) return obj.memory_type
  return undefined
}

export function parseThoughtMetadataFields(
  obj: Record<string, unknown>,
): ThoughtMetadataExtraction {
  const raw = readMemoryTypeRaw(obj)
  const memoryType = normalizeMemoryType(raw)
  if (!memoryType) {
    const label = typeof raw === 'string' ? raw.trim() : raw === undefined ? '' : String(raw)
    throw new InvalidMemoryTypeError(label || '(missing)')
  }
  return { memoryType, cues: parseCues(obj.cues) }
}

function extractChatContent(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('extractThoughtMetadata: response is not an object')
  }
  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('extractThoughtMetadata: no choices in response')
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content
  if (typeof content !== 'string') {
    throw new Error('extractThoughtMetadata: content is not a string')
  }
  return content
}

function parseCues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_CUE_LENGTH && s.length <= MAX_CUE_LENGTH)
    .slice(0, MAX_CUES)
}

export type ThoughtMetadataExtraction = {
  memoryType: MemoryType
  cues: string[]
}

type ExtractThoughtMetadataPass = 'default' | 'retry_strict' | 'retry_category_confusion'

async function extractThoughtMetadataOnce(
  input: {
    userId: string
    normalizedText: string
    groundingProfile?: GroundingProfileForEnrichment
  },
  pass: ExtractThoughtMetadataPass,
  rejectedMemoryType?: string,
): Promise<ThoughtMetadataExtraction> {
  const captureBlock = capturePrimaryPromptBlock({ normalizedText: input.normalizedText })
  const groundingBlock = groundingSupplementaryPromptBlock(input.groundingProfile ?? null)
  const isStrict = pass === 'retry_strict'
  const strictRule = isStrict
    ? STRICT_MEMORY_TYPE_FORCED_CHOICE
    : pass === 'retry_category_confusion' && rejectedMemoryType
      ? categoryConfusionRetryRule(rejectedMemoryType)
      : ''

  const prompt = [
    captureBlock,
    '',
    ...(isStrict
      ? []
      : [CATEGORY_VS_MEMORY_TYPE_DISAMBIGUATION, '']),
    'Return ONLY JSON with this shape:',
    '{',
    `  "memoryType": "${MEMORY_TYPE_KEY_UNION}",`,
    '  "cues": ["2-8 word search phrase", "..."]',
    '}',
    '',
    ...(isStrict
      ? []
      : [
          'memoryType — exactly one of:',
          '  episode    — a specific event or experience that happened',
          '  fact       — a standing truth, reference, or factual note',
          '  decision   — a committed choice or resolution',
          '  concern    — a worry, risk, or anxiety',
          '  preference — a personal tendency, habit, or like/dislike',
          '  pattern    — a recurring observation about oneself or a situation',
          '  task       — actionable open work, a to-do, or work in progress',
          '',
        ]),
    CUES_FROM_CAPTURE_RULE,
    strictRule,
    '',
    groundingBlock,
  ]
    .filter((line) => line.length > 0)
    .join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content: m.llm_memory_type_system(),
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    responseFormat: 'json_object',
  })

  const content = stripMarkdownJsonFences(extractChatContent(response))
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('extractThoughtMetadata: output must be a JSON object')
  }
  return parseThoughtMetadataFields(parsed as Record<string, unknown>)
}

/**
 * Single LLM call: memory type classification + search cue phrases.
 * Retries with strict ontology reminders when the model returns drift or category-key confusion.
 */
export async function extractThoughtMetadata(input: {
  userId: string
  normalizedText: string
  groundingProfile?: GroundingProfileForEnrichment
}): Promise<ThoughtMetadataExtraction> {
  try {
    return await extractThoughtMetadataOnce(input, 'default')
  } catch (err) {
    if (!(err instanceof InvalidMemoryTypeError)) throw err
    if (err.categoryKeyConfusion) {
      console.warn('[extract-thought-metadata] category key in memoryType slot; retrying', {
        userId: input.userId,
        rejected: err.raw,
      })
      try {
        return await extractThoughtMetadataOnce(input, 'retry_category_confusion', err.raw)
      } catch (retryErr) {
        if (!(retryErr instanceof InvalidMemoryTypeError)) throw retryErr
        console.warn('[extract-thought-metadata] category confusion retry failed; strict pass', {
          userId: input.userId,
          rejected: retryErr.raw,
        })
        return extractThoughtMetadataOnce(input, 'retry_strict', retryErr.raw)
      }
    }
    console.warn('[extract-thought-metadata] invalid type on first pass; retrying strict', {
      userId: input.userId,
      rejected: err.raw,
    })
    return extractThoughtMetadataOnce(input, 'retry_strict', err.raw)
  }
}
