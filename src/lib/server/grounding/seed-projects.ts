import { captureThought } from '$lib/server/capture/service'
import type { ProjectStatus } from '$lib/server/db/schema'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { judgeGtdProjectHub } from '$lib/server/memory/judge-gtd-project'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { maybePromoteHubToGtdProject } from '$lib/server/memory/maybe-promote-gtd-project'
import { designateNextAction } from '$lib/server/memory/project-next-action'
import { reconcileUserProjects } from '$lib/server/memory/reconcile-user-projects'
import { resolveProjectIdentity } from '$lib/server/memory/resolve-project-identity'

const PROJECT_STATUS_KEYS = ['active', 'someday', 'completed'] as const

export type GroundingProjectSeed = {
  name: string
  nextActionText?: string
  status?: ProjectStatus
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUS_KEYS as readonly string[]).includes(value)
}

export function parseProjectsPayload(raw: unknown): GroundingProjectSeed[] {
  if (!raw || typeof raw !== 'object') return []
  const projects = (raw as { projects?: unknown }).projects
  if (!Array.isArray(projects)) return []

  const out: GroundingProjectSeed[] = []
  for (const entry of projects) {
    if (!entry || typeof entry !== 'object') continue
    const name =
      typeof (entry as { name?: unknown }).name === 'string'
        ? (entry as { name: string }).name.trim()
        : ''
    if (!name) continue
    const nextActionText =
      typeof (entry as { nextActionText?: unknown }).nextActionText === 'string'
        ? (entry as { nextActionText: string }).nextActionText.trim()
        : undefined
    const statusRaw = (entry as { status?: unknown }).status
    const status = isProjectStatus(statusRaw) ? statusRaw : 'active'
    out.push({
      name,
      ...(nextActionText ? { nextActionText } : {}),
      status,
    })
  }
  return out
}

export async function extractProjectsFromGroundingFacet(
  userId: string,
  projectsFacetText: string,
): Promise<GroundingProjectSeed[]> {
  const prompt = [
    'Return ONLY JSON with this shape:',
    '{',
    '  "projects": [',
    '    { "name": "Project title", "nextActionText": "optional concrete next step", "status": "active|someday|completed" }',
    '  ]',
    '}',
    '',
    'Extract active projects and their next actions from the text below.',
    'Merge duplicate names for the same initiative into one project row.',
    'Use status "active" unless the text clearly marks someday or completed.',
    '',
    projectsFacetText,
  ].join('\n')

  const response = await llmChatCompletion({
    userId,
    messages: [
      {
        role: 'system',
        content:
          'You extract structured GTD project lists from onboarding text. Return only valid JSON.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
  })

  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('extractProjectsFromGroundingFacet: missing LLM content')
  }

  const parsed = JSON.parse(stripMarkdownJsonFences(content)) as unknown
  return parseProjectsPayload(parsed)
}

export async function seedProjectsFromGrounding(input: {
  userId: string
  projectsFacetText: string
}): Promise<{ projectCount: number; nextActionCount: number }> {
  const text = input.projectsFacetText.trim()
  if (!text) return { projectCount: 0, nextActionCount: 0 }

  const projects = await extractProjectsFromGroundingFacet(input.userId, text)
  let nextActionCount = 0
  let projectCount = 0

  for (const project of projects) {
    const resolution = await resolveProjectIdentity({
      userId: input.userId,
      surfaceLabel: project.name,
      mode: 'seed',
    })

    const judgment = await judgeGtdProjectHub(input.userId, resolution.entityId, { force: true })
    if (!judgment?.isGtdProject) continue

    const promoted = await maybePromoteHubToGtdProject({
      userId: input.userId,
      entityId: resolution.entityId,
      source: 'capture',
      status: project.status ?? 'active',
      forceJudge: true,
    })
    if (!promoted) continue

    projectCount += 1

    if (project.nextActionText?.trim()) {
      const captured = await captureThought(input.userId, project.nextActionText.trim(), {
        source: 'api',
        awaitEnrichment: true,
      })
      await designateNextAction(input.userId, resolution.entityId, captured.id)
      nextActionCount += 1
    }
  }

  await reconcileUserProjects(input.userId)

  return { projectCount, nextActionCount }
}
