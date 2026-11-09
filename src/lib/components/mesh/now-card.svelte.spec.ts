import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import { offlineStatus } from '$lib/offline/offline-status.svelte'
import { gotoCalls } from '$lib/vitest-stubs/app/navigation'
import NowCard from './now-card.svelte'

/** The Lightning questions card (feature-mesh-now.md NOW-11), with the Now API stubbed. */

type Kind = 'do' | 'sort' | 'file' | 'unblock'
const ANSWERS: Record<Kind, string[]> = {
  do: ['done', 'not_now', 'too_big'],
  sort: ['done', 'drop', 'keep'],
  file: ['yes', 'other_project', 'not_a_task'],
  unblock: ['yes', 'something_else', 'someday', 'finished'],
}

function cardState(id: string, kind: Kind, extra: Record<string, unknown> = {}) {
  return {
    state: 'card',
    card: {
      id,
      kind,
      text: `Text of ${id}`,
      why: `Why of ${id}`,
      project: kind === 'file' || kind === 'unblock' ? { id: 'p1', label: 'Empathy Link' } : null,
      answers: ANSWERS[kind],
      ...(kind === 'file'
        ? {
            otherProjects: [
              { id: 'p8', label: 'Hydra' },
              { id: 'p9', label: 'Sewer' },
            ],
          }
        : {}),
      ...extra,
    },
    remaining: 2,
    candidatesOmitted: 0,
  }
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init }))
const posts = () => calls().filter((c) => c.init?.method === 'POST')
const bodyOf = (c: { init?: RequestInit }) => JSON.parse(String(c.init?.body))

beforeEach(() => {
  offlineStatus.online = true
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  offlineStatus.online = true
})

