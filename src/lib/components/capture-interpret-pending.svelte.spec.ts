import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import {
  INTERPRET_PENDING_STATUS_LABEL,
  INTERPRET_PENDING_STEP_TITLE,
} from '$lib/capture/interpret-pending'
import CaptureInterpretPending from './capture-interpret-pending.svelte'

describe('capture-interpret-pending.svelte', () => {
  it('announces interpreting progress with the submitted thought preview', async () => {
    render(CaptureInterpretPending, { raw: 'Hamburg workshop follow-up' })

    const status = page.getByTestId('capture-interpret-pending')
    await expect.element(status).toBeInTheDocument()
    await expect.element(status).toHaveAttribute('role', 'status')
    await expect.element(page.getByText('Hamburg workshop follow-up')).toBeInTheDocument()
    await expect.element(page.getByText(INTERPRET_PENDING_STATUS_LABEL)).toBeInTheDocument()
    await expect.element(page.getByText(INTERPRET_PENDING_STEP_TITLE)).toBeInTheDocument()
  })
})
