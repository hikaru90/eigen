import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { textFile, thought, thoughtTextFile } from '$lib/server/db/schema'
import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import type { MemoryAuthorship } from '$lib/server/memory/authorship'
import {
  authorshipInsertValues,
  USER_AUTHORSHIP,
  resolveAuthorSqlCondition,
} from '$lib/server/memory/authorship'
import { relevanceFloorFor } from '$lib/server/retrieval/relevance-floor'
import { redactedText } from '$lib/server/security/detect-secrets'
import {
  assertNoSecretPlaceholders,
  noteIndexSurfaces,
  restoreNoteSecrets,
} from '$lib/server/security/note-secrets'
import {
  applyPassageSync,
  createDbNoteSearchSources,
  loadStoredPassages,
  preparePassageSync,
} from './note-passages'
import { runNoteSearch, TEXT_FILE_PREVIEW_LEN, type TextFileSearchHit } from './note-search'

export const MAX_TEXT_FILE_BODY_BYTES = 512 * 1024
export { TEXT_FILE_PREVIEW_LEN }
export type { TextFileSearchHit }

export type TextFileRecord = {
  id: string
  title: string
  body: string
  author: 'user' | 'agent'
  authorLabel: string | null
  authorKeyId: string | null
  createdAt: string
  updatedAt: string
}

export type TextFileAttachmentPreview = {
  id: string
  title: string
  preview: string
  updatedAt: string
}

export type TextFileLinkedThought = {
  id: string
  normalizedText: string
}

function assertBodyWithinLimit(body: string): string {
  const trimmed = body.trim()
  const bytes = new TextEncoder().encode(trimmed).byteLength
  if (bytes > MAX_TEXT_FILE_BODY_BYTES) {
    throw new Error(`body exceeds maximum size of ${MAX_TEXT_FILE_BODY_BYTES} bytes`)
  }
  return trimmed
}

function normalizeTitle(title: string | undefined): string {
  return (title ?? '').trim()
}

function assertTitleOrBody(title: string, body: string): void {
  if (!title && !body) {
    throw new Error('title or body is required')
  }
}

export type TextFileWriteOptions = {
  /**
   * The write comes from the in-app chat agent. It is shown `[redacted secret #n]` for the
   * secrets in a note, so its text is restored against the note's current stored body before it
   * is saved, and a placeholder that cannot be restored fails the write
   * (docs/planning/secret-hygiene.md, Part 2). Absent: the text is what the user typed (Notes
   * editor) and is saved exactly as given.
   */
  agentWrite?: boolean
}

/**
 * What a note's search surfaces are built from (docs/planning/secret-hygiene.md). The body the
 * user saved is stored verbatim (encrypted) and shown back to them; the lexical text, the
 * passages and their embeddings come from the redacted text, so a pasted credential is never
 * indexed or sent to the embedding gateway. Passages carry numbered placeholders so an excerpt
 * shown to the agent can be written back.
 */
function indexSurfaces(title: string, body: string): { indexBody: string; lexicalText: string } {
  const { passageBody, lexicalText } = noteIndexSurfaces(title, body)
  return { indexBody: passageBody, lexicalText }
}

function toPreview(body: string): string {
  return body.slice(0, TEXT_FILE_PREVIEW_LEN)
}

async function decryptTextFileRow<
  T extends {
    title: string
    bodyText: string
    bodyTextEncrypted?: string | null
    author: 'user' | 'agent'
    authorLabel: string | null
    authorKeyId: string | null
    createdAt: Date
    updatedAt: Date
    id: string
  },
>(userId: string, row: T): Promise<TextFileRecord> {
  const body = row.bodyTextEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'text_file',
        column: 'body_text',
        ciphertext: row.bodyTextEncrypted,
      })
    : row.bodyText
  return {
    id: row.id,
    title: row.title,
    body,
    author: row.author,
    authorLabel: row.authorLabel,
    authorKeyId: row.authorKeyId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const TEXT_FILE_RETURNING = {
  id: textFile.id,
  title: textFile.title,
  bodyText: textFile.bodyText,
  bodyTextEncrypted: textFile.bodyTextEncrypted,
  author: textFile.author,
  authorLabel: textFile.authorLabel,
  authorKeyId: textFile.authorKeyId,
  createdAt: textFile.createdAt,
  updatedAt: textFile.updatedAt,
}

export async function createTextFile(
  userId: string,
  input: {
    title?: string
    body?: string
    authorship?: MemoryAuthorship
    /** Source time for notes derived from an older thought; defaults to the database clock. */
    createdAt?: Date
  },
): Promise<TextFileRecord> {
  const title = normalizeTitle(input.title)
  const body = assertBodyWithinLimit(typeof input.body === 'string' ? input.body : '')
  assertTitleOrBody(title, body)
  const { indexBody, lexicalText } = indexSurfaces(title, body)
  const authorValues = authorshipInsertValues(input.authorship ?? USER_AUTHORSHIP)
  const bodyTextEncrypted = await encryptTenantValue({
    userId,
    table: 'text_file',
    column: 'body_text',
    plaintext: body,
  })
  // Embed before writing: a gateway failure fails the create instead of leaving an unsearchable note.
  const passages = await preparePassageSync(userId, { body: indexBody, stored: [] })

  const row = await getDb().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(textFile)
      .values({
        userId,
        title,
        bodyText: '',
        bodyTextEncrypted,
        lexicalText,
        ...authorValues,
        ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
      })
      .returning(TEXT_FILE_RETURNING)
    await applyPassageSync(tx, userId, inserted.id, passages)
    return inserted
  })

  return decryptTextFileRow(userId, row)
}

