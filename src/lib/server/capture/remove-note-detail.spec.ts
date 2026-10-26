import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getTextFileMock: vi.fn(),
  updateTextFileMock: vi.fn(),
  archiveTextFileMock: vi.fn(),
  loadStoredPassagesMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/text-files/service', () => ({
  getTextFile: m.getTextFileMock,
  updateTextFile: m.updateTextFileMock,
  archiveTextFile: m.archiveTextFileMock,
}))
vi.mock('$lib/server/text-files/note-passages', () => ({
  loadStoredPassages: m.loadStoredPassagesMock,
}))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: m.llmChatCompletionMock }))

import { numberNoteSecrets } from '$lib/server/security/note-secrets'
import { chunkNoteIntoPassages } from '$lib/server/text-files/chunk-note-passages'
import { envPaste, leaks } from '$lib/test/secret-fixtures'
import {
  REMOVE_NOTE_DETAIL_PROMPT,
  parseRegionRewrites,
  removeDetailFromNote,
} from './remove-note-detail'

function sentences(count: number): string {
  return Array.from(
    { length: count },
    (_, i) => `Sentence number ${i} talks about topic ${i} in some detail and more words.`,
  ).join(' ')
}

function reply(json: unknown) {
  return { choices: [{ message: { content: JSON.stringify(json) } }] }
}

/** Arrange a note whose stored passages are those of its numbered body. */
function arrangeNote(body: string, title = 'Diary') {
  m.getTextFileMock.mockResolvedValue({ id: 'n1', title, body })
  const numbered = numberNoteSecrets(body)
  const chunks = chunkNoteIntoPassages(numbered)
  m.loadStoredPassagesMock.mockResolvedValue(chunks.map((c, i) => ({ id: `p${i}`, ...c })))
  m.updateTextFileMock.mockResolvedValue({ id: 'n1' })
  m.archiveTextFileMock.mockResolvedValue(true)
  return { numbered, chunks }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseRegionRewrites', () => {
  it('requires every region exactly once and string texts (an empty text is allowed)', () => {
    const ok = parseRegionRewrites(
      JSON.stringify({ regions: [{ region: 'r1', text: '' }, { region: 'r2', text: 'x' }] }),
      ['r1', 'r2'],
    )
    expect(ok).toEqual(new Map([['r1', ''], ['r2', 'x']]))
    expect(() => parseRegionRewrites(JSON.stringify({ regions: [{ region: 'r1', text: 'x' }] }), ['r1', 'r2'])).toThrow(/r2/)
    expect(() =>
      parseRegionRewrites(JSON.stringify({ regions: [{ region: 'r1', text: 'x' }, { region: 'r1', text: 'y' }] }), ['r1']),
    ).toThrow(/more than once/)
    expect(() => parseRegionRewrites(JSON.stringify({ regions: [{ region: 'r9', text: 'x' }] }), ['r1'])).toThrow(/r9/)
    expect(() => parseRegionRewrites(JSON.stringify({ regions: [{ region: 'r1', text: 3 }] }), ['r1'])).toThrow(/text/)
    expect(() => parseRegionRewrites('nope', ['r1'])).toThrow()
  })
})

