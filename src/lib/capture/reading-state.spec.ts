import { describe, expect, it } from 'vitest'
import {
  HASH_TOKEN,
  READING_DEBOUNCE_MS,
  READING_MIN_CHARS,
  categoryLabel,
  hashQueryAt,
  isReadingFresh,
  readingFromPreview,
  readingStatusFor,
  readingTypeKeys,
  stripHashAt,
  stripTrailingHash,
  withAcceptedType,
  type ReadingDraft,
} from './reading-state'

const RAW = 'Call the studio about the frame order'

const preview = {
  interpretedText: 'Call the studio about the frame order today',
  category: {
    key: 'task',
    confidence: 0.9,
    alternatives: [
      { key: 'idea', confidence: 0.05 },
      { key: 'question', confidence: 0.03 },
    ],
  },
  entities: [{ surface: 'the studio', entityType: 'organization', confidence: 0.6 }],
  deviatesFromVerbatim: true,
}

const draft = (over: Partial<ReadingDraft> = {}): ReadingDraft => ({
  rawText: RAW,
  reading: preview,
  ...over,
})

describe('reading debounce mapping (ei app.js readCapture)', () => {
  it('declares the debounce and minimum-char thresholds', () => {
    // ei app.js:327 (v.length < 8) and :336 (setTimeout 620)
    expect(READING_MIN_CHARS).toBe(8)
    expect(READING_DEBOUNCE_MS).toBeGreaterThanOrEqual(600)
    expect(READING_DEBOUNCE_MS).toBeLessThan(1000)
  })

  it('maps empty and short input to idle, long enough input to waiting', () => {
    expect(readingStatusFor('')).toBe('idle')
    expect(readingStatusFor('   \n  ')).toBe('idle')
    expect(readingStatusFor('short')).toBe('idle')
    expect(readingStatusFor('7 chars')).toBe('idle')
    expect(readingStatusFor('8 chars!')).toBe('waiting')
    expect(readingStatusFor('   8 chars!   ')).toBe('waiting')
  })
})

describe('readingFromPreview (client boundary validation of POST /api/capture/read)', () => {
  it('keeps the preview bundle as the draft — there is no thoughtId: nothing was stored', () => {
    const d = readingFromPreview({ preview }, RAW)
    expect(d).not.toBeNull()
    expect(d?.rawText).toBe(RAW)
    expect(d?.reading).toEqual(preview)
    expect(d && 'thoughtId' in d).toBe(false)
  })

  it('records the exact trimmed raw the server read, for freshness checks', () => {
    expect(readingFromPreview({ preview }, `  ${RAW}  `)?.rawText).toBe(RAW)
  })

  it('returns null on contract violations instead of guessing (no fallbacks)', () => {
    expect(readingFromPreview(null, RAW)).toBeNull()
    expect(readingFromPreview({}, RAW)).toBeNull()
    expect(readingFromPreview({ preview: null }, RAW)).toBeNull()
    expect(readingFromPreview({ preview: { ...preview, interpretedText: '  ' } }, RAW)).toBeNull()
    expect(
      readingFromPreview({ preview: { ...preview, category: { ...preview.category, key: '' } } }, RAW),
    ).toBeNull()
    expect(
      readingFromPreview(
        { preview: { ...preview, category: { ...preview.category, confidence: 2 } } },
        RAW,
      ),
    ).toBeNull()
    expect(readingFromPreview({ preview: { ...preview, entities: 'x' } }, RAW)).toBeNull()
    expect(
      readingFromPreview({ preview: { ...preview, deviatesFromVerbatim: 'yes' } }, RAW),
    ).toBeNull()
  })

  it('drops malformed alternatives rather than inventing keys', () => {
    const d = readingFromPreview(
      {
        preview: {
          ...preview,
          category: {
            ...preview.category,
            alternatives: [{ key: 'idea', confidence: 0.1 }, { confidence: 0.2 }, { key: '' }],
          },
        },
      },
      RAW,
    )
    expect(d?.reading.category.alternatives).toEqual([{ key: 'idea', confidence: 0.1 }])
  })
})

describe('isReadingFresh (verbatim-invariant guard for keep)', () => {
  it('is fresh only when the draft was read from exactly the current trimmed raw', () => {
    const d = draft()
    expect(isReadingFresh(d, RAW)).toBe(true)
    expect(isReadingFresh(d, `  ${RAW}  `)).toBe(true)
    expect(isReadingFresh(d, `${RAW} today`)).toBe(false)
    expect(isReadingFresh(null, RAW)).toBe(false)
  })
})

