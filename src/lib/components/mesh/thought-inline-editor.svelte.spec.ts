import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page, userEvent } from 'vitest/browser'
import ThoughtInlineEditor from './thought-inline-editor.svelte'

const client = vi.hoisted(() => ({
  applyThoughtEdit: vi.fn(),
  setThoughtType: vi.fn(),
  assignThoughtThread: vi.fn(),
  unassignThoughtThread: vi.fn(),
  fetchThreadOptions: vi.fn(),
}))
vi.mock('$lib/thought/thought-edit-client', () => client)

const kinds = [
  { key: 'decision', name: 'Decision', definition: 'A choice made' },
  { key: 'task', name: 'Task', definition: 'Something to do' },
]
const base = {
  thoughtId: 't1',
  text: 'Call the studio about pricing',
  category: 'decision',
  thread: { entityId: 'p1', label: 'Studio' },
  kinds,
}

beforeEach(() => {
  vi.clearAllMocks()
  client.fetchThreadOptions.mockResolvedValue([
    { entityId: 'p1', label: 'Studio' },
    { entityId: 'p2', label: 'Garden' },
  ])
})

describe('thought-inline-editor.svelte (change a thought where you read it)', () => {
  it('shows the three things you can change, in the row: the words (Edit), the type and the thread', async () => {
    render(ThoughtInlineEditor, { ...base, onchange: vi.fn() })
    await expect.element(page.getByTestId('thought-inline-words')).toHaveTextContent('Edit')
    await expect.element(page.getByTestId('thought-type')).toHaveTextContent('Decision')
    await expect.element(page.getByTestId('thought-thread')).toHaveTextContent('Studio')
  })

  it('the words field opens on its own full-width line, after the type, thread and edit-words pills', async () => {
    render(ThoughtInlineEditor, { ...base, onchange: vi.fn() })
    const type = page.getByTestId('thought-type').element()
    const thread = page.getByTestId('thought-thread').element()
    const words = page.getByTestId('thought-inline-words').element()
    expect(type.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(thread.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await page.getByTestId('thought-inline-words').click()
    const line = page.getByTestId('thought-inline-words-editor').element()
    expect(line.className).toContain('basis-full')
    expect(line.className).toContain('order-last')
    await expect.element(page.getByTestId('thought-inline-field')).toBeInTheDocument()
  })

  it('edits the words in place: Save sends them, the row gets what the server kept', async () => {
    const onchange = vi.fn()
    client.applyThoughtEdit.mockResolvedValue({
      text: 'Call the studio Monday',
      category: 'decision',
    })
    render(ThoughtInlineEditor, { ...base, onchange })
    await page.getByTestId('thought-inline-words').click()
    const field = page.getByTestId('thought-inline-field')
    await userEvent.clear(field)
    await userEvent.type(field, 'Call the studio Monday')
    await page.getByTestId('thought-inline-save').click()
    expect(client.applyThoughtEdit).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('Call the studio Monday'),
    )
    await vi.waitFor(() =>
      expect(onchange).toHaveBeenCalledWith({
        text: 'Call the studio Monday',
        category: 'decision',
        thread: { entityId: 'p1', label: 'Studio' },
      }),
    )
  })

  it('Escape leaves the words unchanged and sends nothing', async () => {
    render(ThoughtInlineEditor, { ...base, onchange: vi.fn() })
    await page.getByTestId('thought-inline-words').click()
    await userEvent.type(page.getByTestId('thought-inline-field'), ' extra')
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('thought-inline-field')).not.toBeInTheDocument()
    expect(client.applyThoughtEdit).not.toHaveBeenCalled()
  })

  it('a decision becomes a task with one pick (the type is set directly)', async () => {
    const onchange = vi.fn()
    client.setThoughtType.mockResolvedValue(undefined)
    render(ThoughtInlineEditor, { ...base, onchange })
    await page.getByTestId('thought-type').click()
    await page.getByTestId('thought-type-task').click()
    expect(client.setThoughtType).toHaveBeenCalledWith('t1', 'task')
    await vi.waitFor(() =>
      expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ category: 'task' })),
    )
  })

  it('moves the thought to another thread, or off its thread', async () => {
    const onchange = vi.fn()
    client.assignThoughtThread.mockResolvedValue({ entityId: 'p2', label: 'Garden' })
    client.unassignThoughtThread.mockResolvedValue(undefined)
    render(ThoughtInlineEditor, { ...base, onchange })
    await page.getByTestId('thought-thread').click()
    await page.getByText('Garden').click()
    expect(client.assignThoughtThread).toHaveBeenCalledWith('t1', { entityId: 'p2' })
    await vi.waitFor(() =>
      expect(onchange).toHaveBeenLastCalledWith(
        expect.objectContaining({ thread: { entityId: 'p2', label: 'Garden' } }),
      ),
    )
  })

  it('a failed save says why, in the row, and changes nothing', async () => {
    const onchange = vi.fn()
    client.setThoughtType.mockRejectedValue(new Error('Unknown type "task"'))
    render(ThoughtInlineEditor, { ...base, onchange })
    await page.getByTestId('thought-type').click()
    await page.getByTestId('thought-type-task').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Unknown type "task"')
    expect(onchange).not.toHaveBeenCalled()
  })
})
