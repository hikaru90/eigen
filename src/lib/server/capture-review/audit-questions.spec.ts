import { describe, expect, it } from 'vitest'
import {
  AUDIT_CRITERIA_DATE,
  AUDIT_CRITERIA_MISSING_DATES_NONE_STORED,
  AUDIT_CRITERIA_MISSING_DATES_STORED,
  AUDIT_CRITERIA_MISSING_NAMES,
  AUDIT_CRITERIA_NAME,
  AUDIT_CRITERIA_PIECE,
  AUDIT_CRITERIA_PIECES_COVER,
  AUDIT_CRITERIA_WORDING,
  AUDIT_QUESTION_MISSING_DATES,
  AUDIT_QUESTION_MISSING_NAMES,
  AUDIT_QUESTION_PIECES_COVER,
  AUDIT_QUESTION_WORDING,
  auditDateQuestionId,
  auditNameQuestionId,
  auditPieceQuestionId,
  buildCaptureAuditRequest,
  describeStoredDatePhrases,
  describeStoredDates,
  type CaptureAuditInput,
} from './audit-questions'

const BASE: CaptureAuditInput = {
  capturedAt: '2026-10-27T10:00:00+01:00',
  timezone: 'Europe/Berlin',
  rawText: 'Call Mom on Friday about the birthday dinner',
  storedText: 'Call Mom on Friday about the birthday dinner',
  names: [{ ref: 'n1', surface: 'Mom' }],
  dates: [
    { ref: 'd1', event: 'Call Mom about the birthday dinner', day: '2026-10-30', detail: null },
  ],
  pieces: [],
}

function input(patch: Partial<CaptureAuditInput> = {}): CaptureAuditInput {
  return { ...BASE, ...patch }
}

function ids(patch: Partial<CaptureAuditInput> = {}): string[] {
  return Object.keys(buildCaptureAuditRequest(input(patch)).questions)
}

describe('question id helpers', () => {
  it('prefix the ref with the part', () => {
    expect(AUDIT_QUESTION_WORDING).toBe('wording')
    expect(AUDIT_QUESTION_MISSING_NAMES).toBe('missing_names')
    expect(AUDIT_QUESTION_MISSING_DATES).toBe('missing_dates')
    expect(AUDIT_QUESTION_PIECES_COVER).toBe('pieces_cover')
    expect(auditNameQuestionId('n1')).toBe('name:n1')
    expect(auditDateQuestionId('d7')).toBe('date:d7')
    expect(auditPieceQuestionId('p3')).toBe('piece:p3')
  })
})

// The state is the capture line and the capture, nothing else, whatever questions follow: a
// calendar block in it was tried against the live check and did not help Jev with dates.
const STATE = [
  'Captured on Tuesday 27 October 2026 at 10:00 (Europe/Berlin).',
  'The user wrote:',
  '<<<capture',
  'Call Mom on Friday about the birthday dinner',
  'capture>>>',
].join('\n')

describe('buildCaptureAuditRequest: state', () => {
  it('names the capture date in the capture timezone and quotes the raw text', () => {
    expect(buildCaptureAuditRequest(BASE).state).toBe(STATE)
  })

  it('is the same with and without date questions, and for every other question set', () => {
    const two = [
      { ref: 'p1', text: 'one' },
      { ref: 'p2', text: 'two' },
    ]
    for (const patch of [
      { dates: [] },
      { storedText: 'Call Mom on Friday.' },
      { names: [], dates: [] },
      { pieces: two },
      { storedText: 'Call Mom on Friday.', pieces: two },
    ] satisfies Partial<CaptureAuditInput>[]) {
      expect(buildCaptureAuditRequest(input(patch)).state).toBe(STATE)
    }
    expect(STATE).not.toContain('Calendar')
  })

  it('renders the instant in the given timezone: UTC late evening is the next day in Berlin, midnight hour is 00', () => {
    expect(buildCaptureAuditRequest(input({ capturedAt: '2026-10-27T23:30:00Z' })).state).toContain(
      'Captured on Wednesday 28 October 2026 at 00:30 (Europe/Berlin).',
    )
  })

  it('uses the capture timezone, not the offset of the string', () => {
    const state = buildCaptureAuditRequest(
      input({ capturedAt: '2026-10-27T10:00:00+01:00', timezone: 'America/New_York' }),
    ).state
    expect(state).toContain('Captured on Tuesday 27 October 2026 at 05:00 (America/New_York).')
  })

  it('passes German text through untouched', () => {
    const rawText =
      'Am Mittwoch mit Papa zum Arzt nach Leipzig fahren — Steuererklärung nicht vergessen'
    const request = buildCaptureAuditRequest(
      input({
        rawText,
        storedText: rawText,
        names: [{ ref: 'n1', surface: 'Papa' }],
        dates: [
          {
            ref: 'd1',
            event: 'Mit Papa zum Arzt nach Leipzig fahren',
            day: '2026-10-28',
            detail: 'um 9 Uhr',
          },
        ],
      }),
    )
    expect(request.state).toContain(`<<<capture\n${rawText}\ncapture>>>`)
    expect(request.questions['date:d1'].instructions).toBe(
      'Eigen stored "Mit Papa zum Arzt nach Leipzig fahren" for the day after the capture day um 9 Uhr, once (not repeating). Does the capture put this event at that time?',
    )
  })

  it('does not trim or rewrite the raw text', () => {
    const rawText = '  two  spaces\nand a line  '
    expect(buildCaptureAuditRequest(input({ rawText, storedText: rawText })).state).toContain(
      `<<<capture\n${rawText}\ncapture>>>`,
    )
  })
})