describe('removeDetailFromNote', () => {
  it('rewrites only the matched passage window, splices it into the note and saves it as an agent write (passages rebuild, secrets restored)', async () => {
    const body = sentences(30)
    const { numbered, chunks } = arrangeNote(body)
    expect(chunks.length).toBeGreaterThan(5)
    const first = chunks[2]!
    const last = chunks[4]! // ordinal 3 matched: window 2..4
    const region = numbered.slice(first.startChar, last.endChar)
    const victim = region.slice(0, region.indexOf('.') + 1)
    const rewritten = region.replace(victim, '').trimStart()
    expect(rewritten).not.toBe(region)
    m.llmChatCompletionMock.mockResolvedValue(reply({ regions: [{ region: 'r1', text: rewritten }] }))

    const out = await removeDetailFromNote({
      userId: 'u1',
      noteId: 'n1',
      detail: 'the seventh sentence',
      matchedOrdinals: [3],
    })

    expect(out).toBe('edited')
    const call = m.llmChatCompletionMock.mock.calls[0][0]
    expect(call.responseFormat).toBe('json_object')
    expect(call.temperature).toBe(0)
    expect(call.messages[0].content).toBe(REMOVE_NOTE_DETAIL_PROMPT)
    expect(call.messages[1].content).toContain('the seventh sentence')
    expect(call.messages[1].content).toContain(region)
    // the rest of the note is never sent
    expect(call.messages[1].content).not.toContain(chunks[chunks.length - 1]!.text)

    expect(m.updateTextFileMock).toHaveBeenCalledTimes(1)
    const [userId, noteId, input, options] = m.updateTextFileMock.mock.calls[0]
    expect([userId, noteId]).toEqual(['u1', 'n1'])
    expect(options).toEqual({ agentWrite: true })
    expect(input.body).toBe(
      numbered.slice(0, first.startChar) + rewritten + numbered.slice(last.endChar),
    )
    expect(input.title).toBeUndefined()
  })

  it('a secret anywhere in the note reaches the model only as its numbered placeholder', async () => {
    const body = `${envPaste()}\n\n${sentences(30)}`
    arrangeNote(body)
    // the window covers the .env passage
    m.llmChatCompletionMock.mockImplementation(async ({ messages }: { messages: Array<{ content: string }> }) => {
      const region = messages[1]!.content.split('<<<region r1>>>\n')[1]!.split('\n<<</region>>>')[0]!
      return reply({ regions: [{ region: 'r1', text: region.replace('PORT=3000', '') }] })
    })

    await removeDetailFromNote({ userId: 'u1', noteId: 'n1', detail: 'the port', matchedOrdinals: [0] })

    expect(leaks(JSON.stringify(m.llmChatCompletionMock.mock.calls))).toBe(false)
    expect(JSON.stringify(m.llmChatCompletionMock.mock.calls)).toContain('[redacted secret #1]')
    const saved = m.updateTextFileMock.mock.calls[0]![2].body as string
    expect(leaks(saved)).toBe(false)
    expect(saved).toContain('[redacted secret #1]')
    expect(saved).not.toContain('PORT=3000')
  })

  it('non-adjacent matched passages become separate regions, each rewritten and spliced back', async () => {
    const body = sentences(60)
    const { chunks } = arrangeNote(body)
    const ordinals = [1, chunks.length - 2]
    m.llmChatCompletionMock.mockImplementation(async ({ messages }: { messages: Array<{ content: string }> }) => {
      const regions = [...messages[1]!.content.matchAll(/<<<region (r\d+)>>>\n([\s\S]*?)\n<<<\/region>>>/g)]
      return reply({
        regions: regions.map((r) => ({ region: r[1], text: r[2]!.replace(/Sentence number \d+ talks about topic 5 [^.]*\./, '') })),
      })
    })
    await removeDetailFromNote({ userId: 'u1', noteId: 'n1', detail: 'topic 5', matchedOrdinals: ordinals })
    const call = m.llmChatCompletionMock.mock.calls[0][0].messages[1].content as string
    expect(call).toContain('<<<region r1>>>')
    expect(call).toContain('<<<region r2>>>')
    expect(m.updateTextFileMock).toHaveBeenCalledTimes(1)
  })

  it('a rewrite that changes nothing fails loudly (the detail would still be remembered); nothing is saved', async () => {
    const body = sentences(30)
    const { numbered, chunks } = arrangeNote(body)
    const region = numbered.slice(chunks[1]!.startChar, chunks[3]!.endChar)
    m.llmChatCompletionMock.mockResolvedValue(reply({ regions: [{ region: 'r1', text: region }] }))
    await expect(
      removeDetailFromNote({ userId: 'u1', noteId: 'n1', detail: 'x', matchedOrdinals: [2] }),
    ).rejects.toThrow(/unchanged/)
    expect(m.updateTextFileMock).not.toHaveBeenCalled()
  })

  it('a note that was archived or deleted since retrieval is gone: nothing to edit', async () => {
    m.getTextFileMock.mockResolvedValue(null)
    expect(
      await removeDetailFromNote({ userId: 'u1', noteId: 'n1', detail: 'x', matchedOrdinals: [0] }),
    ).toBe('gone')
    expect(m.llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('passages that no longer match the note body fail loudly (stale index), never a blind splice', async () => {
    m.getTextFileMock.mockResolvedValue({ id: 'n1', title: 'T', body: sentences(30) })
    m.loadStoredPassagesMock.mockResolvedValue(
      chunkNoteIntoPassages(sentences(30).replaceAll('Sentence', 'Other')).map((c, i) => ({ id: `p${i}`, ...c })),
    )
    await expect(
      removeDetailFromNote({ userId: 'u1', noteId: 'n1', detail: 'x', matchedOrdinals: [2] }),
    ).rejects.toThrow(/stale/)
    expect(m.llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('a note emptied by the removal (no title either) is archived instead of saved empty', async () => {
    const body = 'I like surfing.'
    arrangeNote(body, '')
    m.llmChatCompletionMock.mockResolvedValue(reply({ regions: [{ region: 'r1', text: '' }] }))
    const out = await removeDetailFromNote({
      userId: 'u1',
      noteId: 'n1',
      detail: 'surfing',
      matchedOrdinals: [0],
    })
    expect(out).toBe('archived')
    expect(m.archiveTextFileMock).toHaveBeenCalledWith('u1', 'n1')
    expect(m.updateTextFileMock).not.toHaveBeenCalled()
  })

  it('an emptied body with a title is saved empty (title-only notes are valid)', async () => {
    arrangeNote('I like surfing.', 'Hobbies')
    m.llmChatCompletionMock.mockResolvedValue(reply({ regions: [{ region: 'r1', text: '' }] }))
    expect(
      await removeDetailFromNote({ userId: 'u1', noteId: 'n1', detail: 'surfing', matchedOrdinals: [0] }),
    ).toBe('edited')
    expect(m.updateTextFileMock.mock.calls[0]![2].body).toBe('')
  })

  it('the prompt asks for verbatim keeping of everything else, placeholders included, in the note language', () => {
    expect(REMOVE_NOTE_DETAIL_PROMPT).toMatch(/exactly as written/i)
    expect(REMOVE_NOTE_DETAIL_PROMPT).toContain('[redacted secret #n]')
    expect(REMOVE_NOTE_DETAIL_PROMPT).toMatch(/any language/i)
  })
})
