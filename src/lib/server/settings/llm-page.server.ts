import type { Actions, RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'
import { env } from '$lib/server/env/private-env'
import { captureServerEvent } from '$lib/server/analytics/posthog-server'
import { isUserAdmin } from '$lib/server/auth/user-role'
import { isByokUiEnabled } from '$lib/server/billing/byok-ui'
import { clearLegacyByokForUser, legacyByokMigrationNeeded } from '$lib/server/billing/legacy-byok'
import {
  getPayPalClientId,
  getPayPalWebSdkUrl,
  getPayPalClientSecret,
} from '$lib/server/billing/paypal'
import { assertByokConfigured, hasSavedByokLlmCredentials } from '$lib/server/billing/preferences'
import { getOrCreateWallet } from '$lib/server/billing/wallet'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  userPreference,
  llmProviderConfig,
  llmActiveProvider,
  type BillingMode,
} from '$lib/server/db/schema'

export type LlmProviderId = 'eurouter' | 'openrouter'

function getSafeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const msg = (error as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim().length > 0) return msg
  }
  return fallback
}

export function isProviderConfigured(
  row: { baseUrl?: string | null; apiKey?: string | null } | undefined,
) {
  return Boolean(row?.baseUrl?.trim() && row?.apiKey?.trim())
}

export async function loadLlmSettingsPage(event: RequestEvent) {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  const userId = event.locals.user.id
  const isAdmin = await isUserAdmin(userId)

  const [pref] = await getDb()
    .select({ billingMode: userPreference.billingMode })
    .from(userPreference)
    .where(eq(userPreference.userId, userId))
    .limit(1)

  const billingMode = (pref?.billingMode ?? 'platform_credits') as BillingMode
  const wallet = await getOrCreateWallet(userId)

  let paypalConfigured: boolean
  let paypalClientId: string | null = null
  let paypalSdkUrl: string | null = null
  try {
    // Use the same resolution logic as the PayPal billing module,
    // so env naming aliases (PAYPAL_URL / PAYPAL_SECRET) work consistently.
    paypalClientId = getPayPalClientId()
    paypalSdkUrl = getPayPalWebSdkUrl()
    // Validate that capture credentials exist as well.
    // Validate capture credentials exist as well.
    // (getPayPalClientSecret + getPayPalApiBase will throw if missing)
    getPayPalClientSecret()
    paypalConfigured = true
  } catch {
    paypalConfigured = false
  }

  const [activeRow] = await getDb()
    .select({ provider: llmActiveProvider.provider })
    .from(llmActiveProvider)
    .where(eq(llmActiveProvider.userId, userId))
    .limit(1)

  const activeProvider = (activeRow?.provider ?? 'eurouter') as LlmProviderId

  const providerRows = await getDb()
    .select()
    .from(llmProviderConfig)
    .where(eq(llmProviderConfig.userId, userId))

  const eurouterRow = providerRows.find((r) => r.provider === 'eurouter')
  const openrouterRow = providerRows.find((r) => r.provider === 'openrouter')
  const [eurouterApiKey, openrouterApiKey] = await Promise.all([
    eurouterRow?.apiKeyEncrypted
      ? decryptTenantValue({
          userId,
          table: 'llm_provider_config',
          column: 'api_key',
          ciphertext: eurouterRow.apiKeyEncrypted,
        })
      : Promise.resolve(eurouterRow?.apiKey ?? ''),
    openrouterRow?.apiKeyEncrypted
      ? decryptTenantValue({
          userId,
          table: 'llm_provider_config',
          column: 'api_key',
          ciphertext: openrouterRow.apiKeyEncrypted,
        })
      : Promise.resolve(openrouterRow?.apiKey ?? ''),
  ])
  const byokConfigured = Boolean(
    (eurouterRow?.baseUrl?.trim() && eurouterApiKey.trim()) ||
    (openrouterRow?.baseUrl?.trim() && openrouterApiKey.trim()),
  )

  const byokUiEnabled = isByokUiEnabled()
  const legacyByokMigration = legacyByokMigrationNeeded({
    byokUiEnabled,
    billingMode,
    hasStoredCredentials: byokConfigured,
  })
  const tab = event.url.searchParams.get('tab')
  let initialTab = (
    tab === 'byok' || tab === 'credits' ? tab : billingMode === 'byok' ? 'byok' : 'credits'
  ) as 'byok' | 'credits'
  if (!byokUiEnabled) {
    initialTab = 'credits'
  }

  return {
    isAdmin,
    billingMode,
    byokUiEnabled,
    byokConfigured,
    legacyByokMigration,
    wallet,
    paypalConfigured,
    paypalClientId,
    paypalSdkUrl,
    activeProvider,
    initialTab,
    providers: {
      eurouter: {
        configured: isProviderConfigured(eurouterRow),
        baseUrl: eurouterRow?.baseUrl ?? '',
        apiKey: eurouterApiKey,
        ruleChat: eurouterRow?.ruleChat ?? '',
        ruleEmbedding: eurouterRow?.ruleEmbedding ?? '',
        modelChat: eurouterRow?.modelChat || env.LLM_MODEL_CHAT?.trim() || '',
        modelEmbedding: eurouterRow?.modelEmbedding || env.LLM_MODEL_EMBEDDING?.trim() || '',
      },
      openrouter: {
        configured: isProviderConfigured(openrouterRow),
        baseUrl: openrouterRow?.baseUrl ?? '',
        apiKey: openrouterApiKey,
        modelChat: openrouterRow?.modelChat || env.LLM_MODEL_CHAT?.trim() || '',
        modelEmbedding: openrouterRow?.modelEmbedding || env.LLM_MODEL_EMBEDDING?.trim() || '',
      },
    },
  }
}

