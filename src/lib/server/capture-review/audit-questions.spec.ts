import { describe, expect, it } from 'vitest'
import {
  AUDIT_CRITERIA_DATE,
  AUDIT_CRITERIA_MISSING_NAMES,
  AUDIT_CRITERIA_NAME,
  AUDIT_CRITERIA_PIECE,
  AUDIT_CRITERIA_PIECES_COVER,
  AUDIT_CRITERIA_WORDING,
  AUDIT_QUESTION_MISSING_NAMES,
  AUDIT_QUESTION_PIECES_COVER,
  AUDIT_QUESTION_WORDING,
  auditDateQuestionId,
  auditNameQuestionId,
  auditPieceQuestionId,
  buildCaptureAuditRequest,
  type CaptureAuditInput,
} from './audit-questions'

const BASE: CaptureAuditInput = {
  capturedAt: '2026-10-27T10:00:00+01:00',
  timezone: 'Europe/Berlin',
  rawText: 'Call Mom on Friday about the birthday dinner',
  storedText: 'Call Mom on Friday about the birthday dinner',
  names: [{ ref: 'n1', surface: 'Mom' }],
  dates: [
    { ref: 'd1', event: 'Call Mom about the birthday dinner', when: 'Friday 30 October 2026' },
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
    expect(AUDIT_QUESTION_PIECES_COVER).toBe('pieces_cover')
    expect(auditNameQuestionId('n1')).toBe('name:n1')
    expect(auditDateQuestionId('d7')).toBe('date:d7')
    expect(auditPieceQuestionId('p3')).toBe('piece:p3')
  })
})

describe('buildCaptureAuditRequest: state', () => {
  it('names the capture date in the capture timezone and quotes the raw text', () => {
    expect(buildCaptureAuditRequest(BASE).state).toBe(
      [
        'Captured on Tuesday 27 October 2026 at 10:00 (Europe/Berlin).',
        'The user wrote:',
        '<<<capture',
        'Call Mom on Friday about the birthday dinner',
        'capture>>>',
      ].join('\n'),
    )
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
            when: 'Mittwoch, 28. Oktober 2026',
          },
        ],
      }),
    )
    expect(request.state).toContain(`<<<capture\n${rawText}\ncapture>>>`)
    expect(request.questions['date:d1'].instructions).toBe(
      'Eigen stored: "Mit Papa zum Arzt nach Leipzig fahren" — Mittwoch, 28. Oktober 2026. Does the capture say that?',
    )
  })

  it('does not trim or rewrite the raw text', () => {
    const rawText = '  two  spaces\nand a line  '
    expect(buildCaptureAuditRequest(input({ rawText, storedText: rawText })).state).toContain(
      `<<<capture\n${rawText}\ncapture>>>`,
    )
  })
})

describe('buildCaptureAuditRequest: which questions', () => {
  it('asks name, missing_names and date for an unchanged, unsplit capture', () => {
    expect(ids()).toEqual(['name:n1', 'missing_names', 'date:d1'])
  })

  it('asks only missing_names when nothing was found', () => {
    expect(ids({ names: [], dates: [] })).toEqual(['missing_names'])
  })

  it('asks wording first, and only when the stored text differs from the raw text', () => {
    expect(ids({ storedText: 'Call Mom on Friday about the birthday dinner.' })).toEqual([
      'wording',
      'name:n1',
      'missing_names',
      'date:d1',
    ])
  })

  it('treats a difference of surrounding whitespace only as unchanged', () => {
    expect(ids({ storedText: `  ${BASE.rawText}\n` })).not.toContain('wording')
    expect(ids({ rawText: `${BASE.rawText}  `, storedText: BASE.storedText })).not.toContain(
      'wording',
    )
  })

  it('asks one question per name, per date and per piece, in that order', () => {
    expect(
      ids({
        storedText: 'changed',
        names: [
          { ref: 'n1', surface: 'Mom' },
          { ref: 'n2', surface: 'Leipzig' },
        ],
        dates: [
          { ref: 'd1', event: 'a', when: 'b' },
          { ref: 'd2', event: 'c', when: 'd' },
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

  it('date quotes the event and the resolved time', () => {
    expect(full.questions['date:d1'].instructions).toBe(
      'Eigen stored: "Call Mom about the birthday dinner" — Friday 30 October 2026. Does the capture say that?',
    )
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
    expect(Object.keys(AUDIT_CRITERIA_PIECE)).toEqual(['right', 'wrong'])
    expect(Object.keys(AUDIT_CRITERIA_PIECES_COVER)).toEqual(['right', 'wrong'])
  })

  it('every criterion is a non-empty sentence', () => {
    for (const criteria of [
      AUDIT_CRITERIA_WORDING,
      AUDIT_CRITERIA_NAME,
      AUDIT_CRITERIA_MISSING_NAMES,
      AUDIT_CRITERIA_DATE,
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
    expect(AUDIT_CRITERIA_DATE.right).toContain('"before 6pm" with no day meaning today')
    expect(AUDIT_CRITERIA_PIECE.wrong).toContain('a greeting, a sign-off, half a sentence')
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
    expect(failing({ dates: [{ ref: '  ', event: 'a', when: 'b' }] })).toThrow(
      '[capture-review] audit: dates[0].ref must not be empty',
    )
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
    expect(failing({ dates: [{ ref: 'd\t1', event: 'a', when: 'b' }] })).toThrow(
      '[capture-review] audit: dates[0].ref must not contain whitespace',
    )
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
          { ref: 'd1', event: 'a', when: 'b' },
          { ref: 'd1', event: 'c', when: 'd' },
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
        dates: [{ ref: 'x', event: 'a', when: 'b' }],
      }),
    ).not.toThrow()
  })

  it('rejects a single piece: pieces must be empty or have at least 2 entries', () => {
    expect(failing({ pieces: [{ ref: 'p1', text: 'one' }] })).toThrow(
      '[capture-review] audit: pieces must be empty or have at least 2 entries, got 1',
    )
  })

  it('rejects empty surface, event, when and piece text', () => {
    expect(failing({ names: [{ ref: 'n1', surface: ' ' }] })).toThrow(
      '[capture-review] audit: names[0].surface must not be empty',
    )
    expect(failing({ dates: [{ ref: 'd1', event: '', when: 'b' }] })).toThrow(
      '[capture-review] audit: dates[0].event must not be empty',
    )
    expect(failing({ dates: [{ ref: 'd1', event: 'a', when: '' }] })).toThrow(
      '[capture-review] audit: dates[0].when must not be empty',
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

  it('does not change its input', () => {
    const frozen = structuredClone(BASE)
    Object.freeze(frozen)
    Object.freeze(frozen.names)
    Object.freeze(frozen.dates)
    Object.freeze(frozen.pieces)
    expect(() => buildCaptureAuditRequest(frozen)).not.toThrow()
  })
})
