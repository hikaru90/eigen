import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ThoughtForget from './thought-forget.svelte'

/**
 * Forget with an arm step (DESIGN.md "Buttons, three levels"; ei app.js:1473-1483).
 * The control is dumb: it renders the armed word and reports taps; the caller's runes
 * store (src/routes/thought/[id]/forget-arm.svelte.ts, unit-tested) owns the timing.
 */
describe('thought-forget.svelte', () => {
  it('reads "Forget" at rest and reports a tap', async () => {
    const ontap = vi.fn()
    render(ThoughtForget, { armed: false, ontap })
    const button = page.getByTestId('thought-forget')
    await expect.element(button).toHaveTextContent('Forget')
    await button.click()
    expect(ontap).toHaveBeenCalledTimes(1)
  })

  it('asks "for good?" while armed, in the warn tone', async () => {
    render(ThoughtForget, { armed: true, ontap: () => {} })
    const button = page.getByTestId('thought-forget')
    await expect.element(button).toHaveTextContent('for good?')
    await expect.element(button).toHaveClass('is-arming')
  })

  it('waits while the delete is in flight', async () => {
    const ontap = vi.fn()
    render(ThoughtForget, { armed: true, busy: true, ontap })
    await expect.element(page.getByTestId('thought-forget')).toBeDisabled()
  })
})
