import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { generateProjectPlan } from '$lib/server/memory/generate-project-plan'

export type GenerateProjectPlanRequest = {
  goal?: string
}

export type GenerateProjectPlanResponse = Awaited<ReturnType<typeof generateProjectPlan>>

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim()
  if (!entityId) error(400, 'Entity id is required')

  let body: GenerateProjectPlanRequest = {}
  try {
    const text = await event.request.text()
    if (text.trim()) {
      body = JSON.parse(text) as GenerateProjectPlanRequest
    }
  } catch {
    error(400, 'Invalid JSON body')
  }

  try {
    const result = await generateProjectPlan({
      userId: user.id,
      projectEntityId: entityId,
      ...(typeof body.goal === 'string' && body.goal.trim() ? { goal: body.goal.trim() } : {}),
    })
    return json(result satisfies GenerateProjectPlanResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) error(404, message)
    error(400, message)
  }
}
