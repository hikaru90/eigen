import { asc, eq, inArray } from 'drizzle-orm'
import { evalQa } from '$lib/server/db/brain.schema'
import { getDb } from '$lib/server/db'
import type {
  QaCapture,
  QaChecks,
  QaEditStep,
  QaRetrievalRelevant,
} from '../../../evals/harness/qa-types'
import { normalizeChecks } from '../../../evals/harness/qa-checks'
import { normalizeCaptures } from '../../../evals/harness/qa-run'
import { loadCorpus } from '../../../evals/harness/dataset'
import { assignCaptureFixtureIds, generateEvalQaId, validateEvalQaId } from './qa-id'

export type EvalQaRecord = {
  id: string
  question: string
  acceptance: string
  captures: QaCapture[]
  retrievalQuery: string | null
  retrievalRelevant: QaRetrievalRelevant[]
  tags: string[]
  edit: QaEditStep | null
  checks: QaChecks
  createdAt: string
  updatedAt: string
}

const TAG_PATTERN = /^[a-z][a-z0-9_]*$/

export {
  assignCaptureFixtureIds,
  generateEvalQaId,
  generateFixtureId,
  validateEvalQaId,
  validateFixtureId,
} from './qa-id'

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0 && TAG_PATTERN.test(t))
}

function normalizeRetrievalRelevant(raw: unknown): QaRetrievalRelevant[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      id: String(item.id ?? '').trim(),
      grade: Number(item.grade) as 0 | 1 | 2 | 3,
    }))
    .filter((r) => r.id.length > 0 && r.grade >= 0 && r.grade <= 3)
}

function normalizeEdit(raw: unknown): QaEditStep | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const fixtureId = String(o.fixtureId ?? '').trim()
  const newRawText = String(o.newRawText ?? '').trim()
  if (!fixtureId || !newRawText) return null
  return { fixtureId, newRawText }
}

function rowToRecord(row: typeof evalQa.$inferSelect): EvalQaRecord {
  return {
    id: row.id,
    question: row.question,
    acceptance: row.acceptance,
    captures: normalizeCaptures(row.capturesJson),
    retrievalQuery: row.retrievalQuery?.trim() || null,
    retrievalRelevant: normalizeRetrievalRelevant(row.retrievalRelevantJson),
    tags: normalizeTags(row.tagsJson),
    edit: normalizeEdit(row.editJson),
    checks: normalizeChecks(row.checksJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function buildFixtureIdPool(excludeQaId?: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const thought of loadCorpus().thoughts) {
    ids.add(thought.id)
  }
  const rows = await listEvalQa()
  for (const row of rows) {
    if (row.id === excludeQaId) continue
    for (const cap of row.captures) {
      ids.add(cap.fixtureId)
    }
  }
  return ids
}

export async function validateEvalQaInput(input: {
  id?: string
  question: string
  acceptance: string
  captures?: QaCapture[]
  retrievalQuery?: string | null
  retrievalRelevant?: QaRetrievalRelevant[]
  tags?: string[]
  edit?: QaEditStep | null
  checks?: QaChecks
  /** When updating, exclude this QA's captures from the reserved-id pool first. */
  excludeQaId?: string
}): Promise<{
  id?: string
  question: string
  acceptance: string
  captures: QaCapture[]
  retrievalQuery: string | null
  retrievalRelevant: QaRetrievalRelevant[]
  tags: string[]
  edit: QaEditStep | null
  checks: QaChecks
}> {
  const question = input.question.trim()
  const acceptance = input.acceptance.trim()
  if (!question) throw new Error('Question is required')
  if (!acceptance) throw new Error('Acceptance criteria are required')

  const draftCaptures = normalizeCaptures(input.captures ?? [])
  if (draftCaptures.length === 0) {
    throw new Error('At least one capture (thought to ingest) is required')
  }
  for (const cap of draftCaptures) {
    if (!cap.rawText?.trim()) {
      throw new Error('Each capture needs thought text')
    }
  }

  const fixturePool = await buildFixtureIdPool(input.excludeQaId)
  const captures = assignCaptureFixtureIds(draftCaptures, fixturePool)
  if (captures.length === 0) {
    throw new Error('At least one capture (thought to ingest) is required')
  }
  const retrievalQuery =
    typeof input.retrievalQuery === 'string' && input.retrievalQuery.trim()
      ? input.retrievalQuery.trim()
      : null
  const retrievalRelevant = normalizeRetrievalRelevant(input.retrievalRelevant ?? [])
  if (retrievalQuery && retrievalRelevant.length === 0) {
    throw new Error('Retrieval query requires at least one relevant fixture grade')
  }
  const tags = normalizeTags(input.tags ?? [])
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag)) {
      throw new Error(`Invalid tag: ${tag}`)
    }
  }
  const edit = input.edit === undefined ? null : normalizeEdit(input.edit)
  if (edit && !captures.some((c) => c.fixtureId === edit.fixtureId)) {
    throw new Error(`Edit fixture ${edit.fixtureId} must have a matching capture`)
  }
  return {
    ...(input.id !== undefined ? { id: validateEvalQaId(input.id) } : {}),
    question,
    acceptance,
    captures,
    retrievalQuery,
    retrievalRelevant,
    tags,
    edit,
    checks: normalizeChecks(input.checks ?? {}),
  }
}

