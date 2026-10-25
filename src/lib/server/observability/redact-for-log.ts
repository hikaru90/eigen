/**
 * Redact likely secrets before logging or telemetry. Does not handle cyclic structures.
 */

const SENSITIVE_EXACT = new Set(
  [
    'api_key',
    'apikey',
    'secret',
    'secret_key',
    'private_key',
    'password',
    'access_token',
    'refresh_token',
    'authorization',
    'auth',
    'token',
    'client_secret',
  ].map((s) => s.toLowerCase()),
)

const SENSITIVE_SUFFIXES = ['_secret', '_token', '_password', '_key', '_credentials'] as const

const VECTOR_EXACT = new Set(
  ['embedding', 'summaryembedding', 'queryembedding', 'vector', 'embeddings'].map((s) =>
    s.toLowerCase(),
  ),
)

function isVectorField(name: string): boolean {
  return VECTOR_EXACT.has(name.toLowerCase())
}

/**
 * The one source of truth for "this name labels a credential" (log redaction and the free-text
 * secret detector in `security/detect-secrets.ts`). Spelling is folded first so `apiKey`,
 * `API-KEY` and `api_key` are one name.
 */
export function isSensitiveFieldName(name: string): boolean {
  const lower = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
  if (SENSITIVE_EXACT.has(lower)) return true
  return SENSITIVE_SUFFIXES.some((s) => lower.endsWith(s))
}

function redactValue(key: string, value: unknown): unknown {
  if (isSensitiveFieldName(key)) return '[REDACTED]'
  if (isVectorField(key)) return '[REDACTED_VECTOR]'
  if (value !== null && typeof value === 'object') return redactForLog(value)
  return value
}

export function redactForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactForLog)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v)
  }
  return out
}
