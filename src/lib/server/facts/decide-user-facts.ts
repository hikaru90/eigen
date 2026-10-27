/**
 * The decisions about a capture's fact candidates (docs/planning/jev-everywhere-rollout.md, J1):
 * every one of them is Jev's, asked per candidate in ONE batched Decisions call (the chat model
 * only proposed the candidates, extract-user-facts.ts):
 *
 * - `fact_keep`: keep (a complete, personally relevant fact about a person) or drop (a fragment,
 *   trivia, a document's topic, a writing-task note, a request). Jev's probability of "keep" is the
 *   stored confidence; below the 0.7 gate (Q2) a candidate is not stored.
 * - `fact_subject`: the capture's author (user) or someone else (person).
 * - `fact_kind`: one of the fact catalog.
 * - `fact_reconcile`: against the stored facts nearest to the candidate — add, none (already
 *   contained), update (it replaces one stored fact) or confirm (it restates one).
 *
 * Code validates the answers against the closed sets, turns them into the typed operations
 * `planFactWrites` writes, and decides nothing by reading a statement: a missing or off-catalog
 * answer, or a person without a label to attribute the fact to, throws into the caller's retry
 * ladder. There is no fallback to keeping everything, and the chat model is never asked.
 */

import type { FactOperation, ParsedFact, ParsedFactSubject } from './fact-operations'
import type { FactCandidate } from './parse-fact-extraction'
import {
  runEnforcedBoundedDecisions,
  type BoundedDecisionSpec,
} from '$lib/server/llm/decision-plane'
import {
  FACT_CONFIDENCE_MIN,
  FACT_KINDS,
  SECURE_VALUE_PLACEHOLDER,
  statementForIndex,
  type FactKind,
  type FactSubjectKind,
} from './fact-vocabulary'

/** A stored fact near a candidate, as Jev sees it (the statement may still hold its secure reference). */
export type NearestFact = {
  id: string
  subjectKind: FactSubjectKind
  subjectLabel: string | null
  kind: FactKind
  statement: string
  inferred: boolean
  asOf: Date
}

/** The reference text joins the state as an excerpt only: the candidates are what is judged. */
export const FACT_DECISION_REFERENCE_MAX_CHARS = 4_000

export const FACT_KEEP_CRITERIA = {
  keep: 'A complete statement about one person (the capture\'s author or someone in their life) that would change how an assistant should treat or advise that person: a preference, dislike, habit, activity, health condition or need, circumstance (job, place, household), relationship, plan or goal, constraint or personality trait. It may be implied by the capture rather than stated, as long as the implication is clear.',
  drop: 'Not worth storing: a sentence fragment or an incomplete statement, trivia or a passing detail with no bearing on the person (a scent, a weather remark, a one-off event), the topic or content of a document, recipe, article or code, a note about a writing or work task rather than about the person, a request or instruction to the assistant, or general knowledge.',
} as const

export const FACT_SUBJECT_CRITERIA = {
  user: 'The fact is about the author of the capture (the user themselves).',
  person:
    'The fact is about someone else — a friend, relative, colleague or other named or described person in the user\'s life — and not about the user.',
} as const

export const FACT_KIND_CRITERIA: Record<FactKind, string> = {
  preference: 'Something the person likes or prefers.',
  dislike: 'Something the person dislikes or avoids by preference.',
  habit: 'A recurring behaviour or routine.',
  activity: 'Something the person does or takes part in (sports, hobbies, work activities).',
  health: 'A health condition, symptom, medication or dietary need.',
  circumstance: 'A situation: job, home, place, household, living situation.',
  relationship: 'A relationship between the person and someone else.',
  plan: 'A goal or plan for the future.',
  constraint: 'Something the person cannot do, must not do, or is limited by.',
  trait: 'A personality trait or characteristic.',
}

type ReconcileTarget = { op: 'update' | 'confirm'; factId: string }

/**
 * The reconcile choices for one candidate: add, none, and — per nearest stored fact F1…Fn — update
 * and confirm. The choice keys double as the closed set; `targets` maps update_Fn / confirm_Fn back to
 * the stored fact (no key is parsed, no id ever reaches Jev).
 */
