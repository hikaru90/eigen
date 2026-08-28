import { describe, expect, it, vi } from 'vitest'
import {
  isOwleryMailConfigured,
  resolveOwleryMailConfig,
  sendTransactionalEmail,
} from './mail'

describe('resolveOwleryMailConfig', () => {
  it('returns null when any required env is missing', () => {
    expect(resolveOwleryMailConfig({})).toBeNull()
    expect(
      resolveOwleryMailConfig({
        OWLERY_API_KEY: 'us_x',
        OWLERY_BASE_URL: 'https://owlery.example',
      }),
    ).toBeNull()
    expect(isOwleryMailConfigured({})).toBe(false)
  })

  it('strips trailing slash from base URL', () => {
    expect(
      resolveOwleryMailConfig({
        OWLERY_API_KEY: 'us_x',
        OWLERY_BASE_URL: 'https://owlery.example/',
        OWLERY_EMAIL_FROM: 'hello@eigenmesh.xyz',
      }),
    ).toEqual({
      apiKey: 'us_x',
      baseUrl: 'https://owlery.example',
      from: 'hello@eigenmesh.xyz',
    })
  })
})

describe('sendTransactionalEmail', () => {
  it('throws when mail is not configured', async () => {
    await expect(
      sendTransactionalEmail({}, { to: 'a@b.co', subject: 's', html: '<p>x</p>', text: 'x' }),
    ).rejects.toThrow(/not configured/)
  })

  it('POSTs to Owlery /api/v1/emails with Bearer auth', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ emailId: 'em_1' }), { status: 200 }),
    )

    const result = await sendTransactionalEmail(
      {
        OWLERY_API_KEY: 'us_test',
        OWLERY_BASE_URL: 'https://owlery.example',
        OWLERY_EMAIL_FROM: 'hello@eigenmesh.xyz',
      },
      {
        to: 'user@example.com',
        subject: 'Reset your Eigen password',
        html: '<p>link</p>',
        text: 'link',
      },
      fetchImpl as unknown as typeof fetch,
    )

    expect(result).toEqual({ emailId: 'em_1' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://owlery.example/api/v1/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer us_test',
        },
      }),
    )
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({
      to: 'user@example.com',
      from: 'hello@eigenmesh.xyz',
      subject: 'Reset your Eigen password',
      html: '<p>link</p>',
      text: 'link',
    })
  })

  it('includes replyTo when provided', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ emailId: 'em_2' }), { status: 200 }),
    )

    await sendTransactionalEmail(
      {
        OWLERY_API_KEY: 'us_test',
        OWLERY_BASE_URL: 'https://owlery.example',
        OWLERY_EMAIL_FROM: 'hello@eigenmesh.xyz',
      },
      {
        to: 'feedback@eigenmesh.xyz',
        replyTo: 'user@example.com',
        subject: 'Product feedback',
        html: '<p>hi</p>',
        text: 'hi',
      },
      fetchImpl as unknown as typeof fetch,
    )

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(body.replyTo).toBe('user@example.com')
  })

  it('throws with API error detail on non-OK response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ message: 'domain not verified' }), { status: 400 }),
    )

    await expect(
      sendTransactionalEmail(
        {
          OWLERY_API_KEY: 'us_test',
          OWLERY_BASE_URL: 'https://owlery.example',
          OWLERY_EMAIL_FROM: 'hello@eigenmesh.xyz',
        },
        { to: 'a@b.co', subject: 's', html: 'h', text: 't' },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/domain not verified/)
  })
})