describe('buildCaptureAuditRequest: the time of a date question', () => {
  // The capture day is Tuesday 27 October 2026 (Europe/Berlin) unless a test says otherwise.
  const asked = (phrase: string, event = 'Dentist appointment') =>
    `Eigen stored "${event}" for ${phrase}. Does the capture put this event at that time?`
  // A stored day is one occurrence, and the phrase says so at its end (after the detail).
  const askedOnce = (phrase: string, event = 'Dentist appointment') =>
    asked(`${phrase}, once (not repeating)`, event)

  function instructions(
    date: { day: string | null; detail: string | null; event?: string },
    patch: Partial<CaptureAuditInput> = {},
  ): string {
    const request = buildCaptureAuditRequest(
      input({
        dates: [
          {
            ref: 'd1',
            event: date.event ?? 'Dentist appointment',
            day: date.day,
            detail: date.detail,
          },
        ],
        ...patch,
      }),
    )
    return request.questions['date:d1'].instructions
  }

  describe('the day is named by its distance from the capture day', () => {
    it('0 days: the capture day itself', () => {
      expect(instructions({ day: '2026-10-27', detail: null })).toBe(
        askedOnce('the capture day itself'),
      )
    })

    it('1 day: the day after the capture day', () => {
      expect(instructions({ day: '2026-10-28', detail: null })).toBe(
        askedOnce('the day after the capture day'),
      )
    })

    it.each([
      ['2026-10-29', 'the Thursday after the capture day (2 days later)'],
      ['2026-10-30', 'the Friday after the capture day (3 days later)'],
      ['2026-11-03', 'the Tuesday after the capture day (7 days later)'],
      ['2026-11-09', 'the Monday after the capture day (13 days later)'],
    ])('2 to 13 days (%s): the weekday and the number of days', (day, phrase) => {
      expect(instructions({ day, detail: null })).toBe(askedOnce(phrase))
    })

    it('14 days and more: the full date and the number of days after', () => {
      expect(instructions({ day: '2026-11-10', detail: null })).toBe(
        askedOnce('Tuesday 10 November 2026 (14 days after the capture day)'),
      )
      expect(instructions({ day: '2026-11-29', detail: null })).toBe(
        askedOnce('Sunday 29 November 2026 (33 days after the capture day)'),
      )
    })

    it('-1 day: the day before the capture day', () => {
      expect(instructions({ day: '2026-10-26', detail: null })).toBe(
        askedOnce('the day before the capture day'),
      )
    })

    it('-2 days and fewer: the full date and the number of days before', () => {
      expect(instructions({ day: '2026-10-25', detail: null })).toBe(
        askedOnce('Sunday 25 October 2026 (2 days before the capture day)'),
      )
      expect(instructions({ day: '2026-10-17', detail: null })).toBe(
        askedOnce('Saturday 17 October 2026 (10 days before the capture day)'),
      )
    })
  })

  describe('the last day of a month is said so, in the two long forms only', () => {
    it('after the capture day', () => {
      expect(instructions({ day: '2026-11-30', detail: null })).toBe(
        askedOnce(
          'Monday 30 November 2026 (34 days after the capture day, the last day of November)',
        ),
      )
    })

    it('before the capture day', () => {
      expect(
        instructions(
          { day: '2026-10-31', detail: null },
          { capturedAt: '2026-11-05T10:00:00+01:00' },
        ),
      ).toBe(
        askedOnce(
          'Saturday 31 October 2026 (5 days before the capture day, the last day of October)',
        ),
      )
    })

    it('not in the short forms, even on a last day', () => {
      expect(instructions({ day: '2026-10-31', detail: null })).toBe(
        askedOnce('the Saturday after the capture day (4 days later)'),
      )
      expect(
        instructions(
          { day: '2026-10-31', detail: null },
          { capturedAt: '2026-10-30T10:00:00+01:00' },
        ),
      ).toBe(askedOnce('the day after the capture day'))
    })

    it('knows February in a leap year and in a common year', () => {
      expect(
        instructions(
          { day: '2028-02-29', detail: null },
          { capturedAt: '2028-01-10T10:00:00+01:00' },
        ),
      ).toBe(
        askedOnce(
          'Tuesday 29 February 2028 (50 days after the capture day, the last day of February)',
        ),
      )
      expect(
        instructions(
          { day: '2027-02-28', detail: null },
          { capturedAt: '2027-01-10T10:00:00+01:00' },
        ),
      ).toBe(
        askedOnce(
          'Sunday 28 February 2027 (49 days after the capture day, the last day of February)',
        ),
      )
      expect(
        instructions(
          { day: '2028-02-28', detail: null },
          { capturedAt: '2028-01-10T10:00:00+01:00' },
        ),
      ).toBe(askedOnce('Monday 28 February 2028 (49 days after the capture day)'))
    })

    it('is not said for a day that is not the last of its month', () => {
      expect(instructions({ day: '2026-11-29', detail: null })).not.toContain('last day')
    })
  })

  describe('the capture day is the date in the capture timezone', () => {
    it('late evening UTC is already the next day in Berlin', () => {
      const patch = { capturedAt: '2026-10-27T23:30:00Z' }
      expect(instructions({ day: '2026-10-28', detail: null }, patch)).toBe(
        askedOnce('the capture day itself'),
      )
      expect(instructions({ day: '2026-10-29', detail: null }, patch)).toBe(
        askedOnce('the day after the capture day'),
      )
      expect(instructions({ day: '2026-10-27', detail: null }, patch)).toBe(
        askedOnce('the day before the capture day'),
      )
    })

    it('early morning UTC is still the day before in New York', () => {
      const patch = { capturedAt: '2026-10-27T01:00:00Z', timezone: 'America/New_York' }
      expect(instructions({ day: '2026-10-26', detail: null }, patch)).toBe(
        askedOnce('the capture day itself'),
      )
      expect(instructions({ day: '2026-10-27', detail: null }, patch)).toBe(
        askedOnce('the day after the capture day'),
      )
    })

    it('counts calendar days: daylight saving time (25 October 2026) and a year end change nothing', () => {
      expect(
        instructions(
          { day: '2026-10-26', detail: null },
          { capturedAt: '2026-10-24T10:00:00+02:00' },
        ),
      ).toBe(askedOnce('the Monday after the capture day (2 days later)'))
      expect(
        instructions(
          { day: '2027-01-02', detail: null },
          { capturedAt: '2026-12-30T10:00:00+01:00' },
        ),
      ).toBe(askedOnce('the Saturday after the capture day (3 days later)'))
    })

    it('does not depend on the clock time of the capture', () => {
      for (const capturedAt of ['2026-10-27T00:00:00+01:00', '2026-10-27T23:59:59+01:00']) {
        expect(instructions({ day: '2026-10-30', detail: null }, { capturedAt })).toBe(
          askedOnce('the Friday after the capture day (3 days later)'),
        )
      }
    })
  })

  describe('day and detail', () => {
    it('day and detail: the day, one space, the detail', () => {
      expect(instructions({ day: '2026-10-30', detail: 'at 09:00' })).toBe(
        askedOnce('the Friday after the capture day (3 days later) at 09:00'),
      )
      expect(instructions({ day: '2026-10-27', detail: 'before 18:00' })).toBe(
        askedOnce('the capture day itself before 18:00'),
      )
      expect(instructions({ day: '2026-11-30', detail: 'as the deadline' })).toBe(
        askedOnce(
          'Monday 30 November 2026 (34 days after the capture day, the last day of November) as the deadline',
        ),
      )
    })

    it('day only: no trailing space', () => {
      expect(instructions({ day: '2026-10-30', detail: null })).toBe(
        askedOnce('the Friday after the capture day (3 days later)'),
      )
    })

    it('detail only: the detail alone', () => {
      expect(instructions({ day: null, detail: 'every Tuesday at 19:00' }, {})).toBe(
        asked('every Tuesday at 19:00'),
      )
    })

    it('trims the detail', () => {
      expect(instructions({ day: '2026-10-28', detail: '  at 09:00\n' })).toBe(
        askedOnce('the day after the capture day at 09:00'),
      )
    })

    it('quotes the event as given', () => {
      expect(
        instructions({ day: '2026-10-28', detail: null, event: 'Steuererklärung abgeben' }),
      ).toBe(askedOnce('the day after the capture day', 'Steuererklärung abgeben'))
    })
  })

  describe('a single stored occurrence says so', () => {
    it('appends ", once (not repeating)" to the end of the phrase when the item has a day', () => {
      expect(
        instructions({ day: '2026-10-27', detail: 'at 19:00', event: 'Yoga at Studio Nord' }),
      ).toBe(
        'Eigen stored "Yoga at Studio Nord" for the capture day itself at 19:00, once (not repeating). Does the capture put this event at that time?',
      )
    })

    it('comes after the detail, and after a day with no detail', () => {
      expect(instructions({ day: '2026-10-30', detail: 'at 09:00' })).toBe(
        askedOnce('the Friday after the capture day (3 days later) at 09:00'),
      )
      expect(instructions({ day: '2026-10-30', detail: null })).toBe(
        askedOnce('the Friday after the capture day (3 days later)'),
      )
      expect(instructions({ day: '2026-11-30', detail: 'as the deadline' })).toBe(
        askedOnce(
          'Monday 30 November 2026 (34 days after the capture day, the last day of November) as the deadline',
        ),
      )
    })

    it('is not added to an item without a day: a repeat or a detail-only item', () => {
      const text = instructions({ day: null, detail: 'every Tuesday at 19:00' })
      expect(text).toBe(asked('every Tuesday at 19:00'))
      expect(text).not.toContain('once')
      expect(instructions({ day: null, detail: 'as the deadline' })).not.toContain('once')
    })

    it('is added per item: a repeat and a single date in one capture', () => {
      const request = buildCaptureAuditRequest(
        input({
          dates: [
            { ref: 'd1', event: 'Yoga', day: null, detail: 'every Tuesday at 19:00' },
            { ref: 'd2', event: 'Dentist', day: '2026-10-30', detail: 'at 09:00' },
          ],
        }),
      )
      expect(request.questions['date:d1'].instructions).toBe(
        'Eigen stored "Yoga" for every Tuesday at 19:00. Does the capture put this event at that time?',
      )
      expect(request.questions['date:d2'].instructions).toBe(
        'Eigen stored "Dentist" for the Friday after the capture day (3 days later) at 09:00, once (not repeating). Does the capture put this event at that time?',
      )
    })

    it('does not touch the missing_dates question, which names events only', () => {
      const request = buildCaptureAuditRequest(
        input({ dates: [{ ref: 'd1', event: 'Yoga', day: '2026-10-27', detail: 'at 19:00' }] }),
      )
      expect(request.questions.missing_dates.instructions).toBe(
        'Eigen stored a time for: "Yoga". Besides these, does the capture give a day, a time, a deadline or a repetition for anything else?',
      )
      expect(request.questions.missing_dates.instructions).not.toContain('once')
    })
  })

  it('builds a phrase per date question', () => {
    const request = buildCaptureAuditRequest(
      input({
        dates: [
          { ref: 'd1', event: 'a', day: '2026-10-27', detail: null },
          { ref: 'd2', event: 'b', day: null, detail: 'every Tuesday at 19:00' },
        ],
      }),
    )
    expect(request.questions['date:d1'].instructions).toBe(
      'Eigen stored "a" for the capture day itself, once (not repeating). Does the capture put this event at that time?',
    )
    expect(request.questions['date:d2'].instructions).toBe(
      'Eigen stored "b" for every Tuesday at 19:00. Does the capture put this event at that time?',
    )
  })
})

