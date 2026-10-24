import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ShareComposer from './share-composer.svelte'

vi.mock('$lib/capture/transcribe-audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/capture/transcribe-audio')>()),
  transcribeAudioChunk: vi.fn(async () => ''),
}))

describe('share-composer.svelte', () => {
  it('offers voice input on the Contribute message field', async () => {
    render(ShareComposer, {
      maxLength: 4000,
      oncheck: async () => null,
      oncreate: async () => false,
      onvoteinstead: () => {},
    })
    await expect.element(page.getByRole('button', { name: 'Start voice input' })).toBeInTheDocument()
  })
})
