/**
 * Consolidation runner — nightly "sleep" for memory maintenance.
 *
 * Phase 1 (DeepSleep): salience recompute (elapsed-time), ontology prune, entity repair.
 * Phase 2 (REM): integration — community detection/summaries.
 *
 * Salience decay/open-loop floors use wall-clock elapsed time (idempotent per run).
 * Retrieval still bumps salience on access (reconsolidation).
 * Called by POST /api/admin/consolidate (pg_cron at 2am or manual).
 */

import { eq } from 'drizzle-orm'
import { isHeartbeatJobId, type HeartbeatJobId } from '$lib/consolidation/heartbeat-job-plan'
import {
  buildHeartbeatJobReport,
  type HeartbeatJobReport,
} from '$lib/consolidation/heartbeat-job-report'
import { getDb, withDbUser } from '$lib/server/db'
import { user } from '$lib/server/db/schema'
import {
  consolidateCanonicalEntityAliasesForUser,
  repairCanonicalEntityTypesForUser,
} from '$lib/server/memory/canonical-entity-admin'
import { pruneUnusedOntologyEntityKinds } from '$lib/server/ontology-db'
import { backfillRetrievalLinksForUser } from '$lib/server/retrieval/materialize-links'
import { buildAllCommunityBundles } from './community-bundles'
import { runCommunityDetection } from './community-detection'
import {
  runCommunitySummaryGeneration,
  getCommunitySummaryStats,
  formatCommunitySummaryDetail,
  type CommunitySummaryResult,
  type CommunitySummaryStats,
} from './community-summaries'
import { runSalienceCompute } from './compute-salience'
import { repairEntityRelationsForUser } from './repair-entity-relations'
import { computeThoughtRetrievalFeatures } from './thought-retrieval-features'

export type ConsolidationPhase = 'deep_sleep' | 'rem'

export type ConsolidationJobResult = {
  phase: ConsolidationPhase
  job: string
  ok: boolean
  detail?: string
  durationMs: number
  /** Plain-language explanation + optional samples for the Heartbeat UI. */
  report?: HeartbeatJobReport
}

export type ConsolidationRunResult = {
  userId: string
  jobs: ConsolidationJobResult[]
  totalDurationMs: number
}

/** Human-readable lines for failed consolidation steps (shown in UI). */
export function formatConsolidationJobErrors(jobs: ConsolidationJobResult[]): string[] {
  return jobs
    .filter((j) => !j.ok)
    .map((j) => {
      const label = j.job.replace(/_/g, ' ')
      return j.detail ? `${label}: ${j.detail}` : `${label} failed`
    })
}

function formatDurationMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function formatJobResultDetail(detail: unknown): string | undefined {
  if (typeof detail === 'number') {
    return detail === 1 ? '1 item' : `${detail} items`
  }
  if (typeof detail !== 'object' || detail === null) return undefined
  if ('repaired' in detail && 'edgesAdded' in detail) {
    const r = detail as {
      repaired: number
      gaps: number
      edgesAdded: number
      scanned?: number
      processed?: number
    }
    if (r.gaps === 0) return 'all co-mentioned entities connected'
    const processedDetail =
      typeof r.processed === 'number' ? `, ${r.processed} gap thoughts processed` : ''
    if (r.repaired === 0) return `${r.gaps} gaps found, none repaired yet${processedDetail}`
    return `${r.repaired} of ${r.gaps} gaps repaired (${r.edgesAdded} edges${processedDetail})`
  }
  if ('merged' in detail && 'candidates' in detail) {
    const r = detail as { merged: number; candidates: number; scanned: number }
    if (r.candidates === 0) return `no dedup candidates (${r.scanned} scanned)`
    return `${r.merged} of ${r.candidates} dedup candidates merged (${r.scanned} scanned)`
  }
  if ('repaired' in detail) {
    return `${(detail as { repaired: number }).repaired} repaired`
  }
  if ('deletedEntityKindIds' in detail) {
    return `${(detail as { deletedEntityKindIds: string[] }).deletedEntityKindIds.length} entity kinds pruned`
  }
  if ('totalCommunities' in detail) {
    const r = detail as {
      totalCommunities: number
      changed?: boolean
      graphHealth?: { lowConfidence?: boolean; reasons?: string[] }
    }
    const label =
      r.changed === false
        ? `${r.totalCommunities} communities (unchanged)`
        : `${r.totalCommunities} communities`
    if (r.graphHealth?.lowConfidence) {
      const reasons =
        Array.isArray(r.graphHealth.reasons) && r.graphHealth.reasons.length > 0
          ? `; low-confidence graph: ${r.graphHealth.reasons.join(', ')}`
          : '; low-confidence graph'
      return `${label}${reasons}`
    }
    return label
  }
  if ('summarized' in detail && 'total' in detail) {
    const r = detail as CommunitySummaryResult
    return formatCommunitySummaryDetail(r)
  }
  if ('generated' in detail) {
    const r = detail as { generated: number; pending?: number }
    if (r.generated > 0) {
      return r.pending && r.pending > 0
        ? `${r.generated} summaries written (${r.pending} still pending)`
        : `${r.generated} summaries written`
    }
    if (r.pending && r.pending > 0) {
      return `${r.pending} communities still need summaries`
    }
    return 'nothing to summarize'
  }
  if ('decayed' in detail || 'openTasks' in detail) {
    const r = detail as { decayed: number; openTasks: number }
    const parts: string[] = []
    if (r.decayed > 0) parts.push(`${r.decayed} decayed`)
    if (r.openTasks > 0) parts.push(`${r.openTasks} open tasks raised`)
    return parts.length > 0 ? parts.join(', ') : 'nothing to adjust'
  }
  if ('updated' in detail && typeof (detail as { updated: unknown }).updated === 'number') {
    const n = (detail as { updated: number }).updated
    return `${n} thoughts updated`
  }
  if ('built' in detail && 'skipped' in detail) {
    const r = detail as { built: number; skipped: number }
    return `${r.built} bundles built${r.skipped > 0 ? `, ${r.skipped} skipped` : ''}`
  }
  return undefined
}

/** Human-readable step lines for a completed heartbeat (shown in UI). */
export function formatConsolidationJobSummaries(jobs: ConsolidationJobResult[]): string[] {
  return jobs.map((j) => {
    const label = j.job.replace(/_/g, ' ')
    const timing = formatDurationMs(j.durationMs)
    if (!j.ok) {
      return `${label}: failed (${timing}) — ${j.detail ?? 'unknown error'}`
    }
    const work = j.detail ?? 'ok'
    return `${label}: ${work} (${timing})`
  })
}

function jobDetailFromResult(detail: unknown): string | undefined {
  if (typeof detail === 'string' && detail.trim()) return detail
  return formatJobResultDetail(detail)
}

function attachJobReport(
  job: string,
  ok: boolean,
  raw: unknown,
  detail: string | undefined,
): { detail: string; report: HeartbeatJobReport } {
  const report = buildHeartbeatJobReport(job, raw, { ok, detail })
  // Preserve operator-facing suffixes the structured summary would drop.
  if (
    typeof detail === 'string' &&
    detail.trim() &&
    (detail.includes('skipped (communities unchanged)') || detail.includes('will resume next run'))
  ) {
    report.summary = detail
  }
  return { detail: report.summary, report }
}

export type ConsolidateForUserOptions = {
  shouldCancel?: () => boolean | Promise<boolean>
  onJobStart?: (job: string) => void | Promise<void>
  onJobComplete?: (result: ConsolidationJobResult) => void | Promise<void>
}

