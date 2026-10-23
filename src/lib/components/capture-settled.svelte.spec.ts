import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'
import CaptureSettled from './capture-settled.svelte'

const thought: CaptureSubmitResult = {
  id: 'thought-1',
  normalizedText: 'Call the studio about the frame order',
  category: 'task',
  metadata: {},
  cues: [],
  enrichedAt: null,
  entities: [],
  temporalEvents: [],
  linkedThoughts: [],
  attachedFiles: [],
  enrichmentComplete: false,
  categoryProvisional: true,
  gtdProjectLabel: null,
  gtdIsNextAction: false,
  queueStatus: 'pending',
  author: 'user',
  authorLabel: null,
  lifecycleStatus: 'open',
}

describe('capture-settled.svelte', () => {
  it('renders the kept words, their type, and the quiet tools', async () => {
    render(CaptureSettled, { thought, onForget: () => {}, onAttach: () => {} })
    const root = page.getByTestId('capture-settled')
    await expect.element(root).toHaveTextContent('Call the studio about the frame order')
    await expect.element(root).toHaveTextContent('Task')
    await expect.element(page.getByTestId('capture-edit-toggle')).toBeInTheDocument()
    await expect.element(page.getByTestId('capture-forget')).toBeInTheDocument()
    await expect.element(page.getByTestId('capture-attach')).toBeInTheDocument()
    await expect
      .element(page.getByTestId('capture-settled-open'))
      .toHaveAttribute('href', expect.stringContaining('/thought/thought-1'))
  })

  it('hides Forget and attach when no handler is wired (nothing dangles)', async () => {
    render(CaptureSettled, { thought })
    await expect.element(page.getByTestId('capture-edit-toggle')).toBeInTheDocument()
    await expect.element(page.getByTestId('capture-forget')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('capture-attach')).not.toBeInTheDocument()
  })

  it('shows the natural-language edit input and reports background work as plain words', async () => {
    render(CaptureSettled, { thought, editLoading: true })
    await expect.element(page.getByTestId('capture-settled')).toHaveTextContent('knitting')
  })

  it('links to the thought page (wave 3 route) regardless', async () => {
    render(CaptureSettled, { thought })
    await expect
      .element(page.getByTestId('capture-settled-open'))
      .toHaveAttribute('href', expect.stringContaining('thought-1'))
  })
})
