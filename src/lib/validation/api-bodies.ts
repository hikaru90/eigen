import { z } from 'zod'
import { FEEDBACK_MAX_LENGTH } from '$lib/feedback/feedback-max-length'

function isIsoDateTime(value: string): boolean {
  const ms = Date.parse(value)
  return Number.isFinite(ms)
}

const isoDateTimeOrNull = z.union([
  z.null(),
  z.string().refine(isIsoDateTime, { message: 'must be ISO datetime or null' }),
])

/** POST /api/feedback */
export const feedbackPostBodySchema = z.object({
  message: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(1, 'message must not be empty')
        .max(FEEDBACK_MAX_LENGTH, `message must be at most ${FEEDBACK_MAX_LENGTH} characters`),
    ),
})

export type FeedbackPostBody = z.infer<typeof feedbackPostBodySchema>

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
