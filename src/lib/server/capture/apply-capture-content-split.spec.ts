import type { CaptureSplitPlan } from './content-role'
import type { CaptureContentSplitResult } from './split-capture-content'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCaptureContentSplitIfNeeded } from './apply-capture-content-split'

const {
  resolveCaptureContentSplitMock,
  encryptTenantValueMock,
  decryptTenantValueMock,
  getDbMock,
  createTextFileMock,
  linkTextFileToThoughtMock,
  queueSplitChildMock,
  computeLexicalTextMock,
  order,
} = vi.hoisted(() => ({
  resolveCaptureContentSplitMock: vi.fn(),
  encryptTenantValueMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
  getDbMock: vi.fn(),
  createTextFileMock: vi.fn(),
  linkTextFileToThoughtMock: vi.fn(),
  queueSplitChildMock: vi.fn(),
  computeLexicalTextMock: vi.fn((text: string) => `lex:${text}`),
  order: [] as string[],
}))

vi.mock('$lib/server/capture/split-capture-content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./split-capture-content')>()
  return { ...actual, resolveCaptureContentSplit: resolveCaptureContentSplitMock }
})
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptTenantValueMock,
  decryptTenantValue: decryptTenantValueMock,
}))
vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/memory/lexical-text', () => ({ computeLexicalText: computeLexicalTextMock }))
vi.mock('$lib/server/text-files/service', () => ({
  createTextFile: createTextFileMock,
  linkTextFileToThought: linkTextFileToThoughtMock,
}))
vi.mock('$lib/server/capture/queue-split-child', () => ({ queueSplitChild: queueSplitChildMock }))

const SOURCE_CREATED_AT = new Date('2025-03-01T09:00:00.000Z')

const TOPIC_WORK = 'Work ran two hours over today and Jonas pushed back on the roadmap again.'
const TOPIC_BODY = 'My knee aches since Sunday, so I booked physiotherapy for Thursday morning.'
const TOPIC_FAMILY = 'Mom called about her seventieth in March; she wants a small dinner at home.'
const JOURNAL = `${TOPIC_WORK}\n\n${TOPIC_BODY}\n\n${TOPIC_FAMILY}`

type MetadataRow = Record<string, unknown> | null

/** DB double: one parent row on select, every update.set payload recorded in call order. */
function mockDb(metadata: MetadataRow = {}) {
  const setMock = vi.fn((payload: Record<string, unknown>) => {
    order.push(`update:${payload.metadataEncrypted ? 'metadata' : 'other'}`)
    return { where: vi.fn().mockResolvedValue(undefined) }
  })
  const row = {
    author: 'user',
    authorLabel: null,
    authorKeyId: null,
    createdAt: SOURCE_CREATED_AT,
    metadata: {},
    metadataEncrypted: metadata ? `enc:metadata:${JSON.stringify(metadata)}` : null,
  }
  getDbMock.mockReturnValue({
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [row]) })) })),
    })),
    update: vi.fn(() => ({ set: setMock })),
  })
  return { setMock }
}

function storedMetadata(setMock: ReturnType<typeof mockDb>['setMock'], call: number) {
  const payload = setMock.mock.calls[call]?.[0] as Record<string, unknown>
  const encrypted = String(payload.metadataEncrypted)
  return JSON.parse(encrypted.slice('enc:metadata:'.length)) as Record<string, unknown> & {
    captureContentSplit: CaptureSplitPlan
  }
}

function lastMetadata(setMock: ReturnType<typeof mockDb>['setMock']) {
  const calls = setMock.mock.calls.filter((c) => (c[0] as Record<string, unknown>).metadataEncrypted)
  return storedMetadata(setMock, setMock.mock.calls.indexOf(calls[calls.length - 1]!))
}

function updatePayloads(setMock: ReturnType<typeof mockDb>['setMock']) {
  return setMock.mock.calls.map((c) => c[0] as Record<string, unknown>)
}

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  encryptTenantValueMock.mockImplementation(
    async (input: { plaintext: string; column: string }) => `enc:${input.column}:${input.plaintext}`,
  )
  decryptTenantValueMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
    String(ciphertext).replace(/^enc:metadata:/, ''),
  )
  let childCounter = 0
  queueSplitChildMock.mockImplementation(async () => {
    childCounter += 1
    order.push(`child:${childCounter}`)
    return `child-${childCounter}`
  })
  createTextFileMock.mockImplementation(async () => {
    order.push('note')
    return { id: 'file-1' }
  })
  linkTextFileToThoughtMock.mockResolvedValue({ linked: true })
})

