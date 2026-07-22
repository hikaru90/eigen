import { and, eq, inArray } from 'drizzle-orm'
import type { EvalEntry } from '$lib/server/db/brain.schema'
import { evalThoughtMap } from '$lib/server/db/brain.schema'
import { withDbUser } from '$lib/server/db'
import { updateEvalEntry } from '$lib/eval/store'
import type { CorpusFixtureRef } from '$lib/eval/store'
import { ingestBrokenFromCheckAssertions } from './auto-retrieval-prune'
import { deleteCorpusThought } from './delete-corpus-fixture'
import { logEval } from './eval-context'
import { EVAL_INGEST_RETRY_MAX_DEFAULT } from './eval-config'
import type { QaChecks } from './qa-types'

/** Fixtures whose entity checks require resolution rows (not haystack distractors with minCount 0). */
export function fixtureIdsRequiringEntityResolution(checks: QaChecks): string[] {
  const ids = new Set<string>()
  for (const entityCheck of checks.entities ?? []) {
    const min = entityCheck.minCount ?? 0
    const surfaces = entityCheck.surfacesContaining?.length ?? 0
    if ((min > 0 || surfaces > 0) && entityCheck.fixtureId) {
      ids.add(entityCheck.fixtureId)
    }
  }
  return [...ids]
}

export function resolveIngestRetryMax(): number {
  const raw = process.env.EVAL_INGEST_RETRY_MAX?.trim()
  if (!raw) return EVAL_INGEST_RETRY_MAX_DEFAULT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`EVAL_INGEST_RETRY_MAX must be a non-negative integer, got: ${raw}`)
  }
  return parsed
}

function captureFailureFixture(entry: EvalEntry): string | null {
  if (entry.kind !== 'capture' || entry.status !== 'failed') return null
  const ref = entry.fixtureRef?.trim()
  return ref || null
}

/** Fixtures whose corpus row should be deleted and re-captured before the next attempt. */
export function brokenFixturesFromEntries(entries: EvalEntry[]): Map<string, Set<string>> {
  const byQa = new Map<string, Set<string>>()

  const add = (qaId: string | null, fixtureId: string) => {
    if (!fixtureId.trim()) return
    const key = qaId ?? '_global'
    const set = byQa.get(key) ?? new Set<string>()
    set.add(fixtureId)
    byQa.set(key, set)
  }

  for (const entry of entries) {
    const captureFixture = captureFailureFixture(entry)
    if (captureFixture) {
      add(null, captureFixture)
    }

    if (entry.kind === 'check' && entry.status === 'completed' && entry.passed === false) {
      const qaId = String(entry.inputJson?.qaId ?? '').trim() || null
      const raw = entry.resultJson as {
        assertions?: Array<{ passed?: boolean; fixtureId?: string; id?: string }>
      }
      for (const fixtureId of ingestBrokenFromCheckAssertions(raw?.assertions ?? [])) {
        add(qaId, fixtureId)
      }
    }
  }

  return byQa
}

export function entriesToRerunForFixtures(input: {
  entries: EvalEntry[]
  qaId: string | null
  brokenFixtures: Set<string>
}): EvalEntry[] {
  const { entries, qaId, brokenFixtures } = input
  if (brokenFixtures.size === 0) return []

  const out: EvalEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'capture' && entry.fixtureRef && brokenFixtures.has(entry.fixtureRef)) {
      out.push(entry)
      continue
    }
    if (!qaId) continue
    if (entry.kind === 'check' && entry.fixtureRef === `${qaId}_check`) out.push(entry)
    if (entry.kind === 'check' && entry.fixtureRef === `${qaId}_post_edit_check`) out.push(entry)
    if (entry.kind === 'retrieval' && entry.fixtureRef === `${qaId}_retrieval`) out.push(entry)
    if (entry.kind === 'answer' && entry.fixtureRef === qaId) out.push(entry)
  }
  return out.sort((a, b) => a.ordinal - b.ordinal)
}

export async function resetEvalEntriesForRetry(
  operatorUserId: string,
  entryIds: string[],
): Promise<void> {
  for (const entryId of entryIds) {
    await updateEvalEntry(operatorUserId, entryId, {
      status: 'pending',
      passed: null,
      resultJson: {},
      error: null,
      durationMs: null,
      startedAt: null,
      finishedAt: null,
    })
  }
}

export async function deleteRunFixtureMappings(input: {
  operatorUserId: string
  runId: string
  fixtureIds: string[]
}): Promise<void> {
  if (input.fixtureIds.length === 0) return
  await withDbUser(input.operatorUserId, async (db) => {
    await db
      .delete(evalThoughtMap)
      .where(
        and(
          eq(evalThoughtMap.runId, input.runId),
          inArray(evalThoughtMap.fixtureId, input.fixtureIds),
        ),
      )
  })
}

export async function purgeCorpusFixtures(input: {
  evalUserId: string
  corpusFixtureMap: Map<string, CorpusFixtureRef>
  fixtureIds: string[]
}): Promise<string[]> {
  const deleted: string[] = []
  for (const fixtureId of input.fixtureIds) {
    const ref = input.corpusFixtureMap.get(fixtureId)
    if (!ref) continue
    const ok = await deleteCorpusThought({ evalUserId: input.evalUserId, thoughtId: ref.thoughtId })
    if (ok) {
      input.corpusFixtureMap.delete(fixtureId)
      deleted.push(fixtureId)
      logEval(`ingest retry: deleted corpus fixture ${fixtureId} (thought ${ref.thoughtId})`)
    }
  }
  return deleted
}

export type IngestRetryBatch = {
  qaId: string | null
  brokenFixtures: Set<string>
  entriesToRerun: EvalEntry[]
}

export function planIngestRetries(entries: EvalEntry[]): IngestRetryBatch[] {
  const byQa = brokenFixturesFromEntries(entries)
  const batches: IngestRetryBatch[] = []

  for (const [qaKey, brokenFixtures] of byQa) {
    if (brokenFixtures.size === 0) continue
    const qaId = qaKey === '_global' ? null : qaKey
    const entriesToRerun = entriesToRerunForFixtures({ entries, qaId, brokenFixtures })
    if (entriesToRerun.length === 0) continue
    batches.push({ qaId, brokenFixtures, entriesToRerun })
  }

  return batches
}

/** Union of all ingest-broken fixture ids across retry batches. */
export function allBrokenFixtureIds(batches: IngestRetryBatch[]): string[] {
  const out = new Set<string>()
  for (const batch of batches) {
    for (const fixtureId of batch.brokenFixtures) {
      out.add(fixtureId)
    }
  }
  return [...out]
}
