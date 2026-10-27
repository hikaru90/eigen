import type { McpToolContext } from './tools'
import { randomUUID } from 'node:crypto'
import { captureThought } from '$lib/server/capture/service'
import { loadOpenProposal, validateProposedThoughts } from '$lib/server/chat/ask-proposals'
import { getDb } from '$lib/server/db'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'
import { strictToolArgs, validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

/**
 * The two Ask-only tools of "Ask proposes thoughts, stores them on yes"
 * (docs/planning/feature-ask-proposes-thoughts.md). In-app Ask only — never exposed to HTTP
 * MCP clients, which keep `capture_thought` unchanged.
 *
 * The server, not the model, decides what may be stored (AP-4): `store_thoughts` takes its
 * text from the persisted proposal and only runs when Jev judged THIS message a confirm of
 * the latest open proposal. Everything else is rejected with an error the model must relay.
 */

function askTurnOf(context: McpToolContext, tool: string) {
  if (!context.askTurn) throw new Error(`${tool} is only available in an Ask chat turn`)
  return context.askTurn
}

/** AP-2: show the user thoughts worth keeping. Stores nothing — the user must confirm. */
export async function runProposeThoughtsTool(context: McpToolContext, args: unknown) {
  const body = strictToolArgs(args, ['thoughts'])
  const turn = askTurnOf(context, 'propose_thoughts')

  if (turn.proposalReply === 'confirm') {
    throw new Error(
      'propose_thoughts is not available on a turn where the user confirmed the open proposal — store it with store_thoughts.',
    )
  }
  if (turn.captureWorthy !== 'yes' && turn.proposalReply !== 'revise') {
    throw new Error(
      `propose_thoughts is not available: this message was not judged worth keeping (capture_worthy is ${turn.captureWorthy ?? 'unavailable'}) and the user is not revising an open proposal. Do not propose anything.`,
    )
  }

  const thoughts = validateProposedThoughts(body.thoughts)
  return sanitizeMcpToolResult({ proposalId: randomUUID(), thoughts })
}

/** AP-4 / AP-5: store the latest open proposal exactly as proposed, on a confirmed reply. */
export async function runStoreThoughtsTool(context: McpToolContext, args: unknown) {
  const body = strictToolArgs(args, ['proposal_id'])
  const proposalId = validateNonEmptyEntityId(
    typeof body.proposal_id === 'string' ? body.proposal_id : undefined,
    'proposal_id',
  )
  const turn = askTurnOf(context, 'store_thoughts')

  if (turn.storeStarted) {
    throw new Error('store_thoughts already ran in this turn — nothing more is stored.')
  }
  if (turn.proposalReply !== 'confirm') {
    throw new Error(
      'Nothing was stored: the user has not confirmed an open proposal in this message. Propose thoughts first and wait for the user to confirm.',
    )
  }

  // Re-read the persisted proposal at call time: latest, and the user turn directly after it.
  const open = await loadOpenProposal(getDb(), turn.sessionId)
  if (!open) {
    throw new Error(
      'Nothing was stored: there is no open proposal to confirm — a proposal can only be confirmed in the user message directly after it.',
    )
  }
  if (open.proposalId !== proposalId) {
    throw new Error('Nothing was stored: proposal_id does not match the latest open proposal.')
  }

  turn.storeStarted = true
  const stored: Array<{ thoughtId: string; text: string }> = []
  for (const text of open.thoughts) {
    try {
      const result = await captureThought(context.userId, text, {
        source: 'ask',
        provenance: { askSessionId: turn.sessionId, askProposalId: open.proposalId },
      })
      stored.push({ thoughtId: result.id, text })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Stored ${stored.length} of ${open.thoughts.length} thoughts, then failed: ${reason}. Do not call store_thoughts again.`,
        { cause: err },
      )
    }
  }
  return sanitizeMcpToolResult({ proposalId: open.proposalId, stored })
}
