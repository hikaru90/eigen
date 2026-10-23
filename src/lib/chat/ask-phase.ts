/**
 * Ask's status phases (ei DESIGN.md "The mark is the loading indicator"):
 * `recalling… → following the threads… → writing…`, driven by the real NDJSON stream
 * rather than a timer. The page renders the phase beside the mesh spinner and
 * resolves each id to a paraglide message; this module owns only the walk.
 *
 * Routing is by stream event *type* and the fixed tool contract (which tool composes
 * the reply) — the same structural switch `pushStreamEvent` already does. No text is
 * inspected for meaning.
 */
import type { ChatProgressEvent } from './consume-chat-ndjson'

export type AskPhase = 'recalling' | 'threads' | 'writing'

export const ASK_PHASES: readonly AskPhase[] = ['recalling', 'threads', 'writing']

export const ASK_PHASE_INITIAL: AskPhase = 'recalling'

/** Tools whose run *is* the mesh writing its reply (agent-loop contract, not a heuristic). */
const COMPOSING_TOOLS: ReadonlySet<string> = new Set(['answer_question'])

/** The further of two phases: the status line never steps back. */
export function laterAskPhase(a: AskPhase, b: AskPhase): AskPhase {
  return ASK_PHASES.indexOf(b) > ASK_PHASES.indexOf(a) ? b : a
}

export function askPhaseAfterEvent(current: AskPhase, event: ChatProgressEvent): AskPhase {
  switch (event.type) {
    case 'thinking':
      return current
    case 'agent_progress':
      return laterAskPhase(current, 'threads')
    case 'tool_call':
    case 'tool_executing':
    case 'tool_progress':
    case 'tool_result':
      return laterAskPhase(current, COMPOSING_TOOLS.has(event.tool) ? 'writing' : 'threads')
    default:
      return current
  }
}