describe('personal', () => {
  it('a short entry is one span: stored exactly as before — no children, no note, raw text still visible to enrich', async () => {
    const original = '  spaced   words  '
    resolveCaptureContentSplitMock.mockResolvedValue({
      role: 'personal',
      spans: ['spaced   words'],
      rationale: 'one thing',
    } satisfies CaptureContentSplitResult)
    const { setMock } = mockDb()

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: original,
      existingNormalizedText: 'spaced words',
    })

    expect(out).toMatchObject({
      rawText: original,
      enrichRawText: original,
      normalizedText: 'spaced words',
      role: 'personal',
      attachedFileId: null,
      childThoughtIds: [],
    })
    expect(createTextFileMock).not.toHaveBeenCalled()
    expect(queueSplitChildMock).not.toHaveBeenCalled()
    const payload = updatePayloads(setMock)[0]
    expect(payload.normalizedText).toBe('spaced words')
    expect(payload).not.toHaveProperty('rawText')
    expect(payload).not.toHaveProperty('rawTextEncrypted')
    expect(encryptTenantValueMock).not.toHaveBeenCalledWith(expect.objectContaining({ column: 'raw_text' }))
  })

  it('a ~900-char three-topic entry becomes three verbatim span thoughts and no note', async () => {
    resolveCaptureContentSplitMock.mockResolvedValue({
      role: 'personal',
      spans: [TOPIC_WORK, TOPIC_BODY, TOPIC_FAMILY],
      rationale: 'three distinct things',
    } satisfies CaptureContentSplitResult)
    const { setMock } = mockDb()

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: JOURNAL,
      existingNormalizedText: JOURNAL.replace(/\s+/g, ' '),
      decidedRole: 'personal',
    })

    // the capture's own thought narrows to span 1; spans 2..3 are children
    expect(out.normalizedText).toBe(TOPIC_WORK)
    expect(out.rawText).toBe(JOURNAL)
    expect(out.enrichRawText).toBe(TOPIC_WORK)
    expect(out.childThoughtIds).toEqual(['child-1', 'child-2'])
    expect(out.attachedFileId).toBeNull()
    expect(createTextFileMock).not.toHaveBeenCalled()
    expect(linkTextFileToThoughtMock).not.toHaveBeenCalled()

    // children carry the exact span text, the parent's authorship and its capture time
    expect(queueSplitChildMock).toHaveBeenCalledTimes(2)
    expect(queueSplitChildMock.mock.calls.map((c) => c[0].text)).toEqual([TOPIC_BODY, TOPIC_FAMILY])
    for (const [childInput] of queueSplitChildMock.mock.calls) {
      expect(childInput).toMatchObject({
        userId: 'u1',
        parentThoughtId: 't1',
        parent: { author: 'user', authorLabel: null, authorKeyId: null, createdAt: SOURCE_CREATED_AT },
      })
      expect(childInput).not.toHaveProperty('category')
      expect(JOURNAL).toContain(childInput.text)
    }

    // raw_text of the original is the audit record — never written
    for (const payload of updatePayloads(setMock)) {
      expect(payload).not.toHaveProperty('rawText')
      expect(payload).not.toHaveProperty('rawTextEncrypted')
    }
    // no duplicate memory: the parent's active text is span 1 only, never the whole entry
    const parentUpdate = updatePayloads(setMock)[0]
    expect(parentUpdate.normalizedText).toBe(TOPIC_WORK)
    expect(parentUpdate.lexicalText).toBe(`lex:${TOPIC_WORK}`)

    const final = lastMetadata(setMock)
    expect(final.splitInto).toEqual(['child-1', 'child-2'])
    expect(final.captureContentSplit).toMatchObject({
      role: 'personal',
      spans: [TOPIC_WORK, TOPIC_BODY, TOPIC_FAMILY],
      spanThoughtIds: ['t1', 'child-1', 'child-2'],
      attachedFileId: null,
    })
  })

  it('persists the plan on the parent BEFORE it creates any child', async () => {
    resolveCaptureContentSplitMock.mockResolvedValue({
      role: 'personal',
      spans: [TOPIC_WORK, TOPIC_BODY],
      rationale: 'r',
    } satisfies CaptureContentSplitResult)
    mockDb()

    await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: `${TOPIC_WORK}\n\n${TOPIC_BODY}`,
    })

    expect(order.indexOf('update:metadata')).toBeLessThan(order.indexOf('child:1'))
  })

  it('passes the decided role through to the generation call', async () => {
    resolveCaptureContentSplitMock.mockResolvedValue({
      role: 'personal',
      spans: ['raw capture'],
      rationale: 'r',
    } satisfies CaptureContentSplitResult)
    mockDb()

    await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: 'raw capture',
      decidedRole: 'personal',
    })

    expect(resolveCaptureContentSplitMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', rawText: 'raw capture', decidedRole: 'personal' }),
    )
  })

  it('a failing generation call fails the apply loudly and creates nothing', async () => {
    resolveCaptureContentSplitMock.mockRejectedValue(new Error('span 2 is not a verbatim substring'))
    const { setMock } = mockDb()

    await expect(
      applyCaptureContentSplitIfNeeded({ userId: 'u1', thoughtId: 't1', rawText: JOURNAL }),
    ).rejects.toThrow(/verbatim substring/)
    expect(queueSplitChildMock).not.toHaveBeenCalled()
    expect(createTextFileMock).not.toHaveBeenCalled()
    expect(setMock).not.toHaveBeenCalled()
  })
})

