import { describe, expect, it } from 'vitest'
import { alignEvidenceToCaptures, EvidenceNotInHistoryError } from './evidence-alignment'
import { PERSONAMEM_EPOCH, type CaptureItem } from './history-to-captures'

const captures = (...texts: string[]): CaptureItem[] =>
  texts.map((rawText, i) => ({
    rawText,
    capturedAt: new Date(PERSONAMEM_EPOCH.getTime() + i * 864e5),
  }))

const user = (content: string) => ({ role: 'user', content })
const assistant = (content: string) => ({ role: 'assistant', content })
const ask = (q: string, prefType = 'neutral_preferences') => ({ questionId: q, prefType })

describe('alignEvidenceToCaptures', () => {
  const history = captures(
    'I drink green tea.',
    'Almonds, no sugar.',
    'Knees ache.',
    'Tomatoes in spring.',
  )

  it('maps each evidence user turn to the index of the capture with exactly that text', () => {
    expect(
      alignEvidenceToCaptures(
        history,
        [user('Almonds, no sugar.'), assistant('Good.'), user('Tomatoes in spring.')],
        ask('p1-aaaaaaaaaaaa'),
      ),
    ).toEqual([1, 3])
  })

  it('ignores assistant turns, even when their text is not in the history', () => {
    expect(
      alignEvidenceToCaptures(history, [assistant('never said'), user('Knees ache.')], ask('p1-a')),
    ).toEqual([2])
  })

  it('trims the evidence the way captures are trimmed', () => {
    expect(alignEvidenceToCaptures(history, [user('  Knees ache.\n')], ask('p1-a'))).toEqual([2])
  })

  it('is exact: a different case, punctuation or a prefix does not match', () => {
    for (const near of ['knees ache.', 'Knees ache', 'Knees']) {
      expect(() => alignEvidenceToCaptures(history, [user(near)], ask('p1-a'))).toThrow(
        EvidenceNotInHistoryError,
      )
    }
  })

  it('every capture with the same text is evidence (identical text is identical evidence)', () => {
    const repeated = captures('Hello.', 'I like tea.', 'Hello.', 'I like tea.')
    expect(alignEvidenceToCaptures(repeated, [user('I like tea.')], ask('p1-a'))).toEqual([1, 3])
  })

  it('returns sorted, unique indexes', () => {
    expect(
      alignEvidenceToCaptures(
        history,
        [user('Tomatoes in spring.'), user('Almonds, no sugar.'), user('Tomatoes in spring.')],
        ask('p1-a'),
      ),
    ).toEqual([1, 3])
  })

  it('fails loud naming the question, its pref_type and the missing turn', () => {
    const run = () =>
      alignEvidenceToCaptures(
        history,
        [user('Almonds, no sugar.'), user('Not there at all.')],
        ask('p9-123456789abc', 'ask_to_forget'),
      )
    expect(run).toThrow(EvidenceNotInHistoryError)
    expect(run).toThrow(/p9-123456789abc/)
    expect(run).toThrow(/ask_to_forget/)
    expect(run).toThrow(/Not there at all\./)
  })

  it('clips a long missing turn in the message', () => {
    const long = `start ${'x'.repeat(500)}`
    try {
      alignEvidenceToCaptures(history, [user(long)], ask('p1-a'))
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message.length).toBeLessThan(400)
      expect((err as Error).message).toContain('start')
    }
  })

  describe('pref_types whose evidence the dataset does not put in the history', () => {
    it('sensitive_info with none of its evidence in the history is "not in history" (null), not a failure', () => {
      expect(
        alignEvidenceToCaptures(
          history,
          [user('A pasted draft with an IBAN.')],
          ask('p1-a', 'sensitive_info'),
        ),
      ).toBeNull()
    })

    it('sensitive_info whose evidence IS in the history is aligned like any other', () => {
      expect(
        alignEvidenceToCaptures(history, [user('Knees ache.')], ask('p1-a', 'sensitive_info')),
      ).toEqual([2])
    })

    it('sensitive_info with only some of its evidence in the history fails loud', () => {
      expect(() =>
        alignEvidenceToCaptures(
          history,
          [user('Knees ache.'), user('Never said.')],
          ask('p1-a', 'sensitive_info'),
        ),
      ).toThrow(/Never said\./)
    })

    it('no other pref_type is exempt', () => {
      for (const prefType of ['ask_to_forget', 'neutral_preferences', 'therapy_background']) {
        expect(() =>
          alignEvidenceToCaptures(history, [user('Never said.')], ask('p1-a', prefType)),
        ).toThrow(EvidenceNotInHistoryError)
      }
    })
  })

  it('fails loud on evidence without any user turn', () => {
    expect(() => alignEvidenceToCaptures(history, [assistant('Only me.')], ask('p1-a'))).toThrow(
      /no user turn/,
    )
  })
})
