/**
 * Contract of the fact-extraction answer (docs/planning/user-facts-layer.md). Pure validation of
 * what the LLM returned: no text is interpreted here, nothing is repaired, and no error message
 * repeats a statement or an identifier value (they flow into ingest logs).
 *
 * The model reconciles each fact it finds against the stored facts it was shown (referenced as F1,
 * F2, … — real ids never reach it): `add`, `update` (supersedes one stored fact), `confirm`
 * (restates one stored fact unchanged) or `none`. Facts below the confidence gate are dropped
 * and only counted.
 */

import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { redactSecrets } from '$lib/server/security/detect-secrets'
import {
  FACT_CONFIDENCE_MIN,
  FACT_EXTRACTION_MAX_FACTS,
  FACT_KINDS,
  FACT_STATEMENT_MAX_CHARS,
  SECURE_VALUE_KINDS,
  countSecurePlaceholders,
  type FactKind,
  type SecureValueKind,
} from './fact-vocabulary'

/** What the model was shown, by the ref it used (F1.. = stored facts, E1.. = known people). */
export type FactExtractionRefs = {
  facts: ReadonlyMap<string, string>
  entities: ReadonlyMap<string, string>
}

export type ParsedFactSubject =
  { kind: 'user' } | { kind: 'person'; label: string; entityId: string | null }

export type ParsedIdentifier = { kind: SecureValueKind; label: string; value: string }

export type ParsedFact = {
  subject: ParsedFactSubject
  kind: FactKind
  /** Display form: an identifier fact's statement holds the placeholder, never the value. */
  statement: string
  confidence: number
  inferred: boolean
  identifier: ParsedIdentifier | null
}

export type FactOperation =
  | { op: 'add'; fact: ParsedFact }
  | { op: 'update'; supersedesFactId: string; fact: ParsedFact }
  | { op: 'confirm'; factId: string }

export type ParsedFactExtraction = {
  operations: FactOperation[]
  /** Facts the model found with confidence below the gate: not stored. */
  droppedLowConfidence: number
}

const FAIL_PREFIX = 'user fact extraction'

