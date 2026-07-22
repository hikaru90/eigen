import { beforeEach, describe, expect, it, vi } from 'vitest'

const betterAuthMock = vi.fn((config: unknown) => ({ config }))
const drizzleAdapterMock = vi.fn(() => ({ adapter: 'drizzle' }))
const sveltekitCookiesMock = vi.fn(() => ({ plugin: 'cookies' }))
const sendTransactionalEmailMock = vi.fn()
const recordVerificationLinkMock = vi.fn()
const grantStartingFreeCreditsMock = vi.fn()
const resolveAccountKindMock = vi.fn(() => 'production')

const env: Record<string, string | undefined> = {
  ORIGIN: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'secret',
}

vi.mock('better-auth/minimal', () => ({
  betterAuth: betterAuthMock,
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: drizzleAdapterMock,
}))

vi.mock('better-auth/svelte-kit', () => ({
  sveltekitCookies: sveltekitCookiesMock,
}))

vi.mock('$env/dynamic/private', () => ({
  env,
}))

vi.mock('$app/server', () => ({
  getRequestEvent: vi.fn(),
}))

vi.mock('$lib/server/db/auth-db', () => ({
  authDb: {},
}))

vi.mock('$lib/server/email/usesend', () => ({
  isUseSendMailConfigured: (e: Record<string, string | undefined>) =>
    Boolean(
      e.USESEND_API_KEY?.trim() && e.USESEND_BASE_URL?.trim() && e.USESEND_EMAIL_FROM?.trim(),
    ),
  sendTransactionalEmail: (...args: unknown[]) => sendTransactionalEmailMock(...args),
}))

vi.mock('$lib/server/e2e/verification-link-store', () => ({
  recordVerificationLink: (...args: unknown[]) => recordVerificationLinkMock(...args),
}))

vi.mock('$lib/auth/account-kind', () => ({
  resolveAccountKindForNewUser: (...args: unknown[]) => resolveAccountKindMock(...args),
}))

vi.mock('$lib/server/billing/wallet', () => ({
  grantStartingFreeCredits: (...args: unknown[]) => grantStartingFreeCreditsMock(...args),
}))

function clearMailEnv() {
  delete env.USESEND_API_KEY
  delete env.USESEND_BASE_URL
  delete env.USESEND_EMAIL_FROM
  delete env.GITHUB_CLIENT_ID
  delete env.GITHUB_CLIENT_SECRET
  delete env.GOOGLE_CLIENT_ID
  delete env.GOOGLE_CLIENT_SECRET
}

async function loadAuth() {
  vi.resetModules()
  betterAuthMock.mockClear()
  drizzleAdapterMock.mockClear()
  sveltekitCookiesMock.mockClear()
  sendTransactionalEmailMock.mockReset()
  recordVerificationLinkMock.mockReset()
  grantStartingFreeCreditsMock.mockReset()
  resolveAccountKindMock.mockReset()
  resolveAccountKindMock.mockReturnValue('production')
  sendTransactionalEmailMock.mockResolvedValue(undefined)
  grantStartingFreeCreditsMock.mockResolvedValue(undefined)
  return import('./auth')
}

type AuthConfig = {
  emailVerification?: {
    sendVerificationEmail: (input: { user: { email: string }; url: string }) => Promise<void>
  }
  emailAndPassword: {
    requireEmailVerification: boolean
    sendResetPassword?: (input: { user: { email: string }; url: string }) => Promise<void>
  }
  user: {
    changeEmail: {
      updateEmailWithoutVerification: boolean
      sendChangeEmailConfirmation?: (input: {
        user: { email: string }
        newEmail: string
        url: string
      }) => Promise<void>
    }
  }
  socialProviders?: Record<string, unknown>
  account?: { accountLinking: { enabled: boolean; trustedProviders: string[] } }
  databaseHooks: {
    user: {
      create: {
        before: (user: { email?: string }) => Promise<{ data: Record<string, unknown> }>
        after: (user: { id: string }) => Promise<void>
      }
    }
  }
}

