import { describe, expect, it } from 'vitest'
import { load } from './+page.server'

describe('graph legacy redirect', () => {
  it('redirects /graph to /memory', async () => {
    await expect(
      load({ locals: { user: { id: 'u1' } }, url: new URL('http://localhost/graph') } as never),
    ).rejects.toMatchObject({ status: 302, location: '/memory' })
  })

  it('redirects legacy temporal tab to /memory/timeline', async () => {
    await expect(
      load({
        locals: { user: { id: 'u1', email: 'a@b.c' } },
        url: new URL('http://localhost/graph?tab=temporal&event=ev1'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/memory/timeline?event=ev1' })
  })

  it('preserves thought deep link on redirect', async () => {
    await expect(
      load({
        locals: { user: { id: 'u1' } },
        url: new URL('http://localhost/graph?thought=t1'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/memory?thought=t1' })
  })
})
