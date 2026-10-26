import { z } from 'zod'
import {
  BOARD_AREAS,
  BOARD_KINDS,
  type BoardArea,
  type BoardKind,
  type BoardStatus,
} from '$lib/feedback/board-types'
import { isInsufficientCreditsError } from '$lib/server/billing/insufficient-credits'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { BOARD_AREA_CATALOG, BOARD_KIND_CATALOG } from './catalog'
import { BoardError } from './errors'

/**
 * MB-9: the one LLM judge a share runs (AGENTS.md "LLM as judge"). It classifies
 * kind and area from the board's catalog and decides whether the draft asks for
 * the same thing as one of the candidates (ranked by title-embedding similarity —
 * ranking only). Post-LLM code validates the JSON against the schema and the
 * candidate ids; it never re-decides meaning from the strings.
 *
 * Billing / usage log: `llmChatCompletion` settles the call against the user's
 * wallet with markup and writes the activity_call_log row (`board_idea_judge`).
 */

export const BOARD_JUDGE_MAX_ATTEMPTS = 3
export const BOARD_JUDGE_FAILED_MESSAGE = "Couldn't check your idea — try again"
export const BOARD_JUDGE_LOG_CONTEXT = 'board_idea_judge'

export type BoardJudgeCandidate = {
  id: string
  title: string
  kind: BoardKind
  area: BoardArea
  status: BoardStatus
}

export type BoardJudgeDecision = {
  kind: BoardKind
  area: BoardArea
  duplicateOfId: string | null
}

const judgeOutputSchema = z.object({
  kind: z.enum(BOARD_KINDS),
  area: z.enum(BOARD_AREAS),
  duplicate_of: z.string().trim().min(1).nullable(),
  reason: z.string().optional(),
})

const JSON_SCHEMA = `{ "kind": "${BOARD_KINDS.join('" | "')}", "area": "${BOARD_AREAS.join('" | "')}", "duplicate_of": "<candidate id>" | null, "reason": "<one short sentence>" }`

export function buildBoardJudgeMessages(
  title: string,
  candidates: readonly BoardJudgeCandidate[],
): ChatMessage[] {
  const kinds = BOARD_KINDS.map((k) => `- "${k}": ${BOARD_KIND_CATALOG[k]}`).join('\n')
  const areas = BOARD_AREAS.map((a) => `- "${a}": ${BOARD_AREA_CATALOG[a]}`).join('\n')
  const system = [
    'You triage a request someone is sharing on the Eigenmesh ideas board (Eigenmesh is a personal memory app).',
    'Return JSON only, exactly this schema:',
    JSON_SCHEMA,
    'Rules:',
    '- kind must be exactly one key from the kind catalog; area exactly one key from the area catalog. No synonyms.',
    '- duplicate_of is the id of a candidate ONLY when the draft asks for the same change as that candidate (a paraphrase, another wording, another language). Being in the same area, sharing words, or being related is NOT enough: a different request is not a duplicate.',
    '- If no candidate is the same request, duplicate_of is null. Never invent an id; use only ids from the candidate list.',
    'Kind catalog:',
    kinds,
    'Area catalog:',
    areas,
  ].join('\n')

  const list =
    candidates.length === 0
      ? 'Candidates: (no existing ideas to compare against — duplicate_of must be null)'
      : [
          'Candidates (existing open ideas, most similar first):',
          ...candidates.map(
            (c) => `- id: ${c.id} | ${c.kind} in ${c.area} | ${c.status} | "${c.title}"`,
          ),
        ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: `Draft:\n"${title}"\n\n${list}` },
  ]
}

/** Validate the judge's JSON against the schema and the candidate ids. Throws on anything else. */
export function parseBoardJudgeOutput(
  content: string,
  candidateIds: ReadonlySet<string>,
): BoardJudgeDecision {
  const parsed = judgeOutputSchema.safeParse(parseLlmJsonPayload(content))
  if (!parsed.success) {
    throw new Error(
      `Board judge output failed the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    )
  }
  const dup = parsed.data.duplicate_of
  if (dup !== null && !candidateIds.has(dup)) {
    throw new Error(`Board judge duplicate_of "${dup}" is not one of the candidates`)
  }
  return { kind: parsed.data.kind, area: parsed.data.area, duplicateOfId: dup }
}

/**
 * Exactly 3 attempts, then a plain error (502) — no fallback kind, no "assume not a
 * duplicate". An empty wallet is not retried: the 402 surfaces as-is.
 */
export async function judgeBoardIdea(input: {
  userId: string
  title: string
  candidates: readonly BoardJudgeCandidate[]
}): Promise<BoardJudgeDecision> {
  const messages = buildBoardJudgeMessages(input.title, input.candidates)
  const ids = new Set(input.candidates.map((c) => c.id))
  let lastError = ''
  for (let attempt = 1; attempt <= BOARD_JUDGE_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await llmChatCompletion({
        userId: input.userId,
        messages,
        temperature: 0,
        logContext: BOARD_JUDGE_LOG_CONTEXT,
        responseFormat: 'json_object',
      })
      return evictOnReject(response, () => parseBoardJudgeOutput(extractChatContent(response), ids))
    } catch (err) {
      if (isInsufficientCreditsError(err)) throw err
      lastError = err instanceof Error ? err.message : String(err)
      console.warn('[board.judge] attempt failed', { attempt, error: lastError.slice(0, 200) })
    }
  }
  throw new BoardError(
    `${BOARD_JUDGE_FAILED_MESSAGE}. (The check failed ${BOARD_JUDGE_MAX_ATTEMPTS} times: ${lastError})`,
    502,
  )
}
