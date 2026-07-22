import { describe, expect, it } from 'vitest'
import { shouldSubmitSearchOnEnter } from './graph-search-keyboard'

function keydown(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ...opts } as KeyboardEvent
}

describe('shouldSubmitSearchOnEnter', () => {
  it('submits on bare Enter', () => {
    expect(shouldSubmitSearchOnEnter(keydown('Enter'))).toBe(true)
  })

  it('does not submit on other keys', () => {
    expect(shouldSubmitSearchOnEnter(keydown('a'))).toBe(false)
    expect(shouldSubmitSearchOnEnter(keydown('Escape'))).toBe(false)
    expect(shouldSubmitSearchOnEnter(keydown('Tab'))).toBe(false)
  })

  it('does not submit while IME is composing', () => {
    expect(shouldSubmitSearchOnEnter(keydown('Enter', { isComposing: true }))).toBe(false)
  })
})
