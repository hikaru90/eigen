import { m } from '$lib/paraglide/messages.js'
import type { AskProposal, ProposalReply } from '$lib/server/chat/ask-proposals'
import {
  runEnforcedBoundedDecisions,
  type BoundedDecisionSpec,
} from '$lib/server/llm/decision-plane'

/**
 * The per-turn Jev decisions of Ask proposing thoughts
 * (docs/planning/feature-ask-proposes-thoughts.md AP-1 / AP-3). Semantics — is this message
 * worth keeping, is this reply a yes — are decided by the decision model, never by text
 * patterns. ONE Decisions call per turn carries both questions (surface chat_turn).
 *
 * Enforced on every Ask turn, not gated behind an env flag. A failed call never skips
 * silently: both decisions stay null and the reply carries a visible note.
 */

export const CAPTURE_WORTHY_CRITERIA = {
  yes: 'The message tells something about the user or their life that is worth keeping in their mesh — a fact, plan, task, event, preference, commitment, relationship or situation — even when it comes together with a question or a request.',
  no: 'Nothing about the user or their life worth keeping: a pure question, a lookup or search request, an instruction about notes, projects or existing thoughts, small talk, thanks, or a message that only refers to what the assistant said.',
} as const

export const PROPOSAL_REPLY_CRITERIA = {
  confirm:
    'The user accepts the open proposal as written — it should be stored exactly as proposed.',
  revise:
    'The user wants something in the open proposal changed, removed or added before anything is stored.',
  unrelated:
    'The message does not answer the open proposal: a different question, request or topic.',
} as const

const CAPTURE_WORTHY_INSTRUCTIONS =
  "Does the user's latest message contain something about themselves or their life that is worth keeping in their mesh?"
const PROPOSAL_REPLY_INSTRUCTIONS =
  "How does the user's latest message respond to the open proposal — the thoughts the assistant offered to store?"

export type AskTurnDecisions = {
  /** null = the decision call failed. */
  captureWorthy: 'yes' | 'no' | null
  /** null = no proposal was open, or the decision call failed. */
  proposalReply: ProposalReply | null
  /** The proposal that was open when the message arrived (server-resolved, AP-4). */
  openProposal: AskProposal | null
  /** Visible notes for the reply when a decision failed. */
  notes: string[]
}

/** Numbered thoughts, the way the user saw them in the proposal. */
function numberedThoughts(thoughts: string[]): string {
  return thoughts.map((thought, i) => `${i + 1}. ${thought}`).join('\n')
}

/**
 * The Decisions `state`: the raw message when nothing is open (byte-identical to a plain
 * chat turn), else the open proposal followed by the message so the reply can be judged.
 */
export function buildAskTurnState(input: {
  message: string
  openProposal: AskProposal | null
}): string {
  if (!input.openProposal) return input.message
  return `Open proposal — the thoughts the assistant offered to store in the user's mesh:\n${numberedThoughts(input.openProposal.thoughts)}\n\nLatest user message:\n${input.message}`
}

function isCaptureWorthy(choice: unknown): choice is 'yes' | 'no' {
  return choice === 'yes' || choice === 'no'
}

function isProposalReply(choice: unknown): choice is ProposalReply {
  return choice === 'confirm' || choice === 'revise' || choice === 'unrelated'
}

export async function decideAskTurn(input: {
  userId: string
  message: string
  openProposal: AskProposal | null
}): Promise<AskTurnDecisions> {
  const specs: BoundedDecisionSpec[] = [
    {
      decisionKind: 'capture_worthy',
      id: 'capture_worthy',
      question: {
        type: 'choice',
        instructions: CAPTURE_WORTHY_INSTRUCTIONS,
        criteria: CAPTURE_WORTHY_CRITERIA,
      },
      llmChoice: null,
    },
  ]
  if (input.openProposal) {
    specs.push({
      decisionKind: 'proposal_reply',
      id: 'proposal_reply',
      question: {
        type: 'choice',
        instructions: PROPOSAL_REPLY_INSTRUCTIONS,
        criteria: PROPOSAL_REPLY_CRITERIA,
      },
      llmChoice: null,
    })
  }

  try {
    const answers = await runEnforcedBoundedDecisions({
      userId: input.userId,
      surface: 'chat_turn',
      state: buildAskTurnState(input),
      specs,
    })
    const captureWorthy = answers.get('capture_worthy')?.choice
    if (!isCaptureWorthy(captureWorthy)) {
      throw new Error('capture_worthy answer missing or off-catalog')
    }
    let proposalReply: ProposalReply | null = null
    if (input.openProposal) {
      const reply = answers.get('proposal_reply')?.choice
      if (!isProposalReply(reply)) throw new Error('proposal_reply answer missing or off-catalog')
      proposalReply = reply
    }
    return { captureWorthy, proposalReply, openProposal: input.openProposal, notes: [] }
  } catch (err) {
    console.error('[ask-turn] decision failed', err)
    return {
      captureWorthy: null,
      proposalReply: null,
      openProposal: input.openProposal,
      notes: [
        m.ask_capture_check_failed(),
        ...(input.openProposal ? [m.ask_reply_check_failed()] : []),
      ],
    }
  }
}

export type AskTurnPlan = {
  /** The tool this turn must call successfully before it may finish; null = none. */
  requiredTool: 'propose_thoughts' | 'store_thoughts' | null
  /** Context lines appended to the loop's system prompt. */
  hints: string[]
}

/** What the turn must do, from Jev's decisions — plain branching on the decided keys. */
export function planAskTurn(decisions: AskTurnDecisions): AskTurnPlan {
  const { captureWorthy, proposalReply, openProposal } = decisions
  const hints: string[] = []
  const openBlock = openProposal
    ? [`[open proposal ${openProposal.proposalId}]`, numberedThoughts(openProposal.thoughts)]
    : []

  if (captureWorthy === null) {
    hints.push(
      '[thought check unavailable — do not call propose_thoughts or store_thoughts this turn]',
    )
    return { requiredTool: null, hints }
  }

  if (proposalReply === 'confirm' && openProposal) {
    hints.push(
      ...openBlock,
      `[proposal_reply: confirm — the user accepted this proposal as written; call store_thoughts with proposal_id "${openProposal.proposalId}"]`,
    )
    return { requiredTool: 'store_thoughts', hints }
  }

  if (proposalReply === 'revise' && openProposal) {
    hints.push(
      ...openBlock,
      "[proposal_reply: revise — apply the user's change, then call propose_thoughts with the full revised list]",
    )
    return { requiredTool: 'propose_thoughts', hints }
  }

  if (proposalReply === 'unrelated') {
    hints.push(
      ...openBlock,
      '[proposal_reply: unrelated — the open proposal is closed; never store it]',
    )
  }

  if (captureWorthy === 'yes') {
    hints.push(
      '[capture_worthy: yes — after doing what the user asked, call propose_thoughts with the thoughts worth keeping]',
    )
    return { requiredTool: 'propose_thoughts', hints }
  }

  hints.push('[capture_worthy: no — do not call propose_thoughts]')
  return { requiredTool: null, hints }
}
