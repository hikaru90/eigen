import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authDbSelectMock, isUseSendMailConfiguredMock, sendTransactionalEmailMock } = vi.hoisted(
  () => ({
    authDbSelectMock: vi.fn(),
    isUseSendMailConfiguredMock: vi.fn(),
    sendTransactionalEmailMock: vi.fn(),
  }),
)

vi.mock('$lib/server/env/private-env', () => ({
  env: {
    USESEND_API_KEY: 'us_test',
    USESEND_BASE_URL: 'https://usesend.example',
    USESEND_EMAIL_FROM: 'hello@eigenmesh.xyz',
    ORIGIN: 'https://eigen.example',
  },
}))

vi.mock('$lib/server/db/auth-db', () => ({
  authDb: { select: authDbSelectMock },
}))

vi.mock('$lib/server/db/auth.schema', () => ({
  user: { id: 'id', email: 'email' },
}))

vi.mock('$lib/server/email/usesend', () => ({
  isUseSendMailConfigured: isUseSendMailConfiguredMock,
  sendTransactionalEmail: sendTransactionalEmailMock,
}))

const { queueNotificationEmail } = await import('./notification-email')

function selectReturning(rows: { email?: string }[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  authDbSelectMock.mockReturnValue({ from })
  return { limit, where, from }
}

const PAYLOAD = {
  title: 'Appointment',
  body: 'In 30 min · Dentist',
  url: '/memory/timeline?event=te1',
  tag: 'event-te1-30',
}

describe('queueNotificationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isUseSendMailConfiguredMock.mockReturnValue(true)
    sendTransactionalEmailMock.mockResolvedValue({ emailId: 'em_1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-ops when useSend is not configured', async () => {
    isUseSendMailConfiguredMock.mockReturnValue(false)
    selectReturning([])

    await queueNotificationEmail('u1', PAYLOAD)

    expect(authDbSelectMock).not.toHaveBeenCalled()
    expect(sendTransactionalEmailMock).not.toHaveBeenCalled()
  })

  it('no-ops when the user has no email row', async () => {
    selectReturning([])

    await queueNotificationEmail('u1', PAYLOAD)

    expect(sendTransactionalEmailMock).not.toHaveBeenCalled()
  })

  it('sends a transactional email with absolute URL and escaped body', async () => {
    selectReturning([{ email: 'user@example.com' }])

    await queueNotificationEmail('u1', {
      title: 'Daily',
      body: 'A <b>summary</b> & more',
      url: '/memory/timeline',
      tag: 'daily-summary-2026-01-01',
    })

    expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1)
    const [envArg, input] = sendTransactionalEmailMock.mock.calls[0]
    expect(input.to).toBe('user@example.com')
    expect(input.subject).toBe('[Eigen] Daily')
    expect(input.text).toContain('Open: https://eigen.example/memory/timeline')
    expect(input.html).toContain('https://eigen.example/memory/timeline')
    expect(input.html).toContain('A &lt;b&gt;summary&lt;/b&gt; &amp; more')
    expect(envArg).toBeDefined()
  })

  it('logs and swallows send failures (best-effort, never throws)', async () => {
    selectReturning([{ email: 'user@example.com' }])
    sendTransactionalEmailMock.mockRejectedValue(new Error('smtp down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(queueNotificationEmail('u1', PAYLOAD)).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[notification-email]'),
      expect.objectContaining({ userId: 'u1', to: 'user@example.com' }),
    )
    errSpy.mockRestore()
  })

  it('keeps already-absolute URLs unchanged', async () => {
    selectReturning([{ email: 'user@example.com' }])

    await queueNotificationEmail('u1', { title: 'T', body: 'B', url: 'https://other.example/x' })

    const input = sendTransactionalEmailMock.mock.calls[0][1]
    expect(input.text).toContain('Open: https://other.example/x')
  })
})
