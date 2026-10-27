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
    dates: [],
    pieces: [],
  },
  expected: { 'name:n1': 'right', missing_names: 'none_missing' },
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