describe('buildCaptureAuditRequest: which questions', () => {
  it('asks name, missing_names, date and missing_dates for an unchanged, unsplit capture', () => {
    expect(ids()).toEqual(['name:n1', 'missing_names', 'date:d1', 'missing_dates'])
  })

  it('asks missing_names and missing_dates, always, when nothing was found', () => {
    expect(ids({ names: [], dates: [] })).toEqual(['missing_names', 'missing_dates'])
  })

  it('asks wording first, and only when the stored text differs from the raw text', () => {
    expect(ids({ storedText: 'Call Mom on Friday about the birthday dinner.' })).toEqual([
      'wording',
      'name:n1',
      'missing_names',
      'date:d1',
      'missing_dates',
    ])
  })

  it('treats a difference of surrounding whitespace only as unchanged', () => {
    expect(ids({ storedText: `  ${BASE.rawText}\n` })).not.toContain('wording')
    expect(ids({ rawText: `${BASE.rawText}  `, storedText: BASE.storedText })).not.toContain(
      'wording',
    )
  })

  it('asks one question per name, per date and per piece, each group with its "missing" question, in that order', () => {
    expect(
      ids({
        storedText: 'changed',
        names: [
          { ref: 'n1', surface: 'Mom' },
          { ref: 'n2', surface: 'Leipzig' },
        ],
        dates: [
          { ref: 'd1', event: 'a', day: '2026-10-30', detail: null },
          { ref: 'd2', event: 'c', day: null, detail: 'every Tuesday' },
        ],
        pieces: [
          { ref: 'p1', text: 'one' },
          { ref: 'p2', text: 'two' },
          { ref: 'p3', text: 'three' },
        ],
      }),
    ).toEqual([
      'wording',
      'name:n1',
      'name:n2',
      'missing_names',
      'date:d1',
      'date:d2',
      'missing_dates',
      'piece:p1',
      'piece:p2',
      'piece:p3',
      'pieces_cover',
    ])
  })

  it('asks no piece questions when the capture was not split', () => {
    const questions = ids({ pieces: [] })
    expect(questions.some((id) => id.startsWith('piece:'))).toBe(false)
    expect(questions).not.toContain('pieces_cover')
  })

  it('every question is a choice question', () => {
    const request = buildCaptureAuditRequest(
      input({
        storedText: 'changed',
        pieces: [
          { ref: 'p1', text: 'one' },
          { ref: 'p2', text: 'two' },
        ],
      }),
    )
    for (const question of Object.values(request.questions)) expect(question.type).toBe('choice')
  })
})

