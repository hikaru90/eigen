import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'
import { runWithTrace } from '$lib/server/activity/trace-context'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import type { LifecycleStatus } from '$lib/server/db/brain.schema'
import { thought } from '$lib/server/db/schema'
import { setThoughtLifecycleStatus, archiveThoughtForUser } from '$lib/server/memory/lifecycle'
import { listTextFilesForThought } from '$lib/server/text-files/service'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const thoughtId = event.params.thoughtId?.trim() ?? ''
  if (!thoughtId) error(400, 'thoughtId is required')

  const [row] = await getDb()
    .select({
      id: thought.id,
      rawText: thought.rawText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      category: thought.category,
      author: thought.author,
      authorLabel: thought.authorLabel,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      updatedAt: thought.updatedAt,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, user.id)))
    .limit(1)

  if (!row) error(404, 'Thought not found')
  const [rawText, normalizedText, metadataJson] = await Promise.all([
    row.rawTextEncrypted
      ? decryptTenantValue({
          userId: user.id,
          table: 'thought',
          column: 'raw_text',
          ciphertext: row.rawTextEncrypted,
        })
      : Promise.resolve(row.rawText),
    row.normalizedTextEncrypted
      ? decryptTenantValue({
          userId: user.id,
          table: 'thought',
          column: 'normalized_text',
          ciphertext: row.normalizedTextEncrypted,
        })
      : Promise.resolve(row.normalizedText),
    row.metadataEncrypted
      ? decryptTenantValue({
          userId: user.id,
          table: 'thought',
          column: 'metadata',
          ciphertext: row.metadataEncrypted,
        })
      : Promise.resolve(JSON.stringify(row.metadata ?? {})),
  ])

  return json({
    id: row.id,
    rawText,
    normalizedText,
    category: row.category,
    author: row.author,
    authorLabel: row.authorLabel,
    metadata: JSON.parse(metadataJson) as Record<string, unknown>,
    updatedAt: row.updatedAt,
    attachedFiles: await listTextFilesForThought(user.id, thoughtId),
  })
}

export const PATCH: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const thoughtId = event.params.thoughtId?.trim() ?? ''
  if (!thoughtId) error(400, 'thoughtId is required')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON')
  }

  const status =
    typeof body === 'object' && body && 'status' in body
      ? (body as { status?: unknown }).status
      : undefined
  if (status !== 'open' && status !== 'completed' && status !== 'archived') {
    error(400, 'status must be "open", "completed", or "archived"')
  }

  const result = await runWithTrace(crypto.randomUUID(), () =>
    setThoughtLifecycleStatus(user.id, thoughtId, status as LifecycleStatus),
  )
  if (!result.ok) error(404, 'Thought not found')

  return json({ thought: result.thought })
}

export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const thoughtId = event.params.thoughtId?.trim() ?? ''
  if (!thoughtId) error(400, 'thoughtId is required')

  const result = await runWithTrace(crypto.randomUUID(), () =>
    archiveThoughtForUser(user.id, thoughtId),
  )
  if (!result.ok) error(404, 'Thought not found')

  return json({ ok: true as const, archived: true })
}
