import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { dateExists, ISO_WITH_OFFSET } from './fixture'
import { mutationSchema, type Mutation } from './verify-mutations'

/**
 * The cases of `npm run capture-review:verify` (docs/planning/capture-feedback.md, C5): made-up
 * captures, each either clean or carrying one mutation to inject after the capture. Strict: an
 * unknown key, a blank text, a duplicate id or a capture time without an offset is an error.
 */

export const VERIFY_CASES_PATH = fileURLToPath(new URL('./verify-cases.json', import.meta.url))

export type VerifyCase = {
  id: string
  kind: 'clean' | 'mistake'
  text: string
  capturedAt: string
  capturedAtDate: Date
  /** The mistake to inject; null for a clean case. */
  mutation: Mutation | null
}

const caseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/, 'id must be lowercase letters, digits and underscores'),
  text: z.string().refine((t) => t.trim() !== '', 'text must not be blank'),
  capturedAt: z
    .string()
    .refine(
      (v) => ISO_WITH_OFFSET.test(v) && !Number.isNaN(Date.parse(v)),
      'capturedAt must be an ISO 8601 date-time with an offset or Z',
    ),
  mutation: mutationSchema.optional(),
})

export function parseVerifyCases(raw: unknown): VerifyCase[] {
  if (!Array.isArray(raw)) {
    throw new Error('[capture-review] verify cases must be a list of { id, text, capturedAt }')
  }
  if (raw.length === 0) throw new Error('[capture-review] verify cases need at least one case')

  const seen = new Set<string>()
  const cases = raw.map((entry, i): VerifyCase => {
    const where = `verify case ${i + 1}`
    const parsed = caseSchema.safeParse(entry)
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'case'}: ${issue.message}`)
        .join('; ')
      throw new Error(`[capture-review] ${where} is invalid (${problems})`)
    }
    const { id, text, capturedAt, mutation } = parsed.data
    if (!dateExists(capturedAt)) {
      throw new Error(`[capture-review] ${where} is invalid (capturedAt: the date does not exist)`)
    }
    if (seen.has(id)) throw new Error(`[capture-review] ${where}: duplicate id "${id}"`)
    seen.add(id)

    // Authoring guards on the fixture itself, by identity of the made-up strings.
    if (
      mutation?.type === 'add_name' &&
      text.toLowerCase().includes(mutation.surface.trim().toLowerCase())
    ) {
      throw new Error(
        `[capture-review] ${where} (${id}): the invented name is already in the capture`,
      )
    }
    if (mutation?.type === 'replace_wording' && mutation.text.trim() === text.trim()) {
      throw new Error(
        `[capture-review] ${where} (${id}): the replacement wording is the same as the capture`,
      )
    }
    return {
      id,
      kind: mutation ? 'mistake' : 'clean',
      text,
      capturedAt,
      capturedAtDate: new Date(capturedAt),
      mutation: mutation ?? null,
    }
  })

  if (!cases.some((c) => c.kind === 'clean')) {
    throw new Error('[capture-review] verify cases need at least one clean case')
  }
  if (!cases.some((c) => c.kind === 'mistake')) {
    throw new Error('[capture-review] verify cases need at least one mistake case')
  }
  return cases
}

export function loadVerifyCases(path: string): VerifyCase[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(
      `[capture-review] cannot read the verify cases ${path}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
  return parseVerifyCases(raw)
}
