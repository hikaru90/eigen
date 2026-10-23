import { z } from 'zod'

function isIsoDateTime(value: string): boolean {
  const ms = Date.parse(value)
  return Number.isFinite(ms)
}

const isoDateTimeOrNull = z.union([
  z.null(),
  z.string().refine(isIsoDateTime, { message: 'must be ISO datetime or null' }),
])

/** POST /api/timeline/parse-date-range */
export const parseDateRangeRequestSchema = z.object({
  phrase: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'phrase is required')),
  timeZone: z
    .string()
    .transform((s) => s.trim())
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
  nowIso: z
    .string()
    .transform((s) => s.trim())
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
})

export type ParseDateRangeRequest = z.infer<typeof parseDateRangeRequestSchema>

/** LLM / absolute range payload after parse-date-range */
export const parsedDateRangeSchema = z.object({
  from: isoDateTimeOrNull,
  to: isoDateTimeOrNull,
  includeUndated: z.boolean(),
  label: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'label must be a non-empty string')),
})

export type ParsedDateRangeBody = z.infer<typeof parsedDateRangeSchema>
