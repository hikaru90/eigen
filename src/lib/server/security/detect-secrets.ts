/**
 * Format-based secret redaction for free text (docs/planning/secret-hygiene.md, Design 1).
 *
 * A credential the user pastes must never reach an LLM, an embedding, an index, a cue, a graph
 * entity or an MCP result. This module is the one place that finds them. It is pure and decides
 * by FORMAT only (provider key shapes, JWT / PEM / URL-password structure, `credential_name =
 * value` assignments) — redaction is explicitly allowed without an LLM (AGENTS.md "LLM as judge":
 * "Allowed without LLM: … redaction"). It never judges what text MEANS: no entropy guessing (ids
 * and hashes would false-positive), no "is this sensitive personal data" calls.
 *
 * The credential-NAME rules are shared with log redaction (`isSensitiveFieldName`), one source of
 * truth. Placeholders keep the non-secret name (`LLM_API_KEY=[redacted secret]`) so the FACT that
 * a credential exists can still be remembered, never its value. Findings carry kind, name and
 * span in the input — never the value.
 */
import { isSensitiveFieldName } from '$lib/server/observability/redact-for-log'

export const SECRET_PLACEHOLDER = '[redacted secret]'

/**
 * A placeholder that carries the secret's ordinal in the text it was cut from
 * (`[redacted secret #2]`). Note text served to the chat agent uses these, so the agent can write
 * a placeholder back and the server can restore the real value (docs/planning/secret-hygiene.md,
 * Part 2). The ordinal is 1-based, in text order.
 */
export function numberedSecretPlaceholder(ordinal: number): string {
  return `[redacted secret #${ordinal}]`
}

