import { describe, expect, it } from 'vitest'
import { load } from './+page.server'

/**
 * /memory left the chrome with the ei redesign (docs/planning/ei-redesign.md,
 * decision 1): the hub is /mesh now. The old graph page is gone, so the load
 * must redirect on the server — before any graph prefetch — instead of
 * rendering and bouncing client-side.
 */
describe('memory legacy redirect', () => {
  it('redirects unauthenticated user to login', async () => {
    await expect(
      load({ locals: { user: null }, url: new URL('http://localhost/memory') } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' })
  })

  it('redirects signed-in user to the mesh hub', async () => {
    await expect(
      load({ locals: { user: { id: 'u1' } }, url: new URL('http://localhost/memory') } as never),
    ).rejects.toMatchObject({ status: 302, location: '/mesh' })
  })

  it('hands a thought deep link to the thought page', async () => {
    await expect(
      load({
        locals: { user: { id: 'u1' } },
        url: new URL('http://localhost/memory?thought=t1'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/thought/t1' })
  })

  it('encodes the thought id on the way through', async () => {
    await expect(
      load({
        locals: { user: { id: 'u1' } },
        url: new URL('http://localhost/memory?thought=a%2Fb%20c'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/thought/a%2Fb%20c' })
  })

  it('drops retired view params (graph / embeddings have no nav home)', async () => {
    await expect(
      load({
        locals: { user: { id: 'u1' } },
        url: new URL('http://localhost/memory?view=embeddings'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/mesh' })
  })

  it('does not follow an empty thought param', async () => {
    await expect(
      load({
        locals: { user: { id: 'u1' } },
        url: new URL('http://localhost/memory?thought='),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/mesh' })
  })
})
