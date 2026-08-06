import type { MemoryType } from '$lib/server/db/brain.schema'
import { memoryTypeEnum } from '$lib/server/db/brain.schema'

/** Canonical memoryType keys (storage / retrieval / consolidation). */
export const MEMORY_TYPE_KEYS = [...memoryTypeEnum] as const

export const MEMORY_TYPE_KEY_UNION = MEMORY_TYPE_KEYS.join('|')

/**
 * Ontology thought_category keys that must never be copied into memoryType.
 * `decision` is omitted — it is valid in both ontologies.
 */
export const THOUGHT_CATEGORY_ONLY_KEYS = [
  'feeling',
  'goal',
  'idea',
  'memory',
  'observation',
  'question',
  'reference',
  'reflection',
  'task',
] as const

export type ThoughtCategoryOnlyKey = (typeof THOUGHT_CATEGORY_ONLY_KEYS)[number]

function isMemoryType(value: string): value is MemoryType {
  return (MEMORY_TYPE_KEYS as readonly string[]).includes(value)
}

/** Normalize LLM memoryType output; null when no canonical key matches. */
export function normalizeMemoryType(raw: unknown): MemoryType | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  const underscored = trimmed.replace(/[\s-]+/g, '_')
  if (isMemoryType(underscored)) return underscored
  for (const key of MEMORY_TYPE_KEYS) {
    if (key.toLowerCase() === underscored) return key
  }
  return null
}

/** True when the model returned a thought_category key in the memoryType slot. */
export function isThoughtCategoryKeyConfusion(raw: string): boolean {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return (THOUGHT_CATEGORY_ONLY_KEYS as readonly string[]).includes(normalized)
}

export const CATEGORY_VS_MEMORY_TYPE_DISAMBIGUATION = [
  'category and memoryType are DIFFERENT fields — never copy category.key into memoryType.',
  `category.key → thought kind (${THOUGHT_CATEGORY_ONLY_KEYS.join(', ')}, decision).`,
  `memoryType → storage/retrieval shape (${MEMORY_TYPE_KEY_UNION}) only.`,
  'When category.key is "observation": one-time notice → episode or fact; standing truth → fact; recurring tendency → pattern.',
  `FORBIDDEN memoryType values (category-only keys): ${THOUGHT_CATEGORY_ONLY_KEYS.join(', ')}.`,
].join('\n')

/** True when a stored memoryType value is a canonical key (not a category-only drift label). */
export function isPersistedMemoryTypeValid(raw: unknown): boolean {
  return normalizeMemoryType(raw) != null
}

export function categoryConfusionRetryRule(rejectedMemoryType: string): string {
  return [
    `Your previous memoryType "${rejectedMemoryType}" is a thought category key, not a memoryType.`,
    `Keep category.key as "${rejectedMemoryType}" if appropriate, but memoryType must be one of: ${MEMORY_TYPE_KEY_UNION}.`,
    'Do not repeat category keys in memoryType.',
  ].join(' ')
}

/**
 * Strict retry: forced choice over canonical memoryTypes only.
 * Intentionally does NOT name rejected category keys (no priming).
 */
export const STRICT_MEMORY_TYPE_FORCED_CHOICE = [
  'Your previous memoryType was rejected.',
  'memoryType — choose ONLY from: episode (a specific event), fact (a standing truth), decision (a committed choice/resolution), concern (a worry/risk), preference (a personal tendency), pattern (a recurring tendency about oneself or a situation).',
  'Pick exactly one. No other strings.',
].join(' ')

