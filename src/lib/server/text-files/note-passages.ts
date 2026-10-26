import type { NoteSearchSources } from './note-search'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb, type AppDatabase } from '$lib/server/db'
import { notePassage, textFile } from '$lib/server/db/schema'
import { createThoughtEmbeddings } from '$lib/server/llm/embedding'
import { resolveAuthorSqlCondition } from '$lib/server/memory/authorship'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { buildLexicalTsQuery } from '$lib/server/retrieval/lexical'
import {
  chunkNoteIntoPassages,
  planPassageSync,
  type NotePassageChunk,
  type StoredPassageRef,
} from './chunk-note-passages'

/** Passages per embedding gateway call. */
export const NOTE_PASSAGE_EMBED_BATCH = 32
/** Candidates pulled per signal (vector ANN, passage FTS) before the per-note merge. */
export const NOTE_PASSAGE_ANN_LIMIT = 40
export const NOTE_PASSAGE_LEXICAL_LIMIT = 40
/** Whole-note keyword candidates (title and body), the signal title searches rely on. */
const NOTE_LEXICAL_LIMIT = 20

export type StoredPassage = StoredPassageRef

export type PassageEmbedFn = (userId: string, texts: string[]) => Promise<number[][]>

export type PreparedPassageRow = NotePassageChunk & {
  textEncrypted: string
  lexicalText: string
  /** In memory only: written to Postgres by `applyPassageSync`, never returned or logged. */
  embedding: number[]
}

export type PreparedPassageSync = {
  deleteIds: string[]
  rows: PreparedPassageRow[]
}

/** Drizzle handle: the app db or a transaction on it. */
export type PassageDbHandle = Pick<AppDatabase, 'insert' | 'delete'>

async function embedInBatches(
  userId: string,
  texts: string[],
  embed: PassageEmbedFn,
): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += NOTE_PASSAGE_EMBED_BATCH) {
    const batch = texts.slice(i, i + NOTE_PASSAGE_EMBED_BATCH)
    const vectors = await embed(userId, batch)
    if (vectors.length !== batch.length) {
      throw new Error(
        `note passage embedding count mismatch: expected ${batch.length}, got ${vectors.length}`,
      )
    }
    out.push(...vectors)
  }
  return out
}

/**
 * Chunk the body, diff against the stored passages, and embed only what changed (create: all;
 * append: the changed tail; title-only edit: nothing). Does no database writes, so the caller can
 * embed first and then commit the note and its passages in one transaction: an embedding failure
 * fails the whole write instead of leaving a note without an index.
 */
export async function preparePassageSync(
  userId: string,
  input: { body: string; stored: StoredPassage[] },
  embed: PassageEmbedFn = createThoughtEmbeddings,
): Promise<PreparedPassageSync> {
  const plan = planPassageSync(input.stored, chunkNoteIntoPassages(input.body))
  if (plan.insert.length === 0) return { deleteIds: plan.deleteIds, rows: [] }

  const vectors = await embedInBatches(
    userId,
    plan.insert.map((c) => c.text),
    embed,
  )
  const rows = await Promise.all(
    plan.insert.map(async (chunk, i) => ({
      ...chunk,
      embedding: vectors[i]!,
      lexicalText: computeLexicalText(chunk.text),
      textEncrypted: await encryptTenantValue({
        userId,
        table: 'note_passage',
        column: 'text',
        plaintext: chunk.text,
      }),
    })),
  )
  return { deleteIds: plan.deleteIds, rows }
}

/** Write a prepared sync: delete stale passages first (unique ordinal), then insert new ones. */
export async function applyPassageSync(
  db: PassageDbHandle,
  userId: string,
  textFileId: string,
  prepared: PreparedPassageSync,
): Promise<void> {
  if (prepared.deleteIds.length > 0) {
    await db
      .delete(notePassage)
      .where(and(eq(notePassage.textFileId, textFileId), inArray(notePassage.id, prepared.deleteIds)))
  }
  if (prepared.rows.length > 0) {
    await db.insert(notePassage).values(
      prepared.rows.map((row) => ({
        userId,
        textFileId,
        ordinal: row.ordinal,
        startChar: row.startChar,
        endChar: row.endChar,
        textEncrypted: row.textEncrypted,
        lexicalText: row.lexicalText,
        embedding: row.embedding,
      })),
    )
  }
}

/** Stored passages of a note, decrypted. Selects no embedding column. */
export async function loadStoredPassages(
  userId: string,
  textFileId: string,
): Promise<StoredPassage[]> {
  const rows = await getDb()
    .select({
      id: notePassage.id,
      ordinal: notePassage.ordinal,
      startChar: notePassage.startChar,
      endChar: notePassage.endChar,
      textEncrypted: notePassage.textEncrypted,
    })
    .from(notePassage)
    .where(and(eq(notePassage.userId, userId), eq(notePassage.textFileId, textFileId)))
    .orderBy(notePassage.ordinal)
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      ordinal: row.ordinal,
      startChar: row.startChar,
      endChar: row.endChar,
      text: await decryptTenantValue({
        userId,
        table: 'note_passage',
        column: 'text',
        ciphertext: row.textEncrypted,
      }),
    })),
  )
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/**
 * Postgres-backed sources for `runNoteSearch`. Every select lists its columns explicitly and
 * never includes `embedding`; the query vector is used only inside the SQL distance expression.
 */
