import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { textFile, thought, thoughtTextFile } from '$lib/server/db/schema'
import type { MemoryAuthorship } from '$lib/server/memory/authorship'
import {
  authorshipInsertValues,
  USER_AUTHORSHIP,
  resolveAuthorSqlCondition,
} from '$lib/server/memory/authorship'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { buildLexicalTsQuery } from '$lib/server/retrieval/lexical'

export const MAX_TEXT_FILE_BODY_BYTES = 512 * 1024
export const TEXT_FILE_PREVIEW_LEN = 200

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

export type TextFileSearchHit = {
  id: string
  title: string
  preview: string
  lexicalScore: number
  updatedAt: string
  author: 'user' | 'agent'
  authorLabel: string | null
  authorKeyId: string | null
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

export async function createTextFile(
  userId: string,
  input: { title?: string; body?: string; authorship?: MemoryAuthorship },
): Promise<TextFileRecord> {
  const title = normalizeTitle(input.title)
  const body = assertBodyWithinLimit(typeof input.body === 'string' ? input.body : '')
  assertTitleOrBody(title, body)
  const lexicalText = computeLexicalText(`${title} ${body}`)
  const authorValues = authorshipInsertValues(input.authorship ?? USER_AUTHORSHIP)
  const bodyTextEncrypted = await encryptTenantValue({
    userId,
    table: 'text_file',
    column: 'body_text',
    plaintext: body,
  })

  const [row] = await getDb()
    .insert(textFile)
    .values({
      userId,
      title,
      bodyText: '',
      bodyTextEncrypted,
      lexicalText,
      ...authorValues,
    })
    .returning({
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

  return decryptTextFileRow(userId, row)
}

export async function updateTextFile(
  userId: string,
  fileId: string,
  input: { title?: string; body?: string },
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
  const nextTitle = input.title !== undefined ? normalizeTitle(input.title) : current.title
  const nextBody = input.body !== undefined ? assertBodyWithinLimit(input.body) : current.body
  assertTitleOrBody(nextTitle, nextBody)
  const lexicalText = computeLexicalText(`${nextTitle} ${nextBody}`)
  const bodyTextEncrypted = await encryptTenantValue({
    userId,
    table: 'text_file',
    column: 'body_text',
    plaintext: nextBody,
  })

  const [row] = await getDb()
    .update(textFile)
    .set({
      title: nextTitle,
      bodyText: '',
      bodyTextEncrypted,
      lexicalText,
      updatedAt: new Date(),
    })
    .where(and(eq(textFile.id, fileId), eq(textFile.userId, userId)))
    .returning({
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
  const separator =
    input.separator !== undefined
      ? input.separator
      : current.body.length === 0 || current.body.endsWith('\n')
        ? ''
        : '\n'
  const nextBody = assertBodyWithinLimit(`${current.body}${separator}${appendText}`)
  assertTitleOrBody(current.title, nextBody)
  const lexicalText = computeLexicalText(`${current.title} ${nextBody}`)
  const bodyTextEncrypted = await encryptTenantValue({
    userId,
    table: 'text_file',
    column: 'body_text',
    plaintext: nextBody,
  })

  const [row] = await getDb()
    .update(textFile)
    .set({
      bodyText: '',
      bodyTextEncrypted,
      lexicalText,
      updatedAt: new Date(),
    })
    .where(and(eq(textFile.id, fileId), eq(textFile.userId, userId)))
    .returning({
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

export async function searchTextFiles(
  userId: string,
  input: {
    query: string
    topK?: number
    authorFilter?: 'user' | 'agent'
    authorLayerKey?: string | null
  },
): Promise<TextFileSearchHit[]> {
  const limit = Math.max(1, Math.min(input.topK ?? 10, 50))
  const tsQueryString = buildLexicalTsQuery(input.query)
  if (tsQueryString.length === 0) return []

  const lexicalVector = sql`to_tsvector('simple', coalesce(${textFile.lexicalText}, ''))`
  const tsQueryExpr = sql`to_tsquery('simple', ${tsQueryString})`
  const rankExpr = sql<number>`ts_rank_cd(${lexicalVector}, ${tsQueryExpr})`
  const matchExpr = sql<boolean>`${lexicalVector} @@ ${tsQueryExpr}`
  const authorSql = resolveAuthorSqlCondition(
    {
      author: textFile.author,
      authorKeyId: textFile.authorKeyId,
      authorLabel: textFile.authorLabel,
    },
    { author: input.authorFilter, authorLayerKey: input.authorLayerKey },
  )

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
      lexicalScore: rankExpr,
    })
    .from(textFile)
    .where(and(eq(textFile.userId, userId), matchExpr, authorSql))
    .orderBy(desc(rankExpr))
    .limit(limit)

  return Promise.all(
    rows.map(async (row) => {
      const file = await decryptTextFileRow(userId, row)
      return {
        id: file.id,
        title: file.title,
        preview: toPreview(file.body),
        lexicalScore: row.lexicalScore ?? 0,
        updatedAt: file.updatedAt,
        author: file.author,
        authorLabel: file.authorLabel,
        authorKeyId: file.authorKeyId,
      }
    }),
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
