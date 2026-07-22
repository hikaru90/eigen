import { loadEvalQa, updateEvalQa } from '../../src/lib/eval/qa-store'
import { resolveChecks } from './qa-checks'
import {
  buildRetrievalRelevantPrunePlan,
  ingestBrokenFixtureIdsFromAssertions,
  type RetrievalRelevantPrunePlan,
} from './prune-retrieval-relevant'
import type { CheckAssertionResult, QaRetrievalRelevant } from './qa-types'

export function qaIdFromRetrievalFixtureRef(fixtureRef: string | null | undefined): string | null {
  if (!fixtureRef?.endsWith('_retrieval')) return null
  return fixtureRef.slice(0, -'_retrieval'.length) || null
}

export function ingestBrokenFromCheckAssertions(assertions: CheckAssertionResult[]): Set<string> {
  return ingestBrokenFixtureIdsFromAssertions(assertions)
}

/** Drop ingest-broken haystack fixtures from retrieval grades; needle stays graded when configured. */
export function runtimeRetrievalRelevant(input: {
  relevant: QaRetrievalRelevant[]
  fixtureToUuid: Map<string, string>
  ingestBroken: Set<string>
  needleFixtureId?: string
}): {
  scoped: QaRetrievalRelevant[]
  skippedUncaptured: string[]
  skippedIngestBroken: string[]
  ingestBrokenNeedleRetained: string[]
} {
  const skippedUncaptured: string[] = []
  const skippedIngestBroken: string[] = []
  const ingestBrokenNeedleRetained: string[] = []
  const scoped: QaRetrievalRelevant[] = []
  for (const row of input.relevant) {
    if (!input.fixtureToUuid.has(row.id)) {
      skippedUncaptured.push(row.id)
      continue
    }
    if (input.ingestBroken.has(row.id)) {
      if (row.id === input.needleFixtureId) {
        ingestBrokenNeedleRetained.push(row.id)
        scoped.push(row)
        continue
      }
      skippedIngestBroken.push(row.id)
      continue
    }
    scoped.push(row)
  }
  return { scoped, skippedUncaptured, skippedIngestBroken, ingestBrokenNeedleRetained }
}

/** Persist retrieval-only prune to eval_qa when ingest failures overlap graded labels. */
export async function autoPersistRetrievalPruneForQa(
  qaId: string,
  ingestBroken: Set<string>,
): Promise<{ applied: boolean; plan: RetrievalRelevantPrunePlan | null }> {
  if (ingestBroken.size === 0) return { applied: false, plan: null }

  const qa = await loadEvalQa(qaId)
  if (!qa?.retrievalQuery?.trim() || qa.retrievalRelevant.length === 0) {
    return { applied: false, plan: null }
  }

  const plan = buildRetrievalRelevantPrunePlan({
    retrievalRelevant: qa.retrievalRelevant,
    checks: resolveChecks(qa),
    ingestBrokenFixtureIds: ingestBroken,
  })
  if (!plan) return { applied: false, plan: null }

  const retrievalQuery = plan.retrievalRelevantAfter.length > 0 ? qa.retrievalQuery : null

  await updateEvalQa(qaId, {
    question: qa.question,
    acceptance: qa.acceptance,
    captures: qa.captures,
    retrievalQuery,
    retrievalRelevant: plan.retrievalRelevantAfter,
    tags: qa.tags,
    edit: qa.edit,
    checks: plan.checksAfter,
  })

  return { applied: true, plan }
}