function lastConfig(): AuthConfig {
  expect(betterAuthMock).toHaveBeenCalled()
  return betterAuthMock.mock.calls[0][0] as AuthConfig
}

describe('auth config', () => {
  beforeEach(() => {
    clearMailEnv()
    env.ORIGIN = 'http://localhost:5173'
    env.BETTER_AUTH_SECRET = 'secret'
  })

  it('constructs better-auth without verification mailer when useSend unset', async () => {
    const mod = await loadAuth()
    expect(mod.auth).toBeDefined()
    expect(betterAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: mod.normalizeAuthOrigin(env.ORIGIN),
        secret: env.BETTER_AUTH_SECRET,
        emailAndPassword: expect.objectContaining({
          enabled: true,
          requireEmailVerification: false,
        }),
        user: expect.objectContaining({
          changeEmail: expect.objectContaining({
            enabled: true,
            updateEmailWithoutVerification: true,
          }),
        }),
      }),
    )
    const config = lastConfig()
    expect(config.emailVerification).toBeUndefined()
    expect(config.emailAndPassword.sendResetPassword).toBeUndefined()
    expect(config.user.changeEmail.sendChangeEmailConfirmation).toBeUndefined()
  })

  it('enables verification mailers when useSend is configured', async () => {
    env.USESEND_API_KEY = 'key'
    env.USESEND_BASE_URL = 'https://mail.example'
    env.USESEND_EMAIL_FROM = 'noreply@example.com'

    await loadAuth()
    const config = lastConfig()
    expect(config.emailAndPassword.requireEmailVerification).toBe(true)
    expect(config.user.changeEmail.updateEmailWithoutVerification).toBe(false)
    expect(config.emailVerification).toBeDefined()
    expect(typeof config.emailAndPassword.sendResetPassword).toBe('function')
    expect(typeof config.user.changeEmail.sendChangeEmailConfirmation).toBe('function')
  })

  it('queues reset-password email via sendResetPassword', async () => {
    env.USESEND_API_KEY = 'key'
    env.USESEND_BASE_URL = 'https://mail.example'
    env.USESEND_EMAIL_FROM = 'noreply@example.com'

    await loadAuth()
    const config = lastConfig()
    await config.emailAndPassword.sendResetPassword!({
      user: { email: 'a@b.com' },
      url: 'https://app/reset?token=1',
    })
    await vi.waitFor(() => expect(sendTransactionalEmailMock).toHaveBeenCalled())
    expect(sendTransactionalEmailMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        to: 'a@b.com',
        subject: 'Reset your Eigen password',
        text: expect.stringContaining('https://app/reset?token=1'),
      }),
    )
  })

  it('records verification link and queues verify email', async () => {
    env.USESEND_API_KEY = 'key'
    env.USESEND_BASE_URL = 'https://mail.example'
    env.USESEND_EMAIL_FROM = 'noreply@example.com'

    await loadAuth()
    const config = lastConfig()
    await config.emailVerification!.sendVerificationEmail({
      user: { email: 'v@b.com' },
      url: 'https://app/verify?token=2',
    })
    expect(recordVerificationLinkMock).toHaveBeenCalledWith('v@b.com', 'https://app/verify?token=2')
    await vi.waitFor(() => expect(sendTransactionalEmailMock).toHaveBeenCalled())
    expect(sendTransactionalEmailMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        to: 'v@b.com',
        subject: 'Verify your Eigen email',
      }),
    )
  })

  it('queues change-email confirmation', async () => {
    env.USESEND_API_KEY = 'key'
    env.USESEND_BASE_URL = 'https://mail.example'
    env.USESEND_EMAIL_FROM = 'noreply@example.com'

    await loadAuth()
    const config = lastConfig()
    await config.user.changeEmail.sendChangeEmailConfirmation!({
      user: { email: 'old@b.com' },
      newEmail: 'new@b.com',
      url: 'https://app/change?token=3',
    })
    await vi.waitFor(() => expect(sendTransactionalEmailMock).toHaveBeenCalled())
    expect(sendTransactionalEmailMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        to: 'old@b.com',
        subject: 'Confirm your Eigen email change',
        html: expect.stringContaining('new@b.com'),
      }),
    )
  })

  it('logs when transactional email fails without throwing', async () => {
    env.USESEND_API_KEY = 'key'
    env.USESEND_BASE_URL = 'https://mail.example'
    env.USESEND_EMAIL_FROM = 'noreply@example.com'
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await loadAuth()
    sendTransactionalEmailMock.mockRejectedValue(new Error('smtp down'))
    const config = lastConfig()
    await config.emailAndPassword.sendResetPassword!({
      user: { email: 'a@b.com' },
      url: 'https://app/reset',
    })
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled())
    expect(errSpy).toHaveBeenCalledWith(
      '[auth] transactional email failed',
      expect.objectContaining({ to: 'a@b.com', error: 'smtp down' }),
    )
    errSpy.mockRestore()
  })

  it('enables social providers and account linking when credentials set', async () => {
    env.GITHUB_CLIENT_ID = 'gh-id'
    env.GITHUB_CLIENT_SECRET = 'gh-secret'

    await loadAuth()
    const config = lastConfig()
    expect(config.socialProviders).toEqual({
      github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
    })
    expect(config.account?.accountLinking).toEqual({
      enabled: true,
      trustedProviders: ['github'],
    })
  })

  it('databaseHooks before sets accountKind from resolver', async () => {
    await loadAuth()
    resolveAccountKindMock.mockReturnValue('eval')
    const config = lastConfig()
    const result = await config.databaseHooks.user.create.before({ email: 'x@y.com' })
    expect(resolveAccountKindMock).toHaveBeenCalledWith('x@y.com')
    expect(result.data.accountKind).toBe('eval')
  })

  it('databaseHooks after grants starting credits', async () => {
    await loadAuth()
    const config = lastConfig()
    await config.databaseHooks.user.create.after({ id: 'user-1' })
    expect(grantStartingFreeCreditsMock).toHaveBeenCalledWith('user-1')
  })

  it('databaseHooks after logs credit grant failures', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await loadAuth()
    grantStartingFreeCreditsMock.mockRejectedValue(new Error('wallet down'))
    const config = lastConfig()
    await config.databaseHooks.user.create.after({ id: 'user-2' })
    expect(errSpy).toHaveBeenCalledWith(
      '[auth] failed to grant starting free credits',
      expect.objectContaining({ userId: 'user-2', error: 'wallet down' }),
    )
    errSpy.mockRestore()
  })
})

