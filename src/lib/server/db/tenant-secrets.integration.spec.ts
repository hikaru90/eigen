import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { llmProviderConfig, userApiKey } from '$lib/server/db/brain.schema'
import { user } from '$lib/server/db/auth.schema'
import { generateApiKey } from '$lib/server/api-keys/api-key-utils'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('tenant secrets RLS integration', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb

  const suffix = `sec_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
  const ua = `sec_ua_${suffix}`
  const ub = `sec_ub_${suffix}`
  const secretKeyB = `sk-user-b-${suffix}`

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb
    await seedUser(ua)
    await seedUser(ub)
  })

  afterAll(async () => {
    for (const uid of [ua, ub]) {
      await withOperatorDb(async (db) => {
        await db.delete(user).where(eq(user.id, uid))
      }).catch(() => undefined)
    }
  })

  async function seedUser(userId: string) {
    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: userId,
        name: userId,
        email: `${userId}@test.local`,
        emailVerified: true,
        onboardingCompleted: true,
      })
    })
  }

  it('llm_provider_config api keys are not visible to other tenants', async () => {
    await withEvalDb(ub, async (db) => {
      await db.insert(llmProviderConfig).values({
        userId: ub,
        provider: 'openrouter',
        baseUrl: 'https://openrouter.example',
        apiKey: secretKeyB,
        apiKeyEncrypted: `cipher:${secretKeyB}`,
      })
    })

    const visibleToA = await withEvalDb(ua, async (db) =>
      db
        .select({
          apiKey: llmProviderConfig.apiKey,
          apiKeyEncrypted: llmProviderConfig.apiKeyEncrypted,
        })
        .from(llmProviderConfig),
    )

    expect(visibleToA.some((row) => row.apiKey === secretKeyB)).toBe(false)
    expect(visibleToA.some((row) => row.apiKeyEncrypted === `cipher:${secretKeyB}`)).toBe(false)
  })

  it('user_api_key rows are not visible to other tenants', async () => {
    const { hash, prefix } = generateApiKey()
    await withEvalDb(ub, async (db) => {
      await db.insert(userApiKey).values({
        userId: ub,
        name: 'test',
        keyPrefix: prefix,
        keyHash: hash,
      })
    })

    const visibleToA = await withEvalDb(ua, async (db) =>
      db.select({ keyHash: userApiKey.keyHash }).from(userApiKey),
    )

    expect(visibleToA.some((row) => row.keyHash === hash)).toBe(false)
  })
})
