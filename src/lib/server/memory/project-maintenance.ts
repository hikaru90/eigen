/**
 * Background GTD project audit/reconcile — never on read paths.
 * Also refreshes task waterfalls and prunes completed sequence rows.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb, withDbUser } from '$lib/server/db'
import { canonicalEntity } from '$lib/server/db/schema'
import {
  extractProjectOrder,
  shouldInvokeProjectOrderJudge,
} from '$lib/server/memory/extract-project-order'
import { auditGtdProjectProfiles } from '$lib/server/memory/judge-gtd-project'
import { countGtdProjectsForUser } from '$lib/server/memory/project-eligibility'
import {
  loadOpenTaskSummariesForProject,
  pruneCompletedSequencesForUser,
  replaceProjectTaskSequence,
} from '$lib/server/memory/project-task-sequence'
import { reconcileUserProjects } from '$lib/server/memory/reconcile-user-projects'

async function refreshProjectWaterfalls(userId: string): Promise<void> {
  await pruneCompletedSequencesForUser(userId)

  const projects = await getDb()
    .select({
      entityId: canonicalEntity.id,
      label: canonicalEntity.label,
    })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, userId),
        isNotNull(canonicalEntity.projectStatus),
        inArray(canonicalEntity.projectStatus, ['active', 'someday']),
      ),
    )

  for (const project of projects) {
    const openTasks = await loadOpenTaskSummariesForProject(userId, project.entityId)
    if (!shouldInvokeProjectOrderJudge(openTasks.length)) {
      if (openTasks.length === 1) {
        await replaceProjectTaskSequence({
          userId,
          projectEntityId: project.entityId,
          orderedThoughtIds: [openTasks[0]!.thoughtId],
        })
      }
      continue
    }
    const ordered = await extractProjectOrder({
      userId,
      projectLabel: project.label,
      openTasks,
    })
    await replaceProjectTaskSequence({
      userId,
      projectEntityId: project.entityId,
      orderedThoughtIds: ordered,
    })
  }
}

export function scheduleProjectMaintenance(userId: string): void {
  void withDbUser(userId, async () => {
    const projectCount = await countGtdProjectsForUser(userId)
    if (projectCount >= 2) {
      await reconcileUserProjects(userId)
    }
    await auditGtdProjectProfiles(userId)
    await refreshProjectWaterfalls(userId)
  }).catch((err) => {
    console.error('[project-maintenance] background maintenance failed', {
      userId,
      message: err instanceof Error ? err.message : String(err),
    })
  })
}
