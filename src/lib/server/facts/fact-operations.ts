/**
 * The typed result of deciding a capture's fact candidates — what `planFactWrites` turns into rows
 * (docs/planning/user-facts-layer.md, docs/planning/jev-everywhere-rollout.md). Pure types: no DB,
 * no LLM.
 *
 * Every field here was decided by the decision model (Jev) or is the candidate's own text: who the
 * fact is about, its kind, whether it is kept at all, its confidence (Jev's probability) and
 * whether it adds to, replaces or restates a stored fact.
 */

import type { FactKind, SecureValueKind } from './fact-vocabulary'

export type ParsedFactSubject =
  { kind: 'user' } | { kind: 'person'; label: string; entityId: string | null }

export type ParsedIdentifier = { kind: SecureValueKind; label: string; value: string }

export type ParsedFact = {
  subject: ParsedFactSubject
  kind: FactKind
  /** Display form: an identifier fact's statement holds the placeholder, never the value. */
  statement: string
  /** Jev's probability that the candidate is worth keeping (>= the 0.7 gate). */
  confidence: number
  inferred: boolean
  identifier: ParsedIdentifier | null
}

export type FactOperation =
  | { op: 'add'; fact: ParsedFact }
  | { op: 'update'; supersedesFactId: string; fact: ParsedFact }
  | { op: 'confirm'; factId: string }

/**
 * What a derivation did: the rows written, and the candidates that were not stored — dropped by
 * Jev (not a worthwhile fact, or already contained in a stored fact) or kept below the 0.7 gate.
 */
export type DerivedFactCounts = {
  added: number
  superseded: number
  confirmed: number
  droppedByJudge: number
  droppedLowConfidence: number
}

export const NO_DERIVED_FACTS: DerivedFactCounts = {
  added: 0,
  superseded: 0,
  confirmed: 0,
  droppedByJudge: 0,
  droppedLowConfidence: 0,
}
