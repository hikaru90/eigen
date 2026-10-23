/**
 * Patterns response contract (ei redesign, docs/planning/ei-redesign.md wave 2.4).
 *
 * The LLM judge decides *meaning* (which patterns the mesh notices); this module
 * only validates the judge's JSON shape and clamps bounds — it never re-decides
 * what a pattern is (repo guardrail: no string heuristics for meaning).
 * Contract breaches throw `PatternsContractError` (fail loud, no fallback copy);
 * out-of-bounds values are clamped to the caps below.
 */

/** How many patterns the surface shows at most (ask: "cap count ~5"). */
export const PATTERNS_MAX_COUNT = 5
/** How many catalog thoughtIds one pattern may cite. */
export const PATTERN_MAX_THOUGHT_IDS = 12
export const INSIGHT_MAX_LENGTH = 280
export const PATTERN_TITLE_MAX_LENGTH = 80
export const PATTERN_DISTILLATION_MAX_LENGTH = 400

/**
 * Closed vocabulary the judge chooses from for `kind` — how the mind has been
 * moving. Rendered nowhere yet (carried for the later map pass); an unknown
 * kind is a contract breach, not something to retype.
 */
export const PATTERN_KINDS = ['recurring', 'scattered', 'growing', 'fading'] as const

export type PatternKind = (typeof PATTERN_KINDS)[number]

export type ValidatedPattern = {
  title: string
  distillation: string
  kind: PatternKind
  thoughtIds: string[]
}

export type ValidatedPatternsPayload = {
  insight: string
  patterns: ValidatedPattern[]
}

export class PatternsContractError extends Error {
  constructor(message: string) {
    super(`patterns contract: ${message}`)
    this.name = 'PatternsContractError'
  }
}

export function isPatternKind(value: unknown): value is PatternKind {
  return typeof value === 'string' && (PATTERN_KINDS as readonly string[]).includes(value)
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PatternsContractError(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function clampString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Validate + clamp the judge's parsed JSON.
 * `knownThoughtIds` is the catalog that was passed INTO the prompt: every cited
 * id must exist there, so patterns can only ever reference real thoughts.
 */
export function validatePatternsPayload(
  raw: unknown,
  knownThoughtIds: ReadonlySet<string>,
): ValidatedPatternsPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PatternsContractError('payload must be a JSON object')
  }
  const obj = raw as Record<string, unknown>

  const insight = clampString(requireNonEmptyString(obj.insight, 'insight'), INSIGHT_MAX_LENGTH)

  if (!Array.isArray(obj.patterns)) {
    throw new PatternsContractError('patterns must be an array')
  }

  const patterns: ValidatedPattern[] = []
  for (const entry of obj.patterns.slice(0, PATTERNS_MAX_COUNT)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new PatternsContractError('each pattern must be an object')
    }
    const pattern = entry as Record<string, unknown>
    // Shape first: a breach is a breach even for a pattern we would drop below.
    const title = clampString(
      requireNonEmptyString(pattern.title, 'pattern title'),
      PATTERN_TITLE_MAX_LENGTH,
    )
    const distillation = clampString(
      requireNonEmptyString(pattern.distillation, 'pattern distillation'),
      PATTERN_DISTILLATION_MAX_LENGTH,
    )
    if (!isPatternKind(pattern.kind)) {
      throw new PatternsContractError(
        `pattern kind must be one of ${PATTERN_KINDS.join(', ')}`,
      )
    }
    if (!Array.isArray(pattern.thoughtIds)) {
      throw new PatternsContractError('pattern thoughtIds must be an array')
    }

    const boundIds: string[] = []
    for (const id of pattern.thoughtIds) {
      if (typeof id !== 'string') continue
      if (!knownThoughtIds.has(id)) continue
      if (boundIds.includes(id)) continue
      boundIds.push(id)
      if (boundIds.length >= PATTERN_MAX_THOUGHT_IDS) break
    }
    // A pattern that cites none of the thoughts it was given cannot link or be
    // counted — drop it rather than render an unactionable card.
    if (boundIds.length === 0) continue
    // Titles key the cards (and the adopted state): a repeated name is dropped.
    if (patterns.some((existing) => existing.title === title)) continue

    patterns.push({ title, distillation, kind: pattern.kind, thoughtIds: boundIds })
  }

  return { insight, patterns }
}