export async function updateTextFile(
  userId: string,
  fileId: string,
  input: { title?: string; body?: string },
  options: TextFileWriteOptions = {},
): Promise<TextFileRecord | null> {
  const [existing] = await getDb()
    .select({
      id: textFile.id,
      title: textFile.title,
      bodyText: textFile.bodyText,
      bodyTextEncrypted: textFile.bodyTextEncrypted,
      author: textFile.author,
      authorLabel: textFile.authorLabel,
      authorKeyId: textFile.authorKeyId,
      createdAt: textFile.createdAt,
      updatedAt: textFile.updatedAt,
    })
    .from(textFile)
    .where(and(eq(textFile.id, fileId), eq(textFile.userId, userId)))
    .limit(1)

  if (!existing) return null

  const current = await decryptTextFileRow(userId, existing)
  if (options.agentWrite && input.title !== undefined) assertNoSecretPlaceholders(input.title)
  const writtenBody =
    input.body !== undefined && options.agentWrite
      ? restoreNoteSecrets(input.body, current.body)
      : input.body
  const nextTitle = input.title !== undefined ? normalizeTitle(input.title) : current.title
  const nextBody = writtenBody !== undefined ? assertBodyWithinLimit(writtenBody) : current.body
  assertTitleOrBody(nextTitle, nextBody)
  const { indexBody, lexicalText } = indexSurfaces(nextTitle, nextBody)
  const bodyTextEncrypted = await encryptTenantValue({
    userId,
    table: 'text_file',
    column: 'body_text',
    plaintext: nextBody,
  })
  const passages = await preparePassageSync(userId, {
    body: indexBody,
    stored: await loadStoredPassages(userId, fileId),
  })

  const row = await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(textFile)
      .set({
        title: nextTitle,
        bodyText: '',
        bodyTextEncrypted,
        lexicalText,
        updatedAt: new Date(),
      })
      .where(and(eq(textFile.id, fileId), eq(textFile.userId, userId)))
      .returning(TEXT_FILE_RETURNING)
    await applyPassageSync(tx, userId, fileId, passages)
    return updated
  })

  return decryptTextFileRow(userId, row)
}

/**
 * Append text to an existing note body (deterministic concat).
 * Default separator is a single newline when the current body is non-empty and does not already end with a newline.
 */
export async function appendTextFile(
  userId: string,
  fileId: string,
  input: { text: string; separator?: string },
  options: TextFileWriteOptions = {},
): Promise<TextFileRecord | null> {
  const appendText = typeof input.text === 'string' ? input.text.trim() : ''
  if (!appendText) {
    throw new Error('text is required')
  }

  const [existing] = await getDb()
    .select({
      id: textFile.id,
      title: textFile.title,
      bodyText: textFile.bodyText,
      bodyTextEncrypted: textFile.bodyTextEncrypted,
      author: textFile.author,
      authorLabel: textFile.authorLabel,
      authorKeyId: textFile.authorKeyId,
      createdAt: textFile.createdAt,
      updatedAt: textFile.updatedAt,
    })
    .from(textFile)
    .where(and(eq(textFile.id, fileId), eq(textFile.userId, userId)))
    .limit(1)

  if (!existing) return null

  const current = await decryptTextFileRow(userId, existing)
  const restore = (text: string) =>
    options.agentWrite ? restoreNoteSecrets(text, current.body) : text
  const separator =
    input.separator !== undefined
      ? restore(input.separator)
      : current.body.length === 0 || current.body.endsWith('\n')
        ? ''
        : '\n'
  const nextBody = assertBodyWithinLimit(`${current.body}${separator}${restore(appendText)}`)
  assertTitleOrBody(current.title, nextBody)
  const { indexBody, lexicalText } = indexSurfaces(current.title, nextBody)
  const bodyTextEncrypted = await encryptTenantValue({
    userId,
    table: 'text_file',
    column: 'body_text',
    plaintext: nextBody,
  })
  // Tail-only: the passages before the appended text are unchanged and are neither deleted
  // nor re-embedded; only the changed tail is embedded.
  const passages = await preparePassageSync(userId, {
    body: indexBody,
    stored: await loadStoredPassages(userId, fileId),
  })

  const row = await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(textFile)
      .set({
        bodyText: '',
        bodyTextEncrypted,
        lexicalText,
        updatedAt: new Date(),
      })
      .where(and(eq(textFile.id, fileId), eq(textFile.userId, userId)))
      .returning(TEXT_FILE_RETURNING)
    await applyPassageSync(tx, userId, fileId, passages)
    return updated
  })

  return decryptTextFileRow(userId, row)
}

