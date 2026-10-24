import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  entityAlias,
  thought,
  thoughtEntity,
  type ProjectSource,
} from '$lib/server/db/schema'
import { fetchEntityEdgesForUser } from '$lib/server/graph/age'
import { upsertEntityNode } from '$lib/server/graph/age'
import { resolveDecisionEnforceKinds } from '$lib/server/llm/decision-client'
import {
  runEnforcedBoundedDecisions,
  type BoundedDecisionSpec,
} from '$lib/server/llm/decision-plane'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { promoteHubEntityType, upsertGraphHubEntity } from '$lib/server/memory/project-entity'
import { loadEligibleGtdProjects, type EligibleGtdProject } from '$lib/server/memory/project-list'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type ProjectIdentityMode = 'assign' | 'seed' | 'reconcile' | 'promote'

export type ProjectIdentityContext = {
  gtdProjects: EligibleGtdProject[]
  hubCandidates: Array<{
    entityId: string
    label: string
    entityType: string
    mentionCount: number
    linkedThoughtSummaries: string[]
  }>
  graphNeighborPairs: Array<{ sourceLabel: string; targetLabel: string; predicate: string }>
}

export type ProjectIdentityResolution = {
  entityId: string
  canonicalLabel: string
  hubEntityType: string
  isGtdProject: boolean
  shouldCreateHub: boolean
  mergeEntityIds: string[]
}

export type ResolveProjectIdentityInput = {
  userId: string
  surfaceLabel: string
  thoughtId?: string
  mode: ProjectIdentityMode
}

/** Shared LLM policy: merge only true name variants of one initiative. */
export const GTD_PROJECT_STAY_SEPARATE_POLICY = [
  'Merge ONLY when linked thoughts describe the SAME multi-step initiative under different labels (e.g. "Eigen" and "EigenMesh").',
  'Do NOT merge related but distinct bodies of work, sub-projects, phases, or parallel initiatives — even when names overlap or graph neighbors are shared.',
  'Graph neighbors inform discovery; shared neighbors alone are NOT sufficient to merge.',
  'When uncertain, keep projects separate (empty merge list).',
] as const

export function mergeEntityIdsAllowedForMode(mode: ProjectIdentityMode): boolean {
  return mode === 'seed' || mode === 'reconcile'
}

export function effectiveMergeEntityIds(mode: ProjectIdentityMode, ids: string[]): string[] {
  return mergeEntityIdsAllowedForMode(mode) ? ids : []
}

function extractChatContent(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('resolveProjectIdentity: missing LLM content')
  }
  return content
}

async function summarizeLinkedThoughts(
  userId: string,
  entityId: string,
  limit = 3,
): Promise<string[]> {
  const rows = await getDb()
    .select({
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
    })
    .from(thoughtEntity)
    .innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
    .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, entityId)))
    .limit(limit)

  const out: string[] = []
  for (const row of rows) {
    const text = row.normalizedTextEncrypted
      ? await decryptTenantValue({
          userId,
          table: 'thought',
          column: 'normalized_text',
          ciphertext: row.normalizedTextEncrypted,
        })
      : row.normalizedText
    const trimmed = text.trim()
    if (!trimmed) continue
    out.push(trimmed.length > 100 ? `${trimmed.slice(0, 97).trim()}…` : trimmed)
  }
  return out
}

