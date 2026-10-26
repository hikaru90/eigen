/**
 * Reads and writes of the user-facts layer around one capture (docs/planning/user-facts-layer.md):
 * which facts and people the extractor sees, and the transaction that applies its operations.
 *
 * Writes are one transaction per capture: secure values first (a fact references them), then the
 * facts, then their provenance, then the supersede / confirm effects on stored facts. Statements
 * and identifier values are encrypted BEFORE the transaction (the tenant key lookup is a database
 * call of its own); an embedding is written to its column and never read back here.
 */

import type { KnownPerson, StoredFactForPrompt } from './extract-user-facts'
import type { FactWritePlan } from './plan-fact-writes'
import { and, eq } from 'drizzle-orm'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  thoughtEntity,
  userFact,
  userFactSource,
  userSecureValue,
} from '$lib/server/db/schema'
import { searchUserFacts } from './search-user-facts'

/** Stored facts offered to the extractor as reconciliation context. */
export const FACT_RECONCILE_TOP_K = 12
/** Relevance floor of that context: lower than the answer floor, the model filters. */
export const FACT_RECONCILE_MIN_SCORE = 0.2

/** The active facts about related subjects, found by meaning (hybrid search over `user_fact`). */
export async function loadStoredFactsForPrompt(
  userId: string,
  input: { text: string; queryEmbedding: number[] },
): Promise<StoredFactForPrompt[]> {
  const hits = await searchUserFacts(userId, {
    query: input.text,
    queryEmbedding: input.queryEmbedding,
    topK: FACT_RECONCILE_TOP_K,
    minScore: FACT_RECONCILE_MIN_SCORE,
  })
  return hits.map((hit) => ({
    id: hit.id,
    subjectKind: hit.subjectKind,
    subjectLabel: hit.subjectLabel,
    kind: hit.kind,
    statement: hit.statement,
    inferred: hit.inferred,
    asOf: hit.asOf,
  }))
}

/** Graph entities the enrichment linked to this thought; the extractor picks which one a person is. */
export async function loadKnownPeople(userId: string, thoughtId: string): Promise<KnownPerson[]> {
  return getDb()
    .select({
      id: canonicalEntity.id,
      label: canonicalEntity.label,
      entityType: canonicalEntity.entityType,
    })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
    .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.thoughtId, thoughtId)))
}

export type PersistFactWritesInput = {
  plan: FactWritePlan
  /** One per planned add, in order; each embeds the fact's display statement. DB-only. */
  embeddings: number[][]
  thoughtId: string
  /** The reference note whose text the extractor was given, if any. */
  textFileId: string | null
  /** The capture's time: a new fact is "as of" it. */
  capturedAt: Date
}

export type PersistedFactCounts = { added: number; superseded: number; confirmed: number }

