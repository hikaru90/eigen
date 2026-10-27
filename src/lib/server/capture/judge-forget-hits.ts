/**
 * Per-hit decisions of the forget flow (docs/planning/personamem-score-plan.md, S2b; moved to the
 * decision model in docs/planning/jev-everywhere-rollout.md, J1). Both are Jev's, by meaning in any
 * language, each ONE batched Decisions call over the hits:
 *
 * - `forget_action`: for every hit retrieval found — shown in full (a thought's whole text; a
 *   note's matched passage with its neighbours and the note title; a fact with who it is about) —
 *   remove it all, remove just the forgotten part, or keep it. Jev's probability of the chosen
 *   action is the confidence the caller gates on.
 * - `forget_residual`: after the removals, for every hit the search still finds — does it still
 *   state what the user asked to forget? The forget instruction is archived only when every
 *   answer is no.
 *
 * The chat model decides none of this. It only writes text, and only for a `remove_detail`: the
 * edited thought, note passages or fact statement (remove-note-detail.ts, remove-fact-detail.ts).
 * Acting on a decision and the confidence gate are the caller's job; no string rule decides
 * anything here or there.
 */

import type { ForgetHit } from '$lib/server/capture/find-forget-hits'
import { runEnforcedPerItemDecisions } from '$lib/server/llm/decision-plane'

/** A removal is applied only at or above this confidence; below it the hit is left untouched and recorded. */
export const FORGET_CONFIDENCE_MIN = 0.8

export type ForgetHitAction = 'remove_all' | 'remove_detail' | 'keep'

export type JudgedForgetHit = { hit: ForgetHit; action: ForgetHitAction; confidence: number }

export type ForgetResidualVerdict = { hit: ForgetHit; stillStates: boolean; probability: number }

export const FORGET_ACTION_CRITERIA: Record<ForgetHitAction, string> = {
  remove_all:
    'The item is only about the thing to forget: nothing in it would still be worth remembering once that is gone. For a note, use it only when the note as a whole is about the forgotten thing (its title and excerpt make that clear); a note that is about more than that is remove_detail. A fact that states the forgotten thing is remove_all: it is one claim.',
  remove_detail:
    'The item also holds other information the user did not ask to forget. Then only the forgotten part must come out and everything else stays.',
  keep: 'The item does not state or imply the thing to forget. A search returns near matches; those stay. An earlier request to forget something is an instruction, not a fact to remove: keep it.',
}

export const FORGET_RESIDUAL_CRITERIA = {
  yes: 'The item still states or implies the thing the user asked Eigen to forget, in whole or in part, so it would still be remembered.',
  no: 'The item does not state or imply the thing the user asked to forget: it is a near match about something else, or an earlier forget request (an instruction, not a fact).',
} as const

const FORGET_ACTION_QUESTION =
  'What does forgetting the requested thing mean for this stored item? Judge by meaning in any language, between the request and the item too; do not rely on literal word overlap.'
const FORGET_RESIDUAL_QUESTION =
  'The requested thing was removed from memory. Does this stored item, which a search still finds, still state or imply it? Judge by meaning in any language; do not rely on literal word overlap.'

function describeHit(hit: ForgetHit, ref: string): string {
  const stored = hit.createdAt.toISOString().slice(0, 10)
  if (hit.kind === 'fact') {
    const parts = [hit.factKind, ...(hit.inferred ? ['inferred'] : []), `as of ${stored}`]
    return `[${ref}] fact about ${hit.subject} (${parts.join(', ')}):\n${hit.text}`
  }
  if (hit.kind === 'thought') {
    return `[${ref}] thought (stored ${stored}):\n${hit.text}`
  }
  const title = hit.title.trim() || 'Untitled note'
  return `[${ref}] note "${title}" (stored ${stored}), matched excerpt:\n${hit.text}`
}

type HitAnswer = { choice: string; probability: number }

async function askAboutHits(input: {
  userId: string
  forgetRequest: string
  hits: ForgetHit[]
  kind: 'forget_action' | 'forget_residual'
  criteria: Record<string, string>
  question: string
}): Promise<Map<string, HitAnswer>> {
  const refs = input.hits.map((_, i) => `h${i + 1}`)
  const answers = await runEnforcedPerItemDecisions({
    userId: input.userId,
    surface: 'forget',
    kind: input.kind,
    state: `Forget request: ${input.forgetRequest}`,
    criteria: input.criteria,
    items: input.hits.map((hit, i) => ({
      ref: refs[i]!,
      instructions: `${input.question}\n\n${describeHit(hit, refs[i]!)}`,
      llmChoice: null,
    })),
  })
  for (const ref of refs) {
    if (!answers.has(ref)) throw new Error(`forget hit judge: no ${input.kind} answer for ${ref}`)
  }
  return answers
}

export async function judgeForgetHits(params: {
  userId: string
  forgetRequest: string
  hits: ForgetHit[]
}): Promise<JudgedForgetHit[]> {
  if (params.hits.length === 0) return []
  const answers = await askAboutHits({
    ...params,
    kind: 'forget_action',
    criteria: FORGET_ACTION_CRITERIA,
    question: FORGET_ACTION_QUESTION,
  })
  return params.hits.map((hit, i) => {
    const answer = answers.get(`h${i + 1}`)!
    if (!Object.hasOwn(FORGET_ACTION_CRITERIA, answer.choice)) {
      throw new Error(`forget hit judge: unknown forget_action "${answer.choice}" for h${i + 1}`)
    }
    return { hit, action: answer.choice as ForgetHitAction, confidence: answer.probability }
  })
}

/** The residual check: does each hit the search still finds state what the user asked to forget? */
export async function judgeForgetResidual(params: {
  userId: string
  forgetRequest: string
  hits: ForgetHit[]
}): Promise<ForgetResidualVerdict[]> {
  if (params.hits.length === 0) return []
  const answers = await askAboutHits({
    ...params,
    kind: 'forget_residual',
    criteria: FORGET_RESIDUAL_CRITERIA,
    question: FORGET_RESIDUAL_QUESTION,
  })
  return params.hits.map((hit, i) => {
    const answer = answers.get(`h${i + 1}`)!
    if (answer.choice !== 'yes' && answer.choice !== 'no') {
      throw new Error(`forget hit judge: unknown forget_residual "${answer.choice}" for h${i + 1}`)
    }
    return { hit, stillStates: answer.choice === 'yes', probability: answer.probability }
  })
}