function fail(index: number | null, detail: string): never {
  throw new Error(
    index === null ? `${FAIL_PREFIX}: ${detail}` : `${FAIL_PREFIX}: fact #${index + 1}: ${detail}`,
  )
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

function parseSubject(
  raw: unknown,
  index: number,
  entities: FactExtractionRefs['entities'],
): ParsedFactSubject {
  if (!isRecord(raw)) fail(index, 'subject must be an object')
  const { kind, label, entity } = raw
  if (kind === 'user') {
    if (entity !== undefined && entity !== null) fail(index, 'a subject of kind user has no entity')
    return { kind: 'user' }
  }
  if (kind !== 'person') fail(index, 'subject kind must be "user" or "person"')
  const personLabel = nonEmptyString(label)
  if (personLabel === null) fail(index, 'a person subject needs a non-empty label')
  assertNoCredential(personLabel, index, 'subject label')
  if (entity === undefined || entity === null) {
    return { kind: 'person', label: personLabel, entityId: null }
  }
  const entityId = typeof entity === 'string' ? entities.get(entity) : undefined
  if (entityId === undefined)
    fail(index, `subject entity ${JSON.stringify(entity)} was not offered`)
  return { kind: 'person', label: personLabel, entityId }
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

function parseFact(
  entry: Record<string, unknown>,
  index: number,
  refs: FactExtractionRefs,
): ParsedFact {
  const subject = parseSubject(entry.subject, index, refs.entities)

  const kind = entry.kind
  if (typeof kind !== 'string' || !(FACT_KINDS as readonly string[]).includes(kind)) {
    fail(index, `kind must be one of ${FACT_KINDS.join(' | ')}`)
  }

  const statement = nonEmptyString(entry.statement)
  if (statement === null) fail(index, 'statement must be a non-empty string')
  if (statement.length > FACT_STATEMENT_MAX_CHARS) {
    fail(index, `statement is longer than ${FACT_STATEMENT_MAX_CHARS} characters`)
  }
  assertNoCredential(statement, index, 'statement')

  const { confidence, inferred } = entry
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    fail(index, 'confidence must be a number in [0, 1]')
  }
  if (typeof inferred !== 'boolean') fail(index, 'inferred must be true or false')

  const identifier = parseIdentifier(entry.identifier, index)
  const placeholders = countSecurePlaceholders(statement)
  if (identifier === null && placeholders !== 0) {
    fail(index, 'the statement holds a secure-value placeholder but there is no identifier')
  }
  if (identifier !== null && placeholders !== 1) {
    fail(index, 'an identifier fact needs exactly one secure-value placeholder in its statement')
  }

  return { subject, kind: kind as FactKind, statement, confidence, inferred, identifier }
}

export function parseFactExtraction(text: string, refs: FactExtractionRefs): ParsedFactExtraction {
  let parsed: unknown
  try {
    parsed = parseLlmJsonPayload(text)
  } catch {
    // the SyntaxError message quotes the reply; the reply may hold what was extracted
    fail(null, 'response is not valid JSON')
  }
  if (!isRecord(parsed)) fail(null, 'response is not a JSON object')
  const list = parsed.facts
  if (!Array.isArray(list)) fail(null, 'facts must be an array')
  if (list.length > FACT_EXTRACTION_MAX_FACTS) {
    fail(null, `at most ${FACT_EXTRACTION_MAX_FACTS} facts per capture, got ${list.length}`)
  }

  const operations: FactOperation[] = []
  const identifierValues: string[] = []
  const kept: Array<{ index: number; fact: ParsedFact }> = []
  const claimed = new Set<string>()
  let droppedLowConfidence = 0

  const claimStored = (ref: unknown, field: string, index: number): string => {
    const factId = typeof ref === 'string' ? refs.facts.get(ref) : undefined
    if (factId === undefined) {
      fail(index, `${field} ${JSON.stringify(ref)} is not a stored fact that was offered`)
    }
    return factId
  }
  const useOnce = (ref: string, index: number) => {
    if (claimed.has(ref)) fail(index, `stored fact ${ref} is used by more than one operation`)
    claimed.add(ref)
  }

  list.forEach((entry, index) => {
    if (!isRecord(entry)) fail(index, 'each fact must be an object')
    const { op, supersedes, confirms } = entry

    if (op === 'none') return

    if (op === 'confirm') {
      if (supersedes !== undefined) fail(index, 'only an update has "supersedes"')
      const factId = claimStored(confirms, 'confirms', index)
      useOnce(confirms as string, index)
      operations.push({ op: 'confirm', factId })
      return
    }

    if (op !== 'add' && op !== 'update') {
      fail(index, 'op must be "add", "update", "confirm" or "none"')
    }
    if (confirms !== undefined) fail(index, 'only a confirm has "confirms"')
    if (op === 'add' && supersedes !== undefined) fail(index, 'only an update has "supersedes"')
    const supersedesFactId = op === 'update' ? claimStored(supersedes, 'supersedes', index) : null

    const fact = parseFact(entry, index, refs)
    if (fact.identifier) identifierValues.push(fact.identifier.value)

    if (fact.confidence < FACT_CONFIDENCE_MIN) {
      droppedLowConfidence += 1
      return
    }
    if (op === 'update') {
      useOnce(supersedes as string, index)
      operations.push({ op: 'update', supersedesFactId: supersedesFactId!, fact })
    } else {
      operations.push({ op: 'add', fact })
    }
    kept.push({ index, fact })
  })

  // an identifier's value must live only in its secure value: no statement of this capture holds it
  for (const { index, fact } of kept) {
    if (identifierValues.some((value) => fact.statement.includes(value))) {
      fail(
        index,
        'the statement contains the value of an identifier; values belong in "identifier" only',
      )
    }
  }

  return { operations, droppedLowConfidence }
}