describe('buildCaptureAuditRequest: instructions', () => {
  const full = buildCaptureAuditRequest(
    input({
      storedText: 'Call Mom on Friday about the dinner.',
      names: [
        { ref: 'n1', surface: 'Mom' },
        { ref: 'n2', surface: 'Leipzig' },
      ],
      pieces: [
        { ref: 'p1', text: 'Call Mom' },
        { ref: 'p2', text: 'Plan the dinner' },
      ],
    }),
  )

  it('wording quotes the stored text', () => {
    expect(full.questions.wording.instructions).toBe(
      'Eigen stored the capture with this wording:\n<<<stored\nCall Mom on Friday about the dinner.\nstored>>>\nDoes the stored wording say what the user wrote?',
    )
  })

  it('name asks whether the capture mentions the surface', () => {
    expect(full.questions['name:n2'].instructions).toBe(
      'Eigen found the name "Leipzig" in the capture. Does the capture mention "Leipzig"?',
    )
  })

  it('missing_names lists every surface, quoted and comma separated', () => {
    expect(full.questions.missing_names.instructions).toBe(
      'Eigen found these names in the capture: "Mom", "Leipzig". Does the capture name a person, place, organisation or project that is missing from this list?',
    )
  })

  it('missing_names says none when no name was found', () => {
    expect(
      buildCaptureAuditRequest(input({ names: [] })).questions.missing_names.instructions,
    ).toBe(
      'Eigen found these names in the capture: none. Does the capture name a person, place, organisation or project that is missing from this list?',
    )
  })

  it('date quotes the event and says when it was stored', () => {
    expect(full.questions['date:d1'].instructions).toBe(
      'Eigen stored "Call Mom about the birthday dinner" for the Friday after the capture day (3 days later), once (not repeating). Does the capture put this event at that time?',
    )
  })

  describe('missing_dates', () => {
    const request = (dates: CaptureAuditInput['dates']) =>
      buildCaptureAuditRequest(input({ dates })).questions.missing_dates

    describe('when no date was stored', () => {
      it('asks whether the capture gives a time for anything', () => {
        expect(request([]).instructions).toBe(
          'Eigen stored no times for this capture. Does the capture give a day, a time, a deadline or a repetition for anything?',
        )
      })

      it('sends the none-stored criteria', () => {
        expect(request([]).criteria).toEqual(AUDIT_CRITERIA_MISSING_DATES_NONE_STORED)
      })
    })

    describe('when dates were stored', () => {
      const asked = (events: string) =>
        `Eigen stored a time for: ${events}. Besides these, does the capture give a day, a time, a deadline or a repetition for anything else?`

      it('lists the event of every date item in double quotes, joined with "; "', () => {
        expect(
          request([
            {
              ref: 'd1',
              event: 'Call Mom about the birthday dinner',
              day: '2026-10-30',
              detail: null,
            },
            {
              ref: 'd2',
              event: 'Yoga at Studio Nord',
              day: null,
              detail: 'every Tuesday at 19:00',
            },
            { ref: 'd3', event: 'Drop the keys', day: '2026-10-27', detail: 'before 18:00' },
          ]).instructions,
        ).toBe(
          asked('"Call Mom about the birthday dinner"; "Yoga at Studio Nord"; "Drop the keys"'),
        )
      })

      it('names one event without a separator', () => {
        expect(request(BASE.dates).instructions).toBe(asked('"Call Mom about the birthday dinner"'))
      })

      it("holds no time phrase: comparing times is the date question's job", () => {
        const instructions = request([
          { ref: 'd1', event: 'Dentist', day: '2026-10-30', detail: 'at 09:00' },
          { ref: 'd2', event: 'Yoga', day: null, detail: 'every Tuesday at 19:00' },
          { ref: 'd3', event: 'Taxes', day: '2026-11-30', detail: 'as the deadline' },
        ]).instructions
        expect(instructions).toBe(asked('"Dentist"; "Yoga"; "Taxes"'))
        for (const phrase of [
          '09:00',
          '19:00',
          'capture day',
          'Friday',
          'Tuesday',
          'as the deadline',
        ]) {
          expect(instructions).not.toContain(phrase)
        }
      })

      it('quotes the event as given', () => {
        expect(
          request([{ ref: 'd1', event: 'Steuererklärung abgeben', day: null, detail: 'x' }])
            .instructions,
        ).toBe(asked('"Steuererklärung abgeben"'))
      })

      it('sends the stored criteria', () => {
        expect(request(BASE.dates).criteria).toEqual(AUDIT_CRITERIA_MISSING_DATES_STORED)
      })

      it('is asked the same way when the capture was split or reworded', () => {
        const split = buildCaptureAuditRequest(
          input({
            storedText: 'changed',
            pieces: [
              { ref: 'p1', text: 'one' },
              { ref: 'p2', text: 'two' },
            ],
          }),
        )
        expect(split.questions.missing_dates.instructions).toBe(
          asked('"Call Mom about the birthday dinner"'),
        )
      })
    })
  })

  it('piece quotes the piece text', () => {
    expect(full.questions['piece:p2'].instructions).toBe(
      'Eigen stored this part of the capture as its own thought:\n<<<piece\nPlan the dinner\npiece>>>\nIs this a complete thought from the capture?',
    )
  })

  it('pieces_cover numbers the pieces', () => {
    expect(full.questions.pieces_cover.instructions).toBe(
      'Eigen split the capture into these 2 thoughts:\n1. Call Mom\n2. Plan the dinner\nDo they keep everything the capture says?',
    )
  })
})

