import type { CaptureAuditInput } from './audit-questions'
import type { CaptureReviewPart } from './review-parts'
import type { CaptureReviewSnapshot } from './review-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadCaptureReviewSnapshot: vi.fn(),
  loadCaptureAuditInput: vi.fn(),
}))

vi.mock('./review-store', () => ({ loadCaptureReviewSnapshot: mocks.loadCaptureReviewSnapshot }))
vi.mock('./audit-input', () => ({ loadCaptureAuditInput: mocks.loadCaptureAuditInput }))

import { CAPTURE_REVIEW_THRESHOLD, SCORED_PARTS } from './review-parts'
import { buildCaptureReviewView, getCaptureReviewView } from './review-view'
import { CaptureVoteError } from './vote-error'

const ID = '0b6f3f8e-5c1a-4d7e-9a2b-3c4d5e6f7a8b'

const AUDIT: CaptureAuditInput = {
  capturedAt: '2026-10-27T10:00:00+01:00',
  timezone: 'Europe/Berlin',
  rawText: 'Call my sister Anna on Friday about the tickets',
  storedText: 'Call my sister Anna on Friday about the tickets',
  names: [
    { ref: 'n1', surface: 'Anna' },
    { ref: 'n2', surface: 'Berlin' },
  ],
  dates: [{ ref: 'd1', event: 'Call Anna', day: '2026-10-30', detail: 'at 09:00' }],
  pieces: [
    { ref: 'p1', text: 'Call Anna on Friday' },
    { ref: 'p2', text: 'Ask about the tickets' },
  ],
}

function part(
  part: CaptureReviewPart['part'],
  ref: string,
  label: string,
  probability: number,
): CaptureReviewPart {
  return {
    part,
    ref,
    engine: ['category', 'content_role', 'entity_type', 'temporal_kind'].includes(part)
      ? 'jev_decision'
      : 'jev_audit',
    label,
    probability,
  }
}

const ALL_PARTS: CaptureReviewPart[] = [
  part('category', 'category', 'task', 0.93),
  part('content_role', 'content_role', 'primary', 0.99),
  part('entity_type', 'm1', 'person', 0.88),
  part('temporal_kind', 't1', 'event', 0.8),
  part('wording', 'wording', 'right', 0.95),
  part('name', 'name:n1', 'right', 0.97),
  part('missing_names', 'missing_names', 'none_missing', 0.9),
  part('date', 'date:d1', 'wrong', 0.62),
  part('missing_dates', 'missing_dates', 'none_missing', 0.92),
  part('piece', 'piece:p2', 'right', 0.85),
  part('pieces_cover', 'pieces_cover', 'right', 0.9),
]

const UPDATED_AT = new Date('2026-10-27T10:05:00Z')

function snapshot(
  review: Partial<NonNullable<CaptureReviewSnapshot['review']>> | null,
  patch: Partial<Omit<CaptureReviewSnapshot, 'review'>> = {},
): CaptureReviewSnapshot {
  return {
    category: 'task',
    lifecycleStatus: 'open',
    ...patch,
    review:
      review === null
        ? null
        : {
            status: 'scored',
            score: 0.62,
            parts: ALL_PARTS,
            auditError: null,
            verdict: null,
            votedOn: null,
            reasonKind: null,
            editAppliedAt: null,
            updatedAt: UPDATED_AT,
            ...review,
          },
  }
}

function build(
  review: Parameters<typeof snapshot>[0],
  patch: Parameters<typeof snapshot>[1] = {},
  audit: CaptureAuditInput | null = AUDIT,
) {
  return buildCaptureReviewView({ thoughtId: ID, snapshot: snapshot(review, patch), audit })
}