describe('reference', () => {
  it('a pasted recipe: pointer thought + a note holding the recipe, no span children', async () => {
    const original = 'Pasta carbonara recipe from Nonna\n\nIngredients: spaghetti…'
    resolveCaptureContentSplitMock.mockResolvedValue({
      role: 'reference',
      thoughtText: 'Pasta carbonara recipe from Nonna',
      attachmentTitle: 'Carbonara recipe',
      attachmentBody: 'Ingredients: spaghetti…',
      rationale: 'recipe',
    } satisfies CaptureContentSplitResult)
    const { setMock } = mockDb()

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: original,
    })

    expect(out).toMatchObject({
      rawText: original,
      // enrichment sees the pointer only: the recipe body never feeds the graph
      enrichRawText: 'Pasta carbonara recipe from Nonna',
      normalizedText: 'Pasta carbonara recipe from Nonna',
      role: 'reference',
      attachedFileId: 'file-1',
      childThoughtIds: [],
    })
    expect(createTextFileMock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        title: 'Carbonara recipe',
        body: 'Ingredients: spaghetti…',
        // the note is as old as the capture it came with
        createdAt: SOURCE_CREATED_AT,
        authorship: { author: 'user', authorLabel: null, authorKeyId: null },
      }),
    )
    expect(linkTextFileToThoughtMock).toHaveBeenCalledWith('u1', 't1', 'file-1')
    expect(queueSplitChildMock).not.toHaveBeenCalled()

    const first = updatePayloads(setMock)[0]
    expect(first.normalizedText).toBe('Pasta carbonara recipe from Nonna')
    expect(first).not.toHaveProperty('rawText')
    expect(lastMetadata(setMock).captureContentSplit).toMatchObject({
      role: 'reference',
      attachedFileId: 'file-1',
      note: null,
    })
  })

  it('a link failure fails the apply loudly', async () => {
    resolveCaptureContentSplitMock.mockResolvedValue({
      role: 'reference',
      thoughtText: 'pointer',
      attachmentTitle: 'title',
      attachmentBody: 'body',
      rationale: 'r',
    } satisfies CaptureContentSplitResult)
    linkTextFileToThoughtMock.mockResolvedValue({ linked: false, reason: 'thought_not_found' })
    mockDb()

    await expect(
      applyCaptureContentSplitIfNeeded({ userId: 'u1', thoughtId: 't1', rawText: 'raw capture' }),
    ).rejects.toThrow(/failed to link text file file-1/)
  })
})

describe('mixed', () => {
  const PERSONAL = "I'm baking this for Mom's 70th, she can't have nuts:"
  const RECIPE = 'Ingredients: flour, butter, eggs…'

  it('the personal sentence is the thought and the recipe is a note linked to it', async () => {
    resolveCaptureContentSplitMock.mockResolvedValue({
      role: 'mixed',
      spans: [PERSONAL],
      attachmentTitle: 'Birthday cake recipe',
      attachmentBody: RECIPE,
      rationale: 'personal intent plus recipe',
    } satisfies CaptureContentSplitResult)
    const { setMock } = mockDb()

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: `${PERSONAL}\n\n${RECIPE}`,
      decidedRole: 'mixed',
    })

    expect(out).toMatchObject({
      normalizedText: PERSONAL,
      enrichRawText: PERSONAL,
      role: 'mixed',
      attachedFileId: 'file-1',
      childThoughtIds: [],
    })
    expect(createTextFileMock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'Birthday cake recipe', body: RECIPE }),
    )
    expect(linkTextFileToThoughtMock).toHaveBeenCalledWith('u1', 't1', 'file-1')
    expect(updatePayloads(setMock)[0].normalizedText).toBe(PERSONAL)
  })

  it('with several personal spans the note is linked to every span thought', async () => {
    const second = 'She also asked me to bring candles.'
    resolveCaptureContentSplitMock.mockResolvedValue({
      role: 'mixed',
      spans: [PERSONAL, second],
      attachmentTitle: 'Birthday cake recipe',
      attachmentBody: RECIPE,
      rationale: 'r',
    } satisfies CaptureContentSplitResult)
    mockDb()

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: `${PERSONAL} ${second}\n\n${RECIPE}`,
    })

    expect(out.childThoughtIds).toEqual(['child-1'])
    expect(queueSplitChildMock.mock.calls[0][0].text).toBe(second)
    expect(linkTextFileToThoughtMock.mock.calls.map((c) => c[1]).sort()).toEqual(['child-1', 't1'])
    for (const call of linkTextFileToThoughtMock.mock.calls) expect(call[2]).toBe('file-1')
    // the note exists before the children, so each child can be linked as soon as it exists
    expect(order.indexOf('note')).toBeLessThan(order.indexOf('child:1'))
  })
})

