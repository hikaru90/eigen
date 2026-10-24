import { beforeEach, describe, expect, it, vi } from 'vitest'
import { load } from './+page.server'

const { prefRows } = vi.hoisted(() => ({ prefRows: { value: [] as { preferredLanguage: string }[] } }))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => prefRows.value }) }),
    }),
  }),
}))

describe('feedback page server load', () => {
  beforeEach(() => {
    prefRows.value = []
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it("returns the user and their preferred language for the composer's voice input", async () => {
    prefRows.value = [{ preferredLanguage: 'de' }]
    const user = { id: 'u1', email: 'a@b.c' }
    const result = await load({ locals: { user } } as never)

    expect(result).toEqual({ user, preferredLanguage: 'de' })
  })
})