describe('buildCaptureReviewView: the shape an agent reads', () => {
  it('is exactly thought_id, status, score, threshold, below_threshold, parts, vote, note', () => {
    expect(Object.keys(build({})).sort()).toEqual([
      'below_threshold',
      'note',
      'parts',
      'score',
      'status',
      'thought_id',
      'threshold',
      'vote',
    ])
  })

  it('names every part with part, ref, label, probability, counts_toward_score and about — nothing else', () => {
    for (const p of build({}).parts) {
      expect(Object.keys(p).sort()).toEqual([
        'about',
        'counts_toward_score',
        'label',
        'part',
        'probability',
        'ref',
      ])
    }
  })

  it('carries the stored score against the 0.7 threshold', () => {
    const view = build({ score: 0.62 })
    expect(view).toMatchObject({
      thought_id: ID,
      status: 'scored',
      score: 0.62,
      threshold: 0.7,
      below_threshold: true,
      note: null,
    })
    expect(view.threshold).toBe(CAPTURE_REVIEW_THRESHOLD)
  })

  it('treats a score exactly at the threshold as sure, not weak', () => {
    expect(build({ score: 0.7 }).below_threshold).toBe(false)
    expect(build({ score: 0.699 }).below_threshold).toBe(true)
    expect(build({ score: 0.93 }).below_threshold).toBe(false)
  })

  it('keeps the stored order of the parts', () => {
    expect(build({}).parts.map((p) => p.ref)).toEqual(ALL_PARTS.map((p) => p.ref))
  })
})

describe('buildCaptureReviewView: which parts count toward the score', () => {
  it('flags exactly the SCORED_PARTS', () => {
    for (const p of build({}).parts) {
      expect(p.counts_toward_score, p.part).toBe(
        (SCORED_PARTS as readonly string[]).includes(p.part),
      )
    }
    const hidden = build({}).parts.filter((p) => !p.counts_toward_score)
    expect(hidden.map((p) => p.part)).toEqual(['content_role', 'entity_type', 'temporal_kind'])
  })
})

describe('buildCaptureReviewView: what each part is about, in plain words, from the current data', () => {
  const aboutOf = (ref: string, view = build({})) => view.parts.find((p) => p.ref === ref)?.about

  it('category: the thought’s current category key (an edit may have changed it since)', () => {
    expect(aboutOf('category', build({}, { category: 'event' }))).toBe('event')
    expect(aboutOf('category')).toBe('task')
  })

  it('name: the surface of that name', () => {
    expect(aboutOf('name:n1')).toBe('Anna')
    const second = build({ parts: [part('name', 'name:n2', 'wrong', 0.2)] })
    expect(aboutOf('name:n2', second)).toBe('Berlin')
  })

  it('date: the event in quotes, then the date question’s own phrase', () => {
    expect(aboutOf('date:d1')).toBe(
      '"Call Anna" — the Friday after the capture day (3 days later) at 09:00, once (not repeating)',
    )
  })

  it('piece: the piece text', () => {
    expect(aboutOf('piece:p2')).toBe('Ask about the tickets')
  })

  it('the whole capture and the hidden decisions: null', () => {
    for (const ref of [
      'wording',
      'missing_names',
      'missing_dates',
      'pieces_cover',
      'content_role',
      'm1',
      't1',
    ]) {
      expect(aboutOf(ref), ref).toBeNull()
    }
  })

  it('null when the part no longer points at anything stored (the capture changed since)', () => {
    const view = build({
      parts: [
        part('name', 'name:n9', 'right', 0.9),
        part('date', 'date:d9', 'right', 0.9),
        part('piece', 'piece:p9', 'right', 0.9),
      ],
    })
    expect(view.parts.map((p) => p.about)).toEqual([null, null, null])
  })

  it('null for name, date and piece when the audit input is not given', () => {
    const view = build({}, {}, null)
    expect(view.parts.find((p) => p.ref === 'name:n1')?.about).toBeNull()
    expect(view.parts.find((p) => p.ref === 'date:d1')?.about).toBeNull()
    expect(view.parts.find((p) => p.ref === 'piece:p2')?.about).toBeNull()
    expect(view.parts.find((p) => p.ref === 'category')?.about).toBe('task')
  })
})

