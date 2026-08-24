/**
 * Community summary generation — retrieval-focused L1 routing reports.
 *
 * Only domain-level (L1) communities with ≥2 members and ≥1 linked thought
 * receive LLM summaries. Multiple communities are summarized per structured
 * JSON batch call; embeddings are batched via createThoughtEmbeddings.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  graphCommunity,
  communitySummary,
  communityMember,
  canonicalEntity,
  thought,
  thoughtEntity,
} from '$lib/server/db/schema'
import { createThoughtEmbeddings } from '$lib/server/llm/embedding'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { loadCommunityThoughtIds } from './community-bundles'
import { COMMUNITY_MID_LEVEL } from './community-levels'

/** Communities per structured LLM chat call. */
export const SUMMARY_LLM_BATCH_SIZE = 8

/** Max routing summaries generated per heartbeat run (resumable). */
export const DEFAULT_SUMMARY_REPORT_BUDGET = 50

export type CommunitySummaryResult = {
  /** Eligible L1 routing communities. */
  total: number
  summarized: number
  generated: number
  pending: number
  /** Work remaining because the per-run budget was exhausted. */
  deferred: number
  /** True when a batch contract/provider error occurred. */
  failed: boolean
  samples?: import('$lib/consolidation/heartbeat-job-report').HeartbeatJobSample[]
  sampleTotal?: number
}

export type CommunitySummaryStats = Pick<
  CommunitySummaryResult,
  'total' | 'summarized' | 'pending' | 'deferred'
>

export type CommunitySummaryOptions = {
  batchSize?: number
  reportBudget?: number
  shouldCancel?: () => boolean | Promise<boolean>
}

export class CommunitySummaryBatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommunitySummaryBatchError'
  }
}

function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

function dbErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  if (err.message.startsWith('Failed query:') && cause) {
    return typeof cause === 'string' ? cause : String(cause)
  }
  return err.message
}

async function communityStillExists(userId: string, communityId: string): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ id: graphCommunity.id })
    .from(graphCommunity)
    .where(and(eq(graphCommunity.id, communityId), eq(graphCommunity.userId, userId)))
    .limit(1)
  return Boolean(row)
}

/** Remove L2/L0 summaries — retrieval uses L1 routing reports only. */
export async function removeNonRoutingCommunitySummaries(userId: string): Promise<number> {
  const db = getDb()
  const deleted = await db
    .delete(communitySummary)
    .where(
      and(
        eq(communitySummary.userId, userId),
        sql`${communitySummary.level} <> ${COMMUNITY_MID_LEVEL}`,
      ),
    )
    .returning({ id: communitySummary.id })
  return deleted.length
}

export function formatCommunitySummaryDetail(
  stats: CommunitySummaryStats & { generated?: number },
): string {
  if (stats.total === 0) return 'no eligible L1 communities'
  const base = `${stats.summarized} of ${stats.total} L1 routing summaries`
  const parts: string[] = [base]
  if (typeof stats.generated === 'number' && stats.generated > 0) {
    parts.push(`${stats.generated} new`)
  }
  if (stats.pending > 0) parts.push(`${stats.pending} pending`)
  if (stats.deferred > 0) parts.push(`${stats.deferred} deferred`)
  return parts.join(', ')
}

