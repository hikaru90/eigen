import { beforeEach, describe, expect, it, vi } from 'vitest'

const { llmMock } = vi.hoisted(() => ({ llmMock: vi.fn() }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmMock }))
vi.mock('$lib/server/ontology/llm-json', () => ({
  extractChatContent: (r: { content: string }) => r.content,
}))

import type { NowCandidates } from './now-candidates'
import {
  buildNowDeckMessages,
  generateNowDeck,
  NOW_DECK_LOG_CONTEXT,
  NOW_DECK_MAX_ATTEMPTS,
  parseNowDeck,
  type NowDeckContext,
} from './now-deck'

const candidates: NowCandidates = {
  thoughts: [
    {
      thoughtId: 'th-1',
      category: 'task',
      snippet: 'Send the signed form to the accountant',
      author: 'user',
      createdAt: '2026-10-01T10:00:00.000Z',
      project: { id: 'pr-1', label: 'Taxes', rank: 1 },
      eventAt: '2026-11-18T00:00:00.000Z',
      skipCount: 0,
    },
    {
      thoughtId: 'th-2',
      category: 'task',
      snippet: 'Report: I finished the migration',
      author: 'agent',
      createdAt: '2026-06-05T10:00:00.000Z',
      project: null,
      eventAt: null,
      skipCount: 4,
    },
    {
      thoughtId: 'th-3',
      category: 'goal',
      snippet: 'Change the key battery',
      author: 'user',
      createdAt: '2026-09-02T10:00:00.000Z',
      project: null,
      eventAt: null,
      skipCount: 0,
    },
  ],
  projects: [
    {
      entityId: 'pr-1',
      label: 'Taxes',
      deadline: '2026-12-31T00:00:00.000Z',
      milestones: [{ label: 'Filing', targetDate: '2026-12-01T00:00:00.000Z', completedAt: null }],
      nextAction: 'Send the signed form to the accountant',
      openTaskCount: 3,
      stalledReason: null,
    },
    {
      entityId: 'pr-2',
      label: 'Sewer',
      deadline: null,
      milestones: [],
      nextAction: null,
      openTaskCount: 0,
      stalledReason: 'no_next_action',
    },
  ],
  candidatesOmitted: 0,
}

const ontologyKeys = ['task', 'note', 'record']

const context: NowDeckContext = {
  language: 'de',
  localDate: '2026-11-09',
  weekday: 'Monday',
  localTime: '09:30',
  ontologyKeys,
  candidates,
}

const doCard = {
  kind: 'do',
  thoughtId: 'th-1',
  text: 'Send the signed form to the accountant.',
  why: 'Your deadline is in 9 days.',
}
const sortCard = {
  kind: 'sort',
  thoughtId: 'th-2',
  text: 'The migration report: still open?',
  why: 'Skipped four times.',
}
const fileCard = {
  kind: 'file',
  thoughtId: 'th-3',
  projectEntityId: 'pr-1',
  text: 'Change the key battery: file under Taxes?',
  why: 'It sounds like part of Taxes.',
  notTaskCategory: 'note',
}
const unblockCard = {
  kind: 'unblock',
  projectEntityId: 'pr-2',
  text: 'Sewer has no next step.',
  why: 'Nothing is marked next.',
  suggestedStep: 'Book the site visit',
}

const deck = (...cards: unknown[]) => JSON.stringify({ cards })

describe('buildNowDeckMessages (NOW-5)', () => {
  it('states every prompt rule, the schema and the language', () => {
    const [system] = buildNowDeckMessages(context)
    const text = system.content as string
    expect(system.role).toBe('system')
    expect(text).toContain('"cards"')
    expect(text).toContain('"suggestedStep"')
    expect(text).toContain('"notTaskCategory"')
    expect(text).toContain('"de"')
    expect(text).toContain('1 to 12 cards')
    expect(text).toMatch(/first card is a "do" card whenever/i)
    expect(text).toMatch(/at most two cards in a row that are not "do"/i)
    expect(text).toMatch(/vague next action gets an "unblock" card/i)
    expect(text).toMatch(/report, record or duplicate gets a "sort" card/i)
    expect(text).toMatch(/skipped several times gets a "sort" card/i)
    expect(text).toMatch(/never invent dates or people/i)
    expect(text).toMatch(/deadlines|overdue/i)
    expect(text).toMatch(/one card per/i)
  })

  it('lists the ontology keys the file card may use', () => {
    const [system] = buildNowDeckMessages(context)
    for (const key of ontologyKeys) expect(system.content).toContain(key)
  })

  it('hands the model only the listed facts: date, weekday, time and the candidates', () => {
    const [, user] = buildNowDeckMessages(context)
    const text = user.content as string
    expect(text).toContain('2026-11-09')
    expect(text).toContain('Monday')
    expect(text).toContain('09:30')
    expect(text).toContain('th-1')
    expect(text).toContain('Send the signed form to the accountant')
    expect(text).toContain('Taxes')
    expect(text).toContain('author: agent')
    expect(text).toContain('skipped: 4')
    expect(text).toContain('2026-11-18')
    expect(text).toContain('pr-2')
    expect(text).toContain('no_next_action')
    expect(text).not.toContain('older items are not listed')
  })

  it('says how many older thoughts were left out', () => {
    const [, user] = buildNowDeckMessages({
      ...context,
      candidates: { ...candidates, candidatesOmitted: 37 },
    })
    expect(user.content).toContain('37 older')
  })
})

