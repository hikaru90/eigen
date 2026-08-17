import { describe, expect, it } from 'vitest'
import { buildSocialProvidersConfig, listEnabledSocialProviderIds } from './auth-social'

describe('buildSocialProvidersConfig', () => {
  it('returns empty when no OAuth env is set', () => {
    expect(buildSocialProvidersConfig({})).toEqual({})
    expect(listEnabledSocialProviderIds({})).toEqual([])
  })

  it('enables google only when both id and secret are set', () => {
    const config = buildSocialProvidersConfig({
      GOOGLE_CLIENT_ID: 'gid',
      GOOGLE_CLIENT_SECRET: 'gsec',
    })
    expect(config.google).toMatchObject({ clientId: 'gid', clientSecret: 'gsec' })
    expect(typeof config.google?.mapProfileToUser).toBe('function')
    expect(
      listEnabledSocialProviderIds({
        GOOGLE_CLIENT_ID: 'gid',
        GOOGLE_CLIENT_SECRET: 'gsec',
      }),
    ).toEqual(['google'])
  })

  it('does not enable a provider when only client id is set', () => {
    expect(buildSocialProvidersConfig({ GITHUB_CLIENT_ID: 'cid' })).toEqual({})
  })

  it('trims whitespace from credentials', () => {
    const config = buildSocialProvidersConfig({
      GITHUB_CLIENT_ID: '  cid  ',
      GITHUB_CLIENT_SECRET: '  csec  ',
    })
    expect(config.github).toMatchObject({ clientId: 'cid', clientSecret: 'csec' })
    expect(typeof config.github?.mapProfileToUser).toBe('function')
  })
})

describe('mapProfileToUser', () => {
  const googleConfig = buildSocialProvidersConfig({
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsec',
  })
  const githubConfig = buildSocialProvidersConfig({
    GITHUB_CLIENT_ID: 'cid',
    GITHUB_CLIENT_SECRET: 'csec',
  })

  it('maps google given_name/family_name onto firstName/lastName', () => {
    const profile = {
      sub: 'g1',
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      email: 'ada@example.com',
    }
    const mapped = googleConfig.google?.mapProfileToUser(profile)
    expect(mapped).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
  })

  it('omits google name parts that are missing or blank', () => {
    const profile = {
      sub: 'g2',
      name: 'Madonna',
      given_name: '  ',
      email: 'm@example.com',
    }
    const mapped = googleConfig.google?.mapProfileToUser(profile)
    expect(mapped).toEqual({})
  })

  it('splits a github display name into first and last name', () => {
    const profile = {
      id: 1,
      name: 'Ada Byron Lovelace',
      login: 'ada',
      email: 'ada@example.com',
    }
    const mapped = githubConfig.github?.mapProfileToUser(profile)
    expect(mapped).toEqual({ firstName: 'Ada', lastName: 'Byron Lovelace' })
  })

  it('keeps a single-token github display name as firstName only', () => {
    const profile = {
      id: 2,
      name: 'Ada',
      login: 'ada',
      email: 'ada@example.com',
    }
    const mapped = githubConfig.github?.mapProfileToUser(profile)
    expect(mapped).toEqual({ firstName: 'Ada' })
  })

  it('falls back to the github login when no display name is set', () => {
    const profile: { id: number; name: string | null; login: string; email: string } = {
      id: 3,
      name: null,
      login: 'ada-dev',
      email: 'ada@example.com',
    }
    const mapped = githubConfig.github?.mapProfileToUser(profile)
    expect(mapped).toEqual({ firstName: 'ada-dev' })
  })
})
