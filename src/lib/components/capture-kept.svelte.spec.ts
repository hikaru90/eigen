import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page, userEvent } from 'vitest/browser'
import CaptureKept from './capture-kept.svelte'

const client = vi.hoisted(() => ({ postCaptureVote: vi.fn() }))
vi.mock('$lib/capture/capture-vote-client', () => client)

beforeEach(() => {
  vi.clearAllMocks()
})

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

  it('never shows the kept words again', async () => {
    render(CaptureKept, { ...base, stage: 'linked' })
    expect((page.getByTestId('capture-kept').element() as HTMLElement).textContent).not.toContain('Buy oat milk')
  })
  describe('the vote (👍 / 👎), once the thought is kept', () => {
    it('waits for the thought id: nothing to vote on while it is still being saved', async () => {
      render(CaptureKept, { ...base, stage: 'saving' })
      await expect.element(page.getByTestId('capture-kept-vote')).not.toBeInTheDocument()
    })

    it('shows the pair in the strip as soon as the thought is kept — it does not wait for indexing', async () => {
      render(CaptureKept, { ...base, thoughtId: 't1', stage: 'indexing' })
      await expect.element(page.getByTestId('capture-kept-vote')).toBeInTheDocument()
      await expect.element(page.getByRole('button', { name: 'Stored right' })).toBeInTheDocument()
      await expect.element(page.getByRole('button', { name: 'Stored wrong' })).toBeInTheDocument()
    })

    it('starts with no vote, and a 👍 posts for place "capture"', async () => {
      client.postCaptureVote.mockResolvedValue({
        verdict: 'up',
        reasonKind: null,
        editApplied: false,
        changed: false,
        editError: null,
        thought: null,
      })
      render(CaptureKept, { ...base, thoughtId: 't1', stage: 'linked' })
      await expect
        .element(page.getByRole('button', { name: 'Stored right' }))
        .toHaveAttribute('aria-pressed', 'false')
      await page.getByRole('button', { name: 'Stored right' }).click()
      expect(client.postCaptureVote).toHaveBeenCalledWith({
        thoughtId: 't1',
        verdict: 'up',
        place: 'capture',
      })
    })

    it('a 👎 reason that edited the thought keeps the strip in step: the new type, the same thread', async () => {
      client.postCaptureVote.mockResolvedValue({
        verdict: 'down',
        reasonKind: 'wrong_category',
        editApplied: true,
        changed: true,
        editError: null,
        thought: { id: 't1', category: 'observation', normalizedText: 'Oat milk is cheaper at Lidl' },
      })
      const onkeptchange = vi.fn()
      render(CaptureKept, {
        ...base,
        thoughtId: 't1',
        stage: 'linked',
        thread: { entityId: 'p1', label: 'Groceries' },
        onkeptchange,
      })
      await page.getByRole('button', { name: 'Stored wrong' }).click()
      await userEvent.type(page.getByTestId('capture-vote-field'), 'this is an observation, not a task')
      await page.getByTestId('capture-vote-send').click()
      await vi.waitFor(() =>
        expect(onkeptchange).toHaveBeenCalledWith({
          typeKey: 'observation',
          thread: { entityId: 'p1', label: 'Groceries' },
        }),
      )
    })

    it('keeps the strip up while the reason box is open, and lets go when it closes', async () => {
      const oneditingchange = vi.fn()
      render(CaptureKept, { ...base, thoughtId: 't1', stage: 'linked', oneditingchange })
      await page.getByRole('button', { name: 'Stored wrong' }).click()
      expect(oneditingchange).toHaveBeenLastCalledWith(true)
      await page.getByRole('button', { name: 'Stored wrong' }).click()
      expect(oneditingchange).toHaveBeenLastCalledWith(false)
    })

    it('does not let the pencil closing release the strip while the reason box is still open', async () => {
      const oneditingchange = vi.fn()
      render(CaptureKept, { ...base, thoughtId: 't1', stage: 'linked', oneditingchange })
      await page.getByRole('button', { name: 'Stored wrong' }).click()
      await page.getByTestId('capture-kept-edit').click()
      await page.getByTestId('capture-kept-edit').click()
      expect(oneditingchange).toHaveBeenLastCalledWith(true)
    })

    it('adds no question or prompt to the strip', async () => {
      render(CaptureKept, { ...base, thoughtId: 't1', stage: 'linked' })
      const vote = page.getByTestId('capture-kept-vote').element()
      expect(vote.textContent?.trim()).toBe('')
    })
  })
})
