import type { NowCardPayload } from './now-store'
import { and, eq } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { nowCard } from '$lib/server/db/schema'

/**
 * The task text for "Too big" (docs/planning/feature-mesh-now.md, NOW-9): Ask opens at
 * `/chat?breakdown=<cardId>` and the page's server load calls this. Null when the card is not
 * this user's, does not exist, or has no thought to break down (a project card); the caller
 * answers 404. The card's status does not matter: Too big has already been answered by then.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function loadBreakdownTask(userId: string, cardId: string): Promise<string | null> {
  if (!UUID_RE.test(cardId)) return null
  const [row] = await getDb()
    .select({
      targetThoughtId: nowCard.targetThoughtId,
      payloadEncrypted: nowCard.payloadEncrypted,
    })
    .from(nowCard)
    .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId)))
    .limit(1)
  if (!row || !row.targetThoughtId) return null
  const payload = JSON.parse(
    await decryptTenantValue({
      userId,
      table: 'now_card',
      column: 'payload',
      ciphertext: row.payloadEncrypted,
    }),
  ) as NowCardPayload
  return payload.text
}
