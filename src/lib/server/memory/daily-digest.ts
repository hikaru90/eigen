import { and, count, eq, gte, inArray } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { listAuthorLayersForUser, resolveAuthorSqlCondition } from '$lib/server/memory/authorship'
import {
  computeYesterdayStats,
  type DailyDigest,
  type DailyDigestAgent,
} from '$lib/server/memory/daily-summary'
import { loadOpenThreads, snippetForOpenThread } from '$lib/server/memory/open-threads'
import { listProjects } from '$lib/server/memory/project-list'
import { listTemporalEventsForUser } from '$lib/server/memory/temporal-event-list'
import { loadYarnThoughts } from '$lib/server/mesh/yarn-list'

const RECENT_PER_SECTION = 5
const AGENT_WINDOW_MS = 24 * 60 * 60 * 1000

/** Thoughts one agent layer captured since `since` (exact count, not capped by a page). */
async function countAgentCaptures(userId: string, authorLayerKey: string, since: Date): Promise<number> {
  const authorCondition = resolveAuthorSqlCondition(
    { author: thought.author, authorKeyId: thought.authorKeyId, authorLabel: thought.authorLabel },
    { authorLayerKey },
  )
  const [row] = await getDb()
    .select({ n: count() })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        inArray(thought.lifecycleStatus, ['open', 'completed']),
        gte(thought.createdAt, since),
        ...(authorCondition ? [authorCondition] : []),
      ),
    )
  return Number(row?.n ?? 0)
}

async function loadAgentActivity(userId: string, now: Date): Promise<DailyDigestAgent[]> {
  const since = new Date(now.getTime() - AGENT_WINDOW_MS)
  const layers = (await listAuthorLayersForUser(userId)).filter((layer) => layer.kind === 'agent')
  const agents = await Promise.all(
    layers.map(async (layer): Promise<DailyDigestAgent> => {
      const [captured, latest] = await Promise.all([
        countAgentCaptures(userId, layer.key, since),
        loadYarnThoughts(userId, { authorLayerKey: layer.key }),
      ])
      const recent = latest
        .filter((row) => new Date(row.createdAtIso) >= since)
        .slice(0, RECENT_PER_SECTION)
        .map((row) => ({ thoughtId: row.id, snippet: snippetForOpenThread(row.text) }))
      return { key: layer.key, label: layer.label, count: captured, recent }
    }),
  )
  // only agents that captured something today; busiest first
  return agents.filter((agent) => agent.count > 0).sort((a, b) => b.count - a.count)
}

/**
 * Everything the daily summary shows, for the user's own memory (agent captures
 * are reported in their own section). Built from the existing catalog queries:
 * listProjects, loadOpenThreads (stalled + loose tasks), the author layers.
 */
export async function loadDailyDigest(
  userId: string,
  timeZone: string,
  now = new Date(),
): Promise<DailyDigest> {
  const [{ items: openItems }, { items: allItems }, projects, openThreads, agents] =
    await Promise.all([
      listTemporalEventsForUser({ userId, status: 'open', range: 'all', includeTasks: true }),
      listTemporalEventsForUser({ userId, status: 'all', range: 'all', includeTasks: true }),
      listProjects(userId, { kind: 'user' }),
      loadOpenThreads(userId, { authorScope: 'user' }),
      loadAgentActivity(userId, now),
    ])

  const orphans = openThreads.orphanThreads
  return {
    yesterday: computeYesterdayStats(openItems, allItems, timeZone, now),
    projects: projects
      .filter((project) => project.status === 'active')
      .map((project) => ({
        entityId: project.entityId,
        label: project.label,
        nextAction: project.nextAction?.summary ?? null,
      })),
    stalled: openThreads.stalledProjects.flatMap((project) =>
      project.stalled
        ? [{ entityId: project.entityId, label: project.label, reason: project.stalled.reason }]
        : [],
    ),
    unthreaded: {
      count: orphans.length,
      // loadOpenThreads lists oldest first; the summary shows the newest
      recent: orphans
        .slice(-RECENT_PER_SECTION)
        .reverse()
        .map((orphan) => ({ thoughtId: orphan.thoughtId, snippet: orphan.snippet })),
    },
    agents,
  }
}
