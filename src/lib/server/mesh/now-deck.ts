import type { NowCandidates } from './now-candidates'
import { z } from 'zod'
import { isInsufficientCreditsError } from '$lib/server/billing/insufficient-credits'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'

/**
 * The Now deck writer (docs/planning/feature-mesh-now.md, NOW-5 and NOW-6): one LLM call
 * writes up to 12 cards from the structural candidates. Post-LLM code only validates; any
 * invalid card fails the whole attempt. Exactly 3 attempts, then a plain error, never a
 * canned or "top of the list" deck.
 */

export const NOW_DECK_MAX_ATTEMPTS = 3
export const NOW_DECK_LOG_CONTEXT = 'mesh_now_deck'
export const NOW_DECK_MAX_CARDS = 12
export const NOW_TEXT_MAX_CHARS = 140
export const NOW_WHY_MAX_CHARS = 100
export const NOW_SUGGESTED_STEP_MAX_CHARS = 140

export type NowDeckContext = {
  /** The user's preferred language code. */
  language: string
  /** Local calendar date, YYYY-MM-DD, in the user's timezone. */
  localDate: string
  weekday: string
  /** Local time of day, HH:MM. */
  localTime: string
  /** Ontology category keys a `file` card may name as `notTaskCategory`. */
  ontologyKeys: string[]
  candidates: NowCandidates
}

export type NowDeckDraft = {
  kind: 'do' | 'sort' | 'file' | 'unblock'
  thoughtId: string | null
  projectEntityId: string | null
  text: string
  why: string
  suggestedStep: string | null
  notTaskCategory: string | null
}

const optionalId = z.string().trim().min(1).nullish()

const cardSchema = z.object({
  kind: z.enum(['do', 'sort', 'file', 'unblock']),
  thoughtId: optionalId,
  projectEntityId: optionalId,
  text: z.string().trim().min(1).max(NOW_TEXT_MAX_CHARS),
  why: z.string().trim().min(1).max(NOW_WHY_MAX_CHARS),
  suggestedStep: z.string().trim().min(1).max(NOW_SUGGESTED_STEP_MAX_CHARS).nullish(),
  notTaskCategory: z.string().trim().min(1).nullish(),
})

const outputSchema = z.object({ cards: z.array(cardSchema).min(1).max(NOW_DECK_MAX_CARDS) })

