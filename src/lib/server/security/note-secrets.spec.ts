import { describe, expect, it } from 'vitest'
import { envPaste, FAKE_SECRETS, guardWouldTrip, leaks } from '$lib/test/secret-fixtures'
import { redactSecrets } from './detect-secrets'
import {
  BARE_SECRET_PLACEHOLDER_ERROR,
  noteIndexSurfaces,
  numberNoteSecrets,
  restoreNoteSecrets,
  restoreOriginalSlice,
  unknownSecretPlaceholderError,
} from './note-secrets'

/** A note with two secrets and a typo-able sentence between and around them. */
function twoSecretNote(): string {
  return [
    'Deploy runbook, versoin 3',
    `LLM_API_KEY=${FAKE_SECRETS.openai}`,
    'Restart the worker afterwards.',
    `GITHUB_TOKEN=${FAKE_SECRETS.githubClassic}`,
    'Done.',
  ].join('\n')
}

describe('numberNoteSecrets: what the agent is shown', () => {
  it('renders each secret as [redacted secret #n] in text order and keeps the names', () => {
    const shown = numberNoteSecrets(twoSecretNote())
    expect(shown).toBe(
      [
        'Deploy runbook, versoin 3',
        'LLM_API_KEY=[redacted secret #1]',
        'Restart the worker afterwards.',
        'GITHUB_TOKEN=[redacted secret #2]',
        'Done.',
      ].join('\n'),
    )
    expect(leaks(shown)).toBe(false)
  })

  it('ordinals are stable for the same body', () => {
    const body = twoSecretNote()
    expect(numberNoteSecrets(body)).toBe(numberNoteSecrets(body))
  })

  it('is idempotent and leaves a body without secrets alone', () => {
    const shown = numberNoteSecrets(twoSecretNote())
    expect(numberNoteSecrets(shown)).toBe(shown)
    expect(numberNoteSecrets('commit 9f3a2c1, order #A12B')).toBe('commit 9f3a2c1, order #A12B')
  })

  it('a numbered body does not trip the gateway guard', () => {
    expect(guardWouldTrip(numberNoteSecrets(twoSecretNote()))).toBe(false)
  })
})

