import type { CaptureContentSplitResult } from './split-capture-content'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyCaptureContentSplitIfNeeded,
  applySplitResultLocally,
} from './apply-capture-content-split'
import { LONG_CAPTURE_MIN_CHARS, captureSplitMode } from './split-capture-content'

const {
  resolveCaptureContentSplitMock,
  encryptTenantValueMock,
  decryptTenantValueMock,
  getDbMock,
  createTextFileMock,
  linkTextFileToThoughtMock,
  computeLexicalTextMock,
} = vi.hoisted(() => ({
  resolveCaptureContentSplitMock: vi.fn(),
  encryptTenantValueMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
  getDbMock: vi.fn(),
  createTextFileMock: vi.fn(),
  linkTextFileToThoughtMock: vi.fn(),
  computeLexicalTextMock: vi.fn((text: string) => `lex:${text}`),
}))

vi.mock('$lib/server/capture/split-capture-content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./split-capture-content')>()
  return {
    ...actual,
    resolveCaptureContentSplit: resolveCaptureContentSplitMock,
  }
})

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptTenantValueMock,
  decryptTenantValue: decryptTenantValueMock,
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/memory/lexical-text', () => ({
  computeLexicalText: computeLexicalTextMock,
}))

vi.mock('$lib/server/text-files/service', () => ({
  createTextFile: createTextFileMock,
  linkTextFileToThought: linkTextFileToThoughtMock,
}))

function mockDbUpdateCapture() {
  const setMock = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
  const selectLimit = vi.fn().mockResolvedValue([{ metadata: {}, metadataEncrypted: null }])
  getDbMock.mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: selectLimit,
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: setMock,
    }),
  })
  return { setMock, selectLimit }
}

describe('applySplitResultLocally', () => {
  it('keeps raw_text as original and ignores mangled thought_only thoughtText', () => {
    const original =
      "When I open a project in the project pane and I click on the checkbox, the task on the project view doesn't get marked as done."
    const split: CaptureContentSplitResult = {
      mode: 'thought_only',
      thoughtText: "Task can't be marked as done",
      attachmentTitle: '',
      attachmentBody: '',
      rationale: 'bad paraphrase',
    }

    const out = applySplitResultLocally(original, split)
    expect(out.rawText).toBe(original)
    expect(out.normalizedText).toBe(original)
  })

  it('on split keeps raw_text as original and uses pointer for normalized_text', () => {
    const original = 'Pasta carbonara recipe from Nonna\n\nIngredients: spaghetti…'
    const split: CaptureContentSplitResult = {
      mode: 'split',
      thoughtText: 'Pasta carbonara recipe from Nonna',
      attachmentTitle: 'Carbonara recipe',
      attachmentBody: 'Ingredients: spaghetti…',
      rationale: 'recipe',
    }

    const out = applySplitResultLocally(original, split)
    expect(out.rawText).toBe(original.trim())
    expect(out.normalizedText).toBe('Pasta carbonara recipe from Nonna')
  })
})

