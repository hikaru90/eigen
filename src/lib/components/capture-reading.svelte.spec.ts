import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import type { ReadingDraft } from '$lib/capture/reading-state'
import CaptureReading from './capture-reading.svelte'

/** A preview-only draft: there is no thoughtId — nothing was stored while reading. */
const draft: ReadingDraft = {
  rawText: 'Call the studio about the frame order',
  reading: {
    interpretedText: 'Call the studio about the frame order today',
    category: {
      key: 'task',
      confidence: 0.9,
      alternatives: [
        { key: 'idea', confidence: 0.05 },
        { key: 'question', confidence: 0.03 },
      ],
    },
    entities: [],
    deviatesFromVerbatim: true,
  },
}

describe('capture-reading.svelte', () => {
  it('is empty at rest — nothing shows until there are words', async () => {
    render(CaptureReading, { draft: null, waiting: false, error: null })
    const root = page.getByTestId('capture-reading')
    await expect.element(root).toBeInTheDocument()
    // the grid keeps the line collapsed; no words, no spinner
    await expect.element(page.getByText('Sounds like')).not.toBeInTheDocument()
  })

  it('shows the scrambling "Interpreting" line while the mesh reads', async () => {
    render(CaptureReading, { draft: null, waiting: true, error: null })
    const line = page.getByTestId('capture-reading-interpreting')
    await expect.element(line).toBeInTheDocument()
    await expect.element(line.getByRole('status')).toHaveAttribute('aria-label', 'Interpreting')
  })

  it('marks the type and project as pickable with a chevron', async () => {
    render(CaptureReading, { draft, waiting: false, error: null })
    for (const id of ['capture-reading-type', 'capture-reading-thread']) {
      await expect.element(page.getByTestId(id)).toBeInTheDocument()
      expect(page.getByTestId(id).element().querySelector('svg')).not.toBeNull()
    }
  })

  it('renders the reading: type, thread, and the pencil', async () => {
    render(CaptureReading, {
      draft,
      waiting: false,
      error: null,
      threadChoice: { kind: 'loose' },
    })
    const root = page.getByTestId('capture-reading')
    await expect.element(root).toHaveTextContent('Sounds like')
    await expect.element(page.getByTestId('capture-reading-type')).toHaveTextContent('Task')
    await expect.element(page.getByTestId('capture-reading-thread')).toHaveTextContent('no project')
    await expect.element(page.getByTestId('capture-reading-pencil')).toBeInTheDocument()
  })

  it('shows the accepted type from the client copy; an adopted thread reads in your voice', async () => {
    render(CaptureReading, {
      draft: {
        ...draft,
        reading: { ...draft.reading, category: { ...draft.reading.category, key: 'question' } },
      },
      waiting: false,
      error: null,
      threadChoice: { kind: 'thread', entityId: 'p1', label: 'New studio' },
    })
    await expect.element(page.getByTestId('capture-reading-type')).toHaveTextContent('Question')
    const thread = page.getByTestId('capture-reading-thread')
    await expect.element(thread).toHaveTextContent('New studio')
  })

  it('surfaces read errors as plain words — never a fake reading', async () => {
    render(CaptureReading, { draft: null, waiting: false, error: 'Read failed (503)' })
    const root = page.getByTestId('capture-reading')
    await expect.element(root).toHaveTextContent('Read failed (503)')
  })
})