export function createDbNoteSearchSources(
  userId: string,
  input: {
    query: string
    queryEmbedding: number[]
    authorFilter?: 'user' | 'agent'
    authorLayerKey?: string | null
  },
): NoteSearchSources {
  const authorSql = resolveAuthorSqlCondition(
    {
      author: textFile.author,
      authorKeyId: textFile.authorKeyId,
      authorLabel: textFile.authorLabel,
    },
    { author: input.authorFilter, authorLayerKey: input.authorLayerKey },
  )
  const tsQueryString = buildLexicalTsQuery(input.query)

  return {
    passageCandidates: async () => {
      const db = getDb()
      const distance = sql<number>`${notePassage.embedding} <=> ${toVectorLiteral(input.queryEmbedding)}::vector`
      const vectorRows = await db
        .select({
          passageId: notePassage.id,
          textFileId: notePassage.textFileId,
          ordinal: notePassage.ordinal,
          distance,
        })
        .from(notePassage)
        .innerJoin(textFile, eq(notePassage.textFileId, textFile.id))
        .where(and(eq(notePassage.userId, userId), isNull(textFile.archivedAt), authorSql))
        .orderBy(distance)
        .limit(NOTE_PASSAGE_ANN_LIMIT)

      const lexicalRows =
        tsQueryString.length === 0
          ? []
          : await (async () => {
              const tsQuery = sql`to_tsquery('simple', ${tsQueryString})`
              const rank = sql<number>`ts_rank_cd(${notePassage.lexicalTsv}, ${tsQuery})`
              return db
                .select({
                  passageId: notePassage.id,
                  textFileId: notePassage.textFileId,
                  ordinal: notePassage.ordinal,
                  rank,
                })
                .from(notePassage)
                .innerJoin(textFile, eq(notePassage.textFileId, textFile.id))
                .where(
                  and(
                    eq(notePassage.userId, userId),
                    sql`${notePassage.lexicalTsv} @@ ${tsQuery}`,
                    isNull(textFile.archivedAt),
                    authorSql,
                  ),
                )
                .orderBy(desc(rank))
                .limit(NOTE_PASSAGE_LEXICAL_LIMIT)
            })()

      return [
        ...vectorRows.map((r) => ({
          passageId: r.passageId,
          textFileId: r.textFileId,
          ordinal: r.ordinal,
          vectorDistance: r.distance,
        })),
        ...lexicalRows.map((r) => ({
          passageId: r.passageId,
          textFileId: r.textFileId,
          ordinal: r.ordinal,
          lexicalRank: r.rank ?? 0,
        })),
      ]
    },

    noteLexical: async () => {
      if (tsQueryString.length === 0) return []
      const tsQuery = sql`to_tsquery('simple', ${tsQueryString})`
      const rank = sql<number>`ts_rank_cd(${textFile.lexicalTsv}, ${tsQuery})`
      const rows = await getDb()
        .select({ textFileId: textFile.id, rank })
        .from(textFile)
        .where(
          and(
            eq(textFile.userId, userId),
            sql`${textFile.lexicalTsv} @@ ${tsQuery}`,
            isNull(textFile.archivedAt),
            authorSql,
          ),
        )
        .orderBy(desc(rank))
        .limit(NOTE_LEXICAL_LIMIT)
      return rows.map((r) => ({ textFileId: r.textFileId, lexicalRank: r.rank ?? 0 }))
    },

    loadNotes: async (ids) => {
      if (ids.length === 0) return []
      return getDb()
        .select({
          id: textFile.id,
          title: textFile.title,
          createdAt: textFile.createdAt,
          updatedAt: textFile.updatedAt,
          author: textFile.author,
          authorLabel: textFile.authorLabel,
          authorKeyId: textFile.authorKeyId,
        })
        .from(textFile)
        .where(
          and(
            eq(textFile.userId, userId),
            inArray(textFile.id, ids),
            isNull(textFile.archivedAt),
            authorSql,
          ),
        )
    },

    loadPassages: async (pairs) => {
      if (pairs.length === 0) return []
      const wanted = new Set(pairs.map((p) => `${p.textFileId}:${p.ordinal}`))
      const rows = await getDb()
        .select({
          textFileId: notePassage.textFileId,
          ordinal: notePassage.ordinal,
          startChar: notePassage.startChar,
          endChar: notePassage.endChar,
          textEncrypted: notePassage.textEncrypted,
        })
        .from(notePassage)
        .where(
          and(
            eq(notePassage.userId, userId),
            inArray(notePassage.textFileId, [...new Set(pairs.map((p) => p.textFileId))]),
            inArray(notePassage.ordinal, [...new Set(pairs.map((p) => p.ordinal))]),
          ),
        )
      return Promise.all(
        rows
          .filter((r) => wanted.has(`${r.textFileId}:${r.ordinal}`))
          .map(async (r) => ({
            textFileId: r.textFileId,
            ordinal: r.ordinal,
            startChar: r.startChar,
            endChar: r.endChar,
            text: await decryptTenantValue({
              userId,
              table: 'note_passage',
              column: 'text',
              ciphertext: r.textEncrypted,
            }),
          })),
      )
    },
  }
}