describe('buildCaptureAuditRequest: criteria', () => {
  const full = buildCaptureAuditRequest(
    input({
      storedText: 'changed',
      pieces: [
        { ref: 'p1', text: 'one' },
        { ref: 'p2', text: 'two' },
      ],
    }),
  )

  it('has the closed label sets', () => {
    expect(Object.keys(AUDIT_CRITERIA_WORDING)).toEqual(['right', 'wrong'])
    expect(Object.keys(AUDIT_CRITERIA_NAME)).toEqual(['right', 'wrong'])
    expect(Object.keys(AUDIT_CRITERIA_MISSING_NAMES)).toEqual(['none_missing', 'something_missing'])
    expect(Object.keys(AUDIT_CRITERIA_DATE)).toEqual(['right', 'wrong'])
    expect(Object.keys(AUDIT_CRITERIA_MISSING_DATES_NONE_STORED)).toEqual([
      'none_missing',
      'something_missing',
    ])
    expect(Object.keys(AUDIT_CRITERIA_MISSING_DATES_STORED)).toEqual([
      'none_missing',
      'something_missing',
    ])
    expect(Object.keys(AUDIT_CRITERIA_PIECE)).toEqual(['right', 'wrong'])
    expect(Object.keys(AUDIT_CRITERIA_PIECES_COVER)).toEqual(['right', 'wrong'])
  })

  it('every criterion is a non-empty sentence', () => {
    for (const criteria of [
      AUDIT_CRITERIA_WORDING,
      AUDIT_CRITERIA_NAME,
      AUDIT_CRITERIA_MISSING_NAMES,
      AUDIT_CRITERIA_DATE,
      AUDIT_CRITERIA_MISSING_DATES_NONE_STORED,
      AUDIT_CRITERIA_MISSING_DATES_STORED,
      AUDIT_CRITERIA_PIECE,
      AUDIT_CRITERIA_PIECES_COVER,
    ]) {
      for (const text of Object.values(criteria)) expect(text.trim().length).toBeGreaterThan(20)
    }
  })

  it('sends the exported criteria for each question', () => {
    expect(full.questions.wording.criteria).toEqual(AUDIT_CRITERIA_WORDING)
    expect(full.questions['name:n1'].criteria).toEqual(AUDIT_CRITERIA_NAME)
    expect(full.questions.missing_names.criteria).toEqual(AUDIT_CRITERIA_MISSING_NAMES)
    expect(full.questions['date:d1'].criteria).toEqual(AUDIT_CRITERIA_DATE)
    expect(full.questions.missing_dates.criteria).toEqual(AUDIT_CRITERIA_MISSING_DATES_STORED)
    expect(buildCaptureAuditRequest(input({ dates: [] })).questions.missing_dates.criteria).toEqual(
      AUDIT_CRITERIA_MISSING_DATES_NONE_STORED,
    )
    expect(full.questions['piece:p1'].criteria).toEqual(AUDIT_CRITERIA_PIECE)
    expect(full.questions.pieces_cover.criteria).toEqual(AUDIT_CRITERIA_PIECES_COVER)
  })

  it('hands out copies: changing a request never changes the shared criteria', () => {
    const before = { ...AUDIT_CRITERIA_NAME }
    full.questions['name:n1'].criteria.right = 'changed'
    expect(AUDIT_CRITERIA_NAME).toEqual(before)
    expect(buildCaptureAuditRequest(BASE).questions['name:n1'].criteria).toEqual(before)
  })

  it('names the decisive cases the plan relies on', () => {
    expect(AUDIT_CRITERIA_WORDING.right).toContain('Fixing typos')
    expect(AUDIT_CRITERIA_WORDING.wrong).toContain("'maybe' turned into a plan")
    expect(AUDIT_CRITERIA_MISSING_NAMES.none_missing).toContain('"the team lead"')
    expect(AUDIT_CRITERIA_DATE.right).toContain('"before 6pm"')
    expect(AUDIT_CRITERIA_PIECE.wrong).toContain('a greeting, a sign-off, half a sentence')
  })

  // Tuned against the live check: pinned word for word so a change is deliberate.
  it("date right and wrong judge the capture's own time words against the stored time", () => {
    expect(AUDIT_CRITERIA_DATE.right).toBe(
      'Yes: the capture\'s own time words for this event ("Friday", "tomorrow", "Mittwoch", "today", "before 6pm", "every Tuesday") point to this time. A vague time in the capture ("next week", "end of November", "in spring") is right when the stored time falls within it.',
    )
    expect(AUDIT_CRITERIA_DATE.wrong).toBe(
      "No: the capture's time words point to a different day or time, the capture gives no time for this event, the event is not in the capture, or the capture says it repeats and the stored time does not repeat (or the other way round).",
    )
  })

  // Pinned word for word, like the date criteria: a change is deliberate and re-checked live.
  // Two framings, tuned against the live check: "is a time missing from this list?" made Jev call a
  // wrongly stored time missing, so with stored dates the question lists only the events and never
  // the times, and with none stored it asks whether the capture gives any time at all.
  it('missing_dates when no date was stored', () => {
    expect(AUDIT_CRITERIA_MISSING_DATES_NONE_STORED.none_missing).toBe(
      'No: the capture gives no day, time, deadline or repetition. Words that do not fix a time — "soon", "sometimes", "lately", "more often", "again" — do not count.',
    )
    expect(AUDIT_CRITERIA_MISSING_DATES_NONE_STORED.something_missing).toBe(
      'Yes: the capture gives at least one day, time, deadline or repetition ("on Friday at 9am", "every Tuesday", "by the end of November", "tomorrow", "today", "in March").',
    )
  })

  it('missing_dates when dates were stored', () => {
    expect(AUDIT_CRITERIA_MISSING_DATES_STORED.none_missing).toBe(
      'No: every time the capture gives belongs to one of these — whether or not Eigen stored it correctly does not matter here. Words that do not fix a time — "soon", "sometimes", "lately", "more often" — do not count.',
    )
    expect(AUDIT_CRITERIA_MISSING_DATES_STORED.something_missing).toBe(
      'Yes: the capture gives a day, time, deadline or repetition for something else as well.',
    )
  })

  it('pieces_cover right judges only whether something is lost, not whether a piece should exist', () => {
    expect(AUDIT_CRITERIA_PIECES_COVER.right).toBe(
      'Everything of substance in the capture is in at least one of the thoughts. Greetings, filler and repetition may be left out. Judge only whether something is lost: a piece that is a fragment or should not exist does not make this wrong — each piece is judged on its own.',
    )
  })

  it('pieces_cover wrong is unchanged', () => {
    expect(AUDIT_CRITERIA_PIECES_COVER.wrong).toBe(
      'Something of substance in the capture — a task, a fact, a date, a person, an amount or a reason — is in none of the thoughts.',
    )
  })
})

