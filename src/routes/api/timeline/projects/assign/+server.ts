import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { assignThoughtToProject } from '$lib/server/memory/assign-thought-project'

export type AssignProjectRequest = {
  thoughtId: string
  projectEntityId?: string
  projectLabel?: string
}

export type AssignProjectResponse = {
  projectEntityId: string
  projectLabel: string
  eligible: boolean
  created: boolean
  isGtdProject: boolean
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  let body: AssignProjectRequest
  try {
    body = (await event.request.json()) as AssignProjectRequest
  } catch {
    error(400, 'Invalid JSON body')
  }

  const thoughtId = body.thoughtId?.trim()
  if (!thoughtId) error(400, 'thoughtId is required')

  const projectEntityId = body.projectEntityId?.trim()
  const projectLabel = body.projectLabel?.trim()
  if (projectEntityId && projectLabel) {
    error(400, 'Provide projectEntityId or projectLabel, not both')
  }
  if (!projectEntityId && !projectLabel) {
    error(400, 'projectEntityId or projectLabel is required')
  }

  try {
    const result = await assignThoughtToProject(
      user.id,
      thoughtId,
      projectEntityId ? { projectEntityId } : { projectLabel: projectLabel! },
    )
    return json(result satisfies AssignProjectResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(400, message)
  }
}
