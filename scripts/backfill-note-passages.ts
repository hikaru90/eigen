import './load-project-env'

/**
 * Backfill note passages (long-text memory, Phase B) for notes created before `note_passage` existed.
 *
 * Idempotent: only notes with NO passages are processed, and each note's passages are written in
 * one transaction (all or none), so a re-run after a failure picks up exactly the notes still
 * missing. Notes with an empty body have nothing to index and are skipped.
 *
 * Embeddings go through the normal gateway and are BILLED to each note's owner like any other
 * embedding call (usage log + markup). A user without credits fails loudly for that user's notes;
 * the run continues with the next note and exits non-zero if any note failed.
 *
 * Usage:
 *   npm run backfill:note-passages -- --dry-run            # count notes, no embedding
 *   npm run backfill:note-passages -- --user <userId>      # one tenant
 *   npm run backfill:note-passages                         # every tenant
 */
import postgres from 'postgres'
import { withDbUser, getDb } from '$lib/server/db'
import { chunkNoteIntoPassages } from '$lib/server/text-files/chunk-note-passages'
import { applyPassageSync, preparePassageSync } from '$lib/server/text-files/note-passages'
import { getTextFile } from '$lib/server/text-files/service'
import { getDatabaseUrl } from './db-urls.mjs'

type Options = { dryRun: boolean; userId: string | null }

function parseArgs(argv: string[]): Options {
  let dryRun = false
  let userId: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--user') {
      userId = argv[++i]?.trim() || null
      if (!userId) throw new Error('--user requires a user id')
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return { dryRun, userId }
}

/** Notes without passages, across tenants (owner connection, RLS not applied: operator tool). */
async function listNotesWithoutPassages(
  userId: string | null,
): Promise<Array<{ userId: string; noteId: string }>> {
  const sql = postgres(getDatabaseUrl(), { max: 1 })
  try {
    const rows = await sql<{ user_id: string; id: string }[]>`
      select t.user_id, t.id
      from text_file t
      where not exists (select 1 from note_passage p where p.text_file_id = t.id)
        and (${userId}::text is null or t.user_id = ${userId})
      order by t.user_id, t.created_at
    `
    return rows.map((r) => ({ userId: r.user_id, noteId: r.id }))
  } finally {
    await sql.end()
  }
}

type NoteOutcome = 'indexed' | 'empty' | 'dry-run'

async function backfillNote(
  target: { userId: string; noteId: string },
  dryRun: boolean,
): Promise<{ outcome: NoteOutcome; passages: number }> {
  return withDbUser(target.userId, async () => {
    const note = await getTextFile(target.userId, target.noteId)
    if (!note || note.body.trim().length === 0) return { outcome: 'empty' as const, passages: 0 }
    const passages = chunkNoteIntoPassages(note.body).length
    if (dryRun) return { outcome: 'dry-run' as const, passages }

    const prepared = await preparePassageSync(target.userId, { body: note.body, stored: [] })
    await getDb().transaction(async (tx) => {
      await applyPassageSync(tx, target.userId, target.noteId, prepared)
    })
    return { outcome: 'indexed' as const, passages }
  })
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const targets = await listNotesWithoutPassages(options.userId)
  console.info('[backfill-note-passages] notes without passages', {
    count: targets.length,
    user: options.userId ?? 'all',
    dryRun: options.dryRun,
  })

  const totals = { indexed: 0, empty: 0, dryRun: 0, failed: 0, passages: 0 }
  for (const target of targets) {
    try {
      const { outcome, passages } = await backfillNote(target, options.dryRun)
      if (outcome === 'indexed') totals.indexed++
      else if (outcome === 'empty') totals.empty++
      else totals.dryRun++
      totals.passages += passages
      console.info('[backfill-note-passages] note', { ...target, outcome, passages })
    } catch (err) {
      totals.failed++
      console.error('[backfill-note-passages] note failed', {
        ...target,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.info('[backfill-note-passages] done', totals)
  if (totals.failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[backfill-note-passages] failed', err)
  process.exitCode = 1
})
