import { m } from '$lib/paraglide/messages.js'
import { ownerCorrectionBlock } from '$lib/server/capture/owner-correction'
import { evictEvalLlmCacheEntry } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import {
  applyCaptureAnchoredMentions,
  parseTemporalMentions,
  TEMPORAL_ELEMENT_CONTRACT,
  type ExtractedTemporalMention,
} from '$lib/server/memory/temporal-normalize'

function extractChatContent(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('Temporal extraction response is not an object')
  }
  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Temporal extraction response has no choices')
  }
  const message = (choices[0] as { message?: unknown }).message
  if (!message || typeof message !== 'object') {
    throw new Error('Temporal extraction response has no message')
  }
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string') {
    throw new Error('Temporal extraction message content must be a string')
  }
  return content
}

/**
 * Extract structured temporal mentions (deadlines, appointments, periods, etc.)
 * from normalized thought text.
 */
export async function extractTemporalMentions(input: {
  userId: string
  normalizedText: string
  /** Anchor for relative expressions ("next Friday"). */
  capturedAt: Date
  timezone: string
  /** The owner's correction of the last reading: prompt context only, never stored or logged. */
  ownerCorrection?: string
}): Promise<ExtractedTemporalMention[]> {
  const capturedIso = input.capturedAt.toISOString()
  const anchorTz = input.timezone.trim()
  const system = `${m.llm_temporal_extraction_system()}

Additional guidelines:
The capture happened at ${capturedIso} in timezone ${anchorTz}. Always set "timezone" to "${anchorTz}" unless the text explicitly names a different place/timezone.
Return ONLY a JSON object of the form {"mentions": [ ... ]}.
${TEMPORAL_ELEMENT_CONTRACT}
relativeSpec shapes — code computes the final date from capture time ${capturedIso}:
  { "dateAnchor": "capture_time", "relativeMonthsPast": N } for "N months ago"
  { "dateAnchor": "capture_time", "relativeWeeksPast": N } for "N weeks ago"
  { "dateAnchor": "capture_time", "relativeDaysPast": N } for "N days ago"
  { "dateAnchor": "capture_time", "lastWeekdayBeforeCapture": "saturday" } for "last Saturday"
  { "dateAnchor": "explicit", "calendarDate": "YYYY-MM-DD" } for explicit dates (March 15th → year from context)
  { "dateAnchor": "explicit", "calendarMonth": 2, "calendarMonthPart": "mid" } for "mid-February"
Always set relativeSpec when the phrase is relative to capture time. Use calendarDate for explicit calendar dates in the text.
For devices, products, or purchases: emit the possession/acquisition milestone (arrived, received, got, purchased) as kind "milestone" with that date. Do not emit a separate pre-order milestone when an arrival or purchase date is also stated — use only the acquisition date.
For book/media completion: "finished X two weeks ago" or "finished X last weekend" → kind "milestone" with relativeSpec anchored to capture time (relativeWeeksPast or lastWeekdayBeforeCapture).
For malfunctions and repairs: appliance breakdown or repair shop visits → kind "milestone" with resolved date (relativeSpec when relative to capture time).
For lodging: distinguish booking/reservation date (booked, reserved → kind "milestone") from payment deadlines or booking deadlines (kind "deadline" only — do not use deadline as the booking date).
For gardening/seeds: "started X since DATE" or "started seeds on DATE" → kind "milestone" with calendarDate at the start date (when planting began, not when seeds arrived).
Text may be in any language (e.g. German "nächsten Mittwoch" = next Wednesday).
If no temporal content exists, return {"mentions": []}.${
    input.ownerCorrection === undefined ? '' : `\n${ownerCorrectionBlock(input.ownerCorrection)}`
  }`

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: input.normalizedText },
    ],
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'enrich_temporal',
  })

  try {
    const parsed = parseLlmJsonPayload(extractChatContent(response)) as unknown
    const mentions =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as { mentions?: unknown }).mentions
        : undefined
    if (!Array.isArray(mentions)) {
      throw new Error('Temporal extraction output must be a JSON object with a "mentions" array')
    }
    return applyCaptureAnchoredMentions(
      parseTemporalMentions(JSON.stringify(mentions)),
      input.capturedAt,
    )
  } catch (err) {
    // an unusable answer must not be replayed by the eval response cache on retry
    evictEvalLlmCacheEntry(response)
    throw err
  }
}