async function runJob(
  phase: ConsolidationPhase,
  name: string,
  fn: () => Promise<unknown>,
  options?: ConsolidateForUserOptions,
): Promise<ConsolidationJobResult> {
  const start = Date.now()
  try {
    await options?.onJobStart?.(name)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[consolidation] job progress update failed on start', { job: name, message })
  }
  try {
    console.info('[consolidation] job executing', { phase, job: name })
    const raw = await fn()
    const detail = jobDetailFromResult(raw)
    const withReport = attachJobReport(name, true, raw, detail)
    const result: ConsolidationJobResult = {
      phase,
      job: name,
      ok: true,
      detail: withReport.detail,
      report: withReport.report,
      durationMs: Date.now() - start,
    }
    try {
      await options?.onJobComplete?.(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[consolidation] job progress update failed on complete', {
        job: name,
        message,
      })
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[consolidation] job failed', { phase, job: name, message })
    const withReport = attachJobReport(name, false, null, message)
    const result: ConsolidationJobResult = {
      phase,
      job: name,
      ok: false,
      detail: withReport.detail,
      report: withReport.report,
      durationMs: Date.now() - start,
    }
    try {
      await options?.onJobComplete?.(result)
    } catch (progressErr) {
      const progressMessage =
        progressErr instanceof Error ? progressErr.message : String(progressErr)
      console.error('[consolidation] job progress update failed after error', {
        job: name,
        message: progressMessage,
      })
    }
    return result
  }
}

async function shouldStop(
  userId: string,
  options?: ConsolidateForUserOptions,
  inDbScope = false,
): Promise<boolean> {
  if (!options?.shouldCancel) return false
  if (inDbScope) return Promise.resolve(options.shouldCancel())
  return withDbUser(userId, () => Promise.resolve(options.shouldCancel!()))
}

async function runConsolidationJobScoped(
  userId: string,
  jobId: HeartbeatJobId,
  options?: ConsolidateForUserOptions,
): Promise<ConsolidationJobResult> {
  return withDbUser(userId, () => executeConsolidationJob(userId, jobId, options))
}

/**
 * Run a single consolidation job (for retrying a failed heartbeat step).
 * Does not run other phases — only the requested job id.
 */
export async function runConsolidationJobForUser(
  userId: string,
  jobId: HeartbeatJobId,
  options?: ConsolidateForUserOptions,
): Promise<ConsolidationJobResult> {
  if (!isHeartbeatJobId(jobId)) {
    throw new Error(`Unknown consolidation job: ${jobId}`)
  }
  return withDbUser(userId, () => executeConsolidationJob(userId, jobId, options))
}

async function executeConsolidationJob(
  userId: string,
  jobId: HeartbeatJobId,
  options?: ConsolidateForUserOptions,
): Promise<ConsolidationJobResult> {
  switch (jobId) {
    case 'salience_compute':
      return runJob('deep_sleep', 'salience_compute', () => runSalienceCompute(userId), options)
    case 'ontology_prune':
      return runJob(
        'deep_sleep',
        'ontology_prune',
        async () => pruneUnusedOntologyEntityKinds(getDb(), userId),
        options,
      )
    case 'repair_canonical_entity_types':
      return runJob(
        'deep_sleep',
        'repair_canonical_entity_types',
        () => repairCanonicalEntityTypesForUser(userId),
        options,
      )
    case 'dedup_canonical_entities':
      return runJob(
        'deep_sleep',
        'dedup_canonical_entities',
        () => consolidateCanonicalEntityAliasesForUser(userId),
        options,
      )
    case 'repair_entity_relations':
      return runJob(
        'deep_sleep',
        'repair_entity_relations',
        () =>
          repairEntityRelationsForUser(userId, {
            shouldCancel: () => shouldStop(userId, options, true),
          }),
        options,
      )
    case 'community_detection':
      return runJob('rem', 'community_detection', () => runCommunityDetection(userId), options)
    case 'community_summaries':
      return runCommunitySummariesJob(userId, options)
    case 'community_bundles':
      return runJob('rem', 'community_bundles', () => buildAllCommunityBundles(userId), options)
    case 'retrieval_links_backfill':
      return runJob(
        'rem',
        'retrieval_links_backfill',
        () => backfillRetrievalLinksForUser(userId),
        options,
      )
    case 'thought_retrieval_features':
      return runJob(
        'rem',
        'thought_retrieval_features',
        () => computeThoughtRetrievalFeatures(userId),
        options,
      )
  }
}