describe('buildCaptureAuditRequest: validation', () => {
  const failing = (patch: Partial<CaptureAuditInput>) => () =>
    buildCaptureAuditRequest(input(patch))

  it('rejects an empty or whitespace-only rawText', () => {
    expect(failing({ rawText: '' })).toThrow('[capture-review] audit: rawText must not be empty')
    expect(failing({ rawText: ' \n\t ' })).toThrow(
      '[capture-review] audit: rawText must not be empty',
    )
  })

  it('rejects an empty or whitespace-only storedText', () => {
    expect(failing({ storedText: '' })).toThrow(
      '[capture-review] audit: storedText must not be empty',
    )
    expect(failing({ storedText: '   ' })).toThrow(
      '[capture-review] audit: storedText must not be empty',
    )
  })

  it('rejects a capturedAt that does not parse', () => {
    expect(failing({ capturedAt: 'yesterday' })).toThrow(
      '[capture-review] audit: capturedAt must be an ISO 8601 date-time with an offset or Z, got "yesterday"',
    )
    expect(failing({ capturedAt: '2026-13-45T10:00:00+01:00' })).toThrow(
      '[capture-review] audit: capturedAt must be an ISO 8601 date-time with an offset or Z, got "2026-13-45T10:00:00+01:00"',
    )
  })

  it('rejects a capturedAt without an offset (it would depend on the machine)', () => {
    expect(failing({ capturedAt: '2026-10-27T10:00:00' })).toThrow(
      '[capture-review] audit: capturedAt must be an ISO 8601 date-time with an offset or Z, got "2026-10-27T10:00:00"',
    )
    expect(failing({ capturedAt: '2026-10-27' })).toThrow(
      'capturedAt must be an ISO 8601 date-time',
    )
  })

  it('accepts Z, offsets and fractional seconds', () => {
    expect(failing({ capturedAt: '2026-10-27T09:00:00Z' })).not.toThrow()
    expect(failing({ capturedAt: '2026-10-27T10:00:00.123+01:00' })).not.toThrow()
    expect(failing({ capturedAt: '2026-10-27T10:00+01:00' })).not.toThrow()
  })

  it('rejects a timezone that is not valid', () => {
    expect(failing({ timezone: 'Mars/Olympus' })).toThrow(
      '[capture-review] audit: timezone must be a valid IANA time zone, got "Mars/Olympus"',
    )
    expect(failing({ timezone: '' })).toThrow(
      '[capture-review] audit: timezone must be a valid IANA time zone, got ""',
    )
  })

  it('rejects an empty ref, per list', () => {
    expect(failing({ names: [{ ref: '', surface: 'Mom' }] })).toThrow(
      '[capture-review] audit: names[0].ref must not be empty',
    )
    expect(
      failing({ dates: [{ ref: '  ', event: 'a', day: '2026-10-30', detail: null }] }),
    ).toThrow('[capture-review] audit: dates[0].ref must not be empty')
    expect(
      failing({
        pieces: [
          { ref: 'p1', text: 'one' },
          { ref: '', text: 'two' },
        ],
      }),
    ).toThrow('[capture-review] audit: pieces[1].ref must not be empty')
  })

  it('rejects a ref with whitespace inside', () => {
    expect(failing({ names: [{ ref: 'n 1', surface: 'Mom' }] })).toThrow(
      '[capture-review] audit: names[0].ref must not contain whitespace, got "n 1"',
    )
    expect(
      failing({ dates: [{ ref: 'd\t1', event: 'a', day: '2026-10-30', detail: null }] }),
    ).toThrow('[capture-review] audit: dates[0].ref must not contain whitespace')
  })

  it('rejects a duplicate ref within a list, but allows the same ref in different lists', () => {
    expect(
      failing({
        names: [
          { ref: 'n1', surface: 'Mom' },
          { ref: 'n1', surface: 'Leipzig' },
        ],
      }),
    ).toThrow('[capture-review] audit: names refs must be unique, "n1" appears more than once')
    expect(
      failing({
        dates: [
          { ref: 'd1', event: 'a', day: '2026-10-30', detail: null },
          { ref: 'd1', event: 'c', day: '2026-10-31', detail: null },
        ],
      }),
    ).toThrow('[capture-review] audit: dates refs must be unique, "d1" appears more than once')
    expect(
      failing({
        pieces: [
          { ref: 'p1', text: 'one' },
          { ref: 'p1', text: 'two' },
        ],
      }),
    ).toThrow('[capture-review] audit: pieces refs must be unique, "p1" appears more than once')
    expect(
      failing({
        names: [{ ref: 'x', surface: 'Mom' }],
        dates: [{ ref: 'x', event: 'a', day: '2026-10-30', detail: null }],
      }),
    ).not.toThrow()
  })

  it('rejects a single piece: pieces must be empty or have at least 2 entries', () => {
    expect(failing({ pieces: [{ ref: 'p1', text: 'one' }] })).toThrow(
      '[capture-review] audit: pieces must be empty or have at least 2 entries, got 1',
    )
  })

  it('rejects empty surface, event and piece text', () => {
    expect(failing({ names: [{ ref: 'n1', surface: ' ' }] })).toThrow(
      '[capture-review] audit: names[0].surface must not be empty',
    )
    expect(failing({ dates: [{ ref: 'd1', event: '', day: '2026-10-30', detail: null }] })).toThrow(
      '[capture-review] audit: dates[0].event must not be empty',
    )
    expect(
      failing({
        pieces: [
          { ref: 'p1', text: 'one' },
          { ref: 'p2', text: '  ' },
        ],
      }),
    ).toThrow('[capture-review] audit: pieces[1].text must not be empty')
  })

  describe('a date item: day and detail', () => {
    const date = (day: string | null, detail: string | null) => ({
      dates: [{ ref: 'd1', event: 'Dentist appointment', day, detail }],
    })

    it.each([
      '',
      '2026-10-32',
      '2026-13-01',
      '2026-00-10',
      '2026-02-29',
      '2027-02-29',
      '2026-1-5',
      '27.10.2026',
      '2026/10/27',
      ' 2026-10-27',
      '2026-10-27T10:00',
      'Friday',
      '0000-01-01',
    ])('rejects a day that is not a real YYYY-MM-DD date: "%s"', (day) => {
      expect(failing(date(day, null))).toThrow(
        `[capture-review] audit: dates[0].day must be a real calendar date as YYYY-MM-DD, or null, got "${day}"`,
      )
    })

    it('accepts real dates, including a leap day', () => {
      for (const day of ['2026-10-27', '2028-02-29', '2026-12-31', '1999-01-01']) {
        expect(failing(date(day, null))).not.toThrow()
      }
    })

    it('rejects an empty or whitespace-only detail', () => {
      expect(failing(date('2026-10-30', ''))).toThrow(
        '[capture-review] audit: dates[0].detail must not be empty when given, or null',
      )
      expect(failing(date(null, ' \n '))).toThrow(
        '[capture-review] audit: dates[0].detail must not be empty when given, or null',
      )
    })

    it('rejects an item with neither a day nor a detail', () => {
      expect(failing(date(null, null))).toThrow(
        '[capture-review] audit: dates[0] needs a day or a detail, both are null',
      )
    })

    it('accepts a day alone, a detail alone, and both', () => {
      expect(failing(date('2026-10-30', null))).not.toThrow()
      expect(failing(date(null, 'every Tuesday at 19:00'))).not.toThrow()
      expect(failing(date('2026-10-30', 'at 09:00'))).not.toThrow()
    })

    it('names the item that is wrong', () => {
      expect(
        failing({
          dates: [
            { ref: 'd1', event: 'a', day: '2026-10-30', detail: null },
            { ref: 'd2', event: 'b', day: '2026-02-30', detail: null },
          ],
        }),
      ).toThrow('dates[1].day must be a real calendar date')
      expect(
        failing({
          dates: [
            { ref: 'd1', event: 'a', day: '2026-10-30', detail: null },
            { ref: 'd2', event: 'b', day: null, detail: null },
          ],
        }),
      ).toThrow('dates[1] needs a day or a detail')
    })

    it('has no `when` any more: the old shape is not accepted as a date', () => {
      const old = {
        ref: 'd1',
        event: 'a',
        when: 'Friday 30 October 2026',
      } as unknown as CaptureAuditInput['dates'][number]
      expect(failing({ dates: [old] })).toThrow('dates[0].day must be a real calendar date')
    })
  })

  it('does not change its input', () => {
    const frozen = structuredClone(BASE)
    Object.freeze(frozen)
    Object.freeze(frozen.names)
    Object.freeze(frozen.dates)
    Object.freeze(frozen.pieces)
    expect(() => buildCaptureAuditRequest(frozen)).not.toThrow()
  })
})