export async function persistFactWrites(
  userId: string,
  input: PersistFactWritesInput,
): Promise<PersistedFactCounts> {
  const { plan, thoughtId, textFileId, capturedAt } = input
  if (input.embeddings.length !== plan.adds.length) {
    throw new Error(
      `user facts: embedding count mismatch: expected ${plan.adds.length}, got ${input.embeddings.length}`,
    )
  }

  const statements = await Promise.all(
    plan.adds.map((add) =>
      encryptTenantValue({
        userId,
        table: 'user_fact',
        column: 'statement',
        plaintext: add.storedStatement,
      }),
    ),
  )
  const secureRows = await Promise.all(
    plan.adds.flatMap((add) =>
      add.secureValue
        ? [
            (async () => ({
              id: add.secureValue!.id,
              userId,
              kind: add.secureValue!.kind,
              label: add.secureValue!.label,
              valueEncrypted: await encryptTenantValue({
                userId,
                table: 'user_secure_value',
                column: 'value',
                plaintext: add.secureValue!.value,
              }),
            }))(),
          ]
        : [],
    ),
  )

  return getDb().transaction(async (tx) => {
    if (secureRows.length > 0) await tx.insert(userSecureValue).values(secureRows)

    if (plan.adds.length > 0) {
      await tx.insert(userFact).values(
        plan.adds.map((add, i) => ({
          id: add.id,
          userId,
          subjectKind: add.subject.kind,
          subjectLabel: add.subject.kind === 'person' ? add.subject.label : null,
          subjectEntityId: add.subject.kind === 'person' ? add.subject.entityId : null,
          statementEncrypted: statements[i]!,
          lexicalText: add.lexicalText,
          embedding: input.embeddings[i]!,
          kind: add.kind,
          confidence: add.confidence,
          inferred: add.inferred,
          status: 'active' as const,
          asOf: capturedAt,
          secureValueId: add.secureValue?.id ?? null,
        })),
      )
      await tx
        .insert(userFactSource)
        .values(plan.adds.map((add) => ({ userId, factId: add.id, thoughtId, textFileId })))
    }

    let superseded = 0
    for (const add of plan.adds) {
      if (!add.supersedesFactId) continue
      await tx
        .update(userFact)
        .set({ status: 'superseded', supersededBy: add.id, updatedAt: new Date() })
        .where(
          and(
            eq(userFact.id, add.supersedesFactId),
            eq(userFact.userId, userId),
            eq(userFact.status, 'active'),
          ),
        )
      superseded += 1
    }

    let confirmed = 0
    for (const factId of plan.confirms) {
      const [current] = await tx
        .select({ asOf: userFact.asOf })
        .from(userFact)
        .where(
          and(eq(userFact.id, factId), eq(userFact.userId, userId), eq(userFact.status, 'active')),
        )
        .limit(1)
      // superseded or forgotten since it was offered: nothing to confirm
      if (!current) continue
      if (current.asOf.getTime() < capturedAt.getTime()) {
        await tx
          .update(userFact)
          .set({ asOf: capturedAt, updatedAt: new Date() })
          .where(and(eq(userFact.id, factId), eq(userFact.userId, userId)))
      }
      await tx
        .insert(userFactSource)
        .values({ userId, factId, thoughtId, textFileId })
        .onConflictDoNothing()
      confirmed += 1
    }

    return { added: plan.adds.length, superseded, confirmed }
  })
}

export type FactForRewrite = {
  id: string
  subjectLabel: string | null
  /** As stored: an identifier fact holds `[secure:<id>]`. */
  statement: string
  secureValueId: string | null
}

/** The active fact a forget request wants to edit, decrypted. Null: it is not an active fact any more. */
export async function loadActiveFactForRewrite(
  userId: string,
  factId: string,
): Promise<FactForRewrite | null> {
  const [row] = await getDb()
    .select({
      id: userFact.id,
      subjectLabel: userFact.subjectLabel,
      statementEncrypted: userFact.statementEncrypted,
      secureValueId: userFact.secureValueId,
    })
    .from(userFact)
    .where(and(eq(userFact.id, factId), eq(userFact.userId, userId), eq(userFact.status, 'active')))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    subjectLabel: row.subjectLabel,
    statement: await decryptTenantValue({
      userId,
      table: 'user_fact',
      column: 'statement',
      ciphertext: row.statementEncrypted,
    }),
    secureValueId: row.secureValueId,
  }
}

/** Replaces an active fact's statement and the surfaces built from it (keyword text, embedding). */
export async function saveRewrittenFact(
  userId: string,
  input: { factId: string; storedStatement: string; lexicalText: string; embedding: number[] },
): Promise<void> {
  const statementEncrypted = await encryptTenantValue({
    userId,
    table: 'user_fact',
    column: 'statement',
    plaintext: input.storedStatement,
  })
  await getDb()
    .update(userFact)
    .set({
      statementEncrypted,
      lexicalText: input.lexicalText,
      embedding: input.embedding,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userFact.id, input.factId),
        eq(userFact.userId, userId),
        eq(userFact.status, 'active'),
      ),
    )
}