describe('normalizeAuthOrigin', () => {
  beforeEach(() => {
    clearMailEnv()
    env.ORIGIN = 'http://localhost:5173'
    env.BETTER_AUTH_SECRET = 'secret'
  })

  it('prepends https for bare hostnames', async () => {
    const { normalizeAuthOrigin } = await loadAuth()
    expect(normalizeAuthOrigin('eigen.stackstack.de')).toBe('https://eigen.stackstack.de')
  })

  it('leaves full http URLs unchanged aside from trailing slash strip', async () => {
    const { normalizeAuthOrigin } = await loadAuth()
    expect(normalizeAuthOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('strips trailing slash from https URLs', async () => {
    const { normalizeAuthOrigin } = await loadAuth()
    expect(normalizeAuthOrigin('https://app.example.com/')).toBe('https://app.example.com')
  })

  it('throws when missing', async () => {
    const { normalizeAuthOrigin } = await loadAuth()
    expect(() => normalizeAuthOrigin(undefined)).toThrow(/ORIGIN is not set/)
  })

  it('throws when blank', async () => {
    const { normalizeAuthOrigin } = await loadAuth()
    expect(() => normalizeAuthOrigin('   ')).toThrow(/ORIGIN is not set/)
  })

  it('throws for invalid URL after scheme prepend', async () => {
    const { normalizeAuthOrigin } = await loadAuth()
    expect(() => normalizeAuthOrigin('http://[::')).toThrow(/ORIGIN is not a valid URL/)
  })
})
