import { describe, expect, it } from 'vitest'
import {
  isOwleryContactBookConfigured,
  isOwleryMailConfigured,
  resolveOwleryContactBookConfig,
  resolveOwleryMailConfig,
} from './config'

const mailEnv = {
  OWLERY_API_KEY: 'us_test',
  OWLERY_BASE_URL: 'https://owlery.example',
  OWLERY_EMAIL_FROM: 'hello@eigenmesh.xyz',
}

const contactBookEnv = {
  ...mailEnv,
  OWLERY_CONTACT_BOOK_ID: 'aa44e40b69a24ab88cedffcd',
}

describe('resolveOwleryMailConfig', () => {
  it('returns null unless mail env vars are set', () => {
    expect(resolveOwleryMailConfig({})).toBeNull()
    expect(resolveOwleryMailConfig({ OWLERY_API_KEY: 'k' })).toBeNull()
    expect(
      resolveOwleryMailConfig({
        OWLERY_API_KEY: 'k',
        OWLERY_BASE_URL: 'https://x.example',
      }),
    ).toBeNull()
  })

  it('trims values and strips a trailing slash from the base URL', () => {
    expect(
      resolveOwleryMailConfig({
        OWLERY_API_KEY: '  k ',
        OWLERY_BASE_URL: 'https://owlery.example/',
        OWLERY_EMAIL_FROM: ' hello@eigenmesh.xyz ',
      }),
    ).toEqual({
      apiKey: 'k',
      baseUrl: 'https://owlery.example',
      from: 'hello@eigenmesh.xyz',
    })
  })

  it('isOwleryMailConfigured mirrors mail config resolution', () => {
    expect(isOwleryMailConfigured({})).toBe(false)
    expect(isOwleryMailConfigured(mailEnv)).toBe(true)
  })
})

describe('resolveOwleryContactBookConfig', () => {
  it('returns null without contact book id even when mail is configured', () => {
    expect(resolveOwleryContactBookConfig(mailEnv)).toBeNull()
    expect(
      resolveOwleryContactBookConfig({
        ...mailEnv,
        OWLERY_CONTACT_BOOK_ID: '   ',
      }),
    ).toBeNull()
  })

  it('includes contact book id when all four vars are set', () => {
    expect(resolveOwleryContactBookConfig(contactBookEnv)).toEqual({
      apiKey: 'us_test',
      baseUrl: 'https://owlery.example',
      from: 'hello@eigenmesh.xyz',
      contactBookId: 'aa44e40b69a24ab88cedffcd',
    })
  })

  it('isOwleryContactBookConfigured mirrors contact book config resolution', () => {
    expect(isOwleryContactBookConfigured(mailEnv)).toBe(false)
    expect(isOwleryContactBookConfigured(contactBookEnv)).toBe(true)
  })
})
