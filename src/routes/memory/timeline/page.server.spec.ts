import { describe, expect, it } from 'vitest'
import { load } from './+page.server'

describe('memory/timeline legacy redirect', () => {
  it('redirects /memory/timeline to /memory/tasks', async () => {
    await expect(
      load({
        url: new URL('http://localhost/memory/timeline'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/memory/tasks' })
  })

  it('preserves query string on redirect', async () => {
    await expect(
      load({
        url: new URL('http://localhost/memory/timeline?event=ev1&segment=overdue'),
      } as never),
    ).rejects.toMatchObject({
      status: 302,
      location: '/memory/tasks?event=ev1&segment=overdue',
    })
  })
})
