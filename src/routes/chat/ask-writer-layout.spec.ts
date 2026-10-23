import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/routes/chat/+page.svelte', 'utf8')

/** The writer's class list (Tailwind utilities, composed in a Svelte array). */
function writerClass(): string {
  const start = source.indexOf("'fixed left-1/2 z-[34] flex")
  expect(start, 'ask-writer class list').toBeGreaterThan(-1)
  const end = source.indexOf(']}', start)
  return source.slice(start, end)
}

describe('Ask writer stays accessible above the conversation', () => {
  it('starts near the header instead of adding a middle-of-screen spacer', () => {
    expect(source).not.toContain('ask-spacer')
    expect(source).toContain('pt-[calc(var(--head,68px)+28px)]')
  })

  it('portals the unboxed writer out of the masked page', () => {
    const start = source.indexOf('<form')
    expect(source.slice(start, source.indexOf('>', start))).toContain('use:portal')
    const wc = writerClass()
    // ei: the writer is unboxed — at rest it holds the middle of the page like Capture's,
    // once a conversation is underway it docks above the bottom nav.
    expect(wc).toContain('z-[34]')
    expect(wc).toContain('bottom-[calc(var(--bottom-nav)+22px)]')
    expect(wc).toContain('top-[calc(var(--head)+23vh)]')
    expect(wc).toContain('w-[min(700px,calc(100vw-64px))]')
    for (const box of ['bg-raised', 'border', 'shadow-raised', 'rounded-[14px]']) {
      expect(wc, `writer must not be boxed (${box})`).not.toContain(box)
    }
  })

  it('keeps one conversation scroll surface and space for the tallest writer', () => {
    expect(source).toContain('overflow-y-auto')
    expect(source).toContain('--writer-height')
    expect(source).toContain('new ResizeObserver')
    expect(source).toContain('handleAskWheel')
    expect(source).toContain('handleAskTouchMove')
  })

  it('keeps a full-width textarea in your voice and a separate controls row', () => {
    const textareaStart = source.indexOf('<textarea')
    const textareaTag = source.slice(textareaStart, source.indexOf('></textarea>', textareaStart))
    expect(textareaTag).toContain('w-full')
    // your voice: the question is set in Geist Mono
    expect(textareaTag).toContain('font-you')
    const wc = writerClass()
    expect(wc).toContain('flex flex-col')
    const controlsRow = source.indexOf('flex items-center gap-2', textareaStart)
    expect(controlsRow).toBeGreaterThan(textareaStart)
    // the ink pill hugs the end of the controls row
    expect(source).toContain('flex-none ml-auto inline-flex items-center')
  })
})
