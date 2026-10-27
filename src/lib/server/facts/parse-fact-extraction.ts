/**
 * Contract of the fact-candidate answer (docs/planning/user-facts-layer.md,
 * docs/planning/jev-everywhere-rollout.md). Pure validation of what the LLM returned: no text is
 * interpreted here, nothing is repaired, and no error message repeats a statement or an identifier
 * value (they flow into ingest logs).
 *
 * The chat model only PROPOSES candidate statements — the statement, who it names (a subject label,
 * null for the capture's author), the graph person it links to and the identifier it holds. It
 * decides nothing else: whether a candidate is worth keeping, who it is about, its kind and
 * whether it adds to, replaces or restates a stored fact are Jev's (decide-user-facts.ts), so this
 * contract has no op, kind or confidence — and none is read if a reply carries one.
 */

import type { ParsedIdentifier } from './fact-operations'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { redactSecrets } from '$lib/server/security/detect-secrets'
import {
  FACT_EXTRACTION_MAX_FACTS,
  FACT_STATEMENT_MAX_CHARS,
  SECURE_VALUE_KINDS,
  countSecurePlaceholders,
  type SecureValueKind,
} from './fact-vocabulary'

/** What the model was shown, by the ref it used (E1.. = known people). */
export type FactCandidateRefs = {
  entities: ReadonlyMap<string, string>
}

export type FactCandidate = {
  /** Display form: an identifier candidate's statement holds the placeholder, never the value. */
  statement: string
  /** The person as the capture names them ("Mia (friend)"); null: the statement is about the author. */
  subjectLabel: string | null
  /** The graph person the label stands for, when the model said which one of the Known people. */
  entityId: string | null
  /** A likely implication of what the user wrote rather than something they said. */
  inferred: boolean
  identifier: ParsedIdentifier | null
}

const FAIL_PREFIX = 'user fact extraction'

function fail(index: number | null, detail: string): never {
  throw new Error(
    index === null ? `${FAIL_PREFIX}: ${detail}` : `${FAIL_PREFIX}: candidate #${index + 1}: ${detail}`,
  )
}

/**
 * The model named a known person (E…) it was never offered. A recoverable slip of the model, told
 * apart from every other contract error so the extractor can ask once more. `detail` is what the
 * corrective re-ask needs, without the ref the model used.
 */
export class FactExtractionRefError extends Error {
  constructor(
    message: string,
    readonly detail: {
      /** Zero-based position of the candidate in the reply. */
      index: number
      /** Which list the ref should have come from. */
      list: 'known people'
      /** The key of the reply that held the ref. */
      field: 'entity'
    },
  ) {
    super(message)
    this.name = 'FactExtractionRefError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Credentials are never memory (docs/planning/secret-hygiene.md): format-based, no values in the error. */
function assertNoCredential(text: string, index: number, field: string): void {
  if (redactSecrets(text).findings.length > 0) {
    fail(index, `${field} holds a credential; credentials are never stored as facts`)
  }
}

function parseIdentifier(raw: unknown, index: number): ParsedIdentifier | null {
  if (raw === undefined || raw === null) return null
  if (!isRecord(raw)) fail(index, 'identifier must be an object or null')
  const { kind, label, value } = raw
  if (typeof kind !== 'string' || !(SECURE_VALUE_KINDS as readonly string[]).includes(kind)) {
    fail(index, `identifier kind must be one of ${SECURE_VALUE_KINDS.join(' | ')}`)
  }
  const identifierLabel = nonEmptyString(label)
  if (identifierLabel === null) fail(index, 'identifier needs a non-empty label')
  assertNoCredential(identifierLabel, index, 'identifier label')
  const identifierValue = nonEmptyString(value)
  if (identifierValue === null) fail(index, 'identifier needs a non-empty value')
  if (redactSecrets(identifierValue).findings.length > 0) {
    fail(index, 'identifier value is a credential; credentials are never stored as facts')
  }
  return { kind: kind as SecureValueKind, label: identifierLabel, value: identifierValue }
}

function parseCandidate(
  entry: Record<string, unknown>,
  index: number,
  refs: FactCandidateRefs,
): FactCandidate {
  const statement = nonEmptyString(entry.statement)
  if (statement === null) fail(index, 'statement must be a non-empty string')
  if (statement.length > FACT_STATEMENT_MAX_CHARS) {
    fail(index, `statement is longer than ${FACT_STATEMENT_MAX_CHARS} characters`)
  }
  assertNoCredential(statement, index, 'statement')

  let subjectLabel: string | null = null
  if (entry.subject !== undefined && entry.subject !== null) {
    subjectLabel = nonEmptyString(entry.subject)
    if (subjectLabel === null) fail(index, 'subject must be a non-empty string or null')
    assertNoCredential(subjectLabel, index, 'subject label')
  }

  let entityId: string | null = null
  const { entity } = entry
  if (entity !== undefined && entity !== null) {
    const resolved = typeof entity === 'string' ? refs.entities.get(entity) : undefined
    if (resolved === undefined) {
      throw new FactExtractionRefError(
        `${FAIL_PREFIX}: candidate #${index + 1}: entity ${JSON.stringify(entity)} was not offered`,
        { index, list: 'known people', field: 'entity' },
      )
    }
    if (subjectLabel === null) fail(index, 'an entity needs a subject label')
    entityId = resolved
  }

  const { inferred } = entry
  if (typeof inferred !== 'boolean') fail(index, 'inferred must be true or false')

  const identifier = parseIdentifier(entry.identifier, index)
  const placeholders = countSecurePlaceholders(statement)
  if (identifier === null && placeholders !== 0) {
    fail(index, 'the statement holds a secure-value placeholder but there is no identifier')
  }
  if (identifier !== null && placeholders !== 1) {
    fail(index, 'an identifier fact needs exactly one secure-value placeholder in its statement')
  }

  return { statement, subjectLabel, entityId, inferred, identifier }
}

export function parseFactCandidates(text: string, refs: FactCandidateRefs): FactCandidate[] {
  let parsed: unknown
  try {
    parsed = parseLlmJsonPayload(text)
  } catch {
    // the SyntaxError message quotes the reply; the reply may hold what was extracted
    fail(null, 'response is not valid JSON')
  }
  if (!isRecord(parsed)) fail(null, 'response is not a JSON object')
  const list = parsed.candidates
  if (!Array.isArray(list)) fail(null, 'candidates must be an array')
  if (list.length > FACT_EXTRACTION_MAX_FACTS) {
    fail(null, `at most ${FACT_EXTRACTION_MAX_FACTS} candidates per capture, got ${list.length}`)
  }

  const candidates = list.map((entry, index) => {
    if (!isRecord(entry)) fail(index, 'each candidate must be an object')
    return parseCandidate(entry, index, refs)
  })

  // an identifier's value must live only in its secure value: no statement of this capture holds it
  const identifierValues = candidates.flatMap((c) => (c.identifier ? [c.identifier.value] : []))
  candidates.forEach((candidate, index) => {
    if (identifierValues.some((value) => candidate.statement.includes(value))) {
      fail(
        index,
        'the statement contains the value of an identifier; values belong in "identifier" only',
      )
    }
  })

  return candidates
}