/**
 * Run all consolidation jobs for a single user (RLS-scoped via {@link withDbUser} per job).
 * Connections are released between jobs so long LLM steps do not hold the app pool.
 */
export async function consolidateForUser(
  userId: string,
  options?: ConsolidateForUserOptions,
): Promise<ConsolidationRunResult> {
  const start = Date.now()
  const jobs: ConsolidationJobResult[] = []

  // ---- Phase 1: DeepSleep ------------------------------------------------
  if (await shouldStop(userId, options)) {
    return { userId, jobs, totalDurationMs: Date.now() - start }
  }
  jobs.push(await runConsolidationJobScoped(userId, 'salience_compute', options))

  if (await shouldStop(userId, options)) {
    return { userId, jobs, totalDurationMs: Date.now() - start }
  }
  jobs.push(await runConsolidationJobScoped(userId, 'ontology_prune', options))

  if (await shouldStop(userId, options)) {
    return { userId, jobs, totalDurationMs: Date.now() - start }
  }
  jobs.push(await runConsolidationJobScoped(userId, 'repair_canonical_entity_types', options))

  if (await shouldStop(userId, options)) {
    return { userId, jobs, totalDurationMs: Date.now() - start }
  }
  jobs.push(await runConsolidationJobScoped(userId, 'dedup_canonical_entities', options))

  if (await shouldStop(userId, options)) {
    return { userId, jobs, totalDurationMs: Date.now() - start }
  }
  jobs.push(await runConsolidationJobScoped(userId, 'repair_entity_relations', options))

  // ---- Phase 2: REM --------------------------------------------------------
  if (await shouldStop(userId, options)) {
    return { userId, jobs, totalDurationMs: Date.now() - start }
  }
  let communitiesChanged = true
  const detectionResult = await withDbUser(userId, async () =>
    runJob(
      'rem',
      'community_detection',
      async () => {
        const result = await runCommunityDetection(userId)
        communitiesChanged = result.changed
        return result
      },
      options,
    ),
  )
  jobs.push(detectionResult)

  if (detectionResult.ok) {
    if (await shouldStop(userId, options)) {
      return { userId, jobs, totalDurationMs: Date.now() - start }
    }
    if (communitiesChanged) {
      jobs.push(await withDbUser(userId, () => runCommunitySummariesJob(userId, options)))
    } else {
      jobs.push(
        await withDbUser(userId, async () => {
          const stats = await getCommunitySummaryStats(userId)
          if (stats.pending > 0) {
            return runCommunitySummariesJob(userId, options)
          }
          return skipCommunitySummariesJob(userId, stats, options)
        }),
      )
    }

    if (await shouldStop(userId, options)) {
      return { userId, jobs, totalDurationMs: Date.now() - start }
    }
    jobs.push(await runConsolidationJobScoped(userId, 'community_bundles', options))
  }

  if (await shouldStop(userId, options)) {
    return { userId, jobs, totalDurationMs: Date.now() - start }
  }
  jobs.push(await runConsolidationJobScoped(userId, 'retrieval_links_backfill', options))

  if (await shouldStop(userId, options)) {
    return { userId, jobs, totalDurationMs: Date.now() - start }
  }
  jobs.push(await runConsolidationJobScoped(userId, 'thought_retrieval_features', options))

  return { userId, jobs, totalDurationMs: Date.now() - start }
}