describe('buildCaptureReviewView: status none, pending and failed', () => {
  it('none is not an error: no parts, no score, a note that says why and what voting does', () => {
    const view = build(null)
    expect(view).toEqual({
      thought_id: ID,
      status: 'none',
      score: null,
      threshold: 0.7,
      below_threshold: null,
      parts: [],
      vote: null,
      note: 'Not reviewed yet — enrichment is still running, or the thought was captured before capture reviews existed. Rating it with rate_capture starts its review.',
    })
  })

  it('pending_audit: the decisions so far, no score, and a note that the audit has not finished', () => {
    const view = build({
      status: 'pending_audit',
      score: null,
      parts: [part('category', 'category', 'task', 0.93)],
    })
    expect(view.status).toBe('pending_audit')
    expect(view.score).toBeNull()
    expect(view.below_threshold).toBeNull()
    expect(view.parts).toHaveLength(1)
    expect(view.note).toBe(
      'The audit has not finished, so there is no score yet and the audited parts (wording, names, dates, pieces) are not listed. Read this again in a moment.',
    )
  })

  it('audit_failed: no score, the closed explanation the audit stored, and the capture stays as stored', () => {
    const view = build({
      status: 'audit_failed',
      score: null,
      auditError: 'Audit given up after 4 attempts at step "judge": Jev could not answer.',
    })
    expect(view.status).toBe('audit_failed')
    expect(view.score).toBeNull()
    expect(view.below_threshold).toBeNull()
    expect(view.note).toBe(
      'The audit gave up, so there is no score: Audit given up after 4 attempts at step "judge": Jev could not answer. The thought itself is stored as it is.',
    )
  })

  it('audit_failed without a stored explanation still says it gave up', () => {
    expect(build({ status: 'audit_failed', score: null, auditError: null }).note).toBe(
      'The audit gave up, so there is no score. The thought itself is stored as it is.',
    )
  })

  it('scored with nothing to add has no note', () => {
    expect(build({}).note).toBeNull()
  })
})

describe('buildCaptureReviewView: the vote', () => {
  it('is null until someone votes', () => {
    expect(build({ verdict: null }).vote).toBeNull()
  })

  it('shows verdict, place, kind and whether the reason was applied as an edit', () => {
    expect(
      build({
        verdict: 'down',
        votedOn: 'mesh',
        reasonKind: 'wrong_name',
        editAppliedAt: new Date('2026-10-27T10:01:00Z'),
      }).vote,
    ).toEqual({ verdict: 'down', voted_on: 'mesh', reason_kind: 'wrong_name', edit_applied: true })
  })

  it('a vote from an agent over MCP has no place (voted_on null)', () => {
    expect(build({ verdict: 'up', votedOn: null }).vote).toEqual({
      verdict: 'up',
      voted_on: null,
      reason_kind: null,
      edit_applied: false,
    })
  })

  it('a vote can be there without a score: a thought rated before its review was scored', () => {
    const view = build({ status: 'pending_audit', score: null, parts: [], verdict: 'up' })
    expect(view.vote?.verdict).toBe('up')
    expect(view.score).toBeNull()
  })

  it('the vote of a thought that has no review row at all does not exist', () => {
    expect(build(null).vote).toBeNull()
  })

  it('never carries reason text: the keys of a vote are the four above', () => {
    const vote = build({ verdict: 'down', reasonKind: 'wrong_name' }).vote
    expect(Object.keys(vote ?? {}).sort()).toEqual([
      'edit_applied',
      'reason_kind',
      'verdict',
      'voted_on',
    ])
  })
})

describe('buildCaptureReviewView: notes that say the parts may not describe the thought as it is now', () => {
  it('an archived thought keeps its review, and the note says so', () => {
    const view = build({}, { lifecycleStatus: 'archived' })
    expect(view.status).toBe('scored')
    expect(view.note).toBe(
      'The thought is archived (delete_thought archives it); an archived thought keeps its review.',
    )
  })

  it('an archived thought without a review says both', () => {
    expect(build(null, { lifecycleStatus: 'archived' }).note).toBe(
      'Not reviewed yet — enrichment is still running, or the thought was captured before capture reviews existed. Rating it with rate_capture starts its review. The thought is archived (delete_thought archives it); an archived thought keeps its review.',
    )
  })

  it('a completed thought is not archived: no note', () => {
    expect(build({}, { lifecycleStatus: 'completed' }).note).toBeNull()
  })

  it('a reason applied as an edit after the audit: the parts describe the capture before its latest edit', () => {
    const view = build({ editAppliedAt: new Date('2026-10-27T10:09:00Z') })
    expect(view.note).toBe('The parts describe the capture before its latest edit.')
  })

  it('no such note when the audit ran after the edit, or at the same moment, or when no edit was applied', () => {
    expect(build({ editAppliedAt: new Date('2026-10-27T10:01:00Z') }).note).toBeNull()
    expect(build({ editAppliedAt: UPDATED_AT }).note).toBeNull()
    expect(build({ editAppliedAt: null }).note).toBeNull()
  })

  it('combines the notes, in a fixed order, one space between', () => {
    const view = build(
      { editAppliedAt: new Date('2026-10-27T10:09:00Z') },
      { lifecycleStatus: 'archived' },
    )
    expect(view.note).toBe(
      'The parts describe the capture before its latest edit. The thought is archived (delete_thought archives it); an archived thought keeps its review.',
    )
  })
})

