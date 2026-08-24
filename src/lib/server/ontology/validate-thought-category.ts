import type { ResolvedThoughtOntologyKind } from './classify-thought-category'
/**
 * Shared validation for LLM-emitted thought category output.
 *
 * Single type axis: `thought.category` is the only classified type label, and it must always be
 * an active thought_category ontology kind. Validation is repair-before-fail:
 *
 *   1. Primary key valid → use it.
 *   2. Primary invalid but a valid alternative exists → promote the top valid alternative
 *      (still the model's own ranked candidate from the allowed set) and record `repairedFrom`.
 *   3. Nothing valid → throw {@link InvalidThoughtCategoryError}; the caller may run exactly one
 *      strict forced-choice retry listing only the active keys, then fail explicitly.
 *
 * Used by every classification call site (enrich bundle, interpret preview, edit re-classify) —
 * no per-site ad-hoc validation.
 */
import type { LoadedUserOntology } from '$lib/server/ontology-db/load-ontology'
import { validateEntityKindKeyForNewIngest } from '$lib/server/ontology-db/load-ontology'

export class InvalidThoughtCategoryError extends Error {
  readonly raw: string
  constructor(raw: string) {
    super(`Invalid thought category "${raw}" — not an active thought_category ontology kind`)
    this.name = 'InvalidThoughtCategoryError'
    this.raw = raw
  }
}

export function isInvalidThoughtCategoryError(e: unknown): e is InvalidThoughtCategoryError {
  return e instanceof InvalidThoughtCategoryError || (e instanceof Error && e.name === 'InvalidThoughtCategoryError')
}

export type ResolvedThoughtCategory = ResolvedThoughtOntologyKind & {
  /** Set when the primary key was invalid and a valid alternative was promoted. */
  repairedFrom?: string
}

type RawCategoryOutput = {
  key?: unknown
  confidence?: unknown
  alternatives?: unknown
}

function clampConfidence(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/**
 * Resolve LLM category output to an active thought_category kind.
 * @throws {InvalidThoughtCategoryError} when neither the primary nor any alternative is valid.
 */
export function resolveCategoryFromLlmOutput(
  loaded: LoadedUserOntology,
  raw: unknown,
): ResolvedThoughtCategory {
  const obj: RawCategoryOutput =
    raw && typeof raw === 'object' ? (raw as RawCategoryOutput) : {}
  const primary = typeof obj.key === 'string' ? obj.key.trim() : ''

  const alternatives: Array<{ key: string; confidence: number }> = []
  if (Array.isArray(obj.alternatives)) {
    for (const alt of obj.alternatives) {
      if (!alt || typeof alt !== 'object') continue
      const altKey = (alt as { key?: unknown }).key
      if (typeof altKey !== 'string') continue
      const trimmed = altKey.trim()
      if (!trimmed || !validateEntityKindKeyForNewIngest(loaded, trimmed)) continue
      alternatives.push({
        key: trimmed,
        confidence: clampConfidence((alt as { confidence?: unknown }).confidence, 0),
      })
    }
  }

  if (primary && validateEntityKindKeyForNewIngest(loaded, primary)) {
    const row = loaded.entityKindsByKey.get(primary)
    if (!row) throw new InvalidThoughtCategoryError(primary)
    return {
      key: row.key,
      ontologyEntityKindId: row.id,
      confidence: clampConfidence(obj.confidence, 0.5),
      alternatives,
    }
  }

  const promoted = alternatives[0]
  if (promoted) {
    const row = loaded.entityKindsByKey.get(promoted.key)
    if (!row) throw new InvalidThoughtCategoryError(primary || '(missing)')
    return {
      key: row.key,
      ontologyEntityKindId: row.id,
      confidence: promoted.confidence,
      alternatives,
      repairedFrom: primary || '(missing)',
    }
  }

  throw new InvalidThoughtCategoryError(primary || '(missing)')
}

/**
 * Strict forced-choice retry prompt: only the active keys, no catalog descriptions that could
 * prime out-of-set output. Intentionally does not repeat the rejected key.
 */
export function buildStrictCategoryRetryPrompt(input: {
  normalizedText: string
  allowedKeys: readonly string[]
}): string {
  return [
    `Capture:\n${input.normalizedText}`,
    '',
    'Your previous category was rejected.',
    `Choose exactly one category key from this list (no other strings): ${[...input.allowedKeys].sort().join(', ')}.`,
    'Return ONLY JSON: { "key": "<one of the listed keys>", "confidence": 0.0-1.0 }.',
  ].join('\n')
}
