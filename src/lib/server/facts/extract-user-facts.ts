/**
 * Fact candidates (docs/planning/user-facts-layer.md, F1; decisions moved to the decision model in
 * docs/planning/jev-everywhere-rollout.md, J1): ONE json-mode LLM call per capture. The model reads
 * the (secret-redacted) capture, the reference text that came with it and the people already known
 * from it, and PROPOSES candidate statements — the statement, who it names, the graph person it
 * links to, whether it is inferred and the identifier it holds.
 *
 * It decides nothing else. Whether a candidate is worth keeping, who it is about, what kind of fact
 * it is and whether it adds to, replaces or restates a stored fact are Jev's questions
 * (decide-user-facts.ts), asked per candidate in one batched call. Code only builds the prompt,
 * calls the gateway and validates the answer's contract (`parseFactCandidates`); nothing is repaired
 * or decided by string rules.
 *
 * Operator decisions baked into the prompt (Q1–Q4): candidates are statements about people, also
 * from reference material; inferred ones are marked; identifier values are returned separately and
 * never written into a statement.
 *
 * One exception to "one call": a reply that names a known person it was never offered is asked
 * again once, with its own reply and a short correction. Every other contract error, and a second
 * wrong reply, throws into the caller's retry ladder.
 */

import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { SECURE_VALUE_KINDS, SECURE_VALUE_PLACEHOLDER } from './fact-vocabulary'
import {
  FactExtractionRefError,
  parseFactCandidates,
  type FactCandidate,
  type FactCandidateRefs,
} from './parse-fact-extraction'

export const USER_FACT_CANDIDATE_PROMPT = [
  "You list the candidate facts a personal memory could store about people. You get one capture the user wrote (sometimes with reference text that came with it) and the people already known from it. Return JSON only — no markdown fences.",
  '',
  "A candidate is one short statement about ONE person: the user (the author of the capture) or a person in the user's life. List what the capture says or clearly implies about people: preferences and dislikes, habits, activities, health conditions and needs, circumstances (job, home, household, place), relationships, plans and goals, constraints, personality traits.",
  '',
  'You only propose. A separate judge decides afterwards whether each candidate is worth keeping, who it is about, what kind of fact it is and whether it is already stored — so do not rate, classify, compare or filter your list yourself.',
  '- Reference text is read only for what it reveals about people ("an early morning out on the waves before the keynote" in an email the user wrote shows the user surfs). A candidate is always a statement about a person, never about the subject matter of a document, recipe, article, code or news.',
  '- Name the person each statement is about. What the user says about a friend is a statement about that friend, never about the user, and the other way round.',
  '- Credentials (passwords, API keys, tokens) are never candidates. They appear as "[redacted secret]"; never copy that placeholder into a statement as if it were a value.',
  '',
  'Inferred: you may state what the text clearly implies but does not say. Set "inferred": true for those; do not guess beyond what the text supports.',
  '',
  `Identifiers: personal identifiers (email address, phone number, postal address, licence plate, account / IBAN / ID / policy number, date of birth) are candidates too, but their value must never appear in "statement". Give the value only in "identifier": {"kind": <identifier kind>, "label": <what it is, e.g. "licence plate">, "value": <exactly as written>}, and write the statement with the literal text ${SECURE_VALUE_PLACEHOLDER} where the value would stand, e.g. "The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}". An identifier candidate has exactly one ${SECURE_VALUE_PLACEHOLDER}; every other candidate has none. One identifier per candidate.`,
  '',
  'Subject: the person the statement is about, as the capture names them, with the relation if given (e.g. "Mia (friend)"); null when the statement is about the user. Entity: the E-ref of the same person from Known people, else null.',
  "Statement: one short, self-contained sentence in the capture's own language that names its subject. Write what is true, not that the capture says so.",
  '',
  'Return exactly: {"candidates":[{"statement":"<statement>","subject":"<person label>"|null,"entity":"<E-ref>"|null,"inferred":true|false,"identifier":null|{"kind":"<identifier kind>","label":"<label>","value":"<value>"}}]}',
  `identifier kind is one of: ${SECURE_VALUE_KINDS.join(', ')}.`,
  'If the capture says nothing about any person, return {"candidates":[]}.',
  'Judge by meaning, in any language.',
].join('\n')

