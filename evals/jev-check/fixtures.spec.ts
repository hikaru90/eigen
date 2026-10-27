import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareCases } from './check'
import { FIXTURES_DIR, FIXTURE_FILE_NAMES, loadFixtureFiles, parseFixtureFile } from './fixtures'

const AUDIT_CASE = {
  id: 'x01',
  input: {
    capturedAt: '2026-10-27T10:00:00+01:00',
    timezone: 'Europe/Berlin',
    rawText: 'Call Mom',
    storedText: 'Call Mom',
    names: [{ ref: 'n1', surface: 'Mom' }],
    dates: [{ ref: 'd1', event: 'Call Mom', day: '2026-10-30', detail: 'at 09:00' }],
    pieces: [],
  },
  expected: {
    'name:n1': 'right',
    missing_names: 'none_missing',
    'date:d1': 'right',
    missing_dates: 'none_missing',
  },
}

const REASON_CASE = {
  id: 'y01',
  input: { rawText: 'Idea: maps', storedSummary: 'Saved as a task', reason: 'this is an idea' },
  expected: { reason: 'wrong_category' },
}

function auditFile(patch: Record<string, unknown> = {}) {
  return { kind: 'capture_audit', cases: [AUDIT_CASE], ...patch }
}

describe('the real fixture files', () => {
  const files = loadFixtureFiles(FIXTURES_DIR)

  it('are the two kinds, each with cases', () => {
    expect(files.map((f) => f.kind)).toEqual(['capture_audit', 'capture_reason'])
    expect(FIXTURE_FILE_NAMES).toEqual(['capture_audit.json', 'capture_reason.json'])
    for (const file of files) expect(file.cases.length).toBeGreaterThan(0)
  })

  it('keep the cases the dry-run example names', () => {
    const ids = files.flatMap((f) => f.cases.map((c) => c.id))
    expect(ids).toContain('a01-clean-task-en')
    expect(ids).toContain('r01-category-idea')
    expect(new Set(ids).size).toBe(ids.length)
  })

  describe('date items', () => {
    const audit = files.find((f) => f.kind === 'capture_audit')
    if (audit?.kind !== 'capture_audit') throw new Error('capture_audit fixtures missing')
    const byId = (id: string) => {
      const found = audit.cases.find((c) => c.id === id)
      if (!found) throw new Error(`fixture ${id} missing`)
      return found
    }

    it('are stored as a calendar day and a detail, each or both, never as free text', () => {
      const dates = audit.cases.flatMap((c) => c.input.dates)
      expect(dates.length).toBeGreaterThan(0)
      for (const d of dates) {
        expect(Object.keys(d).sort()).toEqual(['day', 'detail', 'event', 'ref'])
        expect(d.day !== null || d.detail !== null).toBe(true)
      }
    })

    it.each([
      ['a01-clean-task-en', '2026-10-30', null],
      ['a02-wrong-weekday', '2026-10-29', 'at 09:00'],
      ['a04-wording-typo-fix-ok', '2026-10-28', null],
      ['a05-invented-name', '2026-10-29', null],
      ['a06-missing-place-name', '2026-10-27', 'before 18:00'],
      ['a07-german-clean', '2026-10-28', null],
      ['a08-german-wrong-deadline', '2026-10-31', 'as the deadline'],
      ['a14-recurring-right', null, 'every Tuesday at 19:00'],
      ['a15-date-not-in-capture', '2026-10-30', null],
      ['a16-wrong-hour', '2026-10-30', 'at 15:00'],
      ['a17-far-deadline-right', '2026-11-30', 'as the deadline'],
      ['a18-wrong-repeat-day', null, 'every Thursday at 19:00'],
      ['a19-next-monday', '2026-11-02', null],
      ['a24-repeat-stored-once', '2026-10-27', 'at 19:00'],
    ])('%s stores day %s and detail %s', (id, day, detail) => {
      const dates = byId(id).input.dates
      expect(dates).toHaveLength(1)
      expect(dates[0]).toMatchObject({ ref: 'd1', day, detail })
    })

    it('a16 to a19: the new cases are the planned captures with the planned labels', () => {
      for (const id of [
        'a16-wrong-hour',
        'a17-far-deadline-right',
        'a18-wrong-repeat-day',
        'a19-next-monday',
      ]) {
        const c = byId(id)
        expect(c.input.capturedAt).toBe('2026-10-27T10:00:00+01:00')
        expect(c.input.timezone).toBe('Europe/Berlin')
        expect(c.input.storedText).toBe(c.input.rawText)
        expect(c.input.pieces).toEqual([])
        expect(c.note, id).toBeTruthy()
      }
      expect(byId('a16-wrong-hour').input.rawText).toBe('Dentist appointment on Friday at 9am')
      expect(byId('a16-wrong-hour').input.names).toEqual([])
      expect(byId('a16-wrong-hour').expected).toEqual({
        missing_names: 'none_missing',
        'date:d1': 'wrong',
        missing_dates: 'none_missing',
      })
      expect(byId('a17-far-deadline-right').input.rawText).toBe(
        'Steuererklärung bis Ende November abgeben',
      )
      expect(byId('a17-far-deadline-right').input.names).toEqual([])
      expect(byId('a17-far-deadline-right').expected).toEqual({
        missing_names: 'none_missing',
        'date:d1': 'right',
        missing_dates: 'none_missing',
      })
      expect(byId('a18-wrong-repeat-day').input.rawText).toBe(
        'Yoga every Tuesday at 7pm at Studio Nord',
      )
      expect(byId('a18-wrong-repeat-day').input.names).toEqual([
        { ref: 'n1', surface: 'Studio Nord' },
      ])
      expect(byId('a18-wrong-repeat-day').expected).toEqual({
        'name:n1': 'right',
        missing_names: 'none_missing',
        'date:d1': 'wrong',
        missing_dates: 'none_missing',
      })
      expect(byId('a19-next-monday').input.rawText).toBe('Ask Priya about the budget next Monday')
      expect(byId('a19-next-monday').input.names).toEqual([{ ref: 'n1', surface: 'Priya' }])
      expect(byId('a19-next-monday').expected).toEqual({
        'name:n1': 'right',
        missing_names: 'none_missing',
        'date:d1': 'right',
        missing_dates: 'none_missing',
      })
    })

    it('a24: a repeat stored as a single date is wrong, and nothing else is off', () => {
      expect(byId('a24-repeat-stored-once')).toMatchObject({
        note: 'Repeat stored as a single date.',
        input: {
          capturedAt: '2026-10-27T10:00:00+01:00',
          timezone: 'Europe/Berlin',
          rawText: 'Yoga every Tuesday at 7pm at Studio Nord',
          storedText: 'Yoga every Tuesday at 7pm at Studio Nord',
          names: [{ ref: 'n1', surface: 'Studio Nord' }],
          dates: [
            { ref: 'd1', event: 'Yoga at Studio Nord', day: '2026-10-27', detail: 'at 19:00' },
          ],
          pieces: [],
        },
        expected: {
          'name:n1': 'right',
          missing_names: 'none_missing',
          'date:d1': 'wrong',
          missing_dates: 'none_missing',
        },
      })
    })

    it('a24 asks the date question about the capture day itself at 19:00', () => {
      const request = prepareCases(files).find((c) => c.id === 'a24-repeat-stored-once')?.request
      expect(request?.questions['date:d1'].instructions).toBe(
        'Eigen stored "Yoga at Studio Nord" for the capture day itself at 19:00. Does the capture put this event at that time?',
      )
    })

    it('every case expects missing_dates: something_missing only where the capture gives a time nobody stored', () => {
      const somethingMissing = [
        'a09-good-split', // "Today:" is a time and no date is stored
        'a11-split-drops-detail', // "expires in March"
        'a20-dentist-date-lost',
        'a21-yoga-repeat-lost',
        'a23-german-deadline-lost',
      ]
      for (const c of audit.cases) {
        expect(c.expected.missing_dates, c.id).toBe(
          somethingMissing.includes(c.id) ? 'something_missing' : 'none_missing',
        )
      }
    })

    it('a20 to a23: the lost-date cases are the planned captures, nothing stored', () => {
      for (const id of [
        'a20-dentist-date-lost',
        'a21-yoga-repeat-lost',
        'a22-vague-not-a-time',
        'a23-german-deadline-lost',
      ]) {
        const c = byId(id)
        expect(c.input.capturedAt, id).toBe('2026-10-27T10:00:00+01:00')
        expect(c.input.timezone, id).toBe('Europe/Berlin')
        expect(c.input.storedText, id).toBe(c.input.rawText)
        expect(c.input.dates, id).toEqual([])
        expect(c.input.pieces, id).toEqual([])
        expect(c.note, id).toBeTruthy()
      }
      expect(byId('a20-dentist-date-lost')).toMatchObject({
        input: { rawText: 'Dentist appointment on Friday at 9am', names: [] },
        expected: { missing_names: 'none_missing', missing_dates: 'something_missing' },
        note: 'The clock-time date was never stored.',
      })
      expect(byId('a21-yoga-repeat-lost')).toMatchObject({
        input: {
          rawText: 'Yoga every Tuesday at 7pm at Studio Nord',
          names: [{ ref: 'n1', surface: 'Studio Nord' }],
        },
        expected: {
          'name:n1': 'right',
          missing_names: 'none_missing',
          missing_dates: 'something_missing',
        },
      })
      expect(byId('a22-vague-not-a-time')).toMatchObject({
        input: {
          rawText: 'I should call Grandma more often',
          names: [{ ref: 'n1', surface: 'Grandma' }],
        },
        expected: {
          'name:n1': 'right',
          missing_names: 'none_missing',
          missing_dates: 'none_missing',
        },
      })
      expect(byId('a23-german-deadline-lost')).toMatchObject({
        input: {
          rawText: 'Bis Freitag die Rechnung an Herrn Weber schicken',
          names: [{ ref: 'n1', surface: 'Herrn Weber' }],
        },
        expected: {
          'name:n1': 'right',
          missing_names: 'none_missing',
          missing_dates: 'something_missing',
        },
      })
    })

    it('the missing_dates question of a case with a stored date names its event and no time', () => {
      const request = prepareCases(files).find((c) => c.id === 'a16-wrong-hour')?.request
      expect(request?.questions.missing_dates.instructions).toBe(
        'Eigen stored a time for: "Dentist appointment". Besides these, does the capture give a day, a time, a deadline or a repetition for anything else?',
      )
      expect(request?.questions.missing_dates.criteria.none_missing).toBe(
        'No: every time the capture gives belongs to one of these — whether or not Eigen stored it correctly does not matter here. Words that do not fix a time — "soon", "sometimes", "lately", "more often" — do not count.',
      )
    })

    it('the missing_dates question of a case with nothing stored asks whether the capture gives any time', () => {
      const request = prepareCases(files).find((c) => c.id === 'a20-dentist-date-lost')?.request
      expect(request?.questions.missing_dates.instructions).toBe(
        'Eigen stored no times for this capture. Does the capture give a day, a time, a deadline or a repetition for anything?',
      )
      expect(request?.questions.missing_dates.criteria.none_missing).toBe(
        'No: the capture gives no day, time, deadline or repetition. Words that do not fix a time — "soon", "sometimes", "lately", "more often", "again" — do not count.',
      )
    })

    it('a17 asks about the last day of November, 34 days after the capture day', () => {
      const request = prepareCases(files).find((c) => c.id === 'a17-far-deadline-right')?.request
      expect(request?.questions['date:d1'].instructions).toBe(
        'Eigen stored "Steuererklärung abgeben" for Monday 30 November 2026 (34 days after the capture day, the last day of November) as the deadline. Does the capture put this event at that time?',
      )
    })

    it('a16 asks for the Friday after the capture day at 15:00', () => {
      const request = prepareCases(files).find((c) => c.id === 'a16-wrong-hour')?.request
      expect(request?.questions['date:d1'].instructions).toBe(
        'Eigen stored "Dentist appointment" for the Friday after the capture day (3 days later) at 15:00. Does the capture put this event at that time?',
      )
    })
  })

  it('run through the production builders: every case expects exactly the questions the builder asks, with labels the criteria define', () => {
    const prepared = prepareCases(files)
    expect(prepared.length).toBe(files.reduce((n, f) => n + f.cases.length, 0))
    for (const c of prepared) {
      expect(Object.keys(c.expected).sort(), c.id).toEqual(Object.keys(c.request.questions).sort())
      for (const [questionId, label] of Object.entries(c.expected)) {
        expect(
          Object.keys(c.request.questions[questionId].criteria),
          `${c.id} ${questionId}`,
        ).toContain(label)
      }
    }
  })

  it('cover both languages and every split / wording / date branch of the audit', () => {
    const prepared = prepareCases(files)
    const audit = prepared.filter((c) => c.kind === 'capture_audit')
    const questionIds = new Set(audit.flatMap((c) => Object.keys(c.request.questions)))
    expect(questionIds.has('wording')).toBe(true)
    expect(questionIds.has('pieces_cover')).toBe(true)
    expect([...questionIds].some((id) => id.startsWith('date:'))).toBe(true)
    expect([...questionIds].some((id) => id.startsWith('name:'))).toBe(true)
    expect([...questionIds].some((id) => id.startsWith('piece:'))).toBe(true)
    expect(audit.some((c) => c.request.state.includes('Steuererklärung'))).toBe(true)
  })
})

