import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import CaptureOnboardingOverlay from './capture-onboarding-overlay.svelte'

describe('capture-onboarding-overlay.svelte', () => {
  it('is hidden when open is false', async () => {
    render(CaptureOnboardingOverlay, { open: false })
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('steps through welcome and capture, then shows install', async () => {
    render(CaptureOnboardingOverlay, {
      open: true,
      walletAvailableCredits: 100,
      creditsGatePassed: true,
    })
    await expect.element(page.getByText('Step 1 of 4')).toBeInTheDocument()
    await expect.element(page.getByText('Your memory, not theirs.')).toBeInTheDocument()
    await expect
      .element(page.getByText(/shouldn't live inside one chat vendor or hyperscaler/))
      .toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.element(page.getByText('Step 2 of 4')).toBeInTheDocument()
    await expect.element(page.getByText('Just drop it in.')).toBeInTheDocument()
    await expect
      .element(page.getByText(/Eigen Mesh captures what's on your mind/))
      .toBeInTheDocument()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.element(page.getByText('Step 3 of 4')).toBeInTheDocument()
    await expect.element(page.getByText('Install Eigen Mesh')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Install app' })).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Continue without installing' }))
      .toBeInTheDocument()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect.element(page.getByText('Step 2 of 4')).toBeInTheDocument()
  })

  it('advances from install skip to notifications step', async () => {
    render(CaptureOnboardingOverlay, {
      open: true,
      walletAvailableCredits: 100,
      creditsGatePassed: true,
    })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Continue without installing' }).click()
    await expect.element(page.getByText('Step 4 of 4')).toBeInTheDocument()
    await expect.element(page.getByText('Stay in the loop')).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Enable notifications' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Continue without notifications' }))
      .toBeInTheDocument()
  })

  it('does not show PayPal top-up or BYOK forms', async () => {
    render(CaptureOnboardingOverlay, {
      open: true,
      walletAvailableCredits: 100,
      creditsGatePassed: true,
    })
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.element(page.getByText('API key')).not.toBeInTheDocument()
    await expect.element(page.getByText(/PayPal/i)).not.toBeInTheDocument()
    await expect.element(page.getByText(/Add credits via PayPal/i)).not.toBeInTheDocument()
  })

  it('does not reset step when wallet credits update after advancing', async () => {
    const { rerender } = render(CaptureOnboardingOverlay, {
      open: true,
      walletAvailableCredits: 0,
      creditsGatePassed: false,
    })
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.element(page.getByText('Step 2 of 4')).toBeInTheDocument()

    rerender({
      open: true,
      walletAvailableCredits: 500,
      creditsGatePassed: true,
    })
    await expect.element(page.getByText('Step 2 of 4')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })
})
