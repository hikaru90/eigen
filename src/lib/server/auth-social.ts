/** OAuth providers supported in Better Auth `socialProviders` config. */
export const SOCIAL_PROVIDER_IDS = ['google', 'github'] as const

export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number]

type SocialProviderCredentials = {
  clientId: string
  clientSecret: string
}

export type SocialProvidersConfig = Partial<Record<SocialProviderId, SocialProviderCredentials>>

const PROVIDER_ENV: Record<SocialProviderId, { clientId: string; clientSecret: string }> = {
  google: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
  github: { clientId: 'GITHUB_CLIENT_ID', clientSecret: 'GITHUB_CLIENT_SECRET' },
}

function readCredential(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim()
  return value || undefined
}

/**
 * Builds Better Auth `socialProviders` from env. A provider is enabled only when both
 * client ID and secret are set (no partial or implicit credentials).
 */
export function buildSocialProvidersConfig(
  env: Record<string, string | undefined>,
): SocialProvidersConfig {
  const config: SocialProvidersConfig = {}

  for (const providerId of SOCIAL_PROVIDER_IDS) {
    const keys = PROVIDER_ENV[providerId]
    const clientId = readCredential(env, keys.clientId)
    const clientSecret = readCredential(env, keys.clientSecret)
    if (clientId && clientSecret) {
      config[providerId] = { clientId, clientSecret }
    }
  }

  return config
}

export function listEnabledSocialProviderIds(
  env: Record<string, string | undefined>,
): SocialProviderId[] {
  return SOCIAL_PROVIDER_IDS.filter((id) => buildSocialProvidersConfig(env)[id] !== undefined)
}