describe('parseFixtureFile', () => {
  it('parses an audit file and a reason file', () => {
    expect(parseFixtureFile(auditFile(), 'x.json').cases[0].id).toBe('x01')
    expect(
      parseFixtureFile({ kind: 'capture_reason', cases: [REASON_CASE] }, 'y.json').cases[0]
        .expected,
    ).toEqual({ reason: 'wrong_category' })
  })

  it('requires day and detail on every date item (null when there is none) and rejects the old `when`', () => {
    const withDates = (dates: unknown[]) =>
      auditFile({ cases: [{ ...AUDIT_CASE, input: { ...AUDIT_CASE.input, dates } }] })
    const ok = { ref: 'd1', event: 'Call Mom', day: null, detail: 'every Tuesday' }
    expect(() => parseFixtureFile(withDates([ok]), 'x.json')).not.toThrow()
    expect(() =>
      parseFixtureFile(
        withDates([{ ref: 'd1', event: 'a', when: 'Friday 30 October 2026' }]),
        'x.json',
      ),
    ).toThrow(/when/)
    expect(() =>
      parseFixtureFile(withDates([{ ref: 'd1', event: 'a', day: '2026-10-30' }]), 'x.json'),
    ).toThrow(/detail/)
    expect(() => parseFixtureFile(withDates([{ ...ok, day: 20261030 }]), 'x.json')).toThrow(/day/)
  })

  it('keeps an optional note', () => {
    const file = parseFixtureFile(auditFile({ cases: [{ ...AUDIT_CASE, note: 'why' }] }), 'x.json')
    expect(file.cases[0].note).toBe('why')
  })

  it('names the source file in every failure', () => {
    expect(() => parseFixtureFile({ kind: 'nope', cases: [] }, 'bad.json')).toThrow(/bad\.json/)
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      parseFixtureFile({ kind: 'capture_other', cases: [AUDIT_CASE] }, 'x.json'),
    ).toThrow()
  })

  it('is strict: unknown keys at the top, in a case, and in an input are errors', () => {
    expect(() => parseFixtureFile(auditFile({ extra: 1 }), 'x.json')).toThrow(/extra/)
    expect(() =>
      parseFixtureFile(auditFile({ cases: [{ ...AUDIT_CASE, extra: 1 }] }), 'x.json'),
    ).toThrow(/extra/)
    expect(() =>
      parseFixtureFile(
        auditFile({ cases: [{ ...AUDIT_CASE, input: { ...AUDIT_CASE.input, extra: 1 } }] }),
        'x.json',
      ),
    ).toThrow(/extra/)
    expect(() =>
      parseFixtureFile(
        {
          kind: 'capture_reason',
          cases: [{ ...REASON_CASE, input: { ...REASON_CASE.input, extra: 1 } }],
        },
        'y.json',
      ),
    ).toThrow(/extra/)
  })

  it('rejects a missing input field, an empty case id and a non-string label', () => {
    const { pieces: _pieces, ...withoutPieces } = AUDIT_CASE.input
    expect(() =>
      parseFixtureFile(auditFile({ cases: [{ ...AUDIT_CASE, input: withoutPieces }] }), 'x.json'),
    ).toThrow(/pieces/)
    expect(() =>
      parseFixtureFile(auditFile({ cases: [{ ...AUDIT_CASE, id: '' }] }), 'x.json'),
    ).toThrow()
    expect(() =>
      parseFixtureFile(
        auditFile({ cases: [{ ...AUDIT_CASE, expected: { missing_names: 1 } }] }),
        'x.json',
      ),
    ).toThrow()
  })

  it('rejects a file without cases', () => {
    expect(() => parseFixtureFile(auditFile({ cases: [] }), 'x.json')).toThrow()
  })
})

describe('loadFixtureFiles', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  function writeDir(files: Record<string, unknown>): string {
    dir = mkdtempSync(join(tmpdir(), 'jev-check-fixtures-'))
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(dir, name),
        typeof content === 'string' ? content : JSON.stringify(content),
      )
    }
    return dir
  }

  it('fails loud when a file is missing', () => {
    expect(() => loadFixtureFiles(writeDir({ 'capture_audit.json': auditFile() }))).toThrow(
      /capture_reason\.json/,
    )
  })

  it('fails loud on invalid JSON, naming the file', () => {
    expect(() =>
      loadFixtureFiles(
        writeDir({
          'capture_audit.json': '{ not json',
          'capture_reason.json': { kind: 'capture_reason', cases: [REASON_CASE] },
        }),
      ),
    ).toThrow(/capture_audit\.json/)
  })

  it('fails loud when the kind inside a file does not match its file name', () => {
    expect(() =>
      loadFixtureFiles(
        writeDir({
          'capture_audit.json': { kind: 'capture_reason', cases: [REASON_CASE] },
          'capture_reason.json': { kind: 'capture_reason', cases: [REASON_CASE] },
        }),
      ),
    ).toThrow(/capture_audit\.json.*capture_reason/s)
  })
})
