import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { parseLlmJsonPayload, stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import {
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
  "startAt": "ISO-8601 UTC",
  "endAt": "ISO-8601 UTC or omit",
  "timePrecision": "exact|day|week|month|fuzzy",
  "timezone": "IANA timezone",
  "isAllDay": boolean,
  "recurrenceRule": "optional iCal RRULE string or omit",
  "confidence": 0-1,
  "semanticSummary": "short natural-language summary"
}
Resolve relative dates against capture time ${capturedIso} in timezone ${input.timezone}.
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

	return parseTemporalMentions(content);
}
