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

  it('at rest mirrors Capture: the heading in the same place and voice, suggestions beneath it', () => {
    const hero = source.slice(source.indexOf('data-testid="ask-heading"') - 400, source.indexOf('{#snippet above()}'))
    // same container offset and type as capture/+page.svelte's h1
    expect(hero).toContain('pt-[calc(var(--head)+23vh)] px-7 max-[640px]:pt-[calc(var(--head)+12vh)]')
    expect(hero).toContain('font-you font-normal text-[clamp(32px,4.4vw,46px)]')
    expect(hero).toContain('m.ask_placeholder()')
    expect(hero).toContain('m.ask_try()')
    // one line each, ellipsis, full text in title
    expect(hero).toContain('truncate')
    expect(hero).toContain('title={s.question}')
    // tapping a pill asks exactly the stored question (SQ-4)
    expect(hero).toContain('onclick={() => resend(s.question)}')
  })

  it('keeps history and new chat in the quiet row above the field', () => {
    const above = source.slice(source.indexOf('{#snippet above()}'), source.indexOf('{/snippet}'))
    expect(above).toContain('m.ask_past()')
    expect(above).toContain('m.ask_new_chat()')
    expect(above).not.toContain('m.ask_try()')
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