describe('the type menu mutates the client copy of the accepted reading', () => {
  it('offers the LLM primary first, then its own alternatives, without duplicates', () => {
    expect(readingTypeKeys(draft())).toEqual(['task', 'idea', 'question'])
    expect(
      readingTypeKeys(
        draft({
          reading: {
            ...preview,
            category: { ...preview.category, alternatives: [{ key: 'task', confidence: 0.1 }] },
          },
        }),
      ),
    ).toEqual(['task'])
  })

  it('choosing an alternative makes it the accepted key and keeps the rest as alternatives', () => {
    const next = withAcceptedType(draft(), 'question')
    expect(next.reading.category.key).toBe('question')
    expect(next.reading.category.confidence).toBe(0.03)
    expect(next.reading.category.alternatives.map((a) => a.key).sort()).toEqual(['idea', 'task'])
    // the rest of the accepted reading is untouched
    expect(next.reading.interpretedText).toBe(preview.interpretedText)
    expect(next.reading.entities).toEqual(preview.entities)
    expect(next.rawText).toBe(RAW)
    // the original draft is not mutated in place
    expect(draft().reading.category.key).toBe('task')
  })

  it('choosing the current key is a no-op; a key the LLM never offered is refused', () => {
    const d = draft()
    expect(withAcceptedType(d, 'task')).toBe(d)
    expect(withAcceptedType(d, 'reminder')).toBe(d)
  })
})

describe('categoryLabel (render-only prettify of ontology keys)', () => {
  it('prettifies snake keys without deciding meaning', () => {
    expect(categoryLabel('task')).toBe('Task')
    expect(categoryLabel('memory_type')).toBe('Memory type')
    expect(categoryLabel('to-do')).toBe('To-do')
    expect(categoryLabel('')).toBe('')
  })
})

describe('hash token mechanics (editing, ported from ei app.js:415-431)', () => {
  it('HASH_TOKEN matches a trailing #token before the caret', () => {
    expect(HASH_TOKEN.test('new studio #')).toBe(true)
    expect(HASH_TOKEN.test('new studio #gar')).toBe(true)
    expect(HASH_TOKEN.test('new studio')).toBe(false)
  })

  it('hashQueryAt extracts the query after the caret-positioned #', () => {
    expect(hashQueryAt('mind #gar', 9)).toBe('gar')
    expect(hashQueryAt('mind #', 6)).toBe('')
    expect(hashQueryAt('mind #gar', 5)).toBeNull()
    expect(hashQueryAt('no hash here', 12)).toBeNull()
    expect(hashQueryAt('a #b c', 6)).toBeNull()
  })

  it('stripHashAt removes the token before the caret and keeps the rest', () => {
    expect(stripHashAt('mind #gar', 9)).toEqual({ value: 'mind ', caret: 5 })
    expect(stripHashAt('mind #', 6)).toEqual({ value: 'mind ', caret: 5 })
    expect(stripHashAt('mind #gar rest', 9)).toEqual({ value: 'mind  rest', caret: 5 })
  })

  it('stripTrailingHash drops an unconfirmed trailing token on submit (ei app.js:442)', () => {
    expect(stripTrailingHash('a thought #gar')).toBe('a thought')
    expect(stripTrailingHash('a thought #')).toBe('a thought')
    expect(stripTrailingHash('a thought with #hash inside')).toBe('a thought with #hash inside')
    expect(stripTrailingHash('  spaced #tok  ')).toBe('spaced')
  })

  it('verbatim invariant at submit: raw_text is the typed words — only an unpicked trailing #token and outer whitespace go', () => {
    // The page keeps stripTrailingHash(raw) as raw_text (src/routes/capture/+page.svelte submitCapture).
    // Ordinary text is kept character-for-character; inner spacing, punctuation and inner hashes stay.
    const typed = 'Call   the studio — about #frame order?! ✨'
    expect(stripTrailingHash(typed)).toBe(typed)
    // The two documented exceptions, and nothing else:
    expect(stripTrailingHash(`${typed}   `)).toBe(typed)
    expect(stripTrailingHash(`${typed} #garden`)).toBe(typed)
  })
})