async function skipCommunitySummariesJob(
  userId: string,
  stats: CommunitySummaryStats,
  options?: ConsolidateForUserOptions,
): Promise<ConsolidationJobResult> {
  const start = Date.now()
  const detail =
    stats.total === 0
      ? 'skipped (communities unchanged)'
      : `${formatCommunitySummaryDetail(stats)} — skipped (communities unchanged)`
  try {
    await options?.onJobStart?.('community_summaries')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[consolidation] job progress update failed on start', {
      job: 'community_summaries',
      message,
    })
  }
  const withReport = attachJobReport('community_summaries', true, stats, detail)
  const result: ConsolidationJobResult = {
    phase: 'rem',
    job: 'community_summaries',
    ok: true,
    detail: withReport.detail,
    report: withReport.report,
    durationMs: Date.now() - start,
  }
  console.info('[consolidation] job skipped', { phase: 'rem', job: 'community_summaries', detail })
  try {
    await options?.onJobComplete?.(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[consolidation] job progress update failed on complete', {
      job: 'community_summaries',
      message,
    })
  }
  return result
}

async function runCommunitySummariesJob(
  userId: string,
  options?: ConsolidateForUserOptions,
): Promise<ConsolidationJobResult> {
  const start = Date.now()
  try {
    await options?.onJobStart?.('community_summaries')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[consolidation] job progress update failed on start', {
      job: 'community_summaries',
      message,
    })
  }
  try {
    console.info('[consolidation] job executing', { phase: 'rem', job: 'community_summaries' })
    const summaryResult = await runCommunitySummaryGeneration(userId, {
      shouldCancel: () => shouldStop(userId, options, true),
    })
    const detail = formatCommunitySummaryDetail(summaryResult)
    // Budget exhaustion is resumable work, not a failed heartbeat.
    const ok = !summaryResult.failed
    const detailWithResume =
      summaryResult.deferred > 0 ? `${detail} — will resume next run` : detail
    const withReport = attachJobReport('community_summaries', ok, summaryResult, detailWithResume)
    const result: ConsolidationJobResult = {
      phase: 'rem',
      job: 'community_summaries',
      ok,
      detail: withReport.detail,
      report: withReport.report,
      durationMs: Date.now() - start,
    }
    if (summaryResult.failed) {
      console.error('[consolidation] community summaries failed', summaryResult)
    } else if (summaryResult.deferred > 0) {
      console.info('[consolidation] community summaries deferred to next run', summaryResult)
    }
    try {
      await options?.onJobComplete?.(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[consolidation] job progress update failed on complete', {
        job: 'community_summaries',
        message,
      })
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[consolidation] job failed', {
      phase: 'rem',
      job: 'community_summaries',
      message,
    })
    const withReport = attachJobReport('community_summaries', false, null, message)
    const result: ConsolidationJobResult = {
      phase: 'rem',
      job: 'community_summaries',
      ok: false,
      detail: withReport.detail,
      report: withReport.report,
      durationMs: Date.now() - start,
    }
    try {
      await options?.onJobComplete?.(result)
    } catch (progressErr) {
      const progressMessage =
        progressErr instanceof Error ? progressErr.message : String(progressErr)
      console.error('[consolidation] job progress update failed after error', {
        job: 'community_summaries',
        message: progressMessage,
      })
    }
    return result
  }
}

/**
 * Run consolidation for all users (cron entrypoint).
 * Processes users sequentially to avoid overwhelming DB/LLM capacity.
 */
export async function consolidateAllUsers(): Promise<ConsolidationRunResult[]> {
  const db = getDb()
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.accountKind, 'production'))
  const results: ConsolidationRunResult[] = []

  for (const u of users) {
    try {
      const result = await consolidateForUser(u.id)
      results.push(result)
      console.info('[consolidation] completed for user', {
        userId: u.id,
        jobs: result.jobs.map((j) => `${j.phase}/${j.job}:${j.ok ? 'ok' : 'err'}`).join(','),
        durationMs: result.totalDurationMs,
      })
    } catch (err) {
      console.error('[consolidation] unexpected error for user', {
        userId: u.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}