export async function deleteTextFile(userId: string, fileId: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(textFile)
    .where(and(eq(textFile.id, fileId), eq(textFile.userId, userId)))
    .returning({ id: textFile.id })
  return deleted.length > 0
}

export async function getTextFile(userId: string, fileId: string): Promise<TextFileRecord | null> {
  const [row] = await getDb()
    .select({
      id: textFile.id,
      title: textFile.title,
      bodyText: textFile.bodyText,
      bodyTextEncrypted: textFile.bodyTextEncrypted,
      author: textFile.author,
      authorLabel: textFile.authorLabel,
      authorKeyId: textFile.authorKeyId,
      createdAt: textFile.createdAt,
      updatedAt: textFile.updatedAt,
    })
    .from(textFile)
    .where(and(eq(textFile.id, fileId), eq(textFile.userId, userId)))
    .limit(1)

  if (!row) return null
  return decryptTextFileRow(userId, row)
}

export async function listTextFiles(
  userId: string,
  options?: {
    limit?: number
    cursor?: { updatedAt: Date; id: string }
    authorLayerKey?: string | null
  },
): Promise<TextFileRecord[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))
  const cursor = options?.cursor
  const authorSql = options?.authorLayerKey
    ? resolveAuthorSqlCondition(
        {
          author: textFile.author,
          authorKeyId: textFile.authorKeyId,
          authorLabel: textFile.authorLabel,
        },
        { authorLayerKey: options.authorLayerKey },
      )
    : undefined

  const rows = await getDb()
    .select({
      id: textFile.id,
      title: textFile.title,
      bodyText: textFile.bodyText,
      bodyTextEncrypted: textFile.bodyTextEncrypted,
      author: textFile.author,
      authorLabel: textFile.authorLabel,
      authorKeyId: textFile.authorKeyId,
      createdAt: textFile.createdAt,
      updatedAt: textFile.updatedAt,
    })
    .from(textFile)
    .where(
      and(
        eq(textFile.userId, userId),
        authorSql,
        cursor
          ? or(
              lt(textFile.updatedAt, cursor.updatedAt),
              and(eq(textFile.updatedAt, cursor.updatedAt), lt(textFile.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(textFile.updatedAt), desc(textFile.id))
    .limit(limit)

  return Promise.all(rows.map((row) => decryptTextFileRow(userId, row)))
}

/**
 * Hybrid note search: pgvector + FTS over `note_passage`, plus a whole-note keyword match (so a
 * title still finds its note). One hit per note, carrying the matched passage(s) with their +-1
 * neighbours; the hit id is the note's id. `queryEmbedding` lets a caller that already embedded
 * the query (composeAnswer) skip a second embedding.
 */
export async function searchTextFiles(
  userId: string,
  input: {
    query: string
    topK?: number
    authorFilter?: 'user' | 'agent'
    authorLayerKey?: string | null
    queryEmbedding?: number[]
    /** Relevance floor on the 0..1 hit score. Default: the Q&A context floor for thoughts (eval harness: its override). */
    minScore?: number
    /** Eval observability: the best passage score the floor dropped (null: none). */
    onBelowFloor?: (best: number | null) => void
  },
): Promise<TextFileSearchHit[]> {
  const limit = Math.max(1, Math.min(input.topK ?? 10, 50))
  // a credential pasted into a question is neither embedded nor keyword-matched
  const query = redactedText(input.query)
  const queryEmbedding = input.queryEmbedding ?? (await createThoughtEmbedding(userId, query))
  return runNoteSearch(
    createDbNoteSearchSources(userId, {
      query,
      queryEmbedding,
      authorFilter: input.authorFilter,
      authorLayerKey: input.authorLayerKey,
    }),
    {
      minScore: input.minScore ?? relevanceFloorFor(userId),
      noteLimit: limit,
      onBelowFloor: input.onBelowFloor,
    },
  )
}

async function assertOwnedThought(userId: string, thoughtId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: thought.id })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  return Boolean(row)
}

export async function linkTextFileToThought(
  userId: string,
  thoughtId: string,
  textFileId: string,
): Promise<{ linked: boolean; reason?: 'thought_not_found' | 'text_file_not_found' }> {
  const [thoughtOk, fileOk] = await Promise.all([
    assertOwnedThought(userId, thoughtId),
    getTextFile(userId, textFileId).then((file) => file !== null),
  ])

  if (!thoughtOk) return { linked: false, reason: 'thought_not_found' }
  if (!fileOk) return { linked: false, reason: 'text_file_not_found' }

  await getDb()
    .insert(thoughtTextFile)
    .values({ userId, thoughtId, textFileId })
    .onConflictDoNothing()

  return { linked: true }
}

export async function unlinkTextFileFromThought(
  userId: string,
  thoughtId: string,
  textFileId: string,
): Promise<boolean> {
  const deleted = await getDb()
    .delete(thoughtTextFile)
    .where(
      and(
        eq(thoughtTextFile.userId, userId),
        eq(thoughtTextFile.thoughtId, thoughtId),
        eq(thoughtTextFile.textFileId, textFileId),
      ),
    )
    .returning({ thoughtId: thoughtTextFile.thoughtId })

  return deleted.length > 0
}

export async function listTextFilesForThought(
  userId: string,
  thoughtId: string,
): Promise<TextFileAttachmentPreview[]> {
  const rows = await getDb()
    .select({
      id: textFile.id,
      title: textFile.title,
      bodyText: textFile.bodyText,
      bodyTextEncrypted: textFile.bodyTextEncrypted,
      updatedAt: textFile.updatedAt,
    })
    .from(thoughtTextFile)
    .innerJoin(textFile, eq(thoughtTextFile.textFileId, textFile.id))
    .where(and(eq(thoughtTextFile.userId, userId), eq(thoughtTextFile.thoughtId, thoughtId)))
    .orderBy(desc(textFile.updatedAt), desc(textFile.id))

  return Promise.all(
    rows.map(async (row) => {
      const body = row.bodyTextEncrypted
        ? await decryptTenantValue({
            userId,
            table: 'text_file',
            column: 'body_text',
            ciphertext: row.bodyTextEncrypted,
          })
        : row.bodyText
      return {
        id: row.id,
        title: row.title,
        preview: toPreview(body),
        updatedAt: row.updatedAt.toISOString(),
      }
    }),
  )
}

export async function listTextFilesForThoughtIds(
  userId: string,
  thoughtIds: string[],
): Promise<Map<string, TextFileAttachmentPreview[]>> {
  const uniqueIds = [...new Set(thoughtIds.filter((id) => id.trim().length > 0))]
  const result = new Map<string, TextFileAttachmentPreview[]>()
  if (uniqueIds.length === 0) return result

  const rows = await getDb()
    .select({
      thoughtId: thoughtTextFile.thoughtId,
      id: textFile.id,
      title: textFile.title,
      bodyText: textFile.bodyText,
      bodyTextEncrypted: textFile.bodyTextEncrypted,
      updatedAt: textFile.updatedAt,
    })
    .from(thoughtTextFile)
    .innerJoin(textFile, eq(thoughtTextFile.textFileId, textFile.id))
    .where(and(eq(thoughtTextFile.userId, userId), inArray(thoughtTextFile.thoughtId, uniqueIds)))
    .orderBy(desc(textFile.updatedAt), desc(textFile.id))

  const previews = await Promise.all(
    rows.map(async (row) => {
      const body = row.bodyTextEncrypted
        ? await decryptTenantValue({
            userId,
            table: 'text_file',
            column: 'body_text',
            ciphertext: row.bodyTextEncrypted,
          })
        : row.bodyText
      return {
        thoughtId: row.thoughtId,
        file: {
          id: row.id,
          title: row.title,
          preview: toPreview(body),
          updatedAt: row.updatedAt.toISOString(),
        } satisfies TextFileAttachmentPreview,
      }
    }),
  )

  for (const { thoughtId, file } of previews) {
    const list = result.get(thoughtId) ?? []
    list.push(file)
    result.set(thoughtId, list)
  }

  return result
}

export async function listThoughtsForTextFile(
  userId: string,
  textFileId: string,
): Promise<TextFileLinkedThought[]> {
  const [file] = await getDb()
    .select({ id: textFile.id })
    .from(textFile)
    .where(and(eq(textFile.id, textFileId), eq(textFile.userId, userId)))
    .limit(1)
  if (!file) return []

  const rows = await getDb()
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
    })
    .from(thoughtTextFile)
    .innerJoin(thought, eq(thoughtTextFile.thoughtId, thought.id))
    .where(and(eq(thoughtTextFile.userId, userId), eq(thoughtTextFile.textFileId, textFileId)))
    .orderBy(desc(thought.createdAt), desc(thought.id))

  return rows.map((row) => ({
    id: row.id,
    normalizedText: row.normalizedText,
  }))
}