function reconcileChoices(nearest: NearestFact[]): {
  criteria: Record<string, string>
  targets: Map<string, ReconcileTarget>
} {
  const criteria: Record<string, string> = {
    add: 'The candidate states something none of the stored facts states: store it as a new fact.',
    none: 'Nothing to write: the candidate is already contained in a stored fact (it is less specific than it, or only a part of it) and says nothing new.',
  }
  const targets = new Map<string, ReconcileTarget>()
  nearest.forEach((fact, i) => {
    const ref = `F${i + 1}`
    const about = fact.subjectKind === 'user' ? 'the user' : (fact.subjectLabel ?? 'a person')
    const described = `"${statementForIndex(fact.statement)}" (${fact.kind}, about ${about}, as of ${fact.asOf.toISOString().slice(0, 10)})`
    criteria[`update_${ref}`] =
      `The candidate changes, corrects or ends stored fact ${ref}: the stored fact is no longer true and the candidate says what is true now. Stored fact ${ref}: ${described}.`
    criteria[`confirm_${ref}`] =
      `The candidate says the same as stored fact ${ref} again, unchanged: the stored fact is confirmed and nothing new is stored. Stored fact ${ref}: ${described}.`
    targets.set(`update_${ref}`, { op: 'update', factId: fact.id })
    targets.set(`confirm_${ref}`, { op: 'confirm', factId: fact.id })
  })
  return { criteria, targets }
}

function describeCandidate(candidate: FactCandidate): string {
  const subject = candidate.subjectLabel ?? 'none given: the statement is about the author of the capture'
  return `Candidate fact: "${candidate.statement}"\nProposed subject: ${subject}.${
    candidate.inferred ? '\nThe statement is implied by the capture rather than stated.' : ''
  }`
}

/**
 * The Decisions `state`: the capture (and an excerpt of its reference text) with every identifier
 * value the candidates carry replaced by the placeholder — Jev judges the statements, it has no
 * use for the value, which lives only in its secure store.
 */
function buildState(input: {
  text: string
  referenceText?: string | null
  capturedAt: Date
  candidates: FactCandidate[]
}): string {
  const values = input.candidates.flatMap((c) => (c.identifier ? [c.identifier.value] : []))
  const masked = (text: string) =>
    values.reduce((acc, value) => acc.split(value).join(SECURE_VALUE_PLACEHOLDER), text)
  const sections = [
    `Capture written on: ${input.capturedAt.toISOString().slice(0, 10)}`,
    `Capture:\n<<<capture\n${masked(input.text)}\ncapture>>>`,
  ]
  const reference = input.referenceText?.trim()
  if (reference) {
    sections.push(
      `Reference text that came with the capture (excerpt):\n<<<reference\n${masked(reference).slice(0, FACT_DECISION_REFERENCE_MAX_CHARS)}\nreference>>>`,
    )
  }
  return sections.join('\n\n')
}

export type DecidedFacts = {
  /** What to write, in candidate order: add, update (supersedes) or confirm. */
  operations: FactOperation[]
  /** For each add / update operation, in order: the index of its candidate (embeddings, provenance). */
  candidateIndexes: number[]
  /** Dropped by Jev: fact_keep = drop, or reconcile = none (already contained in a stored fact). */
  droppedByJudge: number
  /** Kept by Jev but below the confidence gate. */
  droppedLowConfidence: number
}

