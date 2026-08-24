import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import {
  createConnectedAgent,
  replaceAgentProjectBindings,
  listConnectedAgents,
  parseSubscribedEvents,
} from '$lib/server/agents/service'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 })

  const agents = await listConnectedAgents(user.id)
  return json({ agents })
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await event.request.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : ''
  const subscribedEvents = parseSubscribedEvents(body.subscribedEvents)
  const projectEntityIds = Array.isArray(body.projectEntityIds)
    ? body.projectEntityIds.filter(
        (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0,
      )
    : []

  if (!name) return json({ error: 'name is required' }, { status: 400 })
  if (!webhookUrl) return json({ error: 'webhookUrl is required' }, { status: 400 })

  try {
    const created = await createConnectedAgent({
      userId: user.id,
      name,
      webhookUrl,
      subscribedEvents,
    })

    if (projectEntityIds.length > 0) {
      await replaceAgentProjectBindings({
        userId: user.id,
        agentId: created.id,
        projectEntityIds,
      })
    }

    return json(
      {
        id: created.id,
        signingSecret: created.signingSecret,
        callbackToken: created.callbackToken,
      },
      { status: 201 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: message }, { status: 400 })
  }
}
