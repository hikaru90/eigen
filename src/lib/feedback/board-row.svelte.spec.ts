import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import BoardRow from './board-row.svelte'
import type { BoardIdea } from './board-types'

const idea = (title: string): BoardIdea => ({
  id: 'i1',
  title,
  kind: 'idea',
  area: 'capture',
  status: 'requested',
  planned: false,
  note: null,
  score: 1,
  myVote: null,
  author: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  shippedAt: null,
  own: false,
}) as BoardIdea

describe('board-row.svelte title', () => {
  it('is capped to three lines with an ellipsis, and a tap opens it fully', async () => {
    render(BoardRow, { idea: idea('word '.repeat(300)) })
    const title = page.getByTestId('idea-title')
    const el = title.element() as HTMLElement
    expect(el.className).toContain('line-clamp-3')
    expect(el.className).not.toMatch(/(^|\s)block(\s|$)/)

    await title.click()
    await expect.element(title).toHaveAttribute('aria-expanded', 'true')
    expect(el.className).not.toContain('line-clamp-3')
  })
})
