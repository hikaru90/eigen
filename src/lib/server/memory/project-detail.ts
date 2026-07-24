import { listProjectsByEntityIds, type ProjectListItem } from '$lib/server/memory/project-list'
import {
  listTemporalEventsForUser,
  MAX_LIST_LIMIT,
  type TemporalEventListItem,
} from '$lib/server/memory/temporal-event-list'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type ProjectDetail = {
  project: ProjectListItem
  items: TemporalEventListItem[]
}

/** Load one GTD project plus all of its timeline task/event items. */
export async function loadProjectDetail(
  userId: string,
  projectEntityId: string,
): Promise<ProjectDetail | null> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const [project] = await listProjectsByEntityIds(userId, [entityId])
  if (!project) return null

  const { items } = await listTemporalEventsForUser({
    userId,
    status: 'all',
    includeTasks: true,
    range: 'all',
    limit: MAX_LIST_LIMIT,
  })

  return {
    project,
    items: items.filter((item) => item.projectEntityId === entityId),
  }
}
