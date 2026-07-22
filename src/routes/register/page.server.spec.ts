import { describe, expect, it } from 'vitest'
import { load } from './+page.server'

describe('register page server', () => {
  it('redirects to signup preserving query string', () => {
    const url = new URL('http://localhost/register?plan=managed')
    expect(() => load({ url, locals: { user: null } } as never)).toThrow()
    try {
      load({ url, locals: { user: null } } as never)
    } catch (e) {
      expect(e).toMatchObject({
        status: 302,
        location: '/signup?plan=managed',
      })
    }
  })

  it('redirects to signup without query when none present', () => {
    const url = new URL('http://localhost/register')
    try {
      load({ url, locals: { user: null } } as never)
    } catch (e) {
      expect(e).toMatchObject({
        status: 302,
        location: '/signup',
      })
    }
  })
})
