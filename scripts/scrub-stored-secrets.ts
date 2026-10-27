import './load-project-env'

/**
 * Scrub credentials that were stored before secret hygiene existed
 * (docs/planning/secret-hygiene.md, Design 5). The logic and its tests live in
 * `src/lib/server/security/scrub-stored-secrets.ts`; this file only wires it to the database.
 *
 * DRY-RUN BY DEFAULT: without `--apply` nothing is written and no embedding is requested; the
 * report lists affected thought/note ids with credential kinds and names — never a value.
 *
 * With `--apply`, per affected thought: `normalized_text`, lexical text, cues, the Ask question
 * and metadata strings are re-derived from the redacted text, the embedding is recomputed
 * (BILLED to the thought's owner like any embedding call), and graph entities whose own label
 * holds a secret value are removed (orphaned canonical entities are pruned). Per affected note:
 * lexical text and passages are rebuilt from the redacted body (changed passages are re-embedded
 * and billed the same way). `raw_text` and saved note bodies are the user's verbatim words and
 * are never rewritten, and `updated_at` is left alone.
 *
 * Usage:
 *   npm run scrub:stored-secrets                       # dry-run, every tenant
 *   npm run scrub:stored-secrets -- --user <userId>    # dry-run, one tenant
 *   npm run scrub:stored-secrets -- --apply            # write (every tenant, or with --user)
 *
 * Exit code is non-zero when any item failed. Re-running is safe: planned items are only those
 * whose derived surfaces still hold a secret.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { askQuestionColumns } from '$lib/server/capture/ask-question-store'
import { toPgVectorLiteral } from '$lib/server/capture/service'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb, withDbUser } from '$lib/server/db'
import {
  canonicalEntity,
  entityResolutionLog,
  textFile,
  thought,
  thoughtEntity,
} from '$lib/server/db/schema'
import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import { pruneCanonicalEntitiesWithNoThoughtLinks } from '$lib/server/memory/canonical-entity-admin'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { redactedText } from '$lib/server/security/detect-secrets'
import {
  runStoredSecretScrub,
  type NoteScrubPlan,
  type ScrubNote,
  type ScrubStore,
  type ScrubThought,
  type ThoughtScrubPlan,
} from '$lib/server/security/scrub-stored-secrets'
import {
  applyPassageSync,
  loadStoredPassages,
  preparePassageSync,
} from '$lib/server/text-files/note-passages'
import { getTextFile } from '$lib/server/text-files/service'
import { getDatabaseUrl } from './db-urls.mjs'

type Options = { apply: boolean; userId: string | undefined }

function parseArgs(argv: string[]): Options {
  let apply = false
  let userId: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--apply') apply = true
    else if (arg === '--user') {
      userId = argv[++i]?.trim()
      if (!userId) throw new Error('--user requires a user id')
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return { apply, userId }
}

/** Tenants that own thoughts or notes (owner connection, RLS not applied: operator tool). */
async function listUserIds(): Promise<string[]> {
  const owner = postgres(getDatabaseUrl(), { max: 1 })
  try {
    const rows = await owner<{ user_id: string }[]>`
      select user_id from thought union select user_id from text_file order by user_id
    `
    return rows.map((r) => r.user_id)
  } finally {
    await owner.end()
  }
}

async function decryptOrPlain(
  userId: string,
  table: string,
  column: string,
  encrypted: string | null,
  plain: string,
): Promise<string> {
  return encrypted ? decryptTenantValue({ userId, table, column, ciphertext: encrypted }) : plain
}

async function loadThoughts(userId: string): Promise<ScrubThought[]> {
  return withDbUser(userId, async () => {
    const db = getDb()
    const rows = await db
      .select({
        id: thought.id,
        rawText: thought.rawText,
        rawTextEncrypted: thought.rawTextEncrypted,
        normalizedText: thought.normalizedText,
        normalizedTextEncrypted: thought.normalizedTextEncrypted,
        askQuestion: thought.askQuestion,
        askQuestionEncrypted: thought.askQuestionEncrypted,
        cues: thought.cues,
        metadata: thought.metadata,
        metadataEncrypted: thought.metadataEncrypted,
      })
      .from(thought)
      .where(eq(thought.userId, userId))
    const links = await db
      .select({
        thoughtId: thoughtEntity.thoughtId,
        entityId: thoughtEntity.entityId,
        label: canonicalEntity.label,
      })
      .from(thoughtEntity)
      .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
      .where(eq(thoughtEntity.userId, userId))
    const entitiesByThought = new Map<string, ScrubThought['entities']>()
    for (const link of links) {
      const list = entitiesByThought.get(link.thoughtId) ?? []
      list.push({ entityId: link.entityId, label: link.label })
      entitiesByThought.set(link.thoughtId, list)
    }

    return Promise.all(
      rows.map(async (row) => {
        const [rawText, normalizedText, askQuestion, metadataJson] = await Promise.all([
          decryptOrPlain(userId, 'thought', 'raw_text', row.rawTextEncrypted, row.rawText),
          decryptOrPlain(
            userId,
            'thought',
            'normalized_text',
            row.normalizedTextEncrypted,
            row.normalizedText,
          ),
          row.askQuestionEncrypted
            ? decryptTenantValue({
                userId,
                table: 'thought',
                column: 'ask_question',
                ciphertext: row.askQuestionEncrypted,
              })
            : Promise.resolve(row.askQuestion),
          row.metadataEncrypted
            ? decryptTenantValue({
                userId,
                table: 'thought',
                column: 'metadata',
                ciphertext: row.metadataEncrypted,
              })
            : Promise.resolve(JSON.stringify(row.metadata ?? {})),
        ])
        return {
          id: row.id,
          rawText,
          normalizedText,
          askQuestion,
          cues: row.cues,
          metadata: JSON.parse(metadataJson) as Record<string, unknown>,
          entities: entitiesByThought.get(row.id) ?? [],
        } satisfies ScrubThought
      }),
    )
  })
}