export async function loadProjectIdentityContext(
  userId: string,
  hintLabel?: string,
): Promise<ProjectIdentityContext> {
  const gtdProjects = await loadEligibleGtdProjects(userId)

  const mentionRows = await getDb()
    .select({
      entityId: thoughtEntity.entityId,
      label: canonicalEntity.label,
      entityType: canonicalEntity.entityType,
      mentionCount: sql<number>`count(*)::int`.as('mention_count'),
    })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
    .where(eq(thoughtEntity.userId, userId))
    .groupBy(thoughtEntity.entityId, canonicalEntity.label, canonicalEntity.entityType)
    .orderBy(sql`count(*) desc`)
    .limit(25)

  let hubCandidates = await Promise.all(
    mentionRows.map(async (row) => ({
      entityId: row.entityId,
      label: row.label,
      entityType: row.entityType,
      mentionCount: row.mentionCount,
      linkedThoughtSummaries: await summarizeLinkedThoughts(userId, row.entityId),
    })),
  )

  if (hintLabel?.trim()) {
    const [byLabel] = await getDb()
      .select({
        entityId: canonicalEntity.id,
        label: canonicalEntity.label,
        entityType: canonicalEntity.entityType,
      })
      .from(canonicalEntity)
      .where(
        and(
          eq(canonicalEntity.userId, userId),
          eq(canonicalEntity.canonicalKey, computeLexicalText(hintLabel)),
        ),
      )
      .limit(1)
    if (byLabel && !hubCandidates.some((c) => c.entityId === byLabel.entityId)) {
      hubCandidates = [
        {
          entityId: byLabel.entityId,
          label: byLabel.label,
          entityType: byLabel.entityType,
          mentionCount: 0,
          linkedThoughtSummaries: await summarizeLinkedThoughts(userId, byLabel.entityId),
        },
        ...hubCandidates,
      ]
    }
  }

  const entityEdges = await fetchEntityEdgesForUser({ userId })
  const labelById = new Map(hubCandidates.map((c) => [c.entityId, c.label]))
  for (const p of gtdProjects) {
    labelById.set(p.entityId, p.label)
  }

  const graphNeighborPairs = entityEdges.slice(0, 40).flatMap((edge) => {
    const sourceLabel = labelById.get(edge.sourceId)
    const targetLabel = labelById.get(edge.targetId)
    if (!sourceLabel || !targetLabel) return []
    return [{ sourceLabel, targetLabel, predicate: edge.predicate }]
  })

  return {
    gtdProjects,
    hubCandidates,
    graphNeighborPairs,
  }
}

export function parseProjectIdentityPayload(
  raw: unknown,
  allowedEntityIds: Set<string>,
): Omit<ProjectIdentityResolution, 'entityId'> & { canonicalEntityId: string | null } {
  if (!raw || typeof raw !== 'object') {
    return {
      canonicalEntityId: null,
      canonicalLabel: '',
      hubEntityType: 'organization',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    }
  }
  const obj = raw as Record<string, unknown>
  const idRaw =
    typeof obj.canonicalEntityId === 'string'
      ? obj.canonicalEntityId
      : typeof obj.canonical_entity_id === 'string'
        ? obj.canonical_entity_id
        : null
  let canonicalEntityId: string | null = null
  if (idRaw) {
    try {
      const trimmed = validateNonEmptyEntityId(idRaw, 'canonicalEntityId')
      if (allowedEntityIds.has(trimmed)) {
        canonicalEntityId = trimmed
      }
    } catch {
      canonicalEntityId = null
    }
  }
  const canonicalLabel =
    typeof obj.canonicalLabel === 'string'
      ? obj.canonicalLabel.trim()
      : typeof obj.canonical_label === 'string'
        ? obj.canonical_label.trim()
        : ''
  const hubEntityType =
    typeof obj.hubEntityType === 'string' && obj.hubEntityType.trim()
      ? obj.hubEntityType.trim()
      : typeof obj.hub_entity_type === 'string' && obj.hub_entity_type.trim()
        ? obj.hub_entity_type.trim()
        : 'organization'
  const isGtdProject = obj.isGtdProject === true || obj.is_gtd_project === true
  const shouldCreateHub = obj.shouldCreateHub !== false && obj.should_create_hub !== false
  const mergeRaw = obj.mergeEntityIds ?? obj.merge_entity_ids
  const mergeEntityIds: string[] = []
  if (Array.isArray(mergeRaw)) {
    for (const entry of mergeRaw) {
      if (typeof entry !== 'string') continue
      try {
        const trimmed = validateNonEmptyEntityId(entry, 'mergeEntityIds[]')
        if (allowedEntityIds.has(trimmed)) {
          mergeEntityIds.push(trimmed)
        }
      } catch {
        // skip invalid ids
      }
    }
  }
  return {
    canonicalEntityId,
    canonicalLabel,
    hubEntityType,
    isGtdProject,
    shouldCreateHub,
    mergeEntityIds,
  }
}

