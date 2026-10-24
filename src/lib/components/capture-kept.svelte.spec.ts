import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import CaptureKept from './capture-kept.svelte'

const base = { typeLabel: 'Task', threadLabel: 'no project', entityCount: 0, linkedCount: 0, slow: false, failureReason: null }

describe('capture-kept.svelte', () => {
  it('names how it was kept while indexing, with a working spinner and the second step lit', async () => {
    render(CaptureKept, { ...base, stage: 'indexing' })
    await expect.element(page.getByTestId('capture-kept')).toHaveTextContent('Task')
    await expect.element(page.getByTestId('capture-kept')).toHaveTextContent('no project')
    await expect.element(page.getByTestId('capture-kept-progress')).toHaveAttribute('aria-valuenow', '2')
    await expect.element(page.getByText('Indexing')).toBeInTheDocument()
  })

  it('is a status strip (a live region that stays up while the user keeps typing)', async () => {
    render(CaptureKept, { ...base, stage: 'indexing' })
    await expect.element(page.getByTestId('capture-kept')).toHaveAttribute('role', 'status')
  })

  it('reports what got linked when done', async () => {
    render(CaptureKept, { ...base, stage: 'linked', entityCount: 3, linkedCount: 2 })
    await expect.element(page.getByTestId('capture-kept-progress')).toHaveAttribute('aria-valuenow', '3')
    await expect.element(page.getByTestId('capture-kept')).toHaveTextContent('3 entities · 2 thoughts')
  })

  it('says so when indexing failed — the thought is still kept', async () => {
    render(CaptureKept, { ...base, stage: 'failed', failureReason: 'embedding timeout' })
    await expect.element(page.getByRole('alert')).toHaveTextContent('embedding timeout')
  })

  it('never shows the kept words again', async () => {
    render(CaptureKept, { ...base, stage: 'linked' })
    expect((page.getByTestId('capture-kept').element() as HTMLElement).textContent).not.toContain('Buy oat milk')
  })
})
