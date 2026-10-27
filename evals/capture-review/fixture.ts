import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * The captures of `npm run capture-review:smoke` (docs/planning/capture-feedback.md, C1): a list of
 * { text, capturedAt }. Strict: an unknown key, a blank text or a capture time without an offset is
 * an error, never ignored. The text is kept exactly as written; it is what the user typed.
 */

export const SMOKE_FIXTURE_PATH = fileURLToPath(new URL('./smoke.json', import.meta.url))

export type SmokeCapture = {
  text: string
  /** ISO 8601 date-time with an offset or Z, as written in the file. */
  capturedAt: string
  capturedAtDate: Date
}

export const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

const captureSchema = z.strictObject({
  text: z.string().refine((text) => text.trim() !== '', 'text must not be blank'),
  capturedAt: z
    .string()
    .refine(
      (value) => ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value)),
      'capturedAt must be an ISO 8601 date-time with an offset or Z',
    ),
})

/** Whether the calendar date in `value` exists (Date.parse rolls 2026-02-30 over to March). */
export function dateExists(value: string): boolean {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const check = new Date(Date.UTC(year, month - 1, day))
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  )
}

export function parseSmokeFixture(raw: unknown): SmokeCapture[] {
  if (!Array.isArray(raw)) {
    throw new Error('[capture-review] smoke fixture must be a list of { text, capturedAt }')
  }
  if (raw.length === 0) {
    throw new Error('[capture-review] smoke fixture needs at least one capture')
  }
  return raw.map((entry, i) => {
    const parsed = captureSchema.safeParse(entry)
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'capture'}: ${issue.message}`)
        .join('; ')
      throw new Error(`[capture-review] smoke fixture capture ${i + 1} is invalid (${problems})`)
    }
    if (!dateExists(parsed.data.capturedAt)) {
      throw new Error(
        `[capture-review] smoke fixture capture ${i + 1} is invalid (capturedAt: the date does not exist)`,
      )
    }
    return {
      text: parsed.data.text,
      capturedAt: parsed.data.capturedAt,
      capturedAtDate: new Date(parsed.data.capturedAt),
    }
  })
}

export function loadSmokeFixture(path: string): SmokeCapture[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(
      `[capture-review] cannot read the smoke fixture ${path}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
  return parseSmokeFixture(raw)
}
