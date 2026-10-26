/**
 * Fact extraction + reconciliation (docs/planning/user-facts-layer.md, F1): ONE json-mode LLM call
 * per capture. The model reads the (secret-redacted) capture, the reference text that came with
 * it, the people already known from it and the facts already stored about related subjects, and
 * returns operations per fact: add | update (supersedes a stored fact) | confirm | none.
 *
 * Every decision here is the model's, by meaning and in any language: who a fact is about, whether
 * it is personally relevant, whether it is implied rather than stated, whether it is an identifier,
 * whether it replaces a stored fact. Code only builds the prompt, calls the gateway and validates
 * the answer's contract (`parseFactExtraction`); nothing is repaired or decided by string rules.
 *
 * Operator decisions baked into the prompt (Q1–Q4): only personally relevant facts about people,
 * also from reference material; inferred facts allowed (confidence >= 0.7 is enforced by code);
 * identifier values are returned separately and never written into a statement.
 *
 * One exception to "one call": a reply that names a person or a stored fact it was never offered
 * is asked again once, with its own reply and a short correction. Every other contract error, and a
 * second wrong reply, throws into the caller's retry ladder.
 */

import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import {
  FACT_CONFIDENCE_MIN,
  FACT_KINDS,
  SECURE_VALUE_KINDS,
  SECURE_VALUE_PLACEHOLDER,
  statementForIndex,
  type FactKind,
  type FactSubjectKind,
} from './fact-vocabulary'
import {
  FactExtractionRefError,
  parseFactExtraction,
  type FactExtractionRefs,
  type ParsedFactExtraction,
} from './parse-fact-extraction'

export const USER_FACT_EXTRACTION_PROMPT = [
  "You build a personal memory's list of facts about people. You get one capture the user wrote (sometimes with reference text that came with it), the people already known from it, and the facts already stored about related subjects. Return JSON only — no markdown fences.",
  '',
  "A fact is one short statement about ONE person: the user (the author of the capture) or a person in the user's life. Only personally relevant facts count: what would change how an assistant should treat or advise that person.",
  '- Worth a fact: preferences and dislikes, habits, activities they do, health conditions and needs, circumstances (job, home, household, place), relationships, plans and goals, constraints, personality traits.',
  '- Never a fact: the topic of a document, recipe, article, code or news; trivia; general knowledge; a task or an event with no bearing on the person. A pasted recipe yields nothing; "I\'m baking this for Mom\'s 70th, she can\'t have nuts" yields a fact about Mom. An email the user wrote to someone else still reveals facts about the user ("an early morning out on the waves before the keynote" shows the user surfs).',
  '- Reference text is read only for what it reveals about people. Its subject matter is never a fact.',
  '- Attribute every fact to the right person. What the user says about a friend is a fact about that friend (subject = that person), never about the user, and the other way round.',
  '- A request to forget or remove something from memory is an instruction, not a fact: return no fact for it.',
  '- Credentials (passwords, API keys, tokens) are never facts. They appear as "[redacted secret]"; never copy that placeholder into a statement as if it were a value.',
  '',
  `Inferred facts: you may state what the text clearly implies but does not say. Set "inferred": true and give a confidence that reflects how clear the implication is. Do not guess: a fact with confidence below ${FACT_CONFIDENCE_MIN} is not stored, so leave out weak guesses.`,
  '',
  `Identifiers: personal identifiers (email address, phone number, postal address, licence plate, account / IBAN / ID / policy number, date of birth) are facts too, but their value must never appear in "statement". Give the value only in "identifier": {"kind": <identifier kind>, "label": <what it is, e.g. "licence plate">, "value": <exactly as written>}, and write the statement with the literal text ${SECURE_VALUE_PLACEHOLDER} where the value would stand, e.g. "The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}". An identifier fact has exactly one ${SECURE_VALUE_PLACEHOLDER}; every other fact has none. One identifier per fact.`,
  '',
  'Reconcile with the stored facts (listed as [F1], [F2], …). For every fact you find, choose its op:',
  '- "add": not stored yet.',
  '- "update": the capture changes or ends a stored fact (quit coffee, moved, changed jobs). Give the new fact and "supersedes": the stored fact\'s ref. The statement says what is true now.',
  '- "confirm": the capture restates a stored fact unchanged. Give "confirms": its ref and nothing else. Never "add" a fact that is already stored.',
  '- "none": a candidate you decided not to store.',
  'Use each stored fact in at most one op. If the capture holds no fact, return {"facts":[]}.',
  '',
  'Subject: {"kind":"user"} for the user; {"kind":"person","label":"<the person as the capture names them, with the relation if given, e.g. Mia (friend)>","entity":"<the E-ref of the same person from Known people, else null>"} for anyone else.',
  "Statement: one short, self-contained sentence in the capture's own language that names its subject. Write what is true, not that the capture says so.",
  '',
  'Return exactly: {"facts":[{"op":"add"|"update"|"confirm"|"none","supersedes":"<F-ref, only for update>","confirms":"<F-ref, only for confirm>","subject":{...},"kind":"<kind>","statement":"<statement>","confidence":<0 to 1>,"inferred":true|false,"identifier":null|{"kind":"<identifier kind>","label":"<label>","value":"<value>"}}]}',
  `kind is one of: ${FACT_KINDS.join(', ')} — preference (likes), dislike, habit (recurring behaviour), activity (things they do), health (conditions, symptoms, medication, dietary needs), circumstance (job, place, household, living situation), relationship, plan (goals and plans), constraint (cannot, must not, limits), trait (personality).`,
  `identifier kind is one of: ${SECURE_VALUE_KINDS.join(', ')}.`,
  'Judge by meaning, in any language.',
].join('\n')