export function buildIdentityPrompt(input: {
  surfaceLabel: string
  mode: ProjectIdentityMode
  context: ProjectIdentityContext
  thoughtId?: string
}): string {
  const mergeAllowed = mergeEntityIdsAllowedForMode(input.mode)
  const catalog = input.context.gtdProjects
    .map(
      (p) =>
        `- ${p.entityId}: ${p.label} (${p.status}, ${p.openTaskCount} open tasks, source=${p.source})`,
    )
    .join('\n')
  const hubs = input.context.hubCandidates
    .map(
      (h) =>
        `- ${h.entityId}: ${h.label} [${h.entityType}] mentions=${h.mentionCount}${
          h.linkedThoughtSummaries.length > 0
            ? ` thoughts: ${h.linkedThoughtSummaries.join(' | ')}`
            : ''
        }`,
    )
    .join('\n')
  const neighbors = input.context.graphNeighborPairs
    .map((e) => `- ${e.sourceLabel} --${e.predicate}--> ${e.targetLabel}`)
    .join('\n')

  const jsonShape = mergeAllowed
    ? [
        '{',
        '  "canonicalEntityId": "uuid from catalog/hubs or null",',
        '  "canonicalLabel": "best display name",',
        '  "hubEntityType": "org|product|project|other ontology entity_type key",',
        '  "shouldCreateHub": true|false,',
        '  "isGtdProject": true|false,',
        '  "mergeEntityIds": ["uuid", "..."]',
        '}',
      ]
    : [
        '{',
        '  "canonicalEntityId": "uuid from catalog/hubs or null",',
        '  "canonicalLabel": "best display name",',
        '  "hubEntityType": "org|product|project|other ontology entity_type key",',
        '  "shouldCreateHub": true|false,',
        '  "isGtdProject": true|false',
        '}',
      ]

  return [
    'Return ONLY JSON with this shape:',
    ...jsonShape,
    '',
    'Decide the single canonical graph hub for this work name.',
    ...(mergeAllowed
      ? [
          'mergeEntityIds lists loser hubs to fold into the winner — only for duplicate variants of the same initiative.',
          ...GTD_PROJECT_STAY_SEPARATE_POLICY,
        ]
      : [
          'Pick or create the best matching hub — do not fold other hubs into this one.',
          'Related but distinct initiatives must remain separate projects.',
        ]),
    'isGtdProject true only for a multi-step initiative — never for ingredients, people, or single chores.',
    'Copy UUIDs exactly from the catalogs below; use null when no existing hub fits.',
    '',
    `Mode: ${input.mode}`,
    input.thoughtId ? `Thought id: ${input.thoughtId}` : '',
    `Surface label: ${input.surfaceLabel}`,
    catalog ? `\nExisting GTD projects:\n${catalog}` : '\nExisting GTD projects: (none)',
    hubs ? `\nGraph hub candidates:\n${hubs}` : '\nGraph hub candidates: (none)',
    neighbors ? `\nEntity graph neighbors:\n${neighbors}` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

/** The raw resolution decision before hub upsert/merge persistence. */
type ResolutionDecision = ReturnType<typeof parseProjectIdentityPayload>

type ResolutionEngineInput = {
  userId: string
  surfaceLabel: string
  mode: ProjectIdentityMode
  thoughtId?: string
  context: ProjectIdentityContext
}

/**
 * The qwen chat judge — base engine when resolution_choice is not enforced,
 * escalation engine when the decision model's winning probability is low.
 */
async function resolveViaChatJudge(input: ResolutionEngineInput): Promise<ResolutionDecision> {
  const allowedEntityIds = new Set<string>([
    ...input.context.gtdProjects.map((p) => p.entityId),
    ...input.context.hubCandidates.map((h) => h.entityId),
  ])

  const allProjectRows = await getDb()
    .select({ entityId: canonicalEntity.id })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, input.userId), isNotNull(canonicalEntity.projectStatus)))
  for (const row of allProjectRows) {
    allowedEntityIds.add(row.entityId)
  }

  const prompt = buildIdentityPrompt({
    surfaceLabel: input.surfaceLabel,
    mode: input.mode,
    context: input.context,
    thoughtId: input.thoughtId,
  })

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content:
          'You resolve canonical graph hub identity for work names using linked thoughts and graph context. Return only valid JSON.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
  })

  const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown
  return parseProjectIdentityPayload(parsed, allowedEntityIds)
}

