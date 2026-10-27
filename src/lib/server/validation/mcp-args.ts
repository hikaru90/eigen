/**
 * Strict contracts for MCP tool args and similar surfaces (entity IDs, search bounds).
 */

const THOUGHT_ID_ARG_KEYS = ['thought_id', 'thoughtId', 'id'] as const

/** Accept canonical MCP keys and common LLM aliases from compact retrieve candidates. */
export function readThoughtIdFromToolArgs(
  body: Record<string, unknown>,
  name = 'thought_id',
): string {
  for (const key of THOUGHT_ID_ARG_KEYS) {
    const value = body[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return validateNonEmptyEntityId(value, name)
    }
  }
  return validateNonEmptyEntityId(undefined, name)
}

export function tryReadThoughtIdFromToolArgs(body: Record<string, unknown>): string | null {
  try {
    return readThoughtIdFromToolArgs(body)
  } catch {
    return null
  }
}

/** Raw lookup text the model passed when it mistook a description for thought_id. */
export function readDeleteLookupQueryFromToolArgs(body: Record<string, unknown>): string | null {
  for (const key of THOUGHT_ID_ARG_KEYS) {
    const value = body[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
  }
  return null
}

/**
 * A tool's arguments as a strict JSON object: anything but an object (or nothing) is refused, and
 * so is any key outside `allowed`, so a misspelt or aliased argument fails loudly instead of being
 * dropped.
 */
export function strictToolArgs(args: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
    throw new Error('Arguments must be a JSON object')
  }
  const body = (args ?? {}) as Record<string, unknown>
  const unknown = Object.keys(body).find((key) => !allowed.includes(key))
  if (unknown) {
    throw new Error(`Unknown argument: ${unknown}. Allowed: ${allowed.join(', ') || '(none)'}`)
  }
  return body
}

export function validateNonEmptyEntityId(value: string | undefined | null, name: string): string {
  if (value == null) {
    throw new Error(`Invalid ${name}: value is required`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error(`Invalid ${name}: cannot be empty or whitespace-only`)
  }
  if (/\s/.test(trimmed)) {
    throw new Error(`Invalid ${name}: cannot contain whitespace`)
  }
  return trimmed
}

export function validateSearchParams(options: {
  threshold?: number | null
  topK?: number | null
}): void {
  const { threshold, topK } = options
  if (threshold != null) {
    if (typeof threshold !== 'number' || Number.isNaN(threshold)) {
      throw new Error('threshold must be a valid number')
    }
    if (threshold < 0 || threshold > 1) {
      throw new Error(`Invalid threshold: ${threshold}. Must be between 0 and 1 (inclusive)`)
    }
  }
  if (topK != null) {
    if (!Number.isInteger(topK) || typeof topK === 'boolean') {
      throw new Error('top_k must be a valid integer')
    }
    if (topK < 0) {
      throw new Error(`Invalid top_k: ${topK}. Must be a non-negative integer`)
    }
  }
}