/** The part of the user message that always comes first: long enough that the capture never lands in the activity log's 300-character context. */
const TASK_HEADER =
  "Task: from the capture below, list the candidate facts about the user or about people in the user's life, and answer with the JSON object described in the system message. Use the known people only to link a person to the graph; never copy them into a new candidate. Reference material is read only for what it reveals about people. You only propose candidates: a separate judge decides what is kept."

/** A graph entity already linked to the capture. */
export type KnownPerson = { id: string; label: string; entityType: string }

export type ExtractFactCandidatesInput = {
  userId: string
  /** The capture text this thought stands for, secret-redacted. */
  text: string
  /** Reference text (a saved note) that came with the capture, secret-redacted. */
  referenceText?: string | null
  capturedAt: Date
  people: KnownPerson[]
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function buildFactCandidateMessages(input: ExtractFactCandidatesInput): {
  messages: ChatMessage[]
  refs: FactCandidateRefs
} {
  const entityRefs = new Map<string, string>()
  const peopleLines = input.people.map((person, i) => {
    const ref = `E${i + 1}`
    entityRefs.set(ref, person.id)
    return `[${ref}] ${person.label} (${person.entityType})`
  })

  const sections = [
    TASK_HEADER,
    `Capture written on: ${day(input.capturedAt)} (relative phrases like "last month" are relative to this date).`,
    `Known people from this capture:\n${peopleLines.length > 0 ? peopleLines.join('\n') : 'none'}`,
    `Capture:\n<<<capture\n${input.text}\ncapture>>>`,
  ]
  const reference = input.referenceText?.trim()
  if (reference) {
    sections.push(
      `Reference text that came with the capture:\n<<<reference\n${reference}\nreference>>>`,
    )
  }

  return {
    messages: [
      { role: 'system', content: USER_FACT_CANDIDATE_PROMPT },
      { role: 'user', content: sections.join('\n\n') },
    ],
    refs: { entities: entityRefs },
  }
}

/** "E1" · "E1 to E4": the refs the model was shown, without listing them all. */
function describeRefs(prefix: 'E', count: number): string {
  return count === 1 ? `${prefix}1` : `${prefix}1 to ${prefix}${count}`
}

/**
 * The short message that follows a reply naming a known person it was never offered. It says which
 * key was wrong and which refs exist; it does not repeat the ref the model used.
 */
export function buildRefCorrection(
  error: FactExtractionRefError,
  refs: FactCandidateRefs,
): string {
  const where = `candidate #${error.detail.index + 1}`
  const closing = 'Reply with the corrected JSON object only.'
  const offered = refs.entities.size
  if (offered === 0) {
    return `Error: ${where}: no Known people were offered, so "entity" must be null. ${closing}`
  }
  return `Error: ${where}: "entity" is not one of the Known people refs (${describeRefs('E', offered)}). Use one of those refs, or null for a person who is not listed. ${closing}`
}

export async function extractFactCandidates(
  input: ExtractFactCandidatesInput,
): Promise<FactCandidate[]> {
  const { messages, refs } = buildFactCandidateMessages(input)
  const ask = (asked: ChatMessage[]) =>
    llmChatCompletion({
      userId: input.userId,
      messages: asked,
      temperature: 0,
      responseFormat: 'json_object',
      logContext: 'user_fact_extraction',
    })
  const parse = (raw: unknown) =>
    evictOnReject(raw, () => {
      const content = extractChatContent(raw).trim()
      if (!content) {
        throw new Error('user fact extraction: empty LLM response')
      }
      return parseFactCandidates(content, refs)
    })

  const raw = await ask(messages)
  try {
    return parse(raw)
  } catch (error) {
    // A known-person ref the model was never offered is a slip it can fix: ask exactly once more,
    // with its own reply and a short correction (the rejected reply is already evicted from the eval
    // cache). Any other problem, or a second wrong reply, fails as before into the ingest retry
    // ladder.
    if (!(error instanceof FactExtractionRefError)) throw error
    const retry = await ask([
      ...messages,
      { role: 'assistant', content: extractChatContent(raw).trim() },
      { role: 'user', content: buildRefCorrection(error, refs) },
    ])
    return parse(retry)
  }
}
