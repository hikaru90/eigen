import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Labelled examples for `npm run jev:check`: real-shaped inputs for the two capture-review
 * decisions, each with the label the planner expects for every question the production builder
 * asks. Strict: an unknown key or a missing field is an error, never ignored.
 */

export const FIXTURE_KINDS = ['capture_audit', 'capture_reason'] as const
export type FixtureKind = (typeof FIXTURE_KINDS)[number]

export const FIXTURES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
export const FIXTURE_FILE_NAMES = FIXTURE_KINDS.map((kind) => `${kind}.json`)

const expectedSchema = z.record(z.string(), z.string())

const caseBase = {
  id: z.string().min(1),
  note: z.string().optional(),
  expected: expectedSchema,
}

const auditInputSchema = z.strictObject({
  capturedAt: z.string(),
  timezone: z.string(),
  rawText: z.string(),
  storedText: z.string(),
  names: z.array(z.strictObject({ ref: z.string(), surface: z.string() })),
  dates: z.array(
    z.strictObject({
      ref: z.string(),
      event: z.string(),
      day: z.string().nullable(),
      detail: z.string().nullable(),
    }),
  ),
  pieces: z.array(z.strictObject({ ref: z.string(), text: z.string() })),
})

const reasonInputSchema = z.strictObject({
  rawText: z.string(),
  storedSummary: z.string(),
  reason: z.string(),
})

const fixtureFileSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('capture_audit'),
    cases: z.array(z.strictObject({ ...caseBase, input: auditInputSchema })).min(1),
  }),
  z.strictObject({
    kind: z.literal('capture_reason'),
    cases: z.array(z.strictObject({ ...caseBase, input: reasonInputSchema })).min(1),
  }),
])

export type FixtureFile = z.infer<typeof fixtureFileSchema>
export type CaptureAuditFixtureFile = Extract<FixtureFile, { kind: 'capture_audit' }>
export type CaptureReasonFixtureFile = Extract<FixtureFile, { kind: 'capture_reason' }>

export function parseFixtureFile(raw: unknown, source: string): FixtureFile {
  const parsed = fixtureFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`[jev-check] invalid fixture file ${source}: ${issues}`)
  }
  return parsed.data
}

/** Reads both fixture files; each file's `kind` must match its name. */
export function loadFixtureFiles(dir: string = FIXTURES_DIR): FixtureFile[] {
  return FIXTURE_KINDS.map((kind) => {
    const source = join(dir, `${kind}.json`)
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(source, 'utf8'))
    } catch (err) {
      throw new Error(
        `[jev-check] cannot read fixture file ${source}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
    const file = parseFixtureFile(raw, source)
    if (file.kind !== kind) {
      throw new Error(
        `[jev-check] fixture file ${source} is for "${kind}" but declares kind "${file.kind}"`,
      )
    }
    return file
  })
}
