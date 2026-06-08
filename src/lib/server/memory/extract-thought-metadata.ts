import { llmChatCompletion } from '$lib/server/llm/llm-client';
import type { MemoryType } from '$lib/server/db/brain.schema';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import { groundingProfilePromptBlock } from '$lib/server/grounding/prompt-block';
import type { GroundingProfileForEnrichment } from '$lib/server/grounding/types';

const VALID_MEMORY_TYPES: MemoryType[] = [
	'episode',
	'fact',
	'decision',
	'concern',
	'open_loop',
	'preference',
	'pattern'
];

const MEMORY_TYPE_KEY_UNION = VALID_MEMORY_TYPES.join('|');

export class InvalidMemoryTypeError extends Error {
	readonly raw: string;

	constructor(raw: string) {
		super(`extractThoughtMetadata: invalid memoryType "${raw}"`);
		this.name = 'InvalidMemoryTypeError';
		this.raw = raw;
	}
}

const MIN_CUE_LENGTH = 3;
const MAX_CUE_LENGTH = 80;
const MAX_CUES = 5;

function isMemoryType(value: unknown): value is MemoryType {
	return typeof value === 'string' && (VALID_MEMORY_TYPES as string[]).includes(value);
}

/** Normalize LLM memoryType output; returns null when no canonical key matches (exact / case-insensitive only). */
export function normalizeMemoryType(raw: unknown): MemoryType | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim().toLowerCase();
	if (!trimmed) return null;
	const underscored = trimmed.replace(/[\s-]+/g, '_');
	if (isMemoryType(underscored)) return underscored;
	for (const key of VALID_MEMORY_TYPES) {
		if (key.toLowerCase() === underscored) return key;
	}
	return null;
}

function readMemoryTypeRaw(obj: Record<string, unknown>): unknown {
	if ('memoryType' in obj) return obj.memoryType;
	if ('memory_type' in obj) return obj.memory_type;
	return undefined;
}

function parseMetadataFields(obj: Record<string, unknown>): ThoughtMetadataExtraction {
	const raw = readMemoryTypeRaw(obj);
	const memoryType = normalizeMemoryType(raw);
	if (!memoryType) {
		const label = typeof raw === 'string' ? raw.trim() : raw === undefined ? '' : String(raw);
		throw new InvalidMemoryTypeError(label || '(missing)');
	}
	return { memoryType, cues: parseCues(obj.cues) };
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

type ExtractThoughtMetadataPass = 'default' | 'retry_strict';

async function extractThoughtMetadataOnce(
	input: {
		userId: string;
		normalizedText: string;
		groundingProfile?: GroundingProfileForEnrichment;
	},
	pass: ExtractThoughtMetadataPass,
	rejectedMemoryType?: string
): Promise<ThoughtMetadataExtraction> {
	const groundingBlock = groundingProfilePromptBlock(input.groundingProfile ?? null);
	const strictRule =
		pass === 'retry_strict'
			? [
					rejectedMemoryType
						? `Your previous memoryType "${rejectedMemoryType}" was rejected.`
						: 'Your previous memoryType was rejected.',
					`memoryType must be copied exactly from this list with no other strings: ${MEMORY_TYPE_KEY_UNION}.`,
					'Do not use thought category keys or free-form labels.'
				].join(' ')
			: '';

	const prompt = [
		'Return ONLY JSON with this shape:',
		'{',
		`  "memoryType": "${MEMORY_TYPE_KEY_UNION}",`,
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
		strictRule,
		'',
		groundingBlock,
		`Note: ${input.normalizedText}`
	]
		.filter((line) => line.length > 0)
		.join('\n');

	const response = await llmChatCompletion({
		userId: input.userId,
		messages: [
			{
				role: 'system',
				content:
					'You classify personal memory notes and generate search cues. memoryType must always be an exact key from the list in the user message. Return only valid JSON.'
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
	return parseMetadataFields(parsed as Record<string, unknown>);
}

/**
 * Single LLM call: memory type classification + search cue phrases.
 * Retries once with a strict ontology reminder when the model returns a drift label.
 */
export async function extractThoughtMetadata(input: {
	userId: string;
	normalizedText: string;
	groundingProfile?: GroundingProfileForEnrichment;
}): Promise<ThoughtMetadataExtraction> {
	try {
		return await extractThoughtMetadataOnce(input, 'default');
	} catch (err) {
		if (!(err instanceof InvalidMemoryTypeError)) throw err;
		console.warn('[extract-thought-metadata] invalid type on first pass; retrying strict', {
			userId: input.userId,
			rejected: err.raw
		});
		return extractThoughtMetadataOnce(input, 'retry_strict', err.raw);
	}
}