describe('a retried enrich resumes instead of re-deciding', () => {
  const plan: CaptureSplitPlan = {
    role: 'mixed',
    rationale: 'r',
    spans: ['first', 'second', 'third'],
    spanThoughtIds: ['t1', null, null],
    note: { title: 'Doc', body: 'body' },
    attachedFileId: null,
  }

  it('creates only what is missing and never calls the generation call again', async () => {
    const { setMock } = mockDb({ captureContentSplit: plan })

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: 'first second third\n\nbody',
      existingNormalizedText: 'first',
    })

    expect(resolveCaptureContentSplitMock).not.toHaveBeenCalled()
    expect(createTextFileMock).toHaveBeenCalledTimes(1)
    expect(queueSplitChildMock.mock.calls.map((c) => c[0].text)).toEqual(['second', 'third'])
    expect(out).toMatchObject({
      normalizedText: 'first',
      enrichRawText: 'first',
      role: 'mixed',
      attachedFileId: 'file-1',
      childThoughtIds: ['child-1', 'child-2'],
    })
    expect(lastMetadata(setMock).captureContentSplit.spanThoughtIds).toEqual(['t1', 'child-1', 'child-2'])
  })

  it('a child created before a crash is not created twice', async () => {
    mockDb({
      captureContentSplit: { ...plan, spanThoughtIds: ['t1', 'child-existing', null], attachedFileId: 'file-0', note: null },
    })

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: 'first second third\n\nbody',
      existingNormalizedText: 'first',
    })

    expect(createTextFileMock).not.toHaveBeenCalled()
    expect(queueSplitChildMock.mock.calls.map((c) => c[0].text)).toEqual(['third'])
    expect(out.childThoughtIds).toEqual(['child-existing', 'child-1'])
    expect(out.attachedFileId).toBe('file-0')
  })

  it('a fully applied plan creates nothing at all', async () => {
    mockDb({
      captureContentSplit: {
        ...plan,
        spanThoughtIds: ['t1', 'c1', 'c2'],
        attachedFileId: 'file-0',
        note: null,
      },
    })

    await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: 'first second third\n\nbody',
      existingNormalizedText: 'first',
    })

    expect(createTextFileMock).not.toHaveBeenCalled()
    expect(queueSplitChildMock).not.toHaveBeenCalled()
    expect(resolveCaptureContentSplitMock).not.toHaveBeenCalled()
  })
})

describe('captures that are never decided or split', () => {
  it('a span child (metadata.splitFrom) is stored as is — no generation call, no writes', async () => {
    const { setMock } = mockDb({ splitFrom: 'parent-1' })

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 'child-1',
      rawText: TOPIC_BODY,
      existingNormalizedText: TOPIC_BODY,
    })

    expect(resolveCaptureContentSplitMock).not.toHaveBeenCalled()
    expect(setMock).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      rawText: TOPIC_BODY,
      enrichRawText: TOPIC_BODY,
      normalizedText: TOPIC_BODY,
      role: 'personal',
      attachedFileId: null,
      childThoughtIds: [],
    })
  })

  it('a row split by the pre-role pipeline (mode thought_only | split) is left as it is', async () => {
    const { setMock } = mockDb({
      captureContentSplit: { mode: 'split', rationale: 'old', attachedFileId: 'file-old' },
    })

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: 'Pasta recipe\n\nIngredients…',
      existingNormalizedText: 'Pasta recipe',
    })

    expect(resolveCaptureContentSplitMock).not.toHaveBeenCalled()
    expect(setMock).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      normalizedText: 'Pasta recipe',
      enrichRawText: 'Pasta recipe',
      attachedFileId: 'file-old',
    })
  })
})
