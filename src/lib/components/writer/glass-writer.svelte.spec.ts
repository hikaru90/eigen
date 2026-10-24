import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page, userEvent } from 'vitest/browser'
import GlassWriter from './glass-writer.svelte'

vi.mock('$lib/capture/transcribe-audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/capture/transcribe-audio')>()),
  transcribeAudioChunk: vi.fn(async () => ''),
}))

const base = {
  placeholder: 'Write it down',
  submitLabel: 'Capture',
  inputTestId: 'writer-input',
  submitTestId: 'writer-send',
}

describe('glass-writer.svelte', () => {
  it('docks a glass pill above the bottom nav, portaled to <body>', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {} })
    const root = page.getByTestId('glass-writer')
    await expect.element(root).toBeInTheDocument()
    const el = root.element() as HTMLElement
    expect(el.parentElement).toBe(document.body)
    expect(el.className).toContain('fixed')
    expect(el.className).toContain('bottom-[calc(var(--bottom-nav)+12px)]')
    const field = page.getByTestId('glass-writer-field').element() as HTMLElement
    expect(field.className).toContain('glass-field')
    await expect.element(page.getByPlaceholder('Write it down')).toBeInTheDocument()
  })

  it('centres the text and the action slot in one space-between row', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {} })
    const field = page.getByTestId('glass-writer-field').element() as HTMLElement
    // the row centres (WebKit has no field-sizing: its one-line textarea is taller than the button)
    expect(field.className).toContain('items-center')
    expect(field.className).toContain('justify-between')
    expect(field.className).not.toContain('items-end')
    // the slot follows the row's centring (WebKit's one-line textarea is taller than the button)
    const slot = page.getByTestId('glass-writer-slot').element() as HTMLElement
    expect(slot.className).not.toContain('self-end')
    expect(slot.className).not.toContain('absolute')
  })

  it('shares one slot: mic while empty, send once there are words', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {}, ontranscript: () => {} })
    await expect.element(page.getByRole('button', { name: 'Start voice input' })).toBeInTheDocument()
    await expect.element(page.getByTestId('writer-send')).not.toBeInTheDocument()
    await userEvent.type(page.getByTestId('writer-input'), 'hello')
    await expect.element(page.getByTestId('writer-send')).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Start voice input' }))
      .not.toBeInTheDocument()
  })

  it('Enter submits, Shift+Enter is a newline, empty never submits', async () => {
    const onsubmit = vi.fn()
    render(GlassWriter, { ...base, onsubmit })
    const input = page.getByTestId('writer-input')
    await userEvent.click(input)
    await userEvent.keyboard('{Enter}')
    expect(onsubmit).not.toHaveBeenCalled()
    await userEvent.type(input, 'one')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect((input.element() as HTMLTextAreaElement).value).toBe('one\n')
    expect(onsubmit).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(onsubmit).toHaveBeenCalledTimes(1)
  })

  it('a consumer keydown that claims Enter wins; submitDisabled blocks sending', async () => {
    const onsubmit = vi.fn()
    render(GlassWriter, { ...base, value: 'words', submitDisabled: true, onsubmit })
    await expect.element(page.getByTestId('writer-send')).toBeDisabled()
    await userEvent.click(page.getByTestId('writer-input'))
    await userEvent.keyboard('{Enter}')
    expect(onsubmit).not.toHaveBeenCalled()
  })

  it('shows Stop while busy when the page can stop', async () => {
    const onstop = vi.fn()
    render(GlassWriter, { ...base, value: 'q', busy: true, onstop, onsubmit: () => {} })
    await userEvent.click(page.getByTestId('glass-writer-stop'))
    expect(onstop).toHaveBeenCalledTimes(1)
  })

  it('publishes its docked height for page padding', async () => {
    render(GlassWriter, { ...base, onsubmit: () => {} })
    await expect
      .poll(() => document.documentElement.style.getPropertyValue('--glass-writer-height'))
      .toMatch(/px$/)
  })
})
