import { describe, expect, it } from 'vitest'
import { load } from './+page.server'

describe('timeline legacy redirect', () => {
  it('redirects /timeline to /memory/timeline', async () => {
    await expect(
      load({ locals: { user: { id: 'u1' } }, url: new URL('http://localhost/timeline') } as never),
    ).rejects.toMatchObject({ status: 302, location: '/memory/timeline' })
  })

  it('preserves event deep link', async () => {
    await expect(
      load({
        locals: { user: { id: 'u1' } },
        url: new URL('http://localhost/timeline?event=ev1'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/memory/timeline?event=ev1' })
  })
})
