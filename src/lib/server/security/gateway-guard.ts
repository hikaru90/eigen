/**
 * Defence in depth at the LLM gateway (docs/planning/secret-hygiene.md, Design 3).
 *
 * Capture boundaries already hand downstream code redacted text, so on the capture path this
 * guard never finds anything (a test asserts exactly that). It exists for every other path that
 * reaches the gateway — Ask questions, chat, agent tool results, legacy rows — and for any future
 * caller that forgets the boundary. A finding is redacted, never forwarded, and logged as a
 * security warning with the call site (kinds and credential names only, never the value).
 */
import {
  redactSecrets,
  redactSecretsDeep,
  type SecretFinding,
} from '$lib/server/security/detect-secrets'

function warnRedacted(callSite: string, findings: SecretFinding[]): void {
  console.warn('[security.gateway-guard] redacted a secret before an outgoing call', {
    callSite,
    count: findings.length,
    kinds: [...new Set(findings.map((f) => f.kind))],
    names: [
      ...new Set(findings.map((f) => f.name).filter((name): name is string => name !== null)),
    ],
  })
}

/** Redacts one outgoing text; warns (without the value) when something was found. */
export function guardOutgoingText(text: string, callSite: string): string {
  const { text: safe, findings } = redactSecrets(text)
  if (findings.length > 0) warnRedacted(callSite, findings)
  return safe
}

/** Chat messages: every message body is scanned, one warning per call for all findings. */
export function guardOutgoingMessages<T extends { content: string }>(
  messages: T[],
  callSite: string,
): T[] {
  const all: SecretFinding[] = []
  const guarded = messages.map((message) => {
    const { text, findings } = redactSecrets(message.content)
    all.push(...findings)
    return findings.length > 0 ? { ...message, content: text } : message
  })
  if (all.length > 0) warnRedacted(callSite, all)
  return guarded
}

/** Embedding input: one string or a batch; one warning per call for all findings. */
export function guardOutgoingEmbeddingInput<T extends string | string[]>(
  input: T,
  callSite: string,
): T {
  const all: SecretFinding[] = []
  const scan = (text: string): string => {
    const { text: safe, findings } = redactSecrets(text)
    all.push(...findings)
    return safe
  }
  const guarded = (Array.isArray(input) ? input.map(scan) : scan(input)) as T
  if (all.length > 0) warnRedacted(callSite, all)
  return guarded
}

/**
 * A structured request body (the Jev decisions client sends `{ state, questions }`): every
 * string inside it is scanned; one warning per call for all findings.
 */
export function guardOutgoingValue<T>(value: T, callSite: string): T {
  const guarded = redactSecretsDeep(value)
  const findings = collectFindings(value)
  if (findings.length > 0) warnRedacted(callSite, findings)
  return guarded
}

function collectFindings(value: unknown): SecretFinding[] {
  if (typeof value === 'string') return redactSecrets(value).findings
  if (Array.isArray(value)) return value.flatMap(collectFindings)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectFindings)
  }
  return []
}
