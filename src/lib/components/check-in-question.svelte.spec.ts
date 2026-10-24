import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import CheckInQuestion from './check-in-question.svelte'

function stubFetch(ok = true) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok }), { status: ok ? 200 : 500 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('check-in-question.svelte', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks a relevance question with keep / archive / not now', async () => {
    const fetchMock = stubFetch()
    const onDone = vi.fn()
    render(CheckInQuestion, {
      question: { kind: 'relevance', thoughtId: 't1', snippet: 'Hydra buoy', question: 'Is Hydra buoy still a project you are working on?' },
      onDone,
    })
    await expect.element(page.getByText('Is Hydra buoy still a project you are working on?')).toBeInTheDocument()
    await page.getByRole('button', { name: 'Still on it' }).click()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/grounding/question',
      expect.objectContaining({ body: JSON.stringify({ kind: 'relevance', thoughtId: 't1', action: 'keep' }) }),
    )
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 3000 })
  })

  it('takes a written answer for a grounding question', async () => {
    const fetchMock = stubFetch()
    render(CheckInQuestion, {
      question: { kind: 'grounding', facetKey: 'work', question: 'Where do you work?' },
      onDone: () => {},
    })
    await page.getByRole('textbox').fill('At Kindred')
    await page.getByRole('button', { name: 'Save' }).click()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/grounding/question',
      expect.objectContaining({ body: JSON.stringify({ kind: 'grounding', facetKey: 'work', answer: 'At Kindred' }) }),
    )
  })

  it('says so when dismissing fails instead of pretending it worked', async () => {
    stubFetch(false)
    const onDone = vi.fn()
    render(CheckInQuestion, {
      question: { kind: 'grounding', facetKey: 'work', question: 'Where do you work?' },
      onDone,
    })
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect.element(page.getByRole('alert')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})