export async function decideFactCandidates(input: {
  userId: string
  /** The capture text this thought stands for, secret-redacted. */
  text: string
  referenceText?: string | null
  capturedAt: Date
  candidates: FactCandidate[]
  /** The stored facts nearest to each candidate, in candidate order. */
  nearest: NearestFact[][]
}): Promise<DecidedFacts> {
  const { candidates, nearest } = input
  if (nearest.length !== candidates.length) {
    throw new Error('decideFactCandidates: one nearest-facts list per candidate is required')
  }
  if (candidates.length === 0) {
    return { operations: [], candidateIndexes: [], droppedByJudge: 0, droppedLowConfidence: 0 }
  }

  const reconcile = new Map<number, ReturnType<typeof reconcileChoices>>()
  const specs: BoundedDecisionSpec[] = candidates.flatMap((candidate, i) => {
    const ref = `c${i + 1}`
    const described = describeCandidate(candidate)
    const own: BoundedDecisionSpec[] = [
      {
        decisionKind: 'fact_keep',
        id: `fact_keep:${ref}`,
        subjectRef: ref,
        question: {
          type: 'choice',
          instructions: `${described}\n\nIs this a complete, personally relevant fact about a person?`,
          criteria: FACT_KEEP_CRITERIA,
        },
        llmChoice: null,
      },
      {
        decisionKind: 'fact_subject',
        id: `fact_subject:${ref}`,
        subjectRef: ref,
        question: {
          type: 'choice',
          instructions: `${described}\n\nWho is this fact about?`,
          criteria: FACT_SUBJECT_CRITERIA,
        },
        llmChoice: null,
      },
      {
        decisionKind: 'fact_kind',
        id: `fact_kind:${ref}`,
        subjectRef: ref,
        question: {
          type: 'choice',
          instructions: `${described}\n\nWhich kind of fact is this?`,
          criteria: FACT_KIND_CRITERIA,
        },
        llmChoice: null,
      },
    ]
    // Nothing stored near the candidate: update and confirm are impossible, so there is nothing to
    // reconcile and the candidate is a plain add.
    if (nearest[i]!.length > 0) {
      const choices = reconcileChoices(nearest[i]!)
      reconcile.set(i, choices)
      own.push({
        decisionKind: 'fact_reconcile',
        id: `fact_reconcile:${ref}`,
        subjectRef: ref,
        question: {
          type: 'choice',
          instructions: `${described}\n\nHow does this candidate relate to the stored facts?`,
          criteria: choices.criteria,
        },
        llmChoice: null,
      })
    }
    return own
  })

  const answers = await runEnforcedBoundedDecisions({
    userId: input.userId,
    surface: 'fact_derivation',
    state: buildState(input),
    specs,
  })
  const answerOf = (id: string) => {
    const answer = answers.get(id)
    if (!answer) throw new Error(`decideFactCandidates: no answer for ${id}`)
    return answer
  }

  const operations: FactOperation[] = []
  const candidateIndexes: number[] = []
  let droppedByJudge = 0
  let droppedLowConfidence = 0

  candidates.forEach((candidate, i) => {
    const ref = `c${i + 1}`
    const keep = answerOf(`fact_keep:${ref}`)
    const keepProbability = keep.probabilities['keep']
    if (keep.choice === 'keep' && typeof keepProbability !== 'number') {
      throw new Error(`decideFactCandidates: fact_keep for candidate #${i + 1} chose keep without a keep probability`)
    }
    if (keep.choice !== 'keep') {
      droppedByJudge += 1
      return
    }
    const confidence = keepProbability as number
    if (confidence < FACT_CONFIDENCE_MIN) {
      droppedLowConfidence += 1
      return
    }

    const subjectChoice = answerOf(`fact_subject:${ref}`).choice
    let subject: ParsedFactSubject
    if (subjectChoice === 'user') {
      subject = { kind: 'user' }
    } else if (subjectChoice === 'person') {
      if (candidate.subjectLabel === null) {
        throw new Error(
          `decideFactCandidates: candidate #${i + 1}: Jev says the fact is about a person but no subject label was proposed`,
        )
      }
      subject = { kind: 'person', label: candidate.subjectLabel, entityId: candidate.entityId }
    } else {
      throw new Error(`decideFactCandidates: fact_subject "${subjectChoice}" for candidate #${i + 1}`)
    }

    const kindChoice = answerOf(`fact_kind:${ref}`).choice
    if (!(FACT_KINDS as readonly string[]).includes(kindChoice)) {
      throw new Error(`decideFactCandidates: fact_kind "${kindChoice}" for candidate #${i + 1}`)
    }

    const fact: ParsedFact = {
      subject,
      kind: kindChoice as FactKind,
      statement: candidate.statement,
      confidence,
      inferred: candidate.inferred,
      identifier: candidate.identifier,
    }

    const choices = reconcile.get(i)
    if (!choices) {
      operations.push({ op: 'add', fact })
      candidateIndexes.push(i)
      return
    }
    const reconcileChoice = answerOf(`fact_reconcile:${ref}`).choice
    if (reconcileChoice === 'add') {
      operations.push({ op: 'add', fact })
      candidateIndexes.push(i)
    } else if (reconcileChoice === 'none') {
      droppedByJudge += 1
    } else {
      const target = choices.targets.get(reconcileChoice)
      if (!target) {
        throw new Error(`decideFactCandidates: fact_reconcile "${reconcileChoice}" for candidate #${i + 1}`)
      }
      if (target.op === 'update') {
        operations.push({ op: 'update', supersedesFactId: target.factId, fact })
        candidateIndexes.push(i)
      } else {
        operations.push({ op: 'confirm', factId: target.factId })
      }
    }
  })

  return { operations, candidateIndexes, droppedByJudge, droppedLowConfidence }
}
