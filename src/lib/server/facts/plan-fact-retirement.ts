/**
 * Which facts go when their sources do (docs/planning/user-facts-layer.md, edit / archive hooks).
 * Pure set logic over rows the store loaded; no text is interpreted.
 *
 * A fact lives as long as ONE of the things it was derived from lives (its capture thought is not
 * archived, or its reference note is not archived). When the last one goes, the fact is retired:
 * status `forgotten`, and the secure value it points at is deleted with it. A fact that had
 * replaced an older one (`superseded_by`) takes the replacement with it: the older fact is
 * reopened, because what made it history no longer exists. That only holds for a source going
 * away; a forget request never reopens anything (`revive: false`).
 */

import type { FactStatus } from './fact-vocabulary'

export type RetirementFact = {
  id: string
  status: FactStatus
  secureValueId: string | null
  supersededBy: string | null
}

/** One source row of a fact and whether the thing it points at still lives. */
export type RetirementSource = { factId: string; live: boolean }

export type FactRetirementPlan = {
  /** Facts to set to `forgotten`. */
  retire: string[]
  /** Superseded facts to reopen (`active`, `superseded_by` cleared). */
  revive: string[]
  /** Secure values to delete with the retired facts. */
  secureValueIds: string[]
}

export function planFactRetirement(input: {
  /** The candidates: facts that lost a source. */
  facts: RetirementFact[]
  sources: RetirementSource[]
  /** Facts whose `superseded_by` is one of the candidates (any status). */
  supersededByCandidates: RetirementFact[]
  revive: boolean
}): FactRetirementPlan {
  const liveFacts = new Set(input.sources.filter((s) => s.live).map((s) => s.factId))
  const retiring = input.facts.filter((f) => f.status !== 'forgotten' && !liveFacts.has(f.id))
  const retire = retiring.map((f) => f.id)
  const retired = new Set(retire)

  const revive = input.revive
    ? input.supersededByCandidates
        .filter(
          (f) =>
            f.status === 'superseded' &&
            f.supersededBy !== null &&
            retired.has(f.supersededBy) &&
            !retired.has(f.id),
        )
        .map((f) => f.id)
    : []

  return {
    retire,
    revive,
    secureValueIds: retiring.flatMap((f) => (f.secureValueId ? [f.secureValueId] : [])),
  }
}