export async function listEvalQa(): Promise<EvalQaRecord[]> {
  const db = getDb()
  const rows = await db.select().from(evalQa).orderBy(asc(evalQa.id))
  return rows.map(rowToRecord)
}

export async function loadEvalQa(id: string): Promise<EvalQaRecord | null> {
  const db = getDb()
  const [row] = await db.select().from(evalQa).where(eq(evalQa.id, id))
  return row ? rowToRecord(row) : null
}

export async function loadEvalQaByIds(ids: string[]): Promise<Map<string, EvalQaRecord>> {
  if (ids.length === 0) return new Map()
  const db = getDb()
  const rows = await db.select().from(evalQa).where(inArray(evalQa.id, ids))
  return new Map(rows.map((row) => [row.id, rowToRecord(row)]))
}

export async function createEvalQa(input: {
  id?: string
  question: string
  acceptance: string
  captures: QaCapture[]
  retrievalQuery?: string | null
  retrievalRelevant?: QaRetrievalRelevant[]
  tags?: string[]
  edit?: QaEditStep | null
  checks?: QaChecks
}): Promise<EvalQaRecord> {
  const existing = await listEvalQa()
  const existingIds = new Set(existing.map((row) => row.id))
  const resolvedId =
    typeof input.id === 'string' && input.id.trim()
      ? validateEvalQaId(input.id)
      : generateEvalQaId(input.question, existingIds)

  const validated = (await validateEvalQaInput({ ...input, id: resolvedId })) as {
    id: string
    question: string
    acceptance: string
    captures: QaCapture[]
    retrievalQuery: string | null
    retrievalRelevant: QaRetrievalRelevant[]
    tags: string[]
    edit: QaEditStep | null
    checks: QaChecks
  }
  const db = getDb()
  const now = new Date()
  try {
    const [row] = await db
      .insert(evalQa)
      .values({
        id: validated.id,
        question: validated.question,
        acceptance: validated.acceptance,
        capturesJson: validated.captures,
        retrievalQuery: validated.retrievalQuery,
        retrievalRelevantJson: validated.retrievalRelevant,
        tagsJson: validated.tags,
        editJson: validated.edit,
        checksJson: validated.checks,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return rowToRecord(row)
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      throw new Error(`QA id already exists: ${validated.id}`)
    }
    throw err
  }
}

export async function updateEvalQa(
  id: string,
  input: {
    question: string
    acceptance: string
    captures: QaCapture[]
    retrievalQuery?: string | null
    retrievalRelevant?: QaRetrievalRelevant[]
    tags?: string[]
    edit?: QaEditStep | null
    checks?: QaChecks
  },
): Promise<EvalQaRecord> {
  const existing = await loadEvalQa(id)
  if (!existing) {
    throw new Error(`QA not found: ${id}`)
  }
  const checks = input.checks !== undefined ? input.checks : existing.checks
  const validated = await validateEvalQaInput({ ...input, id, checks, excludeQaId: id })
  const db = getDb()
  const [row] = await db
    .update(evalQa)
    .set({
      question: validated.question,
      acceptance: validated.acceptance,
      capturesJson: validated.captures,
      retrievalQuery: validated.retrievalQuery,
      retrievalRelevantJson: validated.retrievalRelevant,
      tagsJson: validated.tags,
      editJson: validated.edit,
      checksJson: validated.checks,
      updatedAt: new Date(),
    })
    .where(eq(evalQa.id, id))
    .returning()
  if (!row) {
    throw new Error(`QA not found: ${id}`)
  }
  return rowToRecord(row)
}

export async function updateEvalQaTags(id: string, tags: unknown): Promise<EvalQaRecord> {
  const db = getDb()
  const normalizedTags = normalizeTags(tags)
  const [row] = await db
    .update(evalQa)
    .set({
      tagsJson: normalizedTags,
      updatedAt: new Date(),
    })
    .where(eq(evalQa.id, id))
    .returning()
  if (!row) {
    throw new Error(`QA not found: ${id}`)
  }
  return rowToRecord(row)
}

export async function deleteEvalQa(id: string): Promise<void> {
  const db = getDb()
  const result = await db.delete(evalQa).where(eq(evalQa.id, id)).returning({ id: evalQa.id })
  if (result.length === 0) {
    throw new Error(`QA not found: ${id}`)
  }
}