/** Below this winning probability the qwen chat judge arbitrates (qwen wins ties). */
const RESOLUTION_CHOICE_ESCALATION_BELOW = 0.6
const CANONICAL_CREATE_KEY = 'create'
const MERGE_CHOICE_KEY = 'merge'

/**
 * ONE Decisions call: the `canonical` question picks an existing hub (UUID
 * criteria keys) or `create`, plus one merge/keep question per candidate.
 * The chat judge is skipped (llmChoice null) unless escalation kicks in —
 * and that escalation runs only AFTER runEnforcedBoundedDecisions persisted
 * its rows, so the rows honestly record llmChoice=null either way.
 */
function resolutionChoiceSpecs(
  candidates: ProjectIdentityContext['hubCandidates'],
): BoundedDecisionSpec[] {
  const canonicalCriteria: Record<string, string> = {}
  for (const hub of candidates) {
    canonicalCriteria[hub.entityId] = `Existing hub "${hub.label}" with ${hub.mentionCount} linked thoughts (type ${hub.entityType})`
  }
  canonicalCriteria[CANONICAL_CREATE_KEY] =
    'No existing hub matches — create a new hub for this name.'

  const specs: BoundedDecisionSpec[] = [
    {
      decisionKind: 'resolution_choice',
      id: 'canonical',
      question: {
        type: 'choice',
        instructions:
          'Which existing hub is the canonical home for this work name — or should a new hub be created?',
        criteria: canonicalCriteria,
      },
      llmChoice: null,
    },
  ]
  for (const [index] of candidates.entries()) {
    specs.push({
      decisionKind: 'resolution_choice',
      id: `merge-${index}`,
      question: {
        type: 'choice',
        instructions: 'Should this existing hub be merged into the canonical hub, or kept separate?',
        criteria: {
          merge: 'Merge this hub into the canonical hub — same work under duplicate naming.',
          keep: 'Keep this hub separate — distinct work despite name similarity.',
        },
      },
      llmChoice: null,
    })
  }
  return specs
}

/**
 * Jev (Decisions API) enforcement for project-hub resolution (spec §5.2/§6 P):
 * the bounded decision model picks the canonical hub and the merge set in ONE
 * call. GTD promotion is NOT decided here — isGtdProject stays false and the
 * gtd_promotion judge runs separately. No try/catch: failures propagate (fail
 * loud, no fallback).
 */
async function resolveViaDecisionModel(
  input: ResolutionEngineInput,
): Promise<ResolutionDecision> {
  const candidates = input.context.hubCandidates
  const answers = await runEnforcedBoundedDecisions({
    userId: input.userId,
    surface: 'resolution',
    state: JSON.stringify({
      workName: input.surfaceLabel,
      candidateHubs: candidates.map((hub) => ({
        id: hub.entityId,
        label: hub.label,
        thoughtCount: hub.mentionCount,
        entityType: hub.entityType,
      })),
    }),
    specs: resolutionChoiceSpecs(candidates),
  })

  const canonical = answers.get('canonical')
  if (!canonical) {
    throw new Error('resolveProjectIdentity: enforced resolution_choice returned no canonical answer')
  }
  const winningProbability = canonical.probabilities[canonical.choice] ?? 0
  if (winningProbability < RESOLUTION_CHOICE_ESCALATION_BELOW) {
    // Calibrated uncertainty: the qwen chat judge arbitrates and its
    // COMPLETE result wins (qwen wins ties).
    return resolveViaChatJudge(input)
  }

  if (canonical.choice === CANONICAL_CREATE_KEY) {
    return {
      canonicalEntityId: null,
      canonicalLabel: input.surfaceLabel,
      hubEntityType: 'project',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    }
  }

  const canonicalHub = candidates.find((hub) => hub.entityId === canonical.choice)
  if (!canonicalHub) {
    throw new Error(
      `resolveProjectIdentity: enforced resolution_choice answered unknown hub "${canonical.choice}"`,
    )
  }
  const mergeEntityIds: string[] = []
  for (const [index, hub] of candidates.entries()) {
    if (hub.entityId === canonicalHub.entityId) continue
    if (answers.get(`merge-${index}`)?.choice === MERGE_CHOICE_KEY) {
      mergeEntityIds.push(hub.entityId)
    }
  }
  return {
    canonicalEntityId: canonicalHub.entityId,
    canonicalLabel: input.surfaceLabel,
    hubEntityType: canonicalHub.entityType,
    isGtdProject: false,
    shouldCreateHub: false,
    mergeEntityIds,
  }
}

