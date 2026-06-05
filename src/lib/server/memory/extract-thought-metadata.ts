import { llmChatCompletion } from '$lib/server/llm/llm-client';
import type { MemoryType } from '$lib/server/db/brain.schema';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';

const VALID_MEMORY_TYPES: MemoryType[] = [
	'episode',
	'fact',
	'decision',
	'concern',
	'open_loop',
	'preference',
	'pattern'
];

const MIN_CUE_LENGTH = 3;
const MAX_CUE_LENGTH = 80;
const MAX_CUES = 5;

function isMemoryType(value: unknown): value is MemoryType {
	return typeof value === 'string' && (VALID_MEMORY_TYPES as string[]).includes(value);
}

function extractChatContent(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('extractThoughtMetadata: response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('extractThoughtMetadata: no choices in response');
	}
	const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
	if (typeof content !== 'string') {
		throw new Error('extractThoughtMetadata: content is not a string');
	}
	return content;
}

function parseCues(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === 'string')
		.map((s) => s.trim())
		.filter((s) => s.length >= MIN_CUE_LENGTH && s.length <= MAX_CUE_LENGTH)
		.slice(0, MAX_CUES);
}

export type ThoughtMetadataExtraction = {
	memoryType: MemoryType;
	cues: string[];
};

/**
 * Single LLM call: memory type classification + search cue phrases.
 */
export async function extractThoughtMetadata(input: {
	userId: string;
	normalizedText: string;
}): Promise<ThoughtMetadataExtraction> {
	const prompt = [
		'Return ONLY JSON with this shape:',
		'{',
		'  "memoryType": "episode|fact|decision|concern|open_loop|preference|pattern",',
		'  "cues": ["2-8 word search phrase", "..."]',
		'}',
		'',
		'memoryType — exactly one of:',
		'  episode    — a specific event or experience that happened',
		'  fact       — a standing truth, reference, or factual note',
		'  decision   — a committed choice or resolution',
		'  concern    — a worry, risk, or anxiety',
		'  open_loop  — an unresolved action item, question, or follow-up',
		'  preference — a personal tendency, habit, or like/dislike',
		'  pattern    — a recurring observation about oneself or a situation',
		'',
		'cues — 3 to 5 short search phrases (2–8 words) for how someone might find this note later.',
		'',
		`Note: ${input.normalizedText}`
	].join('\n');

	const response = await llmChatCompletion({
		userId: input.userId,
		messages: [
			{
				role: 'system',
				content:
					'You classify personal memory notes and generate search cues. Return only valid JSON.'
			},
			{ role: 'user', content: prompt }
		],
		temperature: 0
	});

	const content = stripMarkdownJsonFences(extractChatContent(response));
	const parsed = JSON.parse(content) as unknown;
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('extractThoughtMetadata: output must be a JSON object');
	}
	const obj = parsed as { memoryType?: unknown; cues?: unknown };
	const rawType = obj.memoryType;
	if (typeof rawType !== 'string' || !isMemoryType(rawType.trim().toLowerCase())) {
		throw new Error('extractThoughtMetadata: invalid memoryType');
	}
	return {
		memoryType: rawType.trim().toLowerCase() as MemoryType,
		cues: parseCues(obj.cues)
	};
}
