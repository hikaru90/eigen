import type { DailyDigest } from '$lib/server/memory/daily-summary'
import { renderAgentsHtml, renderDigestText, renderProjectsHtml } from './digest-email-html'
import { OWLERY_TEMPLATES } from '$lib/server/owlery/templates'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  authDbSelectMock,
  isOwleryMailConfiguredMock,
  sendTransactionalEmailMock,
  getDbSelectMock,
} = vi.hoisted(() => ({
  authDbSelectMock: vi.fn(),
  isOwleryMailConfiguredMock: vi.fn(),
  sendTransactionalEmailMock: vi.fn(),
  getDbSelectMock: vi.fn(),
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: {
    OWLERY_API_KEY: 'us_test',
    OWLERY_BASE_URL: 'https://owlery.example',
    OWLERY_EMAIL_FROM: 'hello@eigenmesh.xyz',
    ORIGIN: 'https://eigen.example',
  },
}))

vi.mock('$lib/server/db/auth-db', () => ({
  authDb: { select: authDbSelectMock },
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({ select: getDbSelectMock }),
}))

vi.mock('$lib/server/db/schema', () => ({
  userPreference: { userId: 'user_id', notifyByEmail: 'notify_by_email' },
}))

vi.mock('$lib/server/db/auth.schema', () => ({
  user: { id: 'id', email: 'email' },
}))

vi.mock('$lib/server/owlery/mail', () => ({
  isOwleryMailConfigured: isOwleryMailConfiguredMock,
  sendTransactionalEmail: sendTransactionalEmailMock,
}))

const { queueNotificationEmail, queueDigestEmail } = await import('./notification-email')

function selectReturning(rows: { email?: string }[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  authDbSelectMock.mockReturnValue({ from })
  return { limit, where, from }
}

function preferenceReturning(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  getDbSelectMock.mockReturnValue({ from })
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
    isOwleryMailConfiguredMock.mockReturnValue(true)
    sendTransactionalEmailMock.mockResolvedValue({ emailId: 'em_1' })
    // default: the setting is on (also covers rows that predate the column)
    preferenceReturning([{ notifyByEmail: true }])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-ops when Owlery mail is not configured', async () => {
    isOwleryMailConfiguredMock.mockReturnValue(false)
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

  it('no-ops when the user turned notification emails off — in-app is the channel then', async () => {
    preferenceReturning([{ notifyByEmail: false }])
    selectReturning([{ email: 'user@example.com' }])

    await queueNotificationEmail('u1', PAYLOAD)

    expect(sendTransactionalEmailMock).not.toHaveBeenCalled()
  })

  it('emails when the preference explicitly allows it', async () => {
    preferenceReturning([{ notifyByEmail: true }])
    selectReturning([{ email: 'user@example.com' }])

    await queueNotificationEmail('u1', PAYLOAD)

    expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1)
  })

  it('emails when no preference row exists (the default is on)', async () => {
    preferenceReturning([])
    selectReturning([{ email: 'user@example.com' }])

    await queueNotificationEmail('u1', PAYLOAD)

    expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1)
  })

  it('sends a transactional email with absolute URL and escaped body', async () => {
    preferenceReturning([{ notifyByEmail: true }])
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
    preferenceReturning([{ notifyByEmail: true }])
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

describe('queueDigestEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isOwleryMailConfiguredMock.mockReturnValue(true)
    sendTransactionalEmailMock.mockResolvedValue({ emailId: 'em_1' })
    preferenceReturning([{ notifyByEmail: true }])
  })

  const FULL_DIGEST: DailyDigest = {
    yesterday: { completed: 2, overdue: 0, dueToday: 0 },
    thoughtsFiled: 7,
    tasksDone: 2,
    projects: [],
    projectActivity: {
      mostActive: [{ entityId: 'p1', label: 'Mesh <b>', newThoughts: 1, tasksDone: 1, score: 2 }],
      changes: [],
      needCleanup: {
        stalled: [],
        noNextAction: [],
        overdueTasks: [],
        unthreaded: { count: 0, recent: [] },
      },
    },
    stalled: [],
    unthreaded: { count: 0, recent: [] },
    agents: [],
  }
  const DIGEST = {
    title: 'Daily <x>',
    body: 'A & B\nline 2',
    url: '/summary',
    tag: 'daily-summary-1',
  }

  it('sends via the template with escaped variables and an absolute url', async () => {
    selectReturning([{ email: 'user@example.com' }])

    await queueDigestEmail('u1', DIGEST, FULL_DIGEST)

    expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1)
    const input = sendTransactionalEmailMock.mock.calls[0][1]
    expect(input).toEqual({
      to: 'user@example.com',
      templateId: OWLERY_TEMPLATES.dailyDigest,
      variables: {
        title: 'Daily &lt;x&gt;',
        summary: 'A &amp; B\nline 2',
        url: 'https://eigen.example/summary',
        thoughts_filed: '7',
        tasks_done: '2',
        projects_html: renderProjectsHtml(FULL_DIGEST, 'https://eigen.example'),
        agents_html: renderAgentsHtml(FULL_DIGEST, 'https://eigen.example'),
      },
      text: `Daily <x>\n\nA & B\nline 2\n\nThoughts filed: 7 · Tasks done: 2\n\n${renderDigestText(FULL_DIGEST, 'https://eigen.example')}\n\nOpen: https://eigen.example/summary`,
    })
    const vars = input.variables
    expect(Object.values(vars).every((v) => typeof v === 'string')).toBe(true)
    expect(vars.projects_html).toContain('Mesh &lt;b&gt;')
    expect(vars.projects_html).toContain('https://eigen.example/memory/projects/p1')
    expect(vars.agents_html).toContain('No agent captures in the last 24 hours.')
    expect(input).not.toHaveProperty('html')
    expect(input).not.toHaveProperty('subject')
  })

  it('no-ops when mail is not configured, preference is off, or there is no email', async () => {
    isOwleryMailConfiguredMock.mockReturnValue(false)
    selectReturning([{ email: 'user@example.com' }])
    await queueDigestEmail('u1', DIGEST, FULL_DIGEST)

    isOwleryMailConfiguredMock.mockReturnValue(true)
    preferenceReturning([{ notifyByEmail: false }])
    await queueDigestEmail('u1', DIGEST, FULL_DIGEST)

    preferenceReturning([])
    selectReturning([])
    await queueDigestEmail('u1', DIGEST, FULL_DIGEST)

    expect(sendTransactionalEmailMock).not.toHaveBeenCalled()
  })

  it('logs and swallows send failures', async () => {
    selectReturning([{ email: 'user@example.com' }])
    sendTransactionalEmailMock.mockRejectedValue(new Error('down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(queueDigestEmail('u1', DIGEST, FULL_DIGEST)).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[notification-email]'),
      expect.objectContaining({ userId: 'u1' }),
    )
    errSpy.mockRestore()
  })
})
