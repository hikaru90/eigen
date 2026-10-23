/**
 * Desk navigation + mutation contracts. Desk items always route through the
 * existing Tasks/Projects surfaces and the existing assign endpoint.
 */

export type AssignTaskPayload = { thoughtId: string; projectEntityId?: string } | {
  thoughtId: string
  projectLabel?: string
}

export const ASSIGN_TASK_ENDPOINT = '/api/timeline/projects/assign'

export function requireId(value: string, what: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`Desk: ${what} is required`)
  return trimmed
}

export function deskTaskHref(eventId: string): string {
  return `/memory/tasks?event=${encodeURIComponent(requireId(eventId, 'eventId'))}`
}

export function deskProjectHref(entityId: string): string {
  return `/memory/projects/${encodeURIComponent(requireId(entityId, 'entityId'))}`
}

export function buildAssignTaskPayload(
  task: { thoughtId: string },
  project: { entityId: string },
): { thoughtId: string; projectEntityId: string } {
  const thoughtId = requireId(task.thoughtId, 'task.thoughtId')
  const projectEntityId = requireId(project.entityId, 'project.entityId')
  return { thoughtId, projectEntityId }
}

export function isValidAssignPayload(payload: {
  thoughtId?: string
  projectEntityId?: string
  projectLabel?: string
}): boolean {
  if (!payload.thoughtId?.trim()) return false
  const hasEntity = Boolean(payload.projectEntityId?.trim())
  const hasLabel = Boolean(payload.projectLabel?.trim())
  return hasEntity !== hasLabel
}

export type DeskWallNote = {
  id: string
  label: string
  kind: 'Thought' | 'Entity'
}

/** Wall notes carry identity + label only — never embeddings (DB-only boundary). */
export function toDeskWallNotes(
  nodes: Array<{ id: string; label: string; kind: 'Thought' | 'Entity' }>,
): DeskWallNote[] {
  return nodes.map(({ id, label, kind }) => ({ id, label, kind }))
}
