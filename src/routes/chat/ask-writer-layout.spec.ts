import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/routes/chat/+page.svelte', 'utf8')
const writer = readFileSync('src/lib/components/writer/glass-writer.svelte', 'utf8')

describe('Ask uses the shared bottom-docked writer', () => {
  it('renders GlassWriter instead of its own form/textarea', () => {
    expect(source).toContain("import GlassWriter from '$lib/components/writer/glass-writer.svelte'")
    expect(source).toContain('<GlassWriter')
    expect(source).not.toContain('<textarea')
    expect(source).not.toContain('<form')
  })

  it('is always docked: no at-rest centring, glide or writer-height maths', () => {
    expect(source).not.toContain('writerDocked')
    expect(source).not.toContain('translate-y-[calc(var(--head)')
    expect(source).not.toContain('--writer-height')
    expect(source).not.toContain('new ResizeObserver')
    expect(source).toContain('pt-[calc(var(--head,68px)+28px)]')
  })

  it('pads the conversation clear of the docked writer and keeps one scroll surface', () => {
    expect(source).toContain('overflow-y-auto')
    expect(source).toContain('var(--glass-writer-height,64px)+var(--bottom-nav)')
    expect(source).toContain('handleAskWheel')
    expect(source).toContain('handleAskTouchMove')
  })

  it('wires send, stop and voice through the writer', () => {
    const tag = source.slice(source.indexOf('<GlassWriter'), source.indexOf('{#snippet above()}'))
    for (const prop of ['bind:value={input}', 'onsubmit=', 'onstop={stop}', 'busy={loading}', 'ontranscript=', 'onpartialtranscript=', 'bind:voiceStop={voiceStopFn}']) {
      expect(tag, prop).toContain(prop)
    }
  })

  it('puts Try asking, history and new chat in the quiet row above the field', () => {
    const above = source.slice(source.indexOf('{#snippet above()}'), source.indexOf('{/snippet}'))
    expect(above).toContain('m.ask_try()')
    expect(above).toContain('!conversationShown')
    expect(above).toContain('m.ask_past()')
    expect(above).toContain('m.ask_new_chat()')
    // ei .ask-suggestions: one line each, ellipsis, full text in title
    expect(above).toContain('truncate')
    expect(above).toContain('title={s.text}')
  })

  it('the shared writer is the glass pill docked above the bottom nav, outside the mask', () => {
    expect(writer).toContain('use:portal')
    expect(writer).toContain('bottom-[calc(var(--bottom-nav)+12px)]')
    expect(writer).toContain('w-[calc(100vw-32px)] max-w-[760px]')
    expect(writer).toContain('glass-field')
    expect(writer).toContain('min-h-[52px] rounded-[26px]')
    expect(writer).toContain('font-mesh text-[17px]')
    expect(writer).toContain('caret-signal')
    expect(writer).toContain('placeholder:text-ink-2')
  })
})
