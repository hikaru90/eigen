import type { McpToolContext } from './tools'
import { answerNowCard, NowAnswerError } from '$lib/server/mesh/now-answer'
import { loadNowDeck } from '$lib/server/mesh/now-store'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'
import { strictToolArgs } from '$lib/server/validation/mcp-args'

/**
 * Lightning questions over MCP (docs/planning/feature-mesh-now.md, NOW-10 and NOW-13).
 * `get_now_cards` is also Ask's picker for "what should I do?" (it reads, never answers);
 * `answer_now_card` is HTTP MCP only (`exposeInChat: false`).
 *
 * Budget (docs/testing/agent-benchmark.md): get_now_cards → answer_now_card, 2 calls. Arguments
 * are checked at the boundary before any DB or LLM work: unknown keys, a card_id that is not a
 * uuid, a missing answer, and a project_entity_id that cannot apply fail with the exact
 * constraint. What each answer needs, per card kind, is decided in `answerNowCard`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const NOTES = {
  clear: 'Nothing needs the user right now: no open task or project asks for a decision.',
  limit: 'Three decks were written today and all their cards are answered. More come tomorrow.',
} as const

/** Every pending card of the current deck in order; writes a deck first when NOW-7 allows. */
export async function runGetNowCardsTool(context: McpToolContext, args: unknown) {
  strictToolArgs(args, [])
  const deck = await loadNowDeck(context.userId)
  if (deck.state === 'cards') return sanitizeMcpToolResult(deck)
  return sanitizeMcpToolResult({ state: deck.state, note: NOTES[deck.state] })
}

/** The domain names its fields in camelCase; this tool's arguments are snake_case. */
function forAgent(message: string): string {
  return message.replaceAll('projectEntityId', 'project_entity_id')
}

/** The same service as the Yarn card (`answerNowCard`); an Undo is not offered over MCP. */
export async function runAnswerNowCardTool(context: McpToolContext, args: unknown) {
  const body = strictToolArgs(args, ['card_id', 'answer', 'project_entity_id', 'text'])

  if (typeof body.card_id !== 'string' || !UUID_RE.test(body.card_id)) {
    throw new Error('card_id must be a uuid')
  }
  if (typeof body.answer !== 'string' || body.answer === '') {
    throw new Error('answer is required and must be a string')
  }
  if (body.project_entity_id !== undefined) {
    if (typeof body.project_entity_id !== 'string' || !UUID_RE.test(body.project_entity_id)) {
      throw new Error('project_entity_id must be a uuid')
    }
  } else if (body.answer === 'other_project') {
    throw new Error('project_entity_id is required for other_project')
  }
  if (body.text !== undefined && typeof body.text !== 'string') {
    throw new Error('text must be a string')
  }

  try {
    const { undo: _undo, ...next } = await answerNowCard({
      userId: context.userId,
      cardId: body.card_id,
      answer: body.answer,
      ...(body.project_entity_id !== undefined ? { projectEntityId: body.project_entity_id } : {}),
      ...(body.text !== undefined ? { text: body.text } : {}),
    })
    return sanitizeMcpToolResult({ answered: { cardId: body.card_id, answer: body.answer }, next })
  } catch (err) {
    if (err instanceof NowAnswerError) throw new Error(forAgent(err.message), { cause: err })
    throw err
  }
}