/** Either placeholder form at a position — "already redacted" for the readers below. */
const PLACEHOLDER_AT = /\[redacted secret(?: #[1-9]\d*)?\]/y

function placeholderAt(text: string, from: number): boolean {
  PLACEHOLDER_AT.lastIndex = from
  return PLACEHOLDER_AT.test(text)
}

export type SecretKind =
  | 'api_key'
  | 'access_token'
  | 'jwt'
  | 'private_key'
  | 'connection_string'
  /** A value assigned to a credential name (`password: …`) whose format is not otherwise known. */
  | 'credential'

export type SecretFinding = {
  kind: SecretKind
  /** Variable name when the value was assigned to one (`LLM_API_KEY`), else the provider (`github`). */
  name: string | null
  /** Offsets of the secret VALUE in the text that was scanned. */
  start: number
  end: number
}

export type RedactedSecretSummary = { kind: SecretKind; name: string | null }

type RawFinding = SecretFinding & { origin: 'format' | 'assignment' }

type FormatRule = { kind: SecretKind; name: string | null; pattern: RegExp; group?: number }

const KEY_BODY = '[A-Za-z0-9_-]'

const FORMAT_RULES: FormatRule[] = [
  {
    kind: 'private_key',
    name: null,
    // header to footer; a truncated paste (no footer) is redacted to the end of the text
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  },
  { kind: 'api_key', name: 'anthropic', pattern: new RegExp(`\\bsk-ant-${KEY_BODY}{20,}`, 'g') },
  { kind: 'api_key', name: 'openrouter', pattern: new RegExp(`\\bsk-or-${KEY_BODY}{20,}`, 'g') },
  {
    kind: 'api_key',
    name: 'openai',
    // the digit lookahead keeps hyphenated prose ("sk-learn-pipeline-…") from matching
    pattern: new RegExp(
      `\\bsk-(?!ant-|or-)(?=${KEY_BODY}*\\d)(?:proj-|svcacct-|admin-)?${KEY_BODY}{20,}`,
      'g',
    ),
  },
  { kind: 'access_token', name: 'github', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g },
  { kind: 'access_token', name: 'github', pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { kind: 'access_token', name: 'gitlab', pattern: new RegExp(`\\bglpat-${KEY_BODY}{20,}`, 'g') },
  { kind: 'access_token', name: 'slack', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'api_key', name: 'aws', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'api_key', name: 'google', pattern: new RegExp(`\\bAIza${KEY_BODY}{35}`, 'g') },
  { kind: 'api_key', name: 'stripe', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  {
    kind: 'jwt',
    name: null,
    pattern: new RegExp(`\\beyJ${KEY_BODY}{5,}\\.eyJ${KEY_BODY}{5,}\\.${KEY_BODY}*`, 'g'),
  },
  {
    kind: 'access_token',
    name: 'bearer',
    // `Bearer <token>`: the digit lookahead keeps "Bearer authentication-mechanism" prose out
    pattern: /\bBearer[ \t]+((?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{16,})/g,
    group: 1,
  },
  {
    kind: 'connection_string',
    name: null,
    // scheme://user:PASSWORD@host — the password runs to the last '@' before the path; empty user ok
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:([^\s/@][^\s/]*)@/gi,
    group: 1,
  },
]

/** `NAME = value` / `NAME: value` / `NAME := value`, the name optionally quoted (JSON, YAML, .env). */
const ASSIGNMENT =
  /(?<![A-Za-z0-9_.-])(["'`]?)([A-Za-z_][A-Za-z0-9_.-]*)\1[ \t]*(?:=(?!=)|:=?)[ \t]*/g
/** `--name value` / `--name=value` command-line flags. */
const CLI_FLAG = /(?<![\w-])--([A-Za-z][A-Za-z0-9_-]*)(=|[ \t]+)/g

const QUOTES = new Set(['"', "'", '`'])
/** HTTP auth schemes: the credential is the token that follows the scheme word. */
const AUTH_SCHEMES = new Set(['bearer', 'basic'])

type ValueSpan = { start: number; end: number }

function isReference(value: string): boolean {
  return (
    value.startsWith('$') ||
    value.startsWith('%') ||
    value.startsWith('<') ||
    value.startsWith('{{') ||
    value.startsWith('//') ||
    value.startsWith('process.env') ||
    value.startsWith('os.environ')
  )
}

/** The value that starts at `from`: a quoted string (inner span) or one unquoted token. */
function readValue(
  text: string,
  from: number,
  options: { noLeadingDash: boolean; proseGuard: boolean },
): ValueSpan | null {
  const first = text[from]
  if (first === undefined || first === '\n' || first === '\r') return null
  // already redacted (the placeholder holds a space, so a token read would cut it short)
  if (placeholderAt(text, from)) return null

  if (QUOTES.has(first)) {
    let close = from + 1
    while (close < text.length && text[close] !== first && text[close] !== '\n') close += 1
    if (text[close] !== first || close === from + 1) return null
    const inner = text.slice(from + 1, close)
    if (inner.trim() === '' || isReference(inner) || placeholderAt(inner, 0)) return null
    return { start: from + 1, end: close }
  }

  let end = from
  while (end < text.length && !/[\s"'`]/.test(text[end]!)) end += 1
  if (end === from) return null
  const token = text.slice(from, end)
  if (isReference(token)) return null
  if (options.noLeadingDash && token.startsWith('-')) return null
  // `Secret: I love pizza` is a sentence, not an assignment: after a bare colon, a value made of
  // letters only and followed by more words on the line is prose. `password: hunter2` (a digit or
  // symbol) and `password: hunter` (last on its line) are still values. `=` is never guarded.
  if (
    options.proseGuard &&
    /^\p{L}+$/u.test(token) &&
    text.slice(end).split('\n')[0]!.trim() !== ''
  ) {
    return null
  }

  if (AUTH_SCHEMES.has(token.toLowerCase())) {
    // `Authorization: Bearer <token>` — the scheme word is not the secret, the token after it is
    const rest = /^[ \t]+([^\s"'`]+)/.exec(text.slice(end))
    if (!rest || isReference(rest[1]!)) return null
    const start = end + rest[0].length - rest[1]!.length
    return { start, end: start + rest[1]!.length }
  }
  return { start: from, end }
}

function findFormats(text: string): RawFinding[] {
  const found: RawFinding[] = []
  for (const rule of FORMAT_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const group = rule.group ?? 0
      const value = match[group]
      if (value === undefined || value.length === 0) continue
      const start = group === 0 ? match.index! : match.index! + match[0].indexOf(value)
      found.push({
        kind: rule.kind,
        name: rule.name,
        start,
        end: start + value.length,
        origin: 'format',
      })
    }
  }
  return found
}

function findAssignments(text: string): RawFinding[] {
  const found: RawFinding[] = []
  const push = (name: string, value: ValueSpan | null) => {
    if (!value || !isSensitiveFieldName(name)) return
    found.push({ kind: 'credential', name, ...value, origin: 'assignment' })
  }
  for (const match of text.matchAll(ASSIGNMENT)) {
    const after = match.index! + match[0].length
    push(
      match[2]!,
      readValue(text, after, { noLeadingDash: false, proseGuard: !match[0].includes('=') }),
    )
  }
  for (const match of text.matchAll(CLI_FLAG)) {
    const after = match.index! + match[0].length
    push(match[1]!, readValue(text, after, { noLeadingDash: match[2] !== '=', proseGuard: false }))
  }
  return found
}

/** Union of overlapping findings: a recognised format names the kind, an assignment names the name. */
function mergeFindings(raw: RawFinding[]): SecretFinding[] {
  const sorted = [...raw].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: RawFinding[][] = []
  let currentEnd = -1
  for (const finding of sorted) {
    const group = merged[merged.length - 1]
    if (group && finding.start < currentEnd) {
      group.push(finding)
      currentEnd = Math.max(currentEnd, finding.end)
    } else {
      merged.push([finding])
      currentEnd = finding.end
    }
  }
  return merged.map((group) => {
    const format = group.find((f) => f.origin === 'format')
    const assignment = group.find((f) => f.origin === 'assignment')
    return {
      kind: format ? format.kind : 'credential',
      name: assignment?.name ?? format?.name ?? null,
      start: Math.min(...group.map((f) => f.start)),
      end: Math.max(...group.map((f) => f.end)),
    }
  })
}

function redactWith(
  text: string,
  placeholder: (ordinal: number) => string,
): { text: string; findings: SecretFinding[] } {
  if (text.length === 0) return { text, findings: [] }
  const findings = mergeFindings([...findFormats(text), ...findAssignments(text)])
  if (findings.length === 0) return { text, findings }

  let out = ''
  let cursor = 0
  findings.forEach((finding, index) => {
    out += text.slice(cursor, finding.start) + placeholder(index + 1)
    cursor = finding.end
  })
  out += text.slice(cursor)
  return { text: out, findings }
}

/**
 * Replaces every detected secret VALUE with `[redacted secret]`, keeping surrounding text and
 * non-secret names. Idempotent. Returns the findings (kind, name, span in `text`) — never values.
 */
export function redactSecrets(text: string): { text: string; findings: SecretFinding[] } {
  return redactWith(text, () => SECRET_PLACEHOLDER)
}

/**
 * Like `redactSecrets`, but each placeholder carries its 1-based ordinal in `text`
 * (`[redacted secret #n]`, n = index into `findings`). Deterministic: the same text always
 * yields the same ordinals. Idempotent on its own output.
 */
export function redactSecretsNumbered(text: string): { text: string; findings: SecretFinding[] } {
  return redactWith(text, numberedSecretPlaceholder)
}

/** Just the redacted text — for call sites that do not report findings. */
export function redactedText(text: string): string {
  return redactSecrets(text).text
}

/** What the capture response / metadata records: `[{kind, name}]`, deduped, in text order. */
export function summarizeRedactedSecrets(findings: SecretFinding[]): RedactedSecretSummary[] {
  const seen = new Set<string>()
  const summary: RedactedSecretSummary[] = []
  for (const { kind, name } of findings) {
    const key = `${kind}\u0000${name ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    summary.push({ kind, name })
  }
  return summary
}

/**
 * The `secretsRedacted` list a capture recorded in its metadata (kind + name, never a value);
 * `[]` when the metadata has none. Entries of the wrong shape are dropped, not repaired.
 */
export function readSecretsRedacted(
  metadata: Record<string, unknown> | null | undefined,
): RedactedSecretSummary[] {
  const list = metadata?.secretsRedacted
  if (!Array.isArray(list)) return []
  const out: RedactedSecretSummary[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const { kind, name } = entry as { kind?: unknown; name?: unknown }
    if (typeof kind !== 'string') continue
    out.push({ kind: kind as SecretKind, name: typeof name === 'string' ? name : null })
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/**
 * Deep copy with every string redacted (tool results, metadata). Keys, numbers, booleans, Dates
 * and other non-plain values pass through; the input is never mutated.
 */
export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value).text as T
  if (Array.isArray(value)) return value.map((item) => redactSecretsDeep(item)) as T
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactSecretsDeep(item)
    return out as T
  }
  return value
}
