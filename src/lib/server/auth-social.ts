/** OAuth providers supported in Better Auth `socialProviders` config. */
import { splitDisplayName } from './auth-user-name'

export const SOCIAL_PROVIDER_IDS = ['google', 'github'] as const

export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number]

/** OAuth profile claims we derive name parts from (Google OIDC claims / GitHub profile fields). */
type OAuthNameProfile = {
  name?: unknown
  login?: unknown
  given_name?: unknown
  family_name?: unknown
}

type SocialProviderCredentials = {
  clientId: string
  clientSecret: string
  /** Maps the OAuth profile onto Better Auth user additional fields (firstName/lastName). */
  mapProfileToUser: (profile: OAuthNameProfile) => {
    firstName?: string
    lastName?: string
  }
}

export type SocialProvidersConfig = Partial<Record<SocialProviderId, SocialProviderCredentials>>

const PROVIDER_ENV: Record<SocialProviderId, { clientId: string; clientSecret: string }> = {
  google: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
  github: { clientId: 'GITHUB_CLIENT_ID', clientSecret: 'GITHUB_CLIENT_SECRET' },
}

function readProfileString(profile: OAuthNameProfile, key: keyof OAuthNameProfile): string | undefined {
  const value = profile[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

/** Google ID-token claims carry structured given/family names; fall back to splitting `name`. */
function mapGoogleProfile(profile: OAuthNameProfile): {
  firstName?: string
  lastName?: string
} {
  const firstName = readProfileString(profile, 'given_name')
  const lastName = readProfileString(profile, 'family_name')
  if (firstName || lastName) {
    return { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) }
  }

  const displayName = readProfileString(profile, 'name')
  if (!displayName) return {}
  return splitDisplayName(displayName)
}

/**
 * GitHub exposes only a free-form display `name` (no given/family split), so the first
 * whitespace-separated token becomes firstName and the remainder lastName. Profiles without
 * a display name fall back to the always-present login, mirroring Better Auth's own
 * `profile.name || profile.login` display-name behavior.
 */
function mapGithubProfile(profile: OAuthNameProfile): {
  firstName?: string
  lastName?: string
} {
  const displayName = readProfileString(profile, 'name') ?? readProfileString(profile, 'login')
  if (!displayName) return {}
  return splitDisplayName(displayName)
}

const PROVIDER_PROFILE_MAPPERS: Record<
  SocialProviderId,
  SocialProviderCredentials['mapProfileToUser']
> = {
  google: mapGoogleProfile,
  github: mapGithubProfile,
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
      config[providerId] = {
        clientId,
        clientSecret,
        mapProfileToUser: PROVIDER_PROFILE_MAPPERS[providerId],
      }
    }
  }

  return config
}

export function listEnabledSocialProviderIds(
  env: Record<string, string | undefined>,
): SocialProviderId[] {
  return SOCIAL_PROVIDER_IDS.filter((id) => buildSocialProvidersConfig(env)[id] !== undefined)
}
