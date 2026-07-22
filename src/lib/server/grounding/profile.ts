import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { chatSession } from '$lib/server/db/brain.schema'
import { userGroundingProfile } from '$lib/server/db/schema'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import {
  GROUNDING_FACET_KEY_SET,
  GROUNDING_FACET_MAX_CHARS,
  type GroundingFacetKey,
} from '$lib/server/grounding/constants'
import type { CheckInQuestion } from '$lib/server/grounding/next-check-in'
import {
  RELEVANCE_QUESTION_TEMPLATE_ID_SET,
  type RelevanceQuestionTemplateId,
} from '$lib/server/grounding/relevance-templates'
import { synthesizeGroundingNarrative } from '$lib/server/grounding/synthesize-narrative'
import type {
  GroundingProfileForEnrichment,
  GroundingProfileSnapshot,
} from '$lib/server/grounding/types'

const GROUNDING_TABLE = 'user_grounding_profile'
const NARRATIVE_COLUMN = 'narrative_summary'

function normalizeFacets(raw: Record<string, string> | null | undefined): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    const k = key.trim()
    if (!GROUNDING_FACET_KEY_SET.has(k)) continue
    if (typeof value !== 'string') continue
    const v = value.trim().slice(0, GROUNDING_FACET_MAX_CHARS)
    if (v.length > 0) out[k] = v
  }
  return out
}

function normalizePendingCheckIn(raw: unknown): CheckInQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = typeof o.kind === 'string' ? o.kind.trim() : ''
  const question = typeof o.question === 'string' ? o.question.trim() : ''
  if (!question) return null

  if (kind === 'relevance') {
    const thoughtId = typeof o.thoughtId === 'string' ? o.thoughtId.trim() : ''
    const snippet = typeof o.snippet === 'string' ? o.snippet.trim() : ''
    const templateId = typeof o.templateId === 'string' ? o.templateId.trim() : ''
    if (!thoughtId || !snippet) return null
    if (!RELEVANCE_QUESTION_TEMPLATE_ID_SET.has(templateId)) return null
    return {
      kind: 'relevance',
      templateId: templateId as RelevanceQuestionTemplateId,
      thoughtId,
      snippet,
      question,
    }
  }

  if (kind === 'grounding' || kind === '') {
    const facetKey = typeof o.facetKey === 'string' ? o.facetKey.trim() : ''
    if (!GROUNDING_FACET_KEY_SET.has(facetKey)) return null
    return {
      kind: 'grounding',
      facetKey: facetKey as GroundingFacetKey,
      question,
    }
  }

  return null
}

export function validateGroundingFacetInput(
  facets: Array<{ key: string; content: string }>,
): Array<{ key: GroundingFacetKey; content: string }> {
  const out: Array<{ key: GroundingFacetKey; content: string }> = []
  for (const facet of facets) {
    const key = facet.key.trim()
    if (!GROUNDING_FACET_KEY_SET.has(key)) {
      throw new Error(
        `Invalid grounding facet key "${key}". Allowed: ${[...GROUNDING_FACET_KEY_SET].join(', ')}`,
      )
    }
    const content = facet.content.trim().slice(0, GROUNDING_FACET_MAX_CHARS)
    if (content.length === 0) {
      throw new Error(`Grounding facet "${key}" content cannot be empty`)
    }
    out.push({ key: key as GroundingFacetKey, content })
  }
  return out
}

async function decryptNarrative(userId: string, encrypted: string | null): Promise<string> {
  if (!encrypted) return ''
  return decryptTenantValue({
    userId,
    table: GROUNDING_TABLE,
    column: NARRATIVE_COLUMN,
    ciphertext: encrypted,
  })
}

async function rowToSnapshot(
  userId: string,
  row: typeof userGroundingProfile.$inferSelect,
): Promise<GroundingProfileSnapshot> {
  const narrativeSummary = await decryptNarrative(userId, row.narrativeSummaryEncrypted)
  return {
    narrativeSummary,
    facets: normalizeFacets(row.facets),
    initialCompletedAt: row.initialCompletedAt,
    lastSessionAt: row.lastSessionAt,
    sessionCount: row.sessionCount,
    lastGroundingPushAt: row.lastGroundingPushAt ?? null,
    pendingCheckIn: normalizePendingCheckIn(row.pendingCheckIn),
  }
}

