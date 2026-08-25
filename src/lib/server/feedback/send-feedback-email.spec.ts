import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isUseSendMailConfiguredMock, sendTransactionalEmailMock } = vi.hoisted(() => ({
  isUseSendMailConfiguredMock: vi.fn(),
  sendTransactionalEmailMock: vi.fn(),
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: {
    USESEND_API_KEY: 'us_test',
    USESEND_BASE_URL: 'https://usesend.example',
    USESEND_EMAIL_FROM: 'Eigen Mesh <hello@eigenmesh.xyz>',
  },
}))

vi.mock('$lib/server/email/usesend', () => ({
  isUseSendMailConfigured: isUseSendMailConfiguredMock,
  sendTransactionalEmail: sendTransactionalEmailMock,
}))

const { FEEDBACK_INBOX_EMAIL, assertFeedbackMailConfigured, sendFeedbackInboxEmail } =
  await import('./send-feedback-email')

describe('sendFeedbackInboxEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isUseSendMailConfiguredMock.mockReturnValue(true)
    sendTransactionalEmailMock.mockResolvedValue({ emailId: 'em_fb' })
  })

  it('exposes the product inbox address', () => {
    expect(FEEDBACK_INBOX_EMAIL).toBe('feedback@eigenmesh.xyz')
  })

  it('assertFeedbackMailConfigured throws when useSend is off', () => {
    isUseSendMailConfiguredMock.mockReturnValue(false)
    expect(() => assertFeedbackMailConfigured()).toThrow(/not configured/i)
  })

  it('sends to feedback@eigenmesh.xyz with replyTo and escaped body', async () => {
    await sendFeedbackInboxEmail({
      feedbackId: 'fb-1',
      userId: 'u1',
      userEmail: 'alex@example.com',
      message: 'Hello <b>world</b> & thanks',
    })

    expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1)
    const [, input] = sendTransactionalEmailMock.mock.calls[0]
    expect(input.to).toBe('feedback@eigenmesh.xyz')
    expect(input.replyTo).toBe('alex@example.com')
    expect(input.subject).toContain('Product feedback')
    expect(input.text).toContain('Hello <b>world</b> & thanks')
    expect(input.text).toContain('alex@example.com')
    expect(input.text).toContain('u1')
    expect(input.text).toContain('fb-1')
    expect(input.html).toContain('Hello &lt;b&gt;world&lt;/b&gt; &amp; thanks')
    expect(input.html).not.toContain('<b>world</b>')
  })

  it('propagates send failures (no silent swallow)', async () => {
    sendTransactionalEmailMock.mockRejectedValue(new Error('useSend down'))
    await expect(
      sendFeedbackInboxEmail({
        feedbackId: 'fb-1',
        userId: 'u1',
        userEmail: 'alex@example.com',
        message: 'hi',
      }),
    ).rejects.toThrow(/useSend down/)
  })
})
