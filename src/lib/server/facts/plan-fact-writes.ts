/**
 * From validated extraction operations to the rows to write (docs/planning/user-facts-layer.md).
 * Pure: ids are generated here (so the encrypted statement can already carry its secure reference
 * before the transaction), nothing touches the database or an LLM.
 *
 * The one rule that matters: an identifier's value lives only in `secureValue.value`. Everything
 * an index, an embedding or a prompt will ever see — `displayStatement`, `lexicalText` — is built
 * from the placeholder form.
 */

import type { FactOperation, ParsedFactSubject } from './parse-fact-extraction'
import { randomUUID } from 'node:crypto'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { bindSecureReference, type FactKind, type SecureValueKind } from './fact-vocabulary'

export type PlannedSecureValue = {
  id: string
  kind: SecureValueKind
  label: string
  /** In memory only until it is encrypted into `user_secure_value`; never logged, embedded or indexed. */
  value: string
}

export type PlannedFact = {
  id: string
  subject: ParsedFactSubject
  kind: FactKind
  /** The statement as every index and prompt sees it (identifier facts: placeholder, no id, no value). */
  displayStatement: string
  /** The statement as stored (encrypted): identifier facts hold `[secure:<id>]`. */
  storedStatement: string
  lexicalText: string
  confidence: number
  inferred: boolean
  secureValue: PlannedSecureValue | null
  /** An update: the stored fact this one replaces. */
  supersedesFactId: string | null
}

export type FactWritePlan = {
  /** New facts (adds and updates), in operation order. */
  adds: PlannedFact[]
  /** Stored facts the capture restates unchanged. */
  confirms: string[]
}

export function planFactWrites(
  operations: FactOperation[],
  newId: () => string = randomUUID,
): FactWritePlan {
  const adds: PlannedFact[] = []
  const confirms: string[] = []

  for (const operation of operations) {
    if (operation.op === 'confirm') {
      confirms.push(operation.factId)
      continue
    }
    const { fact } = operation
    const id = newId()
    const secureValue: PlannedSecureValue | null = fact.identifier
      ? { id: newId(), ...fact.identifier }
      : null
    const subjectLabel = fact.subject.kind === 'person' ? fact.subject.label : ''
    adds.push({
      id,
      subject: fact.subject,
      kind: fact.kind,
      displayStatement: fact.statement,
      storedStatement: secureValue
        ? bindSecureReference(fact.statement, secureValue.id)
        : fact.statement,
      lexicalText: computeLexicalText(`${subjectLabel} ${fact.statement}`),
      confidence: fact.confidence,
      inferred: fact.inferred,
      secureValue,
      supersedesFactId: operation.op === 'update' ? operation.supersedesFactId : null,
    })
  }
  return { adds, confirms }
}
