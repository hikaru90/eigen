import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ThoughtRow from './thought-row.svelte'

/**
 * The shared thought row for Yarn (and later Threads + the thought page):
 * ei app.js:737-742 as a component. Behavioral contract (docs/planning/
 * ei-redesign.md, wave 2.2): words in your voice, time, kind chip, thread
 * name, a tick ring only for to-dos, and one explicit open control — rows
 * never open on tap (DESIGN.md "Lists are for reading").
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

  it('never opens on tap — only the open control opens', async () => {
    const onopen = vi.fn()
    render(ThoughtRow, { ...baseProps, onopen })

    await page.getByText('Call the studio about pricing').click()
    expect(onopen).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'Open this thought' }).click()
    expect(onopen).toHaveBeenCalledTimes(1)
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
})
