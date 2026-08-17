import { describe, expect, it, vi } from 'vitest'
import { createOwleryContact, isOwleryConfigured, resolveOwleryConfig } from './contacts'

const configuredEnv = {
  OWLERY_API_KEY: 'ow_live_test_key',
  OWLERY_BASE_URL: 'https://owlery.example.com',
  OWLERY_CONTACT_BOOK_ID: 'cb_123',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('resolveOwleryConfig', () => {
  it('returns null unless all three env vars are set', () => {
    expect(resolveOwleryConfig({})).toBeNull()
    expect(resolveOwleryConfig({ OWLERY_API_KEY: 'k' })).toBeNull()
    expect(
      resolveOwleryConfig({ OWLERY_API_KEY: 'k', OWLERY_BASE_URL: 'https://x.example' }),
    ).toBeNull()
    expect(
      resolveOwleryConfig({
        OWLERY_API_KEY: 'k',
        OWLERY_BASE_URL: 'https://x.example',
        OWLERY_CONTACT_BOOK_ID: '   ',
      }),
    ).toBeNull()
  })

  it('trims values and strips a trailing slash from the base URL', () => {
    const config = resolveOwleryConfig({
      OWLERY_API_KEY: '  k ',
      OWLERY_BASE_URL: 'https://owlery.example.com/',
      OWLERY_CONTACT_BOOK_ID: ' cb_1 ',
    })
    expect(config).toEqual({
      apiKey: 'k',
      baseUrl: 'https://owlery.example.com',
      contactBookId: 'cb_1',
    })
  })

  it('isOwleryConfigured mirrors config resolution', () => {
    expect(isOwleryConfigured({})).toBe(false)
    expect(isOwleryConfigured(configuredEnv)).toBe(true)
  })
})

describe('createOwleryContact', () => {
  it('posts email, firstName and lastName to the contact book endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { contactId: 'ct_1' }))
    const result = await createOwleryContact(
      configuredEnv,
      { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' },
      fetchMock as unknown as typeof fetch,
    )

    expect(result).toEqual({ contactId: 'ct_1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://owlery.example.com/api/v1/contactBooks/cb_123/contacts')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer ow_live_test_key',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    })
  })

  it('omits lastName from the body when empty', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { contactId: 'ct_2' }))
    await createOwleryContact(
      configuredEnv,
      { email: 'jane@example.com', firstName: 'Jane' },
      fetchMock as unknown as typeof fetch,
    )
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({ email: 'jane@example.com', firstName: 'Jane' })
    expect('lastName' in body).toBe(false)
  })

  it('returns a null contactId when the response omits it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}))
    const result = await createOwleryContact(
      configuredEnv,
      { email: 'jane@example.com', firstName: 'Jane' },
      fetchMock as unknown as typeof fetch,
    )
    expect(result).toEqual({ contactId: null })
  })

  it('throws with status and server message on API failure, without leaking the API key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(422, { message: 'invalid email' }))
    const error = await createOwleryContact(
      configuredEnv,
      { email: 'x', firstName: 'X' },
      fetchMock as unknown as typeof fetch,
    ).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Owlery contact create failed (422): invalid email')
    expect((error as Error).message).not.toContain('ow_live_test_key')
  })

  it('throws with a body excerpt when the error response is not JSON', async () => {
    const fetchMock = vi.fn(async () => new Response('gateway boom', { status: 502 }))
    await expect(
      createOwleryContact(
        configuredEnv,
        { email: 'x', firstName: 'X' },
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow('Owlery contact create failed (502): gateway boom')
  })

  it('throws when Owlery is not configured', async () => {
    await expect(
      createOwleryContact(
        {},
        { email: 'a@b.c', firstName: 'A' },
        vi.fn() as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/Owlery is not configured/)
  })
})