export async function loadGroundingProfileRow(
  userId: string,
): Promise<GroundingProfileSnapshot | null> {
  const [row] = await getDb()
    .select()
    .from(userGroundingProfile)
    .where(eq(userGroundingProfile.userId, userId))
    .limit(1)
  if (!row) return null
  return rowToSnapshot(userId, row)
}

export async function loadGroundingProfileForEnrichment(
  userId: string,
): Promise<GroundingProfileForEnrichment> {
  const snapshot = await loadGroundingProfileRow(userId)
  if (!snapshot) return null
  const hasContent =
    snapshot.narrativeSummary.trim().length > 0 || Object.keys(snapshot.facets).length > 0
  if (!hasContent) return null
  return {
    narrativeSummary: snapshot.narrativeSummary,
    facets: snapshot.facets,
  }
}

export async function mergeGroundingFacets(input: {
  userId: string
  facets: Array<{ key: GroundingFacetKey; content: string }>
  sessionNote?: string
  /** When false (default for incremental saves), only merge facets — no LLM synthesis. */
  synthesizeNarrative?: boolean
  /** When true, bump lastSessionAt and sessionCount (e.g. after answering an optional question). */
  recordSession?: boolean
}): Promise<GroundingProfileSnapshot> {
  const validated = validateGroundingFacetInput(input.facets)
  const [existingRow] = await getDb()
    .select()
    .from(userGroundingProfile)
    .where(eq(userGroundingProfile.userId, input.userId))
    .limit(1)
  const existing = existingRow ? await rowToSnapshot(input.userId, existingRow) : null
  const mergedFacets = { ...(existing?.facets ?? {}) }
  for (const { key, content } of validated) {
    mergedFacets[key] = content
  }

  let narrativeSummaryEncrypted = existingRow?.narrativeSummaryEncrypted ?? null

  if (input.synthesizeNarrative === true) {
    const priorNarrative = existing?.narrativeSummary ?? ''
    const narrativeSummary = await synthesizeGroundingNarrative({
      userId: input.userId,
      facets: mergedFacets,
      sessionNote: input.sessionNote,
      priorNarrative: priorNarrative || undefined,
    })
    narrativeSummaryEncrypted = await encryptTenantValue({
      userId: input.userId,
      table: GROUNDING_TABLE,
      column: NARRATIVE_COLUMN,
      plaintext: narrativeSummary,
    })
  }

  const now = input.recordSession === true ? new Date() : null
  const sessionCount =
    input.recordSession === true ? (existing?.sessionCount ?? 0) + 1 : (existing?.sessionCount ?? 0)

  const [row] = await getDb()
    .insert(userGroundingProfile)
    .values({
      userId: input.userId,
      narrativeSummaryEncrypted,
      facets: mergedFacets,
      sessionCount,
      ...(now ? { lastSessionAt: now } : {}),
    })
    .onConflictDoUpdate({
      target: userGroundingProfile.userId,
      set: {
        ...(input.synthesizeNarrative === true && narrativeSummaryEncrypted
          ? { narrativeSummaryEncrypted }
          : {}),
        facets: mergedFacets,
        ...(input.recordSession === true
          ? { lastSessionAt: now, sessionCount, updatedAt: now }
          : { updatedAt: new Date() }),
      },
    })
    .returning()

  return rowToSnapshot(input.userId, row)
}

export async function saveGroundingQuestionAnswer(input: {
  userId: string
  facetKey: GroundingFacetKey
  answer: string
}): Promise<GroundingProfileSnapshot> {
  return mergeGroundingFacets({
    userId: input.userId,
    facets: [{ key: input.facetKey, content: input.answer }],
    // Facets are used directly in enrichment; skip LLM narrative so save is fast and reliable.
    synthesizeNarrative: false,
    recordSession: true,
  })
}

export async function deleteGroundingProfile(userId: string): Promise<void> {
  const db = getDb()
  await db
    .delete(chatSession)
    .where(and(eq(chatSession.userId, userId), eq(chatSession.mode, 'grounding')))
  await db.delete(userGroundingProfile).where(eq(userGroundingProfile.userId, userId))
}