describe('describeStoredDates (the stored dates in words, for the 👎 reason label)', () => {
  const when = { capturedAt: BASE.capturedAt, timezone: BASE.timezone }

  it('is one phrase per date: the event, then the same words the date question says', () => {
    expect(
      describeStoredDates({
        ...when,
        dates: [
          { ref: 'd1', event: 'Dentist', day: '2026-10-30', detail: 'at 09:00' },
          { ref: 'd2', event: 'Yoga', day: null, detail: 'every Tuesday at 19:00' },
          { ref: 'd3', event: 'Report', day: '2026-10-27', detail: 'as the deadline' },
        ],
      }),
    ).toEqual([
      'Dentist: the Friday after the capture day (3 days later) at 09:00, once (not repeating)',
      'Yoga: every Tuesday at 19:00',
      'Report: the capture day itself as the deadline, once (not repeating)',
    ])
  })

  it('is the same phrase the audit question uses for that date', () => {
    const date = BASE.dates[0]
    const [phrase] = describeStoredDates({ ...when, dates: [date] })
    const asked = buildCaptureAuditRequest(BASE).questions[auditDateQuestionId('d1')].instructions
    expect(asked).toContain(phrase.slice(`${date.event}: `.length))
  })

  it('has nothing to say when no date was stored', () => {
    expect(describeStoredDates({ ...when, dates: [] })).toEqual([])
  })

  it('fails loudly on a bad capture time, time zone or date item', () => {
    const dates = BASE.dates
    expect(() => describeStoredDates({ capturedAt: 'yesterday', timezone: 'Europe/Berlin', dates })).toThrow(
      'capturedAt must be an ISO 8601 date-time',
    )
    expect(() => describeStoredDates({ ...when, timezone: 'Mars/Base', dates })).toThrow(
      'timezone must be a valid IANA time zone',
    )
    expect(() =>
      describeStoredDates({ ...when, dates: [{ ref: 'd1', event: 'a', day: null, detail: null }] }),
    ).toThrow('dates[0] needs a day or a detail')
    expect(() =>
      describeStoredDates({ ...when, dates: [{ ref: 'd1', event: ' ', day: '2026-10-30', detail: null }] }),
    ).toThrow('dates[0].event must not be empty')
  })
})