export async function resolveProjectIdentity(
  input: ResolveProjectIdentityInput,
): Promise<ProjectIdentityResolution> {
  const surfaceLabel = input.surfaceLabel.trim()
  if (!surfaceLabel) {
    throw new Error('resolveProjectIdentity: surfaceLabel is required')
  }

  const context = await loadProjectIdentityContext(input.userId, surfaceLabel)
  const engineInput: ResolutionEngineInput = {
    userId: input.userId,
    surfaceLabel,
    mode: input.mode,
    thoughtId: input.thoughtId,
    context,
  }

  const resolution = resolveDecisionEnforceKinds().has('resolution_choice')
    ? await resolveViaDecisionModel(engineInput)
    : await resolveViaChatJudge(engineInput)

  const canonicalLabel = resolution.canonicalLabel || surfaceLabel

  let entityId: string
  if (resolution.canonicalEntityId) {
    entityId = resolution.canonicalEntityId
  } else if (resolution.shouldCreateHub) {
    entityId = await upsertGraphHubEntity(input.userId, canonicalLabel, resolution.hubEntityType)
  } else {
    entityId = await upsertGraphHubEntity(input.userId, canonicalLabel, resolution.hubEntityType)
  }

  const isGtdProject = resolution.isGtdProject
  const mergeEntityIds = effectiveMergeEntityIds(input.mode, resolution.mergeEntityIds)

  if (mergeEntityIds.length > 0) {
    await mergeProjectEntities(input.userId, entityId, mergeEntityIds, canonicalLabel, 'auto')
  }

  return {
    entityId,
    canonicalLabel,
    hubEntityType: resolution.hubEntityType,
    isGtdProject,
    shouldCreateHub: resolution.shouldCreateHub,
    mergeEntityIds,
  }
}

/**
 * Fold `loserIds` into `winnerId`: thought links, next action and aliases move to the winner,
 * the losers stop being projects. Automatic merges (`origin: 'auto'`, ingest/reconcile) never
 * take a manual project as a loser and never rename a manual winner. A merge the user asked
 * for (`origin: 'user'`) is their authority: manual projects merge and the label is theirs.
 */