export function buildNowDeckMessages(context: NowDeckContext): ChatMessage[] {
  const system = [
    'You write the next deck of "Now" cards for a personal task and memory app. Each card is one thing for the user to do or decide, answerable in one tap.',
    'Return JSON only, exactly this schema:',
    '{ "cards": [ { "kind": "do | sort | file | unblock", "thoughtId": "<id, required for do, sort and file>", "projectEntityId": "<id, required for file and unblock>", "text": "<instruction>", "why": "<one reason line>", "suggestedStep": "<required for unblock>", "notTaskCategory": "<required for file>" } ] }',
    'Kinds:',
    '- "do": one concrete action the user can physically do as written.',
    '- "sort": an open item that needs a decision: finished, drop it, or keep it.',
    '- "file": an open item that belongs to one of the listed projects; the user is asked to move it there. notTaskCategory is the category key to give it if the user says it is not a task.',
    '- "unblock": an active project with no concrete next step; suggestedStep proposes one.',
    'Rules:',
    `- 1 to ${NOW_DECK_MAX_CARDS} cards, written in the language "${context.language}". "text" is at most ${NOW_TEXT_MAX_CHARS} characters, "why" at most ${NOW_WHY_MAX_CHARS}, "suggestedStep" at most ${NOW_SUGGESTED_STEP_MAX_CHARS}.`,
    '- Write "text" as an imperative that names the real thing ("Call the landlord about the deposit."). Use only the facts listed below; never invent dates or people. The "why" line states one listed fact, such as a deadline, an overdue date, the age of the item or how often it was skipped.',
    '- Use only ids from the lists below. At most one card per thought and one card per project.',
    '- The first card is a "do" card whenever a concrete one exists.',
    '- After that, mix the kinds, with at most two cards in a row that are not "do".',
    '- Order the cards by what matters today: deadlines and overdue dates first, then age, how often an item was skipped, the order inside its project, and the local time and weekday.',
    '- A vague next action gets an "unblock" card, not a "do" card; ignore the stored next action and its rank when it is too vague to do as written.',
    '- A finished-work report, record or duplicate gets a "sort" card, not a "do" card. An item by an agent is often one of these.',
    '- An item skipped several times gets a "sort" card, not a "do" card again.',
    `- notTaskCategory must be one of: ${context.ontologyKeys.join(', ')}.`,
  ].join('\n')

  const { thoughts, projects, candidatesOmitted } = context.candidates
  const thoughtLines = thoughts.map((t) =>
    [
      `- id: ${t.thoughtId}`,
      t.category,
      `author: ${t.author}`,
      `created: ${t.createdAt.slice(0, 10)}`,
      t.project
        ? `project: ${t.project.label}${t.project.rank === null ? ' (not ordered)' : ` (rank ${t.project.rank})`}`
        : 'project: none',
      t.eventAt ? `linked date: ${t.eventAt}` : 'linked date: none',
      `skipped: ${t.skipCount}`,
      JSON.stringify(t.snippet),
    ].join(' | '),
  )
  const projectLines = projects.map((p) =>
    [
      `- id: ${p.entityId}`,
      p.label,
      `deadline: ${p.deadline ?? 'none'}`,
      `next action: ${p.nextAction ? JSON.stringify(p.nextAction) : 'none'}`,
      `open tasks: ${p.openTaskCount}`,
      `stalled: ${p.stalledReason ?? 'no'}`,
      `milestones: ${
        p.milestones.length
          ? p.milestones
              .map(
                (m) =>
                  `${m.label} (${m.completedAt ? 'done' : `due ${m.targetDate ?? 'no date'}`})`,
              )
              .join('; ')
          : 'none'
      }`,
    ].join(' | '),
  )
  const user = [
    `Now: ${context.weekday} ${context.localDate}, ${context.localTime} local time.`,
    `Open tasks and goals, oldest first:\n${thoughtLines.join('\n') || '(none)'}${
      candidatesOmitted > 0 ? `\n(${candidatesOmitted} older open thoughts are not listed.)` : ''
    }`,
    `Active projects:\n${projectLines.join('\n') || '(none)'}`,
  ].join('\n\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Validates the model output against the candidates; any problem throws, nothing is dropped or fixed. */
export function parseNowDeck(
  content: string,
  candidates: NowCandidates,
  ontologyKeys: string[],
): NowDeckDraft[] {
  const parsed = outputSchema.safeParse(parseLlmJsonPayload(content))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `Now deck failed the schema: ${issue?.path.join('.') || 'cards'} ${issue?.message ?? 'invalid'}`,
    )
  }
  const thoughtIds = new Set(candidates.thoughts.map((t) => t.thoughtId))
  const projectIds = new Set(candidates.projects.map((p) => p.entityId))
  const categories = new Set(ontologyKeys)
  const targets = new Set<string>()

  return parsed.data.cards.map((card, index) => {
    const label = `Now deck card ${index + 1} (${card.kind})`
    const thoughtId = card.thoughtId ?? null
    const projectEntityId = card.projectEntityId ?? null
    const suggestedStep = card.suggestedStep ?? null
    const notTaskCategory = card.notTaskCategory ?? null

    if (card.kind !== 'unblock' && thoughtId === null) throw new Error(`${label} needs a thoughtId`)
    if ((card.kind === 'file' || card.kind === 'unblock') && projectEntityId === null) {
      throw new Error(`${label} needs a projectEntityId`)
    }
    if (card.kind === 'unblock' && suggestedStep === null) {
      throw new Error(`${label} needs a suggestedStep`)
    }
    if (card.kind === 'file' && notTaskCategory === null) {
      throw new Error(`${label} needs a notTaskCategory`)
    }
    if (thoughtId !== null && !thoughtIds.has(thoughtId)) {
      throw new Error(`${label}: thoughtId is not one of the listed thoughts`)
    }
    if (projectEntityId !== null && !projectIds.has(projectEntityId)) {
      throw new Error(`${label}: projectEntityId is not one of the listed projects`)
    }
    if (notTaskCategory !== null && !categories.has(notTaskCategory)) {
      throw new Error(`${label}: notTaskCategory is not one of the ontology categories`)
    }

    const target = card.kind === 'unblock' ? `project:${projectEntityId}` : `thought:${thoughtId}`
    if (targets.has(target)) throw new Error(`${label}: more than one card per target`)
    targets.add(target)

    return {
      kind: card.kind,
      thoughtId,
      projectEntityId,
      text: card.text,
      why: card.why,
      suggestedStep,
      notTaskCategory,
    }
  })
}

export async function generateNowDeck(input: {
  userId: string
  context: NowDeckContext
}): Promise<NowDeckDraft[]> {
  const messages = buildNowDeckMessages(input.context)
  let lastError = ''
  for (let attempt = 1; attempt <= NOW_DECK_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await llmChatCompletion({
        userId: input.userId,
        messages,
        temperature: 0.5,
        logContext: NOW_DECK_LOG_CONTEXT,
        responseFormat: 'json_object',
      })
      return evictOnReject(response, () =>
        parseNowDeck(
          extractChatContent(response),
          input.context.candidates,
          input.context.ontologyKeys,
        ),
      )
    } catch (err) {
      if (isInsufficientCreditsError(err)) throw err
      lastError = err instanceof Error ? err.message : String(err)
      console.warn('[mesh.now-deck] attempt failed', { attempt, error: lastError.slice(0, 200) })
    }
  }
  throw new Error(
    `Your next steps could not be written: the model failed ${NOW_DECK_MAX_ATTEMPTS} times (${lastError})`,
  )
}
