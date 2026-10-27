import { compile } from 'tailwindcss'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ThoughtThreadMenu from '$lib/components/thought-thread-menu.svelte'
import Fixture from './overlay-scroll-fixture.svelte'

/**
 * Popover and Select content must cap itself to the space bits-ui reports as
 * available and scroll inside it, so a long list never runs past the screen.
 *
 * The browser-mode config omits the Tailwind plugin, so the classes on the real
 * rendered elements would be inert. `applyTailwind` compiles exactly the classes
 * found in the document (the result of the primitives' own `cn(...)` merge) and
 * injects them (plus the preflight `border-box` rule), so the assertions below
 * measure real layout, not class strings.
 */
const VIEWPORT_HEIGHT = 360

let styleEl: HTMLStyleElement | null = null

async function applyTailwind() {
  const { build } = await compile('@theme { --spacing: 0.25rem; }\n@tailwind utilities;')
  const candidates = new Set<string>()
  for (const el of document.querySelectorAll('[class]')) {
    for (const c of el.getAttribute('class')?.split(/\s+/) ?? []) if (c) candidates.add(c)
  }
  styleEl?.remove()
  styleEl = document.createElement('style')
  styleEl.textContent = `*, ::before, ::after { box-sizing: border-box; }\n${build([...candidates])}`
  document.head.append(styleEl)
}

beforeAll(async () => {
  await page.viewport(480, VIEWPORT_HEIGHT)
})

afterEach(() => {
  styleEl?.remove()
  styleEl = null
})

async function openContent() {
  const content = page.getByTestId('overlay-content')
  await expect.element(content).toBeInTheDocument()
  const el = content.element() as HTMLElement
  await applyTailwind()
  // let bits-ui measure the available height and position the wrapper
  await expect
    .poll(() => el.closest<HTMLElement>('[data-bits-floating-content-wrapper]')?.style.transform)
    .not.toContain('-200%')
  return el
}

/** The scrolling element: the content itself, or the Select viewport inside it. */
function scroller(el: HTMLElement): HTMLElement {
  return (
    [el, ...el.querySelectorAll<HTMLElement>('*')].find(
      (n) => getComputedStyle(n).overflowY !== 'visible' && n.scrollHeight > n.clientHeight,
    ) ?? el
  )
}

/** The content is capped to the screen and its list overflows inside a scroller. */
function expectBoundedAndScrollable(el: HTMLElement) {
  const style = getComputedStyle(el)
  expect(style.overflowY).toBe('auto')
  expect(style.maxHeight).not.toBe('none')
  expect(Number.parseFloat(style.maxHeight)).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
  expect(el.getBoundingClientRect().bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
  const box = scroller(el)
  expect(box.scrollHeight).toBeGreaterThan(box.clientHeight)
}

function expectLastEntryReachable(el: HTMLElement, lastEntry: HTMLElement) {
  const box = scroller(el)
  lastEntry.scrollIntoView({ block: 'nearest' })
  const entry = lastEntry.getBoundingClientRect()
  const view = box.getBoundingClientRect()
  expect(box.scrollTop).toBeGreaterThan(0)
  expect(entry.bottom).toBeLessThanOrEqual(view.bottom + 1)
  expect(entry.bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
}

describe('ui overlay content scrolls inside the available height', () => {
  it('popover: ~40 entries are capped and the last one can be scrolled into view', async () => {
    render(Fixture, { kind: 'popover', count: 40 })
    const el = await openContent()
    expectBoundedAndScrollable(el)
    expectLastEntryReachable(el, page.getByTestId('entry-40').element() as HTMLElement)
  })

  it('select: ~40 entries are capped and the last one can be scrolled into view', async () => {
    render(Fixture, { kind: 'select', count: 40 })
    const el = await openContent()
    expectBoundedAndScrollable(el)
    expectLastEntryReachable(el, page.getByTestId('entry-40').element() as HTMLElement)
  })

  it('the Mesh thread picker (a Popover with its own class) reaches the last thread', async () => {
    const options = Array.from({ length: 40 }, (_, i) => ({
      entityId: `p${i + 1}`,
      label: `Thread ${i + 1}`,
    }))
    render(ThoughtThreadMenu, { thread: null, options, open: true })
    const content = page.getByRole('menu')
    await expect.element(content).toBeInTheDocument()
    const el = content.element() as HTMLElement
    await applyTailwind()
    await expect
      .poll(() => el.closest<HTMLElement>('[data-bits-floating-content-wrapper]')?.style.transform)
      .not.toContain('-200%')
    expectBoundedAndScrollable(el)
    expectLastEntryReachable(
      el,
      page.getByText('Thread 40', { exact: true }).element() as HTMLElement,
    )
  })
})