/** Eligible L1 community with ≥2 members and ≥1 thought linked via members. */
export async function countEligibleRoutingCommunities(userId: string): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${graphCommunity.id})::int` })
    .from(graphCommunity)
    .innerJoin(communityMember, eq(communityMember.communityId, graphCommunity.id))
    .innerJoin(
      thoughtEntity,
      and(
        eq(thoughtEntity.entityId, communityMember.canonicalEntityId),
        eq(thoughtEntity.userId, graphCommunity.userId),
      ),
    )
    .where(
      and(
        eq(graphCommunity.userId, userId),
        eq(graphCommunity.level, COMMUNITY_MID_LEVEL),
        sql`${graphCommunity.memberCount} >= 2`,
      ),
    )
  return row?.n ?? 0
}

export async function getCommunitySummaryStats(userId: string): Promise<CommunitySummaryStats> {
  const db = getDb()
  const total = await countEligibleRoutingCommunities(userId)
  if (total === 0) return { total: 0, pending: 0, summarized: 0, deferred: 0 }

  const [pendingRow] = await db
    .select({ n: sql<number>`count(distinct ${graphCommunity.id})::int` })
    .from(graphCommunity)
    .innerJoin(communityMember, eq(communityMember.communityId, graphCommunity.id))
    .innerJoin(
      thoughtEntity,
      and(
        eq(thoughtEntity.entityId, communityMember.canonicalEntityId),
        eq(thoughtEntity.userId, graphCommunity.userId),
      ),
    )
    .leftJoin(communitySummary, eq(communitySummary.communityId, graphCommunity.id))
    .where(
      and(
        eq(graphCommunity.userId, userId),
        eq(graphCommunity.level, COMMUNITY_MID_LEVEL),
        sql`${graphCommunity.memberCount} >= 2`,
        sql`(
					${communitySummary.communityId} IS NULL
					OR (${graphCommunity.dirtyAt} IS NOT NULL AND ${graphCommunity.dirtyAt} > ${communitySummary.generatedAt})
				)`,
      ),
    )

  const pending = pendingRow?.n ?? 0
  return { total, pending, summarized: total - pending, deferred: 0 }
}

const BATCH_SUMMARY_SYSTEM = [
  'You write GraphRAG-style domain community reports for a personal knowledge graph.',
  'Each community is a mid-level cluster of related entities and memories.',
  'Respond with JSON only: {"reports":[{"communityId":"...","title":"...","summary":"..."}, ...]}',
  '- Include exactly one report per communityId requested — no extras, no omissions.',
  '- title: 3–8 word thematic label. Never a comma-separated list of entity names.',
  '- summary: 2–3 concise sentences describing what unifies this cluster thematically.',
  'Do NOT assert biographical facts about the user.',
  'Write in the same language as the thought samples when present; otherwise English.',
].join(' ')

/** Exported for unit tests — batch community summary LLM system prompt. */
export const COMMUNITY_SUMMARY_SYSTEM_PROMPT = BATCH_SUMMARY_SYSTEM

type CommunityContext = {
  communityId: string
  level: number
  entityLabels: string[]
  entityTypes: string[]
  relatedThoughts: string[]
  thoughtCount: number
}

export type { CommunityContext }

async function loadCommunityContext(
  userId: string,
  communityId: string,
): Promise<CommunityContext> {
  const db = getDb()

  const members = await db
    .select({
      label: canonicalEntity.label,
      entityType: canonicalEntity.entityType,
    })
    .from(communityMember)
    .innerJoin(canonicalEntity, eq(communityMember.canonicalEntityId, canonicalEntity.id))
    .where(and(eq(communityMember.communityId, communityId), eq(communityMember.userId, userId)))
    .limit(50)

  const [communityRow] = await db
    .select({ level: graphCommunity.level })
    .from(graphCommunity)
    .where(eq(graphCommunity.id, communityId))
    .limit(1)

  const level = communityRow?.level ?? COMMUNITY_MID_LEVEL

  const thoughtIds = await loadCommunityThoughtIds(userId, communityId, 20)
  let relatedThoughts: string[] = []

  if (thoughtIds.length > 0) {
    const samples = await db
      .select({ normalizedText: thought.normalizedText })
      .from(thought)
      .where(and(eq(thought.userId, userId), inArray(thought.id, thoughtIds)))
      .limit(8)
    relatedThoughts = samples.map((t) => t.normalizedText.slice(0, 300))
  }

  return {
    communityId,
    level,
    entityLabels: members.map((m) => m.label),
    entityTypes: [...new Set(members.map((m) => m.entityType))],
    relatedThoughts,
    thoughtCount: thoughtIds.length,
  }
}

export function buildCommunityContextBlock(ctx: CommunityContext): string {
  const entityList = ctx.entityLabels.slice(0, 12).join(', ')
  const typeList = ctx.entityTypes.join(', ')
  const thoughtSamples = ctx.relatedThoughts.map((t, i) => `${i + 1}. ${t}`).join('\n')

  return [
    `communityId: ${ctx.communityId}`,
    'Domain cluster (L1 routing).',
    `Entity count: ${ctx.entityLabels.length}`,
    entityList ? `Sample entities (context only): ${entityList}` : '',
    typeList ? `Entity types: ${typeList}` : '',
    `Thought count: ${ctx.thoughtCount}`,
    thoughtSamples ? `Thought samples:\n${thoughtSamples}` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

export function buildBatchSummaryPrompt(contexts: CommunityContext[]): string {
  const blocks = contexts.map((ctx, i) =>
    [`--- Community ${i + 1} ---`, buildCommunityContextBlock(ctx)].join('\n'),
  )
  return [`Generate exactly ${contexts.length} reports for these communities:`, '', ...blocks].join(
    '\n',
  )
}

export type ParsedBatchReport = {
  communityId: string
  title: string
  summary: string
}

export function parseBatchCommunityReports(
  content: string,
  expectedIds: string[],
): ParsedBatchReport[] {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new CommunitySummaryBatchError('community summary batch response is not valid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || !('reports' in parsed)) {
    throw new CommunitySummaryBatchError('community summary batch response missing reports array')
  }

  const reportsRaw = (parsed as { reports?: unknown }).reports
  if (!Array.isArray(reportsRaw)) {
    throw new CommunitySummaryBatchError('community summary batch reports must be an array')
  }

  const byId = new Map<string, ParsedBatchReport>()
  for (const item of reportsRaw) {
    if (!item || typeof item !== 'object') {
      throw new CommunitySummaryBatchError('community summary batch report item is invalid')
    }
    const communityId =
      typeof (item as { communityId?: unknown }).communityId === 'string'
        ? (item as { communityId: string }).communityId.trim()
        : ''
    const title =
      typeof (item as { title?: unknown }).title === 'string'
        ? (item as { title: string }).title.trim()
        : ''
    const summary =
      typeof (item as { summary?: unknown }).summary === 'string'
        ? (item as { summary: string }).summary.trim()
        : ''
    if (!communityId || !title || !summary) {
      throw new CommunitySummaryBatchError('community summary batch report missing required fields')
    }
    if (byId.has(communityId)) {
      throw new CommunitySummaryBatchError(
        `duplicate communityId in batch response: ${communityId}`,
      )
    }
    byId.set(communityId, {
      communityId,
      title: title.slice(0, 120),
      summary: summary.slice(0, 4000),
    })
  }

  const expectedSet = new Set(expectedIds)
  for (const id of expectedIds) {
    if (!byId.has(id)) {
      throw new CommunitySummaryBatchError(`batch response missing report for communityId ${id}`)
    }
  }

  for (const id of byId.keys()) {
    if (!expectedSet.has(id)) {
      throw new CommunitySummaryBatchError(`batch response contains unexpected communityId ${id}`)
    }
  }

  return expectedIds.map((id) => byId.get(id)!)
}

async function listPendingRoutingCommunityIds(userId: string, limit: number): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ id: graphCommunity.id })
    .from(graphCommunity)
    .innerJoin(communityMember, eq(communityMember.communityId, graphCommunity.id))
    .innerJoin(
      thoughtEntity,
      and(
        eq(thoughtEntity.entityId, communityMember.canonicalEntityId),
        eq(thoughtEntity.userId, graphCommunity.userId),
      ),
    )
    .leftJoin(communitySummary, eq(communitySummary.communityId, graphCommunity.id))
    .where(
      and(
        eq(graphCommunity.userId, userId),
        eq(graphCommunity.level, COMMUNITY_MID_LEVEL),
        sql`${graphCommunity.memberCount} >= 2`,
        sql`(
					${communitySummary.communityId} IS NULL
					OR (${graphCommunity.dirtyAt} IS NOT NULL AND ${graphCommunity.dirtyAt} > ${communitySummary.generatedAt})
				)`,
      ),
    )
    .groupBy(
      graphCommunity.id,
      graphCommunity.memberCount,
      graphCommunity.dirtyAt,
      communitySummary.communityId,
    )
    .orderBy(
      sql`CASE WHEN ${communitySummary.communityId} IS NULL THEN 0 ELSE 1 END`,
      sql`${graphCommunity.memberCount} DESC`,
      sql`${graphCommunity.id}`,
    )
    .limit(limit)

  return rows.map((r) => r.id)
}

async function generateSummaryBatch(
  userId: string,
  communityIds: string[],
): Promise<{ count: number; samples: { id: string; label: string; note: string }[] }> {
  if (communityIds.length === 0) return { count: 0, samples: [] }

  const contexts = await Promise.all(communityIds.map((id) => loadCommunityContext(userId, id)))

  const response = await llmChatCompletion({
    userId,
    messages: [
      { role: 'system', content: BATCH_SUMMARY_SYSTEM },
      { role: 'user', content: buildBatchSummaryPrompt(contexts) },
    ],
    temperature: 0,
    maxTokens: 280 * communityIds.length,
    responseFormat: 'json_object',
    logContext: 'community_summary_batch',
  })

  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new CommunitySummaryBatchError('community summary batch returned no choices')
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new CommunitySummaryBatchError('community summary batch returned empty content')
  }

  const reports = parseBatchCommunityReports(content, communityIds)
  const embeddingSources = reports.map((r) =>
    `${r.title.slice(0, 500)}. ${r.summary}`.slice(0, 2000),
  )
  const embeddings = await createThoughtEmbeddings(userId, embeddingSources)

  const db = getDb()
  const ctxById = new Map(contexts.map((c) => [c.communityId, c]))

  for (const report of reports) {
    if (!(await communityStillExists(userId, report.communityId))) {
      throw new CommunitySummaryBatchError(
        `community ${report.communityId} no longer exists after batch generation`,
      )
    }
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < reports.length; i++) {
      const report = reports[i]!
      const ctx = ctxById.get(report.communityId)
      if (!ctx) {
        throw new CommunitySummaryBatchError(`missing context for ${report.communityId}`)
      }

      await tx
        .insert(communitySummary)
        .values({
          userId,
          communityId: report.communityId,
          level: COMMUNITY_MID_LEVEL,
          summaryShort: report.title.slice(0, 500),
          summaryText: report.summary,
          summaryEmbedding: sql`${toPgVectorLiteral(embeddings[i]!)}::vector`,
          entityCount: ctx.entityLabels.length,
          thoughtCount: ctx.thoughtCount,
        })
        .onConflictDoUpdate({
          target: communitySummary.communityId,
          set: {
            summaryShort: report.title.slice(0, 500),
            summaryText: report.summary,
            summaryEmbedding: sql`${toPgVectorLiteral(embeddings[i]!)}::vector`,
            entityCount: ctx.entityLabels.length,
            thoughtCount: ctx.thoughtCount,
            generatedAt: sql`now()`,
          },
        })

      await tx
        .update(graphCommunity)
        .set({ dirtyAt: null })
        .where(and(eq(graphCommunity.id, report.communityId), eq(graphCommunity.userId, userId)))
    }
  })

  return {
    count: reports.length,
    samples: reports.slice(0, 12).map((r) => {
      const ctx = ctxById.get(r.communityId)
      const entities = ctx?.entityLabels.slice(0, 3).join(', ') ?? ''
      return {
        id: r.communityId,
        label: r.title.slice(0, 90),
        note: entities
          ? `summarized · e.g. ${entities}`
          : `summarized · ${ctx?.thoughtCount ?? 0} thoughts`,
      }
    }),
  }
}

/**
 * Generate L1 routing summaries in bounded batches until budget exhausted or work complete.
 */
export async function runCommunitySummaryGeneration(
  userId: string,
  options?: CommunitySummaryOptions,
): Promise<CommunitySummaryResult> {
  const batchSize = options?.batchSize ?? SUMMARY_LLM_BATCH_SIZE
  const reportBudget = options?.reportBudget ?? DEFAULT_SUMMARY_REPORT_BUDGET

  await removeNonRoutingCommunitySummaries(userId)

  let generated = 0
  let failed = false
  const samples: { kind: 'note'; id: string; label: string; note: string }[] = []

  while (generated < reportBudget) {
    if (options?.shouldCancel && (await options.shouldCancel())) break

    const stats = await getCommunitySummaryStats(userId)
    if (stats.pending === 0) {
      return {
        ...stats,
        generated,
        deferred: 0,
        failed: false,
        samples,
        sampleTotal: samples.length,
      }
    }

    const remainingBudget = reportBudget - generated
    const take = Math.min(batchSize, remainingBudget, stats.pending)
    const communityIds = await listPendingRoutingCommunityIds(userId, take)
    if (communityIds.length === 0) {
      const final = await getCommunitySummaryStats(userId)
      return {
        ...final,
        generated,
        deferred: 0,
        failed: false,
        samples,
        sampleTotal: samples.length,
      }
    }

    try {
      const batch = await generateSummaryBatch(userId, communityIds)
      generated += batch.count
      for (const s of batch.samples) {
        if (samples.length < 12) {
          samples.push({ kind: 'note', ...s })
        }
      }
    } catch (err) {
      console.error('[consolidation.summary] batch failed', {
        userId,
        count: communityIds.length,
        message: dbErrorMessage(err),
      })
      failed = true
      break
    }
  }

  const finalStats = await getCommunitySummaryStats(userId)
  const deferred = finalStats.pending > 0 && generated >= reportBudget ? finalStats.pending : 0

  return {
    total: finalStats.total,
    summarized: finalStats.summarized,
    generated,
    pending: finalStats.pending,
    deferred,
    failed,
    samples,
    sampleTotal: generated,
  }
}

/** @deprecated Use runCommunitySummaryGeneration — kept for incremental import compatibility. */
export async function runCommunitySummaryBatch(
  userId: string,
  batchSize: number,
): Promise<CommunitySummaryResult> {
  return runCommunitySummaryGeneration(userId, { batchSize, reportBudget: batchSize })
}