describe('buildCaptureReviewView: no leaks', () => {
  it('has no embedding field and no reason field anywhere in the result', () => {
    const json = JSON.stringify(
      build({ verdict: 'down', votedOn: 'capture', reasonKind: 'wrong_name' }),
    )
    expect(json).not.toMatch(/embedding|reason_encrypted|reasonEncrypted|"reason"/i)
  })

  it('does not change the stored parts it was given', () => {
    const before = JSON.stringify(ALL_PARTS)
    build({})
    expect(JSON.stringify(ALL_PARTS)).toBe(before)
  })
})

describe('getCaptureReviewView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadCaptureReviewSnapshot.mockResolvedValue(snapshot({}))
    mocks.loadCaptureAuditInput.mockResolvedValue(AUDIT)
  })

  it('reads the review for this user and thought and builds the view with the audit input', async () => {
    const view = await getCaptureReviewView({ userId: 'u1', thoughtId: ID })

    expect(mocks.loadCaptureReviewSnapshot).toHaveBeenCalledWith({ userId: 'u1', thoughtId: ID })
    expect(mocks.loadCaptureAuditInput).toHaveBeenCalledWith({ userId: 'u1', thoughtId: ID })
    expect(view.status).toBe('scored')
    expect(view.parts.find((p) => p.ref === 'name:n1')?.about).toBe('Anna')
  })

  it('a thought that is not there (or not the user’s) is an explicit not-found error', async () => {
    mocks.loadCaptureReviewSnapshot.mockResolvedValue(null)
    const failure = await getCaptureReviewView({ userId: 'u1', thoughtId: ID }).catch(
      (e: unknown) => e,
    )
    expect(failure).toBeInstanceOf(CaptureVoteError)
    expect(failure).toMatchObject({ code: 'not_found', message: 'Thought not found' })
    expect(mocks.loadCaptureAuditInput).not.toHaveBeenCalled()
  })

  it('does not load the audit input when no part points at a name, date or piece', async () => {
    mocks.loadCaptureReviewSnapshot.mockResolvedValue(
      snapshot({
        parts: [
          part('category', 'category', 'task', 0.93),
          part('wording', 'wording', 'right', 0.95),
          part('missing_names', 'missing_names', 'none_missing', 0.9),
        ],
      }),
    )
    const view = await getCaptureReviewView({ userId: 'u1', thoughtId: ID })
    expect(mocks.loadCaptureAuditInput).not.toHaveBeenCalled()
    expect(view.parts.map((p) => p.about)).toEqual(['task', null, null])
  })

  it('does not load the audit input for a thought with no review', async () => {
    mocks.loadCaptureReviewSnapshot.mockResolvedValue(snapshot(null))
    const view = await getCaptureReviewView({ userId: 'u1', thoughtId: ID })
    expect(mocks.loadCaptureAuditInput).not.toHaveBeenCalled()
    expect(view.status).toBe('none')
  })

  it('a thought that vanishes while its words are read is a not-found error too', async () => {
    mocks.loadCaptureAuditInput.mockResolvedValue(null)
    await expect(getCaptureReviewView({ userId: 'u1', thoughtId: ID })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('fails loudly, never with a half answer, when the words cannot be read', async () => {
    mocks.loadCaptureAuditInput.mockRejectedValue(new Error('boom'))
    await expect(getCaptureReviewView({ userId: 'u1', thoughtId: ID })).rejects.toThrow('boom')
  })
})
