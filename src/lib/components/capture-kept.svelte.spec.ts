import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import CaptureKept from './capture-kept.svelte'

const base = {
  thoughtId: null as string | null,
  typeKey: 'task',
  thread: null,
  kinds: [
    { key: 'task', name: 'Task', definition: 'Something to do' },
    { key: 'observation', name: 'Observation', definition: 'Something noticed' },
  ],
  onkeptchange: () => {},
  entityCount: 0,
  linkedCount: 0,
  slow: false,
  failureReason: null,
}

describe('capture-kept.svelte', () => {
  it('names how it was kept while indexing, and explains what the pass is doing', async () => {
    render(CaptureKept, { ...base, stage: 'indexing' })
    await expect.element(page.getByTestId('capture-kept')).toHaveTextContent('Task')
    await expect.element(page.getByTestId('capture-kept')).toHaveTextContent('no project')
    await expect.element(page.getByTestId('capture-kept-progress')).toHaveAttribute('data-stage', 'indexing')
    await expect.element(page.getByText('Finding the people, places and projects it mentions…')).toBeInTheDocument()
  })

  it('cycles the explanation while indexing (no bar of three lines)', async () => {
    render(CaptureKept, { ...base, stage: 'indexing' })
    await expect
      .element(page.getByText('Making it searchable by meaning, not just words…'), { timeout: 4000 })
      .toBeInTheDocument()
    expect(document.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('is a status strip (a live region that stays up while the user keeps typing)', async () => {
    render(CaptureKept, { ...base, stage: 'indexing' })
    await expect.element(page.getByTestId('capture-kept')).toHaveAttribute('role', 'status')
  })

  it('reports what got linked when done', async () => {
    render(CaptureKept, { ...base, stage: 'linked', entityCount: 3, linkedCount: 2 })
    await expect.element(page.getByTestId('capture-kept-progress')).toHaveAttribute('data-stage', 'linked')
    await expect.element(page.getByTestId('capture-kept')).toHaveTextContent('3 entities · 2 thoughts')
  })

  it('says so when indexing failed — the thought is still kept', async () => {
    render(CaptureKept, { ...base, stage: 'failed', failureReason: 'embedding timeout' })
    await expect.element(page.getByRole('alert')).toHaveTextContent('embedding timeout')
  })

  it('the pencil waits until the thought is kept, then opens the type and thread pickers in place', async () => {
    const { rerender } = render(CaptureKept, { ...base, stage: 'saving' })
    await expect.element(page.getByTestId('capture-kept-edit')).toBeDisabled()
    await rerender({ ...base, thoughtId: 't1', stage: 'indexing' })
    await page.getByTestId('capture-kept-edit').click()
    await expect.element(page.getByTestId('capture-kept-editor')).toBeInTheDocument()
    await expect.element(page.getByTestId('thought-thread')).toBeInTheDocument()
  })

  it('says a credential was left out of memory, without naming or echoing any value', async () => {
    render(CaptureKept, { ...base, stage: 'indexing', secretsRedacted: true })
    const notice = page.getByTestId('capture-kept-secrets')
    await expect.element(notice).toBeInTheDocument()
    await expect.element(notice).toHaveTextContent('not stored in memory')
  })

  it('shows no credential notice when nothing was redacted', async () => {
    render(CaptureKept, { ...base, stage: 'indexing' })
    expect(document.querySelector('[data-testid="capture-kept-secrets"]')).toBeNull()
  })

  it('never shows the kept words again', async () => {
    render(CaptureKept, { ...base, stage: 'linked' })
    expect((page.getByTestId('capture-kept').element() as HTMLElement).textContent).not.toContain('Buy oat milk')
  })
})
