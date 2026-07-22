import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { listConnectedAgents } from '$lib/server/agents/service'
import { listProjectsForUser } from '$lib/server/memory/project-list'
import { getDb } from '$lib/server/db'
import { agentProjectBinding, canonicalEntity } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  const userId = event.locals.user.id
  const agents = await listConnectedAgents(userId)
  const projects = await listProjectsForUser(userId, { authorScope: 'all' })

  const allBindings = await getDb()
    .select({
      agentId: agentProjectBinding.agentId,
      projectEntityId: agentProjectBinding.projectEntityId,
      projectLabel: canonicalEntity.label,
    })
    .from(agentProjectBinding)
    .innerJoin(canonicalEntity, eq(agentProjectBinding.projectEntityId, canonicalEntity.id))
    .where(eq(agentProjectBinding.userId, userId))

  const bindingsByAgent = new Map<
    string,
    Array<{ projectEntityId: string; projectLabel: string }>
  >()
  for (const b of allBindings) {
    let list = bindingsByAgent.get(b.agentId)
    if (!list) {
      list = []
      bindingsByAgent.set(b.agentId, list)
    }
    list.push({ projectEntityId: b.projectEntityId, projectLabel: b.projectLabel })
  }

  return {
    user: event.locals.user,
    agents,
    projects: projects.map((p) => ({
      projectEntityId: p.entityId,
      label: p.label,
      status: p.status,
    })),
    agentProjectBindings: Object.fromEntries(bindingsByAgent),
  }
}