describe('restoreNoteSecrets: agent write -> stored body', () => {
  it('a typo fix elsewhere gives the original body with only the typo changed', () => {
    const stored = twoSecretNote()
    const edited = numberNoteSecrets(stored).replace('versoin', 'version')
    const restored = restoreNoteSecrets(edited, stored)
    expect(restored).toBe(stored.replace('versoin', 'version'))
  })

  it('restores every occurrence, in any order, including a repeated ordinal', () => {
    const stored = twoSecretNote()
    const out = restoreNoteSecrets(
      'second [redacted secret #2], first [redacted secret #1], again [redacted secret #2]',
      stored,
    )
    expect(out).toBe(
      `second ${FAKE_SECRETS.githubClassic}, first ${FAKE_SECRETS.openai}, again ${FAKE_SECRETS.githubClassic}`,
    )
  })

  it('values containing $ patterns are inserted literally', () => {
    const stored = 'password: pa$&ss$1word9'
    expect(restoreNoteSecrets('password: [redacted secret #1]', stored)).toBe(stored)
  })

  it('text without placeholders passes through unchanged (and needs no stored secrets)', () => {
    expect(restoreNoteSecrets('buy milk', 'eggs')).toBe('buy milk')
  })

  it('an ordinal that does not exist in the stored body fails loud', () => {
    expect(() => restoreNoteSecrets('x [redacted secret #7]', twoSecretNote())).toThrow(
      'placeholder #7 does not exist in this note; keep placeholders exactly as returned',
    )
    expect(() => restoreNoteSecrets('x [redacted secret #3]', twoSecretNote())).toThrow(
      unknownSecretPlaceholderError('3'),
    )
  })

  it('ordinal 0, leading zeros and a body without secrets are all unknown', () => {
    expect(() => restoreNoteSecrets('[redacted secret #0]', twoSecretNote())).toThrow(
      /#0 does not exist/,
    )
    expect(() => restoreNoteSecrets('[redacted secret #01]', twoSecretNote())).toThrow(
      /#01 does not exist/,
    )
    expect(() => restoreNoteSecrets('[redacted secret #1]', 'eggs')).toThrow(/#1 does not exist/)
  })

  it('a malformed ordinal ("#n", "#1a", "#") fails loud instead of being saved as text, and is never echoed back', () => {
    expect(() => restoreNoteSecrets('x [redacted secret #n]', twoSecretNote())).toThrow(
      unknownSecretPlaceholderError('?'),
    )
    expect(() => restoreNoteSecrets('x [redacted secret #1a]', twoSecretNote())).toThrow(
      /#\? does not exist/,
    )
    expect(() => restoreNoteSecrets('x [redacted secret #]', twoSecretNote())).toThrow(
      /#\? does not exist/,
    )
    try {
      restoreNoteSecrets(`x [redacted secret #${FAKE_SECRETS.openai}]`, twoSecretNote())
      expect.unreachable()
    } catch (err) {
      expect(leaks((err as Error).message)).toBe(false)
    }
  })

  it('restores against the CURRENT stored body: a concurrent edit that removed a secret makes its ordinal unknown', () => {
    const shownEarlier = numberNoteSecrets(twoSecretNote())
    const edited = shownEarlier.replace('versoin', 'version')
    // meanwhile the user deleted the second secret in the Notes editor
    const currentStored = twoSecretNote().replace(
      `GITHUB_TOKEN=${FAKE_SECRETS.githubClassic}\n`,
      '',
    )
    expect(() => restoreNoteSecrets(edited, currentStored)).toThrow(
      unknownSecretPlaceholderError('2'),
    )
  })

  it('a bare placeholder fails loud with the Notes editor message', () => {
    expect(() => restoreNoteSecrets('key: [redacted secret]', twoSecretNote())).toThrow(
      BARE_SECRET_PLACEHOLDER_ERROR,
    )
    expect(BARE_SECRET_PLACEHOLDER_ERROR).toMatch(/Notes editor/)
    // even next to a valid numbered one: nothing is half-restored
    expect(() =>
      restoreNoteSecrets('[redacted secret #1] and [redacted secret]', twoSecretNote()),
    ).toThrow(BARE_SECRET_PLACEHOLDER_ERROR)
  })

  it('the error texts never carry a secret value', () => {
    for (const run of [
      () => restoreNoteSecrets('[redacted secret #9]', twoSecretNote()),
      () => restoreNoteSecrets('[redacted secret]', twoSecretNote()),
    ]) {
      try {
        run()
        expect.unreachable()
      } catch (err) {
        expect(leaks((err as Error).message)).toBe(false)
      }
    }
  })
})

describe('noteIndexSurfaces: what is indexed', () => {
  it('passages come from the numbered body, the lexical surface from the unnumbered redaction, neither holds a value', () => {
    const { passageBody, lexicalText } = noteIndexSurfaces(
      `key ${FAKE_SECRETS.githubClassic}`,
      twoSecretNote(),
    )
    expect(passageBody).toBe(numberNoteSecrets(twoSecretNote()))
    expect(leaks(passageBody)).toBe(false)
    expect(leaks(lexicalText)).toBe(false)
    expect(lexicalText).toContain('redacted secret')
  })
})

describe('restoreOriginalSlice: capture-split note body -> original values', () => {
  it('maps a body cut from the redacted capture back to the original slice (several secrets)', () => {
    const original = `Runbook\n${envPaste()}\nToken ${FAKE_SECRETS.githubClassic} for CI.\nThen call Mom.`
    const redacted = redactSecrets(original).text
    const body = redacted.slice(
      redacted.indexOf('DATABASE_URL'),
      redacted.indexOf('\nThen call Mom.'),
    )
    expect(body).toContain('[redacted secret]')

    const restored = restoreOriginalSlice(original, body)

    expect(restored).toBe(
      original.slice(original.indexOf('DATABASE_URL'), original.indexOf('\nThen call Mom.')),
    )
    expect(restored).toContain(FAKE_SECRETS.urlPassword)
    expect(restored).toContain(FAKE_SECRETS.openai)
    expect(restored).toContain(FAKE_SECRETS.githubClassic)
  })

  it('maps the whole capture (a reference note with no intent line)', () => {
    const original = envPaste()
    expect(restoreOriginalSlice(original, redactSecrets(original).text)).toBe(original)
  })

  it('maps a slice that starts or ends exactly at a placeholder', () => {
    const original = `a LLM_API_KEY=${FAKE_SECRETS.openai} b`
    expect(restoreOriginalSlice(original, '[redacted secret] b')).toBe(`${FAKE_SECRETS.openai} b`)
    expect(restoreOriginalSlice(original, 'a LLM_API_KEY=[redacted secret]')).toBe(
      `a LLM_API_KEY=${FAKE_SECRETS.openai}`,
    )
  })

  it('a slice without a placeholder is returned as is', () => {
    expect(restoreOriginalSlice(twoSecretNote(), 'Done.')).toBe('Done.')
  })

  it('a literal "[redacted secret]" the user typed is not mistaken for a finding', () => {
    const original = `I write [redacted secret] when hiding things. LLM_API_KEY=${FAKE_SECRETS.openai}`
    const redacted = redactSecrets(original).text
    expect(restoreOriginalSlice(original, redacted)).toBe(original)
    expect(restoreOriginalSlice(original, 'I write [redacted secret] when hiding things.')).toBe(
      'I write [redacted secret] when hiding things.',
    )
  })

  it('the same body at two places with different secrets is ambiguous and fails loud', () => {
    const original = `LLM_API_KEY=${FAKE_SECRETS.openai}\nLLM_API_KEY=${FAKE_SECRETS.anthropic}`
    expect(() => restoreOriginalSlice(original, 'LLM_API_KEY=[redacted secret]')).toThrow(
      /several places/,
    )
  })

  it('the same body at two places with the SAME secret is not ambiguous', () => {
    const original = `LLM_API_KEY=${FAKE_SECRETS.openai}\nLLM_API_KEY=${FAKE_SECRETS.openai}`
    expect(restoreOriginalSlice(original, 'LLM_API_KEY=[redacted secret]')).toBe(
      `LLM_API_KEY=${FAKE_SECRETS.openai}`,
    )
  })

  it('a body that is not part of the capture fails loud', () => {
    expect(() =>
      restoreOriginalSlice(
        envPaste(),
        'LLM_API_KEY=[redacted secret] and something the user never wrote',
      ),
    ).toThrow(/not a verbatim part of the capture/)
  })

  it('a slice that ends inside a placeholder is not a location and fails loud', () => {
    const original = `LLM_API_KEY=${FAKE_SECRETS.openai}`
    expect(() => restoreOriginalSlice(original, 'LLM_API_KEY=[redacted secret')).toThrow(
      /not a verbatim part of the capture/,
    )
  })
})