describe('parseNowDeck (NOW-5 validation)', () => {
  const parse = (content: string) => parseNowDeck(content, candidates, ontologyKeys)

  it('accepts a valid deck of all four kinds and returns normalized drafts', () => {
    const drafts = parse(deck(doCard, sortCard, fileCard, unblockCard))
    expect(drafts).toHaveLength(4)
    expect(drafts[0]).toEqual({
      kind: 'do',
      thoughtId: 'th-1',
      projectEntityId: null,
      text: 'Send the signed form to the accountant.',
      why: 'Your deadline is in 9 days.',
      suggestedStep: null,
      notTaskCategory: null,
    })
    expect(drafts[3]).toMatchObject({
      kind: 'unblock',
      thoughtId: null,
      projectEntityId: 'pr-2',
      suggestedStep: 'Book the site visit',
    })
  })

  const failures: Array<[string, string, RegExp]> = [
    ['invalid JSON', 'not json', /./],
    ['no cards', deck(), /schema/],
    ['more than 12 cards', deck(...Array(13).fill(doCard)), /schema/],
    ['unknown kind', deck({ ...doCard, kind: 'plan' }), /schema/],
    ['text over 140', deck({ ...doCard, text: 'x'.repeat(141) }), /schema/],
    ['why over 100', deck({ ...doCard, why: 'x'.repeat(101) }), /schema/],
    ['suggestedStep over 140', deck({ ...unblockCard, suggestedStep: 'x'.repeat(141) }), /schema/],
    ['empty text', deck({ ...doCard, text: '  ' }), /schema/],
    ['thought id outside the candidates', deck({ ...doCard, thoughtId: 'nope' }), /thoughtId/],
    ['project id outside the candidates', deck({ ...unblockCard, projectEntityId: 'nope' }), /projectEntityId/],
    ['do without thoughtId', deck({ ...doCard, thoughtId: undefined }), /thoughtId/],
    ['sort without thoughtId', deck({ ...sortCard, thoughtId: undefined }), /thoughtId/],
    ['file without thoughtId', deck({ ...fileCard, thoughtId: undefined }), /thoughtId/],
    ['file without projectEntityId', deck({ ...fileCard, projectEntityId: undefined }), /projectEntityId/],
    ['file without notTaskCategory', deck({ ...fileCard, notTaskCategory: undefined }), /notTaskCategory/],
    ['file with category outside the ontology', deck({ ...fileCard, notTaskCategory: 'idea' }), /notTaskCategory/],
    ['unblock without projectEntityId', deck({ ...unblockCard, projectEntityId: undefined }), /projectEntityId/],
    ['unblock without suggestedStep', deck({ ...unblockCard, suggestedStep: undefined }), /suggestedStep/],
    ['two cards for one thought', deck(doCard, { ...sortCard, thoughtId: 'th-1' }), /one card per/],
    ['two cards for one project', deck(unblockCard, { ...unblockCard, text: 'Again' }), /one card per/],
  ]

  it.each(failures)('throws on %s', (_name, content, pattern) => {
    expect(() => parse(content)).toThrow(pattern)
  })

  it('does not drop a bad card among good ones: the whole deck fails', () => {
    expect(() => parse(deck(doCard, { ...sortCard, thoughtId: 'nope' }))).toThrow(/thoughtId/)
  })
})

describe('generateNowDeck (NOW-5, NOW-6)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('bills the user under mesh_now_deck and returns the validated deck', async () => {
    llmMock.mockResolvedValue({ content: deck(doCard, unblockCard) })
    const drafts = await generateNowDeck({ userId: 'u1', context })
    expect(drafts.map((d) => d.kind)).toEqual(['do', 'unblock'])
    expect(NOW_DECK_LOG_CONTEXT).toBe('mesh_now_deck')
    expect(llmMock).toHaveBeenCalledTimes(1)
    expect(llmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        logContext: 'mesh_now_deck',
        responseFormat: 'json_object',
      }),
    )
  })

  it('retries a deck that fails validation and uses the next valid one', async () => {
    llmMock
      .mockResolvedValueOnce({ content: deck({ ...doCard, thoughtId: 'nope' }) })
      .mockResolvedValueOnce({ content: deck(doCard) })
    await expect(generateNowDeck({ userId: 'u1', context })).resolves.toHaveLength(1)
    expect(llmMock).toHaveBeenCalledTimes(2)
  })

  it('tries exactly three times, then fails in plain language (NOW-6)', async () => {
    llmMock.mockResolvedValue({ content: 'not json' })
    await expect(generateNowDeck({ userId: 'u1', context })).rejects.toThrow(/3 times/)
    expect(NOW_DECK_MAX_ATTEMPTS).toBe(3)
    expect(llmMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry when credits run out, and passes the error through', async () => {
    const noCredits = Object.assign(new Error('Not enough credits'), {
      name: 'InsufficientCreditsError',
    })
    llmMock.mockRejectedValue(noCredits)
    await expect(generateNowDeck({ userId: 'u1', context })).rejects.toBe(noCredits)
    expect(llmMock).toHaveBeenCalledTimes(1)
  })

  it('never logs personal text on a failed attempt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    llmMock.mockResolvedValue({ content: deck({ ...doCard, thoughtId: 'nope' }) })
    await expect(generateNowDeck({ userId: 'u1', context })).rejects.toThrow()
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('Send the signed form')
    expect(logged).not.toContain('accountant')
    warn.mockRestore()
  })
})
