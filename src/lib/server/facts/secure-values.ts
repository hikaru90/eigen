/**
 * Server-side substitution of secure values (docs/planning/user-facts-layer.md, Q3). An identifier
 * fact's statement holds `[secure:<id>]`; the answer model may emit that token, but it never sees
 * a value. This is the one place a value is decrypted for a user-facing response, after generation
 * and only when the user asked for it (Ask, MCP). The caller decides when to call it; the value is
 * never logged and never returned anywhere but in the substituted text.
 *
 * A token whose secure value no longer exists (the fact was forgotten) stays in the text and is
 * reported in `unresolved`, unless the caller names a replacement: nothing is guessed here.
 *
 * `resolveSecureReferences` is the form the response boundaries use (the Ask turn's response and the
 * display read of a stored session): every token becomes its value, a gone one becomes a neutral
 * text. Stored answers, agent messages, prompts, logs and the harness all keep the token.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { userSecureValue } from '$lib/server/db/schema'
import { secureReferencePattern } from './fact-vocabulary'

/** What a reference whose value no longer exists reads as in a user-facing response. */
export const SECURE_VALUE_GONE_TEXT = '[no longer stored]'

export type SecureSubstitution = {
  text: string
  /** Tokens replaced by their value (every occurrence counts). */
  substituted: number
  /** Ids of tokens with no secure value behind them; left in the text as written. */
  unresolved: string[]
}

export async function substituteSecureReferences(
  userId: string,
  text: string,
  options: { unresolvedAs?: string } = {},
): Promise<SecureSubstitution> {
  const ids = [
    ...new Set([...text.matchAll(secureReferencePattern())].map((m) => m[1]!.toLowerCase())),
  ]
  if (ids.length === 0) return { text, substituted: 0, unresolved: [] }

  const rows = await getDb()
    .select({ id: userSecureValue.id, valueEncrypted: userSecureValue.valueEncrypted })
    .from(userSecureValue)
    .where(and(eq(userSecureValue.userId, userId), inArray(userSecureValue.id, ids)))

  const values = new Map<string, string>()
  for (const row of rows) {
    values.set(
      row.id.toLowerCase(),
      await decryptTenantValue({
        userId,
        table: 'user_secure_value',
        column: 'value',
        ciphertext: row.valueEncrypted,
      }),
    )
  }

  let substituted = 0
  const out = text.replace(secureReferencePattern(), (token, id: string) => {
    const value = values.get(id.toLowerCase())
    if (value === undefined) return options.unresolvedAs ?? token
    substituted += 1
    return value
  })
  return { text: out, substituted, unresolved: ids.filter((id) => !values.has(id)) }
}

/** The user-facing form of a stored answer: tokens replaced by their values, gone ones by a neutral text. */
export async function resolveSecureReferences(userId: string, text: string): Promise<string> {
  return (await substituteSecureReferences(userId, text, { unresolvedAs: SECURE_VALUE_GONE_TEXT }))
    .text
}
