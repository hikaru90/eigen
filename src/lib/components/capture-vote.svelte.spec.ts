import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page, userEvent } from 'vitest/browser'
import CaptureVote from './capture-vote.svelte'

const client = vi.hoisted(() => ({ postCaptureVote: vi.fn() }))
vi.mock('$lib/capture/capture-vote-client', () => client)

const base = { thoughtId: 't1', initialVerdict: null, place: 'mesh' as const }

const upStored = { verdict: 'up', reasonKind: null, editApplied: false, editError: null, thought: null }
const downStored = { ...upStored, verdict: 'down' }
const editedThought = { id: 't1', normalizedText: 'Call my sister Greta', category: 'task' }

beforeEach(() => {
  vi.clearAllMocks()
  client.postCaptureVote.mockResolvedValue(upStored)
})

const up = () => page.getByRole('button', { name: 'Stored right' })
const down = () => page.getByRole('button', { name: 'Stored wrong' })
const field = () => page.getByTestId('capture-vote-field')
const send = () => page.getByTestId('capture-vote-send')

describe('capture-vote.svelte (👍 / 👎 on a stored thought, never a prompt)', () => {
  it('is two small icon buttons and no words', async () => {
    render(CaptureVote, { ...base })
    await expect.element(up()).toBeInTheDocument()
    await expect.element(down()).toBeInTheDocument()
    const root = page.getByTestId('capture-vote').element()
    expect(root.textContent?.trim()).toBe('')
    expect(root.querySelectorAll('button')).toHaveLength(2)
    expect(root.querySelectorAll('svg')).toHaveLength(2)
    expect(root.querySelector('textarea')).toBeNull()
  })

  it('shows no vote pressed when there is none', async () => {
    render(CaptureVote, { ...base })
    await expect.element(up()).toHaveAttribute('aria-pressed', 'false')
    await expect.element(down()).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the current 👍 pressed', async () => {
    render(CaptureVote, { ...base, initialVerdict: 'up' })
    await expect.element(up()).toHaveAttribute('aria-pressed', 'true')
    await expect.element(down()).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the current 👎 pressed, with the reason box closed', async () => {
    render(CaptureVote, { ...base, initialVerdict: 'down' })
    await expect.element(down()).toHaveAttribute('aria-pressed', 'true')
    await expect.element(up()).toHaveAttribute('aria-pressed', 'false')
    await expect.element(field()).not.toBeInTheDocument()
  })

  it('👍 posts at once with the place, then shows pressed; no box opens', async () => {
    render(CaptureVote, { ...base, place: 'capture' })
    await up().click()
    expect(client.postCaptureVote).toHaveBeenCalledWith({
      thoughtId: 't1',
      verdict: 'up',
      place: 'capture',
    })
    await expect.element(up()).toHaveAttribute('aria-pressed', 'true')
    await expect.element(field()).not.toBeInTheDocument()
  })

  it('👎 shows pressed and opens the box with "What was wrong?"; nothing is posted yet', async () => {
    render(CaptureVote, { ...base })
    await down().click()
    await expect.element(down()).toHaveAttribute('aria-pressed', 'true')
    await expect.element(field()).toBeInTheDocument()
    await expect.element(field()).toHaveAttribute('placeholder', 'What was wrong?')
    expect(client.postCaptureVote).not.toHaveBeenCalled()
  })

  it('sending an empty box stores just the vote: no reason is sent', async () => {
    client.postCaptureVote.mockResolvedValue(downStored)
    const onedited = vi.fn()
    render(CaptureVote, { ...base, onedited })
    await down().click()
    await send().click()
    expect(client.postCaptureVote).toHaveBeenCalledTimes(1)
    const sent = client.postCaptureVote.mock.calls[0][0] as Record<string, unknown>
    expect(sent).toMatchObject({ thoughtId: 't1', verdict: 'down', place: 'mesh' })
    expect(sent.reason ?? '').toBe('')
    await expect.element(field()).not.toBeInTheDocument()
    await expect.element(down()).toHaveAttribute('aria-pressed', 'true')
    expect(onedited).not.toHaveBeenCalled()
  })

  it('sends a blank box (spaces only) as no reason', async () => {
    client.postCaptureVote.mockResolvedValue(downStored)
    render(CaptureVote, { ...base })
    await down().click()
    await userEvent.type(field(), '   ')
    await send().click()
    const sent = client.postCaptureVote.mock.calls[0][0] as Record<string, unknown>
    expect((sent.reason as string | undefined)?.trim() ?? '').toBe('')
  })

  it('sends the typed reason and hands the edited thought to the host', async () => {
    client.postCaptureVote.mockResolvedValue({
      verdict: 'down',
      reasonKind: 'wrong_name',
      editApplied: true,
      editError: null,
      thought: editedThought,
    })
    const onedited = vi.fn()
    render(CaptureVote, { ...base, onedited })
    await down().click()
    await userEvent.type(field(), 'it is Greta, not Anna')
    await send().click()
    expect(client.postCaptureVote).toHaveBeenCalledWith({
      thoughtId: 't1',
      verdict: 'down',
      reason: 'it is Greta, not Anna',
      place: 'mesh',
    })
    await vi.waitFor(() => expect(onedited).toHaveBeenCalledWith(editedThought))
    expect(onedited).toHaveBeenCalledTimes(1)
    await expect.element(field()).not.toBeInTheDocument()
    await expect.element(down()).toHaveAttribute('aria-pressed', 'true')
  })

  it('an edit that failed says why, in place; the vote counts, the text stays, the host is not told', async () => {
    client.postCaptureVote.mockResolvedValue({
      verdict: 'down',
      reasonKind: 'wrong_date',
      editApplied: false,
      editError: 'enrichment gateway timed out',
      thought: null,
    })
    const onedited = vi.fn()
    render(CaptureVote, { ...base, onedited })
    await down().click()
    await userEvent.type(field(), 'wrong day')
    await send().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('enrichment gateway timed out')
    await expect.element(field()).toHaveValue('wrong day')
    await expect.element(down()).toHaveAttribute('aria-pressed', 'true')
    expect(onedited).not.toHaveBeenCalled()
  })

  it('a refused vote (the label could not be made) says why, in place, and keeps the typed text', async () => {
    client.postCaptureVote.mockRejectedValue(
      new Error('Eigen could not work out what kind of mistake you described after 4 tries, so nothing was saved. Send it again.'),
    )
    render(CaptureVote, { ...base })
    await down().click()
    await userEvent.type(field(), 'it is Greta')
    await send().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('nothing was saved')
    await expect.element(field()).toHaveValue('it is Greta')
    // nothing was stored, so the stored vote shows nothing (the box being open is the draft)
    await expect.element(up()).toHaveAttribute('aria-pressed', 'false')
  })

  it('sending again after an error works and clears the error', async () => {
    client.postCaptureVote.mockRejectedValueOnce(new Error('try later'))
    client.postCaptureVote.mockResolvedValueOnce({
      verdict: 'down',
      reasonKind: 'wrong_name',
      editApplied: true,
      editError: null,
      thought: editedThought,
    })
    render(CaptureVote, { ...base })
    await down().click()
    await userEvent.type(field(), 'it is Greta')
    await send().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('try later')
    await send().click()
    await vi.waitFor(() => expect(client.postCaptureVote).toHaveBeenCalledTimes(2))
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(field()).not.toBeInTheDocument()
  })

  it('a 👍 that fails says why and stays unpressed', async () => {
    client.postCaptureVote.mockRejectedValue(new Error('Thought not found'))
    render(CaptureVote, { ...base })
    await up().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Thought not found')
    await expect.element(up()).toHaveAttribute('aria-pressed', 'false')
  })

  it('pressing 👎 again closes an open box without posting anything', async () => {
    render(CaptureVote, { ...base })
    await down().click()
    await down().click()
    await expect.element(field()).not.toBeInTheDocument()
    await expect.element(down()).toHaveAttribute('aria-pressed', 'false')
    expect(client.postCaptureVote).not.toHaveBeenCalled()
  })

  it('Escape closes the box and sends nothing', async () => {
    render(CaptureVote, { ...base })
    await down().click()
    await userEvent.type(field(), 'half a thought')
    await userEvent.keyboard('{Escape}')
    await expect.element(field()).not.toBeInTheDocument()
    expect(client.postCaptureVote).not.toHaveBeenCalled()
  })

  it('👍 while the box is open votes up and closes the box', async () => {
    render(CaptureVote, { ...base, initialVerdict: 'down' })
    await down().click()
    await up().click()
    expect(client.postCaptureVote).toHaveBeenCalledWith({
      thoughtId: 't1',
      verdict: 'up',
      place: 'mesh',
    })
    await expect.element(field()).not.toBeInTheDocument()
    await expect.element(up()).toHaveAttribute('aria-pressed', 'true')
    await expect.element(down()).toHaveAttribute('aria-pressed', 'false')
  })

  it('a stored 👎 can be opened again to add a reason', async () => {
    render(CaptureVote, { ...base, initialVerdict: 'down' })
    await down().click()
    await expect.element(field()).toBeInTheDocument()
  })

  it('disables both buttons while a vote is in flight, so a vote is never sent twice', async () => {
    let finish: (v: unknown) => void = () => {}
    client.postCaptureVote.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(CaptureVote, { ...base })
    await up().click()
    await expect.element(up()).toBeDisabled()
    await expect.element(down()).toBeDisabled()
    finish(upStored)
    await expect.element(up()).toBeEnabled()
    expect(client.postCaptureVote).toHaveBeenCalledTimes(1)
  })

  it('tells the host when the reason box opens and closes (the strip stays up while it is open)', async () => {
    const onopenchange = vi.fn()
    client.postCaptureVote.mockResolvedValue(downStored)
    render(CaptureVote, { ...base, onopenchange })
    await down().click()
    expect(onopenchange).toHaveBeenLastCalledWith(true)
    await send().click()
    await vi.waitFor(() => expect(onopenchange).toHaveBeenLastCalledWith(false))
  })

  it('shows no prompt: with the box open the only words are the Send button', async () => {
    render(CaptureVote, { ...base })
    await down().click()
    const root = page.getByTestId('capture-vote').element()
    expect(root.textContent?.trim()).toBe('Send')
    expect(root.querySelector('h1, h2, h3, h4, label, legend')).toBeNull()
  })
})
