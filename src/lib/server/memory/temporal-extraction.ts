import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { parseLlmJsonPayload, stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import {
	applyCaptureAnchoredMentions,
	parseTemporalMentions,
	type ExtractedTemporalMention
} from '$lib/server/memory/temporal-normalize';

function extractChatContent(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('Temporal extraction response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('Temporal extraction response has no choices');
	}
	const message = (choices[0] as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('Temporal extraction response has no message');
	}
	const content = (message as { content?: unknown }).content;
	if (typeof content !== 'string') {
		throw new Error('Temporal extraction message content must be a string');
	}
	return content;
}

/**
 * Extract structured temporal mentions (deadlines, appointments, periods, etc.)
 * from normalized thought text.
 */
export async function extractTemporalMentions(input: {
	userId: string;
	normalizedText: string;
	/** Anchor for relative expressions ("next Friday"). */
	capturedAt: Date;
	timezone: string;
}): Promise<ExtractedTemporalMention[]> {
	const capturedIso = input.capturedAt.toISOString();
	const system = `You extract temporal facts from personal memory text.
Return ONLY a JSON array. Each element:
{
  "surface": "verbatim phrase from text",
  "kind": "deadline|appointment|milestone|period|reminder|inferred_event",
  "startAt": "ISO-8601 UTC (best estimate; overridden when relativeSpec is set)",
  "endAt": "ISO-8601 UTC or omit",
  "timePrecision": "exact|day|week|month|fuzzy",
  "timezone": "IANA timezone",
  "isAllDay": boolean,
  "recurrenceRule": "optional iCal RRULE string or omit",
  "durationMinutes": optional positive integer estimate,
  "energyLevel": optional "light"|"medium"|"deep",
  "priorityQuadrant": optional "urgent_important"|"not_urgent_important"|"urgent_not_important"|"neither",
  "contextTags": optional string array e.g. ["@home","@computer"],
  "parentSurface": optional verbatim phrase if this is a subtask of another mention in the same text,
  "confidence": 0-1,
  "semanticSummary": "short natural-language summary",
  "relativeSpec": optional object for relative phrases — code computes the final date from capture time ${capturedIso}:
    { "dateAnchor": "capture_time", "relativeMonthsPast": N } for "N months ago"
    { "dateAnchor": "capture_time", "relativeWeeksPast": N } for "N weeks ago"
    { "dateAnchor": "capture_time", "relativeDaysPast": N } for "N days ago"
    { "dateAnchor": "capture_time", "lastWeekdayBeforeCapture": "saturday" } for "last Saturday"
    { "dateAnchor": "explicit", "calendarDate": "YYYY-MM-DD" } for explicit dates (March 15th → year from context)
    { "dateAnchor": "explicit", "calendarMonth": 2, "calendarMonthPart": "mid" } for "mid-February"
}
Always set relativeSpec when the phrase is relative to capture time. Use calendarDate for explicit calendar dates in the text.
For devices, products, or purchases: emit the possession/acquisition milestone (arrived, received, got, purchased) as kind "milestone" with that date. Do not emit a separate pre-order milestone when an arrival or purchase date is also stated — use only the acquisition date.
For book/media completion: "finished X two weeks ago" or "finished X last weekend" → kind "milestone" with relativeSpec anchored to capture time (relativeWeeksPast or lastWeekdayBeforeCapture).
For malfunctions and repairs: appliance breakdown or repair shop visits → kind "milestone" with resolved date (relativeSpec when relative to capture time).
For lodging: distinguish booking/reservation date (booked, reserved → kind "milestone") from payment deadlines or booking deadlines (kind "deadline" only — do not use deadline as the booking date).
For gardening/seeds: "started X since DATE" or "started seeds on DATE" → kind "milestone" with calendarDate at the start date (when planting began, not when seeds arrived).
Text may be in any language (e.g. German "nächsten Mittwoch" = next Wednesday).
If no temporal content exists, return [].`;

	const response = await llmChatCompletion({
		userId: input.userId,
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: input.normalizedText }
		],
		temperature: 0
	});

	let content = stripMarkdownJsonFences(extractChatContent(response));
	// Some models wrap the array in { "events": [...] }.
	try {
		const wrapped = parseLlmJsonPayload(content) as unknown;
		if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
			const events = (wrapped as { events?: unknown }).events;
			if (Array.isArray(events)) {
				content = JSON.stringify(events);
			}
		}
	} catch {
		// use stripped raw content for array parser below
	}

	return applyCaptureAnchoredMentions(parseTemporalMentions(content), input.capturedAt);
}