async function loadNotes(userId: string): Promise<ScrubNote[]> {
  return withDbUser(userId, async () => {
    const rows = await getDb()
      .select({
        id: textFile.id,
        title: textFile.title,
        bodyText: textFile.bodyText,
        bodyTextEncrypted: textFile.bodyTextEncrypted,
        lexicalText: textFile.lexicalText,
      })
      .from(textFile)
      .where(eq(textFile.userId, userId))
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        title: row.title,
        body: await decryptOrPlain(
          userId,
          'text_file',
          'body_text',
          row.bodyTextEncrypted,
          row.bodyText,
        ),
        lexicalText: row.lexicalText,
        passages: (await loadStoredPassages(userId, row.id)).map((p) => p.text),
      })),
    )
  })
}

async function applyThoughtScrub(userId: string, plan: ThoughtScrubPlan): Promise<void> {
  await withDbUser(userId, async () => {
    const db = getDb()
    // embed first: a gateway failure leaves the row untouched, so a re-run picks it up again
    const embedding = await createThoughtEmbedding(userId, plan.normalizedText)
    const [normalizedTextEncrypted, metadataEncrypted, ask] = await Promise.all([
      encryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        plaintext: plan.normalizedText,
      }),
      encryptTenantValue({
        userId,
        table: 'thought',
        column: 'metadata',
        plaintext: JSON.stringify(plan.metadata),
      }),
      askQuestionColumns(userId, plan.askQuestion),
    ])
    const [current] = await db
      .select({ metadataEncrypted: thought.metadataEncrypted })
      .from(thought)
      .where(and(eq(thought.id, plan.thoughtId), eq(thought.userId, userId)))
      .limit(1)
    if (!current) throw new Error(`thought ${plan.thoughtId} not found`)

    await db
      .update(thought)
      .set({
        normalizedText: plan.normalizedText,
        normalizedTextEncrypted,
        lexicalText: computeLexicalText(plan.normalizedText),
        embedding: sql`${toPgVectorLiteral(embedding)}::vector`,
        cues: plan.cues,
        ...ask,
        // plaintext metadata only exists on rows that never had the encrypted column
        ...(current.metadataEncrypted ? { metadataEncrypted } : { metadata: plan.metadata }),
      })
      .where(and(eq(thought.id, plan.thoughtId), eq(thought.userId, userId)))

    if (plan.dropEntityIds.length > 0) {
      await db
        .delete(thoughtEntity)
        .where(
          and(
            eq(thoughtEntity.userId, userId),
            eq(thoughtEntity.thoughtId, plan.thoughtId),
            inArray(thoughtEntity.entityId, plan.dropEntityIds),
          ),
        )
      await db
        .delete(entityResolutionLog)
        .where(
          and(
            eq(entityResolutionLog.userId, userId),
            eq(entityResolutionLog.thoughtId, plan.thoughtId),
            inArray(entityResolutionLog.canonicalEntityId, plan.dropEntityIds),
          ),
        )
      await pruneCanonicalEntitiesWithNoThoughtLinks(userId, plan.dropEntityIds)
    }
  })
}

async function applyNoteScrub(userId: string, plan: NoteScrubPlan): Promise<void> {
  await withDbUser(userId, async () => {
    const note = await getTextFile(userId, plan.noteId)
    if (!note) throw new Error(`note ${plan.noteId} not found`)
    const title = redactedText(note.title)
    const body = redactedText(note.body)
    // embed the changed passages first, then swap lexical text and passages in one transaction
    const prepared = await preparePassageSync(userId, {
      body,
      stored: await loadStoredPassages(userId, plan.noteId),
    })
    await getDb().transaction(async (tx) => {
      await tx
        .update(textFile)
        .set({ lexicalText: computeLexicalText(`${title} ${body}`) })
        .where(and(eq(textFile.id, plan.noteId), eq(textFile.userId, userId)))
      await applyPassageSync(tx, userId, plan.noteId, prepared)
    })
  })
}

const store: ScrubStore = {
  listUserIds,
  loadThoughts,
  loadNotes,
  applyThoughtScrub,
  applyNoteScrub,
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  console.info('[scrub-stored-secrets] start', {
    mode: options.apply ? 'APPLY' : 'dry-run',
    user: options.userId ?? 'all',
  })
  const report = await runStoredSecretScrub(store, options)
  console.info('[scrub-stored-secrets] done', report)
  if (!options.apply && (report.thoughtsWithSecrets > 0 || report.notesWithSecrets > 0)) {
    console.info('[scrub-stored-secrets] dry-run only: re-run with --apply to write these changes')
  }
  if (report.failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[scrub-stored-secrets] failed', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
