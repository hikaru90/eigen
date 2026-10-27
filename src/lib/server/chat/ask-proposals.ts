import { and, asc, eq, or, sql } from 'drizzle-orm'
import { m } from '$lib/paraglide/messages.js'
import type { getDb } from '$lib/server/db'
import { chatMessage } from '$lib/server/db/brain.schema'

/**
 * Ask proposes thoughts (docs/planning/feature-ask-proposes-thoughts.md).
 *
 * A proposal is the persisted result of the Ask-only `propose_thoughts` tool — a
 * `chat_message` tool step, no new table. Everything the server guard (AP-4) needs is read
 * back from those rows: the latest proposal, and whether the user's current message is the
 * user turn directly after it.
 */

type ChatDb = ReturnType<typeof getDb>

/** The two Ask-only tools. Their persisted steps are the proposal, so they are always stored. */
export const ASK_PROPOSAL_TOOL_NAMES = ['propose_thoughts', 'store_thoughts'] as const

/**
 * Size bounds keep a proposal's persisted tool result (the chat preview is capped at 8000
 * characters) whole even when every character needs a JSON escape — a truncated result
 * would not parse back, and a proposal that cannot be read back can never be confirmed.
 */
export const PROPOSAL_MAX_THOUGHTS = 6
export const PROPOSAL_MAX_THOUGHT_CHARS = 500

export type AskProposal = { proposalId: string; thoughts: string[] }

export type ProposalReply = 'confirm' | 'revise' | 'unrelated'

/**
 * Per-turn Ask state, set by the agent loop and read by the proposal tools. The model
 * cannot change it: tool arguments never reach this object.
 */
export type AskTurnState = {
  /** The persisted Ask session this turn belongs to. */
  sessionId: string
  /** Jev's capture_worthy answer for this message; null when the decision failed. */
  captureWorthy: 'yes' | 'no' | null
  /** Jev's proposal_reply answer; null when no proposal was open or the decision failed. */
  proposalReply: ProposalReply | null
  /** Set once store_thoughts has started: a proposal is stored at most once per turn. */
  storeStarted: boolean
}

/** A persisted session row, in the shape the proposal lookup reads. */
export type SessionRow = { role: string; content: string; metadata: unknown }

/** Validates a proposal result object (a live tool result or a parsed persisted one). */
export function readProposalFromResult(value: unknown): AskProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { proposalId, thoughts } = value as Record<string, unknown>
  if (typeof proposalId !== 'string' || !proposalId.trim()) return null
  if (!Array.isArray(thoughts) || thoughts.length === 0) return null
  if (!thoughts.every((t) => typeof t === 'string' && t.trim().length > 0)) return null
  return { proposalId, thoughts: thoughts as string[] }
}

/** Boundary validation of `propose_thoughts({ thoughts })`: exact constraint in every error. */
export function validateProposedThoughts(value: unknown): string[] {
  if (!Array.isArray(value))
    throw new Error('Invalid thoughts: thoughts must be an array of strings')
  if (value.length === 0) throw new Error('Invalid thoughts: propose at least one thought')
  if (value.length > PROPOSAL_MAX_THOUGHTS) {
    throw new Error(
      `Invalid thoughts: at most ${PROPOSAL_MAX_THOUGHTS} thoughts per proposal (got ${value.length}) — keep the ones most worth keeping`,
    )
  }
  return value.map((item, i) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`Invalid thoughts[${i}]: must be a non-empty string`)
    }
    const trimmed = item.trim()
    if (trimmed.length > PROPOSAL_MAX_THOUGHT_CHARS) {
      throw new Error(
        `Invalid thoughts[${i}]: at most ${PROPOSAL_MAX_THOUGHT_CHARS} characters (got ${trimmed.length}) — split it into separate thoughts`,
      )
    }
    return trimmed
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The proposal a persisted row holds: a successful propose_thoughts tool step/result, else null. */
function proposalFromRow(row: SessionRow): AskProposal | null {
  if (row.role !== 'assistant') return null
  const meta = asRecord(row.metadata)
  if (!meta || meta.tool !== 'propose_thoughts' || meta.failed === true) return null
  if (meta.variant !== 'tool_step' && meta.variant !== 'tool_result') return null
  try {
    return readProposalFromResult(JSON.parse(row.content))
  } catch {
    return null
  }
}

/**
 * AP-4 — the proposal a reply can act on. `rows` are the session's persisted rows in order,
 * INCLUDING the user's current message (stored before the agent runs). The latest proposal is
 * open only when exactly one user message follows it: the current one, i.e. the user turn
 * directly after the proposal. A proposal that was never replied to, was followed by any other
 * user turn, or was superseded by a newer proposal is closed.
 */
export function findOpenProposal(rows: SessionRow[]): AskProposal | null {
  let latest: AskProposal | null = null
  let latestIndex = -1
  for (let i = 0; i < rows.length; i++) {
    const proposal = proposalFromRow(rows[i]!)
    if (proposal) {
      latest = proposal
      latestIndex = i
    }
  }
  if (!latest) return null
  const userTurnsAfter = rows.slice(latestIndex + 1).filter((row) => row.role === 'user').length
  return userTurnsAfter === 1 ? latest : null
}

/**
 * Reads the session's persisted rows (user messages and propose_thoughts steps — all the guard
 * needs) and resolves the open proposal. Runs under the caller's RLS scope.
 */
export async function loadOpenProposal(db: ChatDb, sessionId: string): Promise<AskProposal | null> {
  const rows = await db
    .select({
      role: chatMessage.role,
      content: chatMessage.content,
      metadata: chatMessage.metadata,
    })
    .from(chatMessage)
    .where(
      and(
        eq(chatMessage.sessionId, sessionId),
        or(
          eq(chatMessage.role, 'user'),
          sql`${chatMessage.metadata} ->> 'tool' = 'propose_thoughts'`,
        ),
      ),
    )
    .orderBy(asc(chatMessage.createdAt))
  return findOpenProposal(rows)
}

/** The proposal as plain chat text — what the user reads and answers with "yes" or a change. */
export function renderProposalBlock(thoughts: string[]): string {
  const list = thoughts.map((thought, i) => `${i + 1}. ${thought}`).join('\n')
  return `${m.ask_proposal_lead_in()}\n\n${list}\n\n${m.ask_proposal_footer()}`
}

/** True for a persisted/streamed agent step of propose_thoughts or store_thoughts. */
export function isProposalToolStep(step: {
  content: string
  metadata: Record<string, unknown>
}): boolean {
  return (ASK_PROPOSAL_TOOL_NAMES as readonly unknown[]).includes(step.metadata.tool)
}
