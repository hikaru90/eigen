import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  deleteConnectedAgent,
  replaceAgentProjectBindings,
  parseSubscribedEvents,
  updateConnectedAgent,
} from '$lib/server/agents/service'

export const PATCH: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await event.request.json().catch(() => ({}))
  const patch: {
    name?: string
    webhookUrl?: string
    subscribedEvents?: ReturnType<typeof parseSubscribedEvents>
    enabled?: boolean
  } = {}

  if (typeof body.name === 'string') patch.name = body.name
  if (typeof body.webhookUrl === 'string') patch.webhookUrl = body.webhookUrl
  if (body.subscribedEvents !== undefined)
    patch.subscribedEvents = parseSubscribedEvents(body.subscribedEvents)
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled

  const hasProjectBindings = Array.isArray(body.projectEntityIds)

  try {
    const updated = await updateConnectedAgent({
      userId: user.id,
      agentId: event.params.id,
      ...patch,
    })

    if (hasProjectBindings) {
      const projectEntityIds = body.projectEntityIds.filter(
        (v: unknown): v is string => typeof v === 'string' && v.trim(),
      )
      await replaceAgentProjectBindings({
        userId: user.id,
        agentId: event.params.id,
        projectEntityIds,
      })
    }

    return json({ id: updated.id, ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('not found') ? 404 : 400
    return json({ error: message }, { status })
  }
}

export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await deleteConnectedAgent(user.id, event.params.id)
    return json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: message }, { status: 404 })
  }
}
