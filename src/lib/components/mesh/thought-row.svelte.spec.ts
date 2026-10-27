import { createRawSnippet } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ThoughtRow from './thought-row.svelte'

/**
 * The shared thought row for Yarn and Threads. Contract: the words on their own
 * (tick ring only for to-dos), then one pill line — time, type, thread, edit
 * words, related thoughts — always visible; no unfold, no chevron.
 */

const baseProps = {
  thoughtId: 't1',
  text: 'Call the studio about pricing',
  timeLabel: '11:05',
}

const editor = createRawSnippet(() => ({
  render: () =>
    '<span style="display:contents"><span data-testid="row-type">Task</span><span data-testid="row-thread">Studio</span><button data-testid="row-edit">Edit</button></span>',
}))

const related = [
  { id: 'r1', text: 'Book the studio', dateLabel: 'Yesterday', href: '/thought/r1' },
  { id: 'r2', text: 'Studio rent', dateLabel: '2 Oct', href: '/thought/r2' },
]

const follows = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('thought-row.svelte', () => {
  it('shows the words and the time without any click, and has no chevron or unfold', async () => {
    render(ThoughtRow, { ...baseProps })

    await expect.element(page.getByText('Call the studio about pricing')).toBeInTheDocument()
    await expect.element(page.getByText('11:05')).toBeInTheDocument()
    await expect.element(page.getByTestId('thought-row-chevron')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-expanded]')).toBeNull()
  })

  it('clamps only the words paragraph to three lines; the time is not in it', async () => {
    render(ThoughtRow, { ...baseProps, text: 'long '.repeat(400) })
    const words = page.getByTestId('thought-row-text').element() as HTMLElement
    expect(words.className).toContain('line-clamp-3')
    expect(words.querySelector('time')).toBeNull()
    expect(words.className).not.toContain('border-l')
  })

  it('puts the pill line (with the bar) after the words paragraph, time pill first, not a superscript', async () => {
    render(ThoughtRow, { ...baseProps, editor, relatedLabel: 'Related thoughts', related })
    const words = page.getByTestId('thought-row-text').element()
    const line = page.getByTestId('thought-row-pills').element() as HTMLElement
    expect(line.className).toContain('border-l-[3px]')
    expect(line.className).toContain('flex-wrap')
    expect(words.contains(line)).toBe(false)
    expect(follows(words, line)).toBe(true)

    const time = page.getByTestId('thought-row-time').element() as HTMLElement
    expect(time.className).not.toContain('align-super')
    expect(time.className).toContain('tabular-nums')
    const order = [
      'thought-row-time',
      'row-type',
      'row-thread',
      'row-edit',
      'thought-row-related-toggle',
    ].map((id) => line.querySelector(`[data-testid="${id}"]`) as Element)
    order.forEach((el) => expect(el).not.toBeNull())
    for (let i = 0; i < order.length - 1; i++) expect(follows(order[i], order[i + 1])).toBe(true)
  })

  it('the related-thoughts pill toggles the list in flow below the pill line; items link to their thought page', async () => {
    render(ThoughtRow, { ...baseProps, relatedLabel: 'Related thoughts', related })
    const toggle = page.getByTestId('thought-row-related-toggle')
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect.element(page.getByTestId('thought-row-related')).not.toBeInTheDocument()
    const chevron = page.getByTestId('thought-row-related-chevron').element()
    expect(chevron.getAttribute('class')).not.toContain('rotate-180')

    await toggle.click()
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(chevron.getAttribute('class')).toContain('rotate-180')
    const list = page.getByTestId('thought-row-related').element()
    const line = page.getByTestId('thought-row-pills').element()
    expect(line.contains(list)).toBe(false)
    expect(follows(line, list)).toBe(true)
    expect(page.getByTestId('thought-t1').element().contains(list)).toBe(true)
    const items = Array.from(list.querySelectorAll('a'))
    expect(items.map((a) => a.getAttribute('href'))).toEqual(['/thought/r1', '/thought/r2'])
    expect(items[0].textContent).toContain('Book the studio')
    expect(items[0].textContent).toContain('Yesterday')

    await toggle.click()
    await expect.element(page.getByTestId('thought-row-related')).not.toBeInTheDocument()
  })

  it('has no related-thoughts pill when there are none', async () => {
    render(ThoughtRow, { ...baseProps, relatedLabel: 'Related thoughts', related: [] })
    await expect.element(page.getByTestId('thought-row-related-toggle')).not.toBeInTheDocument()
  })

  it('only the type pill is uppercase; time, thread, edit and related are normal case', async () => {
    render(ThoughtRow, {
      ...baseProps,
      kindLabel: 'Task',
      threadLabel: 'New studio',
      relatedLabel: 'Related thoughts',
      related,
    })
    const [type, thread] = Array.from(document.querySelectorAll('[data-testid="thought-row-pill"]'))
    expect(type.className).toContain('uppercase')
    for (const el of [
      thread,
      page.getByTestId('thought-row-time').element(),
      page.getByTestId('thought-row-related-toggle').element(),
    ]) {
      expect(el.className).not.toContain('uppercase')
      expect(el.className).not.toContain('tracking-')
    }
  })

  it('without an editor, type and thread show as plain data pills after the time', async () => {
    render(ThoughtRow, { ...baseProps, kindLabel: 'Task', threadLabel: 'New studio' })
    const pills = Array.from(document.querySelectorAll('[data-testid="thought-row-pill"]'))
    expect(pills.map((p) => p.textContent)).toEqual(['Task', 'New studio'])
    expect(pills[0].className).toContain('uppercase')
    expect(follows(page.getByTestId('thought-row-time').element(), pills[0])).toBe(true)
  })

  it('with an editor, the plain type/thread pills are not duplicated', async () => {
    render(ThoughtRow, { ...baseProps, kindLabel: 'Task', threadLabel: 'New studio', editor })
    await expect.element(page.getByTestId('thought-row-pill')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('row-type')).toBeInTheDocument()
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
    await expect.element(tick).toHaveAttribute('aria-pressed', 'false')
    await tick.click()
    expect(ontoggle).toHaveBeenCalledTimes(1)
    unmount()

    render(ThoughtRow, { ...baseProps, showTick: true, done: true, tickLabel: 'Mark done' })
    await expect
      .element(page.getByRole('button', { name: 'Mark done' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('omits the tick for non-to-dos', async () => {
    render(ThoughtRow, { ...baseProps })
    await expect.element(page.getByRole('button', { name: 'Mark done' })).not.toBeInTheDocument()
  })

  it('fresh rows light the signal dot inside the time pill; done rows are crossed out', async () => {
    const { unmount } = render(ThoughtRow, { ...baseProps, fresh: true })
    await expect.element(page.getByTestId('thought-t1')).toHaveClass('is-fresh')
    const time = page.getByTestId('thought-row-time').element()
    expect(time.contains(page.getByTestId('thought-row-fresh').element())).toBe(true)
    unmount()

    render(ThoughtRow, { ...baseProps, showTick: true, done: true, tickLabel: 'Mark done' })
    await expect.element(page.getByTestId('thought-t1')).toHaveClass('is-done')
  })

  it('shows a day label in the time pill when the caller passes one (threads)', async () => {
    render(ThoughtRow, { ...baseProps, timeLabel: 'Yesterday' })
    await expect.element(page.getByTestId('thought-row-time')).toHaveTextContent('Yesterday')
  })
})
