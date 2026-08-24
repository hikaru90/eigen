import { m } from '$lib/paraglide/messages.js'
import { type ProjectStatus } from '$lib/server/db/schema'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { listEligibleProjectsForAssignment } from '$lib/server/memory/project-list'
import {
  designateNextAction,
  linkThoughtToProject,
  thoughtHasManualProjectLink,
} from '$lib/server/memory/project-next-action'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type GtdProjectOption = {
  entityId: string
  label: string
  status: ProjectStatus
}

export type GtdAssignmentExtraction = {
  projectEntityId: string | null
  isNextAction: boolean
}

export type GtdAssignmentResult = {
  projectEntityId: string | null
  projectLabel: string | null
  isNextAction: boolean
}

function extractChatContent(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('extractGtdAssignment: missing LLM content')
  }
  return content
}

/** @deprecated Use listEligibleProjectsForAssignment from project-list. */
export async function loadGtdProjectOptions(userId: string): Promise<GtdProjectOption[]> {
  const rows = await listEligibleProjectsForAssignment(userId)
  return rows.map((row) => ({
    entityId: row.entityId,
    label: row.label,
    status: row.status,
  }))
}

export function parseGtdAssignmentPayload(
  raw: unknown,
  allowedProjectIds: Set<string>,
): GtdAssignmentExtraction {
  if (!raw || typeof raw !== 'object') {
    return { projectEntityId: null, isNextAction: false }
  }
  const obj = raw as Record<string, unknown>
  const projectRaw =
    typeof obj.projectEntityId === 'string'
      ? obj.projectEntityId
      : typeof obj.project_entity_id === 'string'
        ? obj.project_entity_id
        : null
  const projectEntityId =
    projectRaw && allowedProjectIds.has(validateNonEmptyEntityId(projectRaw, 'projectEntityId'))
      ? validateNonEmptyEntityId(projectRaw, 'projectEntityId')
      : null
  const isNextAction = obj.isNextAction === true || obj.is_next_action === true
  return { projectEntityId, isNextAction }
}

export async function extractGtdAssignment(input: {
  userId: string
  normalizedText: string
  projects: GtdProjectOption[]
  graphHubHints?: Array<{ entityId: string; label: string }>
}): Promise<GtdAssignmentExtraction> {
  if (input.projects.length === 0) {
    return { projectEntityId: null, isNextAction: false }
  }

  const projectCatalog = input.projects
    .map((p) => `- ${p.entityId}: ${p.label} (${p.status})`)
    .join('\n')
  const hubHints = input.graphHubHints?.map((h) => `- ${h.entityId}: ${h.label}`).join('\n')

  const prompt = [
    'Return ONLY JSON with this shape:',
    '{',
    '  "projectEntityId": "uuid from catalog or null",',
    '  "isNextAction": true|false',
    '}',
    '',
    'Decide whether this note belongs to one of the user projects and whether it is the concrete next action for that project (GTD).',
    'Use projectEntityId null when no project clearly applies.',
    'isNextAction should be true only when the text is a specific actionable next step for the chosen project.',
    '',
    'Project catalog:',
    projectCatalog,
    hubHints ? `\nGraph hub hints for this note:\n${hubHints}` : '',
    '',
    `Note: ${input.normalizedText}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content: m.llm_gtd_assignment_system(),
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
  })

  const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown
  const allowed = new Set(input.projects.map((p) => p.entityId))
  return parseGtdAssignmentPayload(parsed, allowed)
}

export async function applyGtdAssignment(input: {
  userId: string
  thoughtId: string
  normalizedText: string
  category: string
  graphHubHints?: Array<{ entityId: string; label: string }>
}): Promise<GtdAssignmentResult | null> {
  if (input.category !== 'task') {
    return null
  }

  if (await thoughtHasManualProjectLink(input.userId, input.thoughtId)) {
    return null
  }

  const projects = await listEligibleProjectsForAssignment(input.userId)
  if (projects.length === 0) return null

  const assignment = await extractGtdAssignment({
    userId: input.userId,
    normalizedText: input.normalizedText,
    projects,
    graphHubHints: input.graphHubHints,
  })

  if (!assignment.projectEntityId) {
    return { projectEntityId: null, projectLabel: null, isNextAction: false }
  }

  const project = projects.find((p) => p.entityId === assignment.projectEntityId)
  if (!project) {
    return { projectEntityId: null, projectLabel: null, isNextAction: false }
  }

  await linkThoughtToProject(input.userId, project.entityId, input.thoughtId, 'ingest')

  if (assignment.isNextAction) {
    await designateNextAction(input.userId, project.entityId, input.thoughtId)
  }

  return {
    projectEntityId: project.entityId,
    projectLabel: project.label,
    isNextAction: assignment.isNextAction,
  }
}