export async function mergeProjectEntities(
  userId: string,
  winnerId: string,
  loserIds: string[],
  canonicalLabel: string | undefined,
  origin: 'auto' | 'user',
): Promise<void> {
  const winner = validateNonEmptyEntityId(winnerId, 'winnerId')
  const losers = [
    ...new Set(loserIds.map((id) => validateNonEmptyEntityId(id, 'loserIds[]'))),
  ].filter((id) => id !== winner)
  if (losers.length === 0) return

  // SAFEGUARD: Check if any loser is a manual project — manual projects must never be merged
  const loserProjects = await getDb()
    .select({
      entityId: canonicalEntity.id,
      source: canonicalEntity.projectSource,
    })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, userId),
        inArray(canonicalEntity.id, losers),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )
  const manualLosers = loserProjects.filter((p) => p.source === 'manual')
  if (origin === 'auto' && manualLosers.length > 0) {
    console.error('[merge-projects] Refusing to merge manual projects', {
      userId,
      winnerId,
      manualLosers: manualLosers.map((p) => p.entityId),
    })
    // Filter out manual losers
    const manualSet = new Set(manualLosers.map((p) => p.entityId))
    const protectedLosers = losers.filter((id) => !manualSet.has(id))
    if (protectedLosers.length === 0) return
    losers.length = 0
    losers.push(...protectedLosers)
  }

  const [winnerRow] = await getDb()
    .select({
      id: canonicalEntity.id,
      label: canonicalEntity.label,
      canonicalKey: canonicalEntity.canonicalKey,
      entityType: canonicalEntity.entityType,
      source: canonicalEntity.projectSource,
    })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, winner)))
    .limit(1)
  if (!winnerRow) {
    throw new Error(`mergeProjectEntities: winner ${winner} not found`)
  }

  const winnerIsManual = winnerRow.source === 'manual'
  const nextLabel =
    winnerIsManual && origin === 'auto'
      ? winnerRow.label
      : canonicalLabel?.trim() || winnerRow.label
  if (nextLabel !== winnerRow.label) {
    await getDb()
      .update(canonicalEntity)
      .set({ label: nextLabel })
      .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, winner)))
  }

  const loserRows = await getDb()
    .select({
      id: canonicalEntity.id,
      canonicalKey: canonicalEntity.canonicalKey,
      label: canonicalEntity.label,
    })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, userId), inArray(canonicalEntity.id, losers)))

  for (const loser of loserRows) {
    const links = await getDb()
      .select({ thoughtId: thoughtEntity.thoughtId })
      .from(thoughtEntity)
      .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, loser.id)))

    for (const link of links) {
      await getDb()
        .insert(thoughtEntity)
        .values({
          userId,
          thoughtId: link.thoughtId,
          entityId: winner,
          salience: 1,
        })
        .onConflictDoNothing()
    }

    await getDb()
      .delete(thoughtEntity)
      .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, loser.id)))

    const [loserProject] = await getDb()
      .select({
        nextActionThoughtId: canonicalEntity.nextActionThoughtId,
        status: canonicalEntity.projectStatus,
        source: canonicalEntity.projectSource,
      })
      .from(canonicalEntity)
      .where(
        and(
          eq(canonicalEntity.userId, userId),
          eq(canonicalEntity.id, loser.id),
          isNotNull(canonicalEntity.projectStatus),
        ),
      )
      .limit(1)

    if (loserProject) {
      const [winnerProject] = await getDb()
        .select({ nextActionThoughtId: canonicalEntity.nextActionThoughtId })
        .from(canonicalEntity)
        .where(
          and(
            eq(canonicalEntity.userId, userId),
            eq(canonicalEntity.id, winner),
            isNotNull(canonicalEntity.projectStatus),
          ),
        )
        .limit(1)

      if (!winnerProject) {
        await getDb()
          .update(canonicalEntity)
          .set({
            projectStatus: loserProject.status,
            projectSource: loserProject.source as ProjectSource,
            nextActionThoughtId: loserProject.nextActionThoughtId,
            entityType: 'project',
          })
          .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, winner)))
      } else if (!winnerProject.nextActionThoughtId && loserProject.nextActionThoughtId) {
        await getDb()
          .update(canonicalEntity)
          .set({ nextActionThoughtId: loserProject.nextActionThoughtId })
          .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, winner)))
      }

      await getDb()
        .update(canonicalEntity)
        .set({
          projectStatus: null,
          projectSource: null,
          nextActionThoughtId: null,
          projectDesignatedAt: null,
          entityType: 'other',
        })
        .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, loser.id)))
    }

    await getDb()
      .insert(entityAlias)
      .values({
        userId,
        canonicalEntityId: winner,
        aliasText: loser.canonicalKey,
      })
      .onConflictDoNothing()

    if (loser.label.trim() && computeLexicalText(loser.label) !== loser.canonicalKey) {
      await getDb()
        .insert(entityAlias)
        .values({
          userId,
          canonicalEntityId: winner,
          aliasText: computeLexicalText(loser.label),
        })
        .onConflictDoNothing()
    }

    await getDb()
      .update(canonicalEntity)
      .set({ entityType: 'other' })
      .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, loser.id)))
  }

  await promoteHubEntityType(userId, winner, nextLabel)
  await upsertEntityNode({
    id: winner,
    userId,
    canonicalKey: winnerRow.canonicalKey,
    label: nextLabel,
    entityType: 'project',
  })
}