describe('now-card.svelte states', () => {
  it('shows one quiet line while the questions are written, then the card; fetches once', async () => {
    let release!: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)))
    render(NowCard)

    await expect.element(page.getByText('Writing your questions…')).toBeInTheDocument()
    release(reply(200, cardState('c1', 'do')))

    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()
    await expect.element(page.getByText('Why of c1')).toBeInTheDocument()
    await expect.element(page.getByText('Lightning questions')).toBeInTheDocument()
    expect(calls().filter((c) => c.url.endsWith('/api/mesh/now'))).toHaveLength(1)
  })

  it('502 shows the message with Try again, which fetches again', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(502, { error: 'The model failed 3 times' }))
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
    render(NowCard)

    await expect.element(page.getByText('The model failed 3 times')).toBeInTheDocument()
    await page.getByRole('button', { name: 'Try again' }).click()

    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('402 shows the billing message and a link to credits', async () => {
    fetchMock.mockResolvedValueOnce(reply(402, { code: 'insufficient_credits', error: 'x' }))
    render(NowCard)

    await expect.element(page.getByTestId('now-credits')).toBeInTheDocument()
    await expect.element(page.getByRole('link', { name: 'Add credits' })).toHaveAttribute(
      'href',
      '/settings/llm',
    )
  })

  it('clear and limit are one quiet line with no border', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { state: 'clear' }))
    const first = render(NowCard)
    await expect.element(page.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(document.querySelector('section')).toBeNull()
    first.unmount()

    fetchMock.mockResolvedValueOnce(reply(200, { state: 'limit' }))
    render(NowCard)
    await expect.element(page.getByText("That's it for today")).toBeInTheDocument()
    expect(document.querySelector('section')).toBeNull()
  })

  it('offline: one line, no fetch, no actions', async () => {
    offlineStatus.online = false
    render(NowCard)

    await expect.element(page.getByTestId('now-offline')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(document.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('now-card.svelte answers', () => {
  it.each(Object.entries(ANSWERS))('%s card offers its answers, the first in stronger ink', async (kind, keys) => {
    fetchMock.mockResolvedValueOnce(reply(200, cardState('c1', kind as Kind)))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    const buttons = [...document.querySelectorAll('section button')] as HTMLButtonElement[]
    expect(buttons).toHaveLength(keys.length)
    expect(buttons[0].className).toContain('text-ink ')
    for (const b of buttons.slice(1)) expect(b.className).toContain('text-ink-2')
  })

  it('Done posts the key and renders the card of the response, with a past-tense line and Undo', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(200, { ...cardState('c2', 'sort'), undo: { cardId: 'c1' } }))
    const onanswered = vi.fn()
    render(NowCard, { onanswered })
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Done' }).click()

    await expect.element(page.getByText('Text of c2')).toBeInTheDocument()
    await expect.element(page.getByText('Marked done')).toBeInTheDocument()
    expect(posts()).toHaveLength(1)
    expect(posts()[0].url).toContain('/api/mesh/now/cards/c1/answer')
    expect(bodyOf(posts()[0])).toEqual({ answer: 'done' })
    expect(onanswered).toHaveBeenCalledTimes(1)
  })

  it('Not now moves on without an Undo line', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(200, { ...cardState('c2', 'do'), undo: null }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Not now' }).click()

    await expect.element(page.getByText('Text of c2')).toBeInTheDocument()
    expect(document.querySelector('[data-testid="now-note"]')).toBeNull()
  })

  it('Drop and Not a task say what happened', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'sort')))
      .mockResolvedValueOnce(reply(200, { ...cardState('c2', 'file'), undo: { cardId: 'c1' } }))
      .mockResolvedValueOnce(reply(200, { state: 'clear', undo: { cardId: 'c2' } }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Drop' }).click()
    await expect.element(page.getByText('Dropped')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Not a task' }).click()
    await expect.element(page.getByText('Not a task anymore')).toBeInTheDocument()
  })

  it('Yes on a file card says where it went', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'file')))
      .mockResolvedValueOnce(reply(200, { state: 'clear', undo: { cardId: 'c1' } }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Yes' }).click()

    await expect.element(page.getByText('Moved to Empathy Link')).toBeInTheDocument()
  })

  it('Other project shows the picker; choosing sends projectEntityId and names the project', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'file')))
      .mockResolvedValueOnce(reply(200, { state: 'clear', undo: { cardId: 'c1' } }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()
    expect(document.querySelector('[role="group"]')).toBeNull()

    await page.getByRole('button', { name: 'Other project' }).click()
    await expect.element(page.getByRole('button', { name: 'Hydra' })).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Empathy Link' })).not.toBeInTheDocument()
    expect(posts()).toHaveLength(0)

    await page.getByRole('button', { name: 'Hydra' }).click()

    await expect.element(page.getByText('Moved to Hydra')).toBeInTheDocument()
    expect(bodyOf(posts()[0])).toEqual({ answer: 'other_project', projectEntityId: 'p8' })
  })

  it('Something else shows the field; Save sends the text', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'unblock')))
      .mockResolvedValueOnce(reply(200, { state: 'clear', undo: null }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Something else' }).click()
    await page.getByLabelText('Next step').fill('Book the site visit')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.element(page.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(bodyOf(posts()[0])).toEqual({ answer: 'something_else', text: 'Book the site visit' })
  })

  it('Too big posts, then opens Ask with that card (NOW-9, AC5)', async () => {
    gotoCalls.length = 0
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(200, { state: 'clear', undo: null }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Too big' }).click()

    await vi.waitFor(() => expect(gotoCalls).toEqual(['/chat?breakdown=c1']))
    expect(bodyOf(posts()[0])).toEqual({ answer: 'too_big' })
  })

  it('a failed Too big does not open Ask', async () => {
    gotoCalls.length = 0
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(400, { error: 'nope' }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Too big' }).click()

    await expect.element(page.getByText('nope')).toBeInTheDocument()
    expect(gotoCalls).toEqual([])
  })

  it('other answers never navigate', async () => {
    gotoCalls.length = 0
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(200, { state: 'clear', undo: null }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Not now' }).click()

    await expect.element(page.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(gotoCalls).toEqual([])
  })

  it('400 shows the server message inline and keeps the card', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'unblock')))
      .mockResolvedValueOnce(reply(400, { error: 'text is required for something_else' }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Something else' }).click()
    await page.getByLabelText('Next step').fill('x')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.element(page.getByTestId('now-inline-error')).toHaveTextContent(
      'text is required for something_else',
    )
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()
  })

  it('409 fetches the current card again', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(409, { error: 'This card was already answered' }))
      .mockResolvedValueOnce(reply(200, cardState('c2', 'do')))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Done' }).click()

    await expect.element(page.getByText('Text of c2')).toBeInTheDocument()
    expect(calls().filter((c) => c.init?.method !== 'POST')).toHaveLength(2)
  })

  it('a next deck that failed after the answer shows the message with Try again', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(200, { state: 'error', error: 'Deck failed', undo: { cardId: 'c1' } }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Done' }).click()

    await expect.element(page.getByText('Deck failed')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('now-card.svelte Undo', () => {
  it('Undo posts to the undo endpoint and renders the returned card', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(200, { ...cardState('c2', 'do'), undo: { cardId: 'c1' } }))
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
    const onundone = vi.fn()
    render(NowCard, { onundone })
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect.element(page.getByText('Marked done')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Undo' }).click()

    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()
    expect(posts()[1].url).toContain('/api/mesh/now/cards/c1/undo')
    expect(document.querySelector('[data-testid="now-note"]')).toBeNull()
    expect(onundone).toHaveBeenCalledTimes(1)
  })

  it('the line and Undo disappear after 6 seconds, timed from the click', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(200, { ...cardState('c2', 'do'), undo: { cardId: 'c1' } }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await page.getByRole('button', { name: 'Done' }).click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="now-note"]')).not.toBeNull())

    vi.advanceTimersByTime(5900)
    expect(document.querySelector('[data-testid="now-note"]')).not.toBeNull()
    vi.advanceTimersByTime(200)
    await vi.waitFor(() => expect(document.querySelector('[data-testid="now-note"]')).toBeNull())
  })

  it('the next action clears the old Undo', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, cardState('c1', 'do')))
      .mockResolvedValueOnce(reply(200, { ...cardState('c2', 'do'), undo: { cardId: 'c1' } }))
      .mockResolvedValueOnce(reply(200, { ...cardState('c3', 'do'), undo: null }))
    render(NowCard)
    await expect.element(page.getByText('Text of c1')).toBeInTheDocument()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect.element(page.getByText('Marked done')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Not now' }).click()

    await expect.element(page.getByText('Text of c3')).toBeInTheDocument()
    expect(document.querySelector('[data-testid="now-note"]')).toBeNull()
  })
})