export const llmSettingsActions: Actions = {
  saveLlmConfig: async (event) => {
    if (!event.locals.user) {
      return fail(401, { llmMessage: 'You must be signed in.' })
    }
    if (!isByokUiEnabled()) {
      return fail(403, { llmMessage: 'Bring your own key is not available on this deployment.' })
    }

    const formData = await event.request.formData()
    const provider = formData.get('provider')?.toString().trim() ?? ''
    const baseUrl = formData.get('baseUrl')?.toString().trim() ?? ''
    const apiKey = formData.get('apiKey')?.toString().trim() ?? ''
    const ruleChat = formData.get('ruleChat')?.toString().trim() || null
    const ruleEmbedding = formData.get('ruleEmbedding')?.toString().trim() || null
    const modelChat = formData.get('modelChat')?.toString().trim() || null
    const modelEmbedding = formData.get('modelEmbedding')?.toString().trim() || null
    const setActive = formData.get('setActive') !== 'false'

    if (provider !== 'eurouter' && provider !== 'openrouter') {
      return fail(400, { llmMessage: 'Invalid provider.' })
    }
    if (!baseUrl) {
      return fail(400, { llmMessage: 'Base URL is required.' })
    }
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      return fail(400, { llmMessage: 'Base URL must start with http:// or https://' })
    }
    if (!apiKey) {
      return fail(400, { llmMessage: 'API key is required.' })
    }

    try {
      const db = getDb()
      const userId = event.locals.user.id
      const apiKeyEncrypted = await encryptTenantValue({
        userId,
        table: 'llm_provider_config',
        column: 'api_key',
        plaintext: apiKey,
      })
      await db
        .insert(llmProviderConfig)
        .values({
          userId,
          provider,
          baseUrl: baseUrl.replace(/\/$/, ''),
          apiKey,
          apiKeyEncrypted,
          ruleChat,
          ruleEmbedding,
          modelChat,
          modelEmbedding,
        })
        .onConflictDoUpdate({
          target: [llmProviderConfig.userId, llmProviderConfig.provider],
          set: {
            baseUrl: baseUrl.replace(/\/$/, ''),
            apiKey,
            apiKeyEncrypted,
            ruleChat,
            ruleEmbedding,
            modelChat,
            modelEmbedding,
            updatedAt: new Date(),
          },
        })

      if (setActive) {
        await db
          .insert(llmActiveProvider)
          .values({ userId, provider })
          .onConflictDoUpdate({
            target: llmActiveProvider.userId,
            set: { provider, updatedAt: new Date() },
          })
      }

      await db
        .insert(userPreference)
        .values({ userId, billingMode: 'byok' })
        .onConflictDoUpdate({
          target: userPreference.userId,
          set: { billingMode: 'byok', updatedAt: new Date() },
        })

      const label = provider === 'eurouter' ? 'EUrouter' : 'OpenRouter'
      return { llmMessage: `${label} saved.`, billingMode: 'byok' as const }
    } catch (error) {
      return fail(400, {
        llmMessage: getSafeErrorMessage(error, 'Unable to save LLM configuration.'),
      })
    }
  },

  setActiveProvider: async (event) => {
    if (!event.locals.user) {
      return fail(401, { llmMessage: 'You must be signed in.' })
    }
    if (!isByokUiEnabled()) {
      return fail(403, { llmMessage: 'Bring your own key is not available on this deployment.' })
    }

    const formData = await event.request.formData()
    const provider = formData.get('provider')?.toString().trim() ?? ''

    if (provider !== 'eurouter' && provider !== 'openrouter') {
      return fail(400, { llmMessage: 'Invalid provider.' })
    }

    try {
      const userId = event.locals.user.id
      await assertByokConfigured(userId)
      const db = getDb()
      await db
        .insert(llmActiveProvider)
        .values({ userId, provider })
        .onConflictDoUpdate({
          target: llmActiveProvider.userId,
          set: { provider, updatedAt: new Date() },
        })
      await db
        .insert(userPreference)
        .values({ userId, billingMode: 'byok' })
        .onConflictDoUpdate({
          target: userPreference.userId,
          set: { billingMode: 'byok', updatedAt: new Date() },
        })
      return {
        llmMessage: `Active provider set to ${provider === 'eurouter' ? 'EUrouter' : 'OpenRouter'}.`,
      }
    } catch (error) {
      return fail(400, {
        llmMessage: getSafeErrorMessage(error, 'Unable to set active provider.'),
      })
    }
  },

  setBillingMode: async (event) => {
    if (!event.locals.user) {
      return fail(401, { billingMessage: 'You must be signed in.' })
    }

    const formData = await event.request.formData()
    const raw = formData.get('billingMode')?.toString().trim() ?? ''
    if (raw !== 'platform_credits' && raw !== 'byok') {
      return fail(400, { billingMessage: 'Invalid billing method.' })
    }

    const billingMode = raw as BillingMode
    const userId = event.locals.user.id

    const [existingPref] = await getDb()
      .select({ billingMode: userPreference.billingMode })
      .from(userPreference)
      .where(eq(userPreference.userId, userId))
      .limit(1)
    const fromBillingMode = (existingPref?.billingMode ?? 'platform_credits') as BillingMode

    try {
      if (billingMode === 'byok' && !isByokUiEnabled()) {
        return fail(403, {
          billingMessage: 'Bring your own key is not available on this deployment.',
        })
      }
      if (billingMode === 'byok') {
        await assertByokConfigured(userId)
      }

      await getDb()
        .insert(userPreference)
        .values({ userId, billingMode })
        .onConflictDoUpdate({
          target: userPreference.userId,
          set: { billingMode, updatedAt: new Date() },
        })

      const billingMessage =
        billingMode === 'byok'
          ? 'LLM calls will use your OpenRouter / EUrouter keys.'
          : 'LLM calls will use Eigen platform credits.'
      if (fromBillingMode !== billingMode) {
        captureServerEvent({
          distinctId: userId,
          event: 'billing_mode_changed',
          properties: { from: fromBillingMode, to: billingMode },
        })
      }
      return { billingMessage, billingMode }
    } catch (error) {
      return fail(400, {
        billingMessage: getSafeErrorMessage(error, 'Unable to update billing method.'),
      })
    }
  },

  switchToPlatformCredits: async (event) => {
    if (!event.locals.user) {
      return fail(401, { legacyByokMessage: 'You must be signed in.' })
    }

    const userId = event.locals.user.id
    const byokUiEnabled = isByokUiEnabled()
    const [pref] = await getDb()
      .select({ billingMode: userPreference.billingMode })
      .from(userPreference)
      .where(eq(userPreference.userId, userId))
      .limit(1)
    const billingMode = (pref?.billingMode ?? 'platform_credits') as BillingMode
    const hasStoredCredentials = await hasSavedByokLlmCredentials(userId)

    if (
      !legacyByokMigrationNeeded({
        byokUiEnabled,
        billingMode,
        hasStoredCredentials,
      })
    ) {
      return fail(400, {
        legacyByokMessage: 'Your account is already using Eigen platform credits.',
      })
    }

    try {
      await clearLegacyByokForUser(userId)
      return {
        legacyByokMessage:
          'Your API keys were removed. LLM calls will now use Eigen platform credits.',
        billingMode: 'platform_credits' as const,
        legacyByokMigration: false,
      }
    } catch (error) {
      return fail(400, {
        legacyByokMessage: getSafeErrorMessage(
          error,
          'Unable to switch to Eigen platform credits.',
        ),
      })
    }
  },

  saveModelConfig: async (event) => {
    if (!event.locals.user) {
      return fail(401, { modelMessage: 'You must be signed in.' })
    }

    const isAdmin = await isUserAdmin(event.locals.user.id)
    if (!isAdmin) {
      return fail(403, { modelMessage: 'Only administrators can modify model configuration.' })
    }

    const formData = await event.request.formData()
    const modelChat = formData.get('modelChat')?.toString().trim() || null
    const modelEmbedding = formData.get('modelEmbedding')?.toString().trim() || null
    const ruleChat = formData.get('ruleChat')?.toString().trim() || null
    const ruleEmbedding = formData.get('ruleEmbedding')?.toString().trim() || null
    const provider = formData.get('provider')?.toString().trim() || 'eurouter'

    if (provider !== 'eurouter' && provider !== 'openrouter') {
      return fail(400, { modelMessage: 'Invalid provider.' })
    }

    try {
      const db = getDb()
      const userId = event.locals.user.id

      // For EUrouter, use routing rules; for OpenRouter, use model names
      const isEurouter = provider === 'eurouter'
      const updateData = isEurouter
        ? { ruleChat, ruleEmbedding, updatedAt: new Date() }
        : { modelChat, modelEmbedding, updatedAt: new Date() }

      // Update or insert provider config
      const existing = await db
        .select()
        .from(llmProviderConfig)
        .where(and(eq(llmProviderConfig.userId, userId), eq(llmProviderConfig.provider, provider)))
        .limit(1)

      if (existing.length > 0 && existing[0]?.baseUrl) {
        await db
          .update(llmProviderConfig)
          .set(updateData)
          .where(
            and(eq(llmProviderConfig.userId, userId), eq(llmProviderConfig.provider, provider)),
          )
      } else {
        await db
          .insert(llmProviderConfig)
          .values({
            userId,
            provider,
            baseUrl:
              provider === 'openrouter'
                ? env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1'
                : env.LLM_BASE_URL?.trim() || 'https://api.eurouter.ai/v1',
            apiKey:
              provider === 'openrouter'
                ? env.OPENROUTER_API_KEY?.trim() || 'placeholder'
                : env.LLM_API_KEY?.trim() || 'placeholder',
            ...updateData,
          })
          .onConflictDoUpdate({
            target: [llmProviderConfig.userId, llmProviderConfig.provider],
            set: updateData,
          })
      }

      return { modelMessage: 'Configuration saved.' }
    } catch (error) {
      return fail(400, {
        modelMessage: getSafeErrorMessage(error, 'Unable to save configuration.'),
      })
    }
  },
}