describe('describeStoredDatePhrases (the stored dates split into event and words, for the review tool)', () => {
  const when = { capturedAt: BASE.capturedAt, timezone: BASE.timezone }

  it('is one { ref, event, when } per date, with the same words describeStoredDates joins', () => {
    const dates = [
      { ref: 'd1', event: ' Dentist ', day: '2026-10-30', detail: 'at 09:00' },
      { ref: 'd2', event: 'Yoga', day: null, detail: 'every Tuesday at 19:00' },
    ]
    const phrases = describeStoredDatePhrases({ ...when, dates })
    expect(phrases).toEqual([
      {
        ref: 'd1',
        event: 'Dentist',
        when: 'the Friday after the capture day (3 days later) at 09:00, once (not repeating)',
      },
      { ref: 'd2', event: 'Yoga', when: 'every Tuesday at 19:00' },
    ])
    expect(phrases.map((p) => `${p.event}: ${p.when}`)).toEqual(
      describeStoredDates({ ...when, dates }),
    )
  })

  it('has nothing to say when no date was stored, and fails loudly on a bad date item', () => {
    expect(describeStoredDatePhrases({ ...when, dates: [] })).toEqual([])
    expect(() =>
      describeStoredDatePhrases({
        ...when,
        dates: [{ ref: 'd1', event: 'a', day: null, detail: null }],
      }),
    ).toThrow('dates[0] needs a day or a detail')
  })
})
