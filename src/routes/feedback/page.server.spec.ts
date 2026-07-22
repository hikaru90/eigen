import { describe, expect, it } from 'vitest'
import { load } from './+page.server'

describe('feedback page server load', () => {
  it('redirects unauthenticated users to login', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it('returns user without throwing when authenticated', async () => {
    const user = { id: 'u1', email: 'a@b.c' }
    const result = await load({ locals: { user } } as never)

    expect(result).toEqual({ user })
  })
})
