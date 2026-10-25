import { createRawSnippet } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ThoughtRow from './thought-row.svelte'

/**
 * The shared thought row for Yarn and Threads (ei app.js:737-742 as a
 * component). Behavioral contract (docs/planning/ei-redesign.md, wave 2.2):
 * words in your voice, time, kind chip, thread name, a tick ring only for
 * to-dos, and one explicit open control — rows never open on tap (DESIGN.md
 * "Lists are for reading"). The open control unfolds the row in place; the
 * full page (editing, echoes) stays reachable from the unfolded row's link.
 */

const baseProps = {
  thoughtId: 't1',
  text: 'Call the studio about pricing',
  timeLabel: '11:05',
  openLabel: 'Open this thought',
}

describe('thought-row.svelte', () => {
  it('renders the words, the time and an open control', async () => {
    render(ThoughtRow, { ...baseProps })

    await expect.element(page.getByText('Call the studio about pricing')).toBeInTheDocument()
    await expect.element(page.getByText('11:05')).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Open this thought' }))
      .toBeInTheDocument()
  })

  it('clamps the words to three lines with an ellipsis (the full thought is on its page)', async () => {
    render(ThoughtRow, { ...baseProps, text: 'long '.repeat(400) })
    const words = page.getByTestId('thought-row-text').element() as HTMLElement
    expect(words.className).toContain('line-clamp-3')
  })

  it('the open control unfolds the row in place — no navigation, onopen only from the page link', async () => {
    const onopen = vi.fn()
    render(ThoughtRow, { ...baseProps, onopen, pageLabel: 'Open page' })

    await page.getByText('Call the studio about pricing').click()
    expect(onopen).not.toHaveBeenCalled()

    const open = page.getByRole('button', { name: 'Open this thought' })
    await open.click()
    // unfolded in place: the words unclamp, the control reports expanded, no page open
    const words = page.getByTestId('thought-row-text').element() as HTMLElement
    expect(words.className).not.toContain('line-clamp-3')
    await expect.element(open).toHaveAttribute('aria-expanded', 'true')
    expect(onopen).not.toHaveBeenCalled()

    // the full page stays one tap away, from inside the unfolded row
    await page.getByRole('button', { name: 'Open page' }).click()
    expect(onopen).toHaveBeenCalledTimes(1)

    // folding back
    await open.click()
    const folded = page.getByTestId('thought-row-text').element() as HTMLElement
    expect(folded.className).toContain('line-clamp-3')
    await expect.element(open).toHaveAttribute('aria-expanded', 'false')
  })

  it('without a pageLabel the unfolded row offers no page link (threads: in the flow only)', async () => {
    render(ThoughtRow, baseProps)
    await page.getByRole('button', { name: 'Open this thought' }).click()
    await expect.element(page.getByTestId('thought-row-page')).not.toBeInTheDocument()
  })

  it('the open control is a chevron that turns over when the row unfolds', async () => {
    render(ThoughtRow, baseProps)
    const chevron = page.getByTestId('thought-row-chevron').element() as SVGElement
    expect(chevron.getAttribute('class')).not.toContain('rotate-180')
    await page.getByRole('button', { name: 'Open this thought' }).click()
    expect(chevron.getAttribute('class')).toContain('rotate-180')
  })

  it('shows the kind chip and the thread name when given', async () => {
    render(ThoughtRow, { ...baseProps, kindLabel: 'Task', threadLabel: 'New studio' })

    await expect.element(page.getByText('Task')).toBeInTheDocument()
    await expect.element(page.getByText('New studio')).toBeInTheDocument()
  })

  it('omits chip, thread and tick when they are not given', async () => {
    render(ThoughtRow, { ...baseProps })

    await expect.element(page.getByText('Task')).not.toBeInTheDocument()
    await expect.element(page.getByText('New studio')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Mark done' })).not.toBeInTheDocument()
  })

  it('gives to-dos a tick ring whose pressed state follows done', async () => {
    const ontoggle = vi.fn()
    const { unmount } = render(ThoughtRow, {
      ...baseProps,
      showTick: true,
      done: false,
      tickLabel: 'Mark done',
      ontoggle,
    })

    const tick = page.getByRole('button', { name: 'Mark done' })
    await expect.element(tick).toBeInTheDocument()
    await expect.element(tick).toHaveAttribute('aria-pressed', 'false')

    await tick.click()
    expect(ontoggle).toHaveBeenCalledTimes(1)
    unmount()

    render(ThoughtRow, {
      ...baseProps,
      showTick: true,
      done: true,
      tickLabel: 'Mark done',
      ontoggle,
    })
    await expect
      .element(page.getByRole('button', { name: 'Mark done' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('marks fresh rows so the signal dot can light, and done rows crossed out', async () => {
    const { unmount } = render(ThoughtRow, { ...baseProps, fresh: true })
    await expect.element(page.getByTestId('thought-t1')).toHaveClass('is-fresh')
    unmount()

    render(ThoughtRow, { ...baseProps, showTick: true, done: true, tickLabel: 'Mark done' })
    await expect.element(page.getByTestId('thought-t1')).toHaveClass('is-done')
  })

  it('marks dated rows (a thread shows the day, not the clock) and shows the day label', async () => {
    render(ThoughtRow, { ...baseProps, timeLabel: 'Yesterday', dated: true })

    await expect.element(page.getByTestId('thought-t1')).toHaveClass('dated')
    await expect.element(page.getByText('Yesterday')).toBeInTheDocument()
  })

  it('an unfolded row shows its editor in place (change the thought where you read it); folded, it does not', async () => {
    const editor = createRawSnippet(() => ({ render: () => '<div data-testid="row-editor">editor</div>' }))
    render(ThoughtRow, { ...baseProps, editor })
    await expect.element(page.getByTestId('row-editor')).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Open this thought' }).click()
    await expect.element(page.getByTestId('row-editor')).toBeInTheDocument()
  })
})
