import { describe, expect, it } from 'vitest'
import { load } from './+page.server'

/**
 * /thought/[id] authorizes like the other memory pages (e.g. src/routes/memory/
 * projects/[entityId]/+page.server.ts:9-16): no session → /login; a blank id is
 * nothing to show. Both happen before any database work.
 */
describe('thought page load — gates before data', () => {
  it('redirects a signed-out visitor to login', async () => {
    await expect(
      load({ locals: { user: null }, params: { id: 't1' } } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' })
  })

  it('treats a blank id as not found', async () => {
    await expect(
      load({ locals: { user: { id: 'u1' } }, params: { id: '   ' } } as never),
    ).rejects.toMatchObject({ status: 404 })
  })
})