describe('applyCaptureContentSplitIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptTenantValueMock.mockImplementation(
      async (input: { plaintext: string; column: string }) =>
        `enc:${input.column}:${input.plaintext}`,
    )
    decryptTenantValueMock.mockResolvedValue('{}')
  })

  it('thought_only: reuses existingNormalizedText without re-normalizing', async () => {
    const original = '  spaced   words  '
    resolveCaptureContentSplitMock.mockResolvedValue({
      mode: 'thought_only',
      thoughtText: original,
      attachmentTitle: '',
      attachmentBody: '',
      rationale: 'atomic note',
    } satisfies CaptureContentSplitResult)

    const { setMock } = mockDbUpdateCapture()

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: original,
      existingNormalizedText: 'spaced words',
    })

    expect(out.normalizedText).toBe('spaced words')
    const updatePayload = setMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.normalizedText).toBe('spaced words')
  })

  it('thought_only: never writes raw_text; keeps whitespace-normalized original', async () => {
    const original =
      "When I open a project in the project pane and I click on the checkbox, the task on the project view doesn't get marked as done."
    resolveCaptureContentSplitMock.mockResolvedValue({
      mode: 'thought_only',
      thoughtText: original,
      attachmentTitle: '',
      attachmentBody: '',
      rationale: 'atomic note',
    } satisfies CaptureContentSplitResult)

    const { setMock } = mockDbUpdateCapture()

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: original,
    })

    expect(out.rawText).toBe(original)
    expect(out.normalizedText).toBe(original)
    expect(out.attachedFileId).toBeNull()
    expect(createTextFileMock).not.toHaveBeenCalled()

    const updatePayload = setMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload).not.toHaveProperty('rawText')
    expect(updatePayload).not.toHaveProperty('rawTextEncrypted')
    expect(updatePayload.normalizedText).toBe(original)
    expect(encryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'normalized_text', plaintext: original }),
    )
    expect(encryptTenantValueMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ column: 'raw_text' }),
    )
  })

  it('split: updates normalized_text pointer only; raw_text untouched; attaches note', async () => {
    const original = 'Pasta carbonara recipe from Nonna\n\nIngredients: spaghetti…'
    resolveCaptureContentSplitMock.mockResolvedValue({
      mode: 'split',
      thoughtText: 'Pasta carbonara recipe from Nonna',
      attachmentTitle: 'Carbonara recipe',
      attachmentBody: 'Ingredients: spaghetti…',
      rationale: 'recipe',
    } satisfies CaptureContentSplitResult)

    createTextFileMock.mockResolvedValue({ id: 'file-1' })
    linkTextFileToThoughtMock.mockResolvedValue({ linked: true })

    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    })
    const authorshipLimit = vi
      .fn()
      .mockResolvedValue([{ author: 'user', authorLabel: null, authorKeyId: null }])
    const metadataLimit = vi.fn().mockResolvedValue([{ metadata: {}, metadataEncrypted: null }])
    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: () => {
              selectCall += 1
              return selectCall === 1 ? authorshipLimit() : metadataLimit()
            },
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: setMock,
      }),
    })

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: original,
    })

    expect(out.rawText).toBe(original)
    expect(out.normalizedText).toBe('Pasta carbonara recipe from Nonna')
    expect(out.attachedFileId).toBe('file-1')
    expect(createTextFileMock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ body: 'Ingredients: spaghetti…' }),
    )
    expect(linkTextFileToThoughtMock).toHaveBeenCalledWith('u1', 't1', 'file-1')

    const updatePayload = setMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload).not.toHaveProperty('rawText')
    expect(updatePayload).not.toHaveProperty('rawTextEncrypted')
    expect(updatePayload.normalizedText).toBe('Pasta carbonara recipe from Nonna')
  })

  it('split: the attached note inherits the source thought createdAt, not wall clock', async () => {
    const sourceCreatedAt = new Date('2025-03-01T09:00:00.000Z')
    resolveCaptureContentSplitMock.mockResolvedValue({
      mode: 'split',
      thoughtText: 'Please polish my email',
      attachmentTitle: 'Email draft',
      attachmentBody: 'Dear team, I just got back from my knee surgery…',
      rationale: 'pasted body',
    } satisfies CaptureContentSplitResult)
    createTextFileMock.mockResolvedValue({ id: 'file-1' })
    linkTextFileToThoughtMock.mockResolvedValue({ linked: true })

    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: async () => {
              selectCall += 1
              return selectCall === 1
                ? [{ author: 'user', authorLabel: null, authorKeyId: null, createdAt: sourceCreatedAt }]
                : [{ metadata: {}, metadataEncrypted: null }]
            },
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({ set: setMock }),
    })

    await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: 'Please polish my email\n\nDear team, I just got back from my knee surgery…',
      decidedMode: 'split',
    })

    expect(createTextFileMock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ createdAt: sourceCreatedAt }),
    )
  })

  it('passes a decision-model decidedMode through to the split resolver', async () => {
    resolveCaptureContentSplitMock.mockResolvedValue({
      mode: 'split',
      thoughtText: 'pointer',
      attachmentTitle: 'title',
      attachmentBody: 'body',
      rationale: 'r',
    } satisfies CaptureContentSplitResult)

    createTextFileMock.mockResolvedValue({ id: 'file-1' })
    linkTextFileToThoughtMock.mockResolvedValue({ linked: true })
    mockDbUpdateCapture()

    await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: 'raw capture',
      decidedMode: 'split',
    })

    expect(resolveCaptureContentSplitMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', rawText: 'raw capture', decidedMode: 'split' }),
    )
  })

  it('decidedMode thought_only: skips the split resolver entirely — no LLM call, verbatim text', async () => {
    const { setMock } = mockDbUpdateCapture()

    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: '  spaced   words  ',
      existingNormalizedText: 'spaced words',
      decidedMode: 'thought_only',
    })

    expect(resolveCaptureContentSplitMock).not.toHaveBeenCalled()
    expect(createTextFileMock).not.toHaveBeenCalled()
    expect(out.split.mode).toBe('thought_only')
    expect(out.normalizedText).toBe('spaced words')
    expect(out.attachedFileId).toBeNull()
    const updatePayload = setMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.normalizedText).toBe('spaced words')
    // Metadata records WHY the split call was skipped.
    expect(updatePayload.metadataEncrypted).toContain('decision_model')
  })

  it('a long capture is always split — summary thought + full text as a note — even when thought_only was decided', async () => {
    resolveCaptureContentSplitMock.mockResolvedValue({
      mode: 'split',
      thoughtText: 'Summary of the long report',
      attachmentTitle: 'Report',
      attachmentBody: 'x'.repeat(LONG_CAPTURE_MIN_CHARS + 1),
      rationale: 'r',
    } satisfies CaptureContentSplitResult)
    createTextFileMock.mockResolvedValue({ id: 'file-1' })
    linkTextFileToThoughtMock.mockResolvedValue({ linked: true })
    mockDbUpdateCapture()

    const longText = 'word '.repeat(LONG_CAPTURE_MIN_CHARS / 4)
    const out = await applyCaptureContentSplitIfNeeded({
      userId: 'u1',
      thoughtId: 't1',
      rawText: longText,
      decidedMode: 'thought_only',
    })

    expect(resolveCaptureContentSplitMock).toHaveBeenCalledWith(
      expect.objectContaining({ decidedMode: 'split' }),
    )
    expect(createTextFileMock).toHaveBeenCalled()
    expect(out.attachedFileId).toBe('file-1')
  })
})

describe('captureSplitMode', () => {
  it('forces split above the long-capture limit', () => {
    expect(captureSplitMode('a'.repeat(LONG_CAPTURE_MIN_CHARS + 1), undefined)).toBe('split')
    expect(captureSplitMode('a'.repeat(LONG_CAPTURE_MIN_CHARS + 1), 'thought_only')).toBe('split')
  })

  it('leaves shorter captures to the decision (or the judge when undecided)', () => {
    expect(captureSplitMode('short', 'thought_only')).toBe('thought_only')
    expect(captureSplitMode('short', undefined)).toBeUndefined()
    expect(captureSplitMode('a'.repeat(LONG_CAPTURE_MIN_CHARS), undefined)).toBeUndefined()
  })
})