/** The part of the user message that always comes first: long enough that the capture never lands in the activity log's 300-character context. */
const TASK_HEADER =
  "Task: from the capture below, extract the personally relevant facts about the user or about people in the user's life, compare each one with the stored facts listed, and answer with the JSON object described in the system message. Use the known people and the stored facts only to link and to reconcile; never copy them into a new fact. Reference material is read only for what it reveals about people, and a request to forget something is not a fact."

/** A stored fact as the extractor sees it (the statement may still hold its secure reference token). */
export type StoredFactForPrompt = {
  id: string
  subjectKind: FactSubjectKind
  subjectLabel: string | null
  kind: FactKind
  statement: string
  inferred: boolean
  asOf: Date
}

/** A graph entity already linked to the capture. */
export type KnownPerson = { id: string; label: string; entityType: string }

export type ExtractUserFactsInput = {
  userId: string
  /** The capture text this thought stands for, secret-redacted. */
  text: string
  /** Reference text (a saved note) that came with the capture, secret-redacted. */
  referenceText?: string | null
  capturedAt: Date
  storedFacts: StoredFactForPrompt[]
  people: KnownPerson[]
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function describeStoredFact(fact: StoredFactForPrompt, ref: string): string {
  const subject = fact.subjectKind === 'user' ? 'user' : (fact.subjectLabel ?? 'person')
  const parts = [subject, fact.kind, `as of ${day(fact.asOf)}`]
  if (fact.inferred) parts.push('inferred')
  // the model sees the placeholder, never a reference id
  parts.push(statementForIndex(fact.statement))
  return `[${ref}] ${parts.join(' · ')}`
}

export function buildFactExtractionMessages(input: ExtractUserFactsInput): {
  messages: ChatMessage[]
  refs: FactExtractionRefs
} {
  const factRefs = new Map<string, string>()
  const storedLines = input.storedFacts.map((fact, i) => {
    const ref = `F${i + 1}`
    factRefs.set(ref, fact.id)
    return describeStoredFact(fact, ref)
  })
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
    `Stored facts about related subjects:\n${storedLines.length > 0 ? storedLines.join('\n') : 'none'}`,
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
      { role: 'system', content: USER_FACT_EXTRACTION_PROMPT },
      { role: 'user', content: sections.join('\n\n') },
    ],
    refs: { facts: factRefs, entities: entityRefs },
  }
}

/** "E1" · "E1 to E4": the refs the model was shown, without listing them all. */
function describeRefs(prefix: 'E' | 'F', count: number): string {
  return count === 1 ? `${prefix}1` : `${prefix}1 to ${prefix}${count}`
}

/**
 * The short message that follows a reply naming a ref it was never offered. It says which key was
 * wrong and which refs exist; it does not repeat the ref the model used.
 */
export function buildRefCorrection(
  error: FactExtractionRefError,
  refs: FactExtractionRefs,
): string {
  const { index, list, field } = error.detail
  const where = `fact #${index + 1}`
  const closing = 'Reply with the corrected JSON object only.'
  if (list === 'known people') {
    const offered = refs.entities.size
    if (offered === 0) {
      return `Error: ${where}: no Known people were offered, so the subject's "entity" must be null. ${closing}`
    }
    return `Error: ${where}: the subject's "entity" is not one of the Known people refs (${describeRefs('E', offered)}). Use one of those refs, or null for a person who is not listed. ${closing}`
  }
  const offered = refs.facts.size
  if (offered === 0) {
    return `Error: ${where}: no stored facts were offered, so "${field}" cannot be used; give the fact as a plain "add". ${closing}`
  }
  return `Error: ${where}: "${field}" is not one of the stored fact refs (${describeRefs('F', offered)}). Use only those refs; a fact that matches none of them is a plain "add". ${closing}`
}

export async function extractUserFacts(
  input: ExtractUserFactsInput,
): Promise<ParsedFactExtraction> {
  const { messages, refs } = buildFactExtractionMessages(input)
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
      return parseFactExtraction(content, refs)
    })

  const raw = await ask(messages)
  try {
    return parse(raw)
  } catch (error) {
    // A ref the model was never offered is a slip it can fix: ask exactly once more, with its own
    // reply and a short correction (the rejected reply is already evicted from the eval cache).
    // Any other problem, or a second wrong reply, fails as before into the ingest retry ladder.
    if (!(error instanceof FactExtractionRefError)) throw error
    const retry = await ask([
      ...messages,
      { role: 'assistant', content: extractChatContent(raw).trim() },
      { role: 'user', content: buildRefCorrection(error, refs) },
    ])
    return parse(retry)
  }
}
