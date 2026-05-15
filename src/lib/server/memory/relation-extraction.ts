import { desc, eq, ne } from 'drizzle-orm';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { searchThoughts } from '$lib/server/retrieval/service';

const ALLOWED_RELATION_TYPES = new Set([
	'mentions',
	'depends_on',
	'refines',
	'contradicts',
	'related_to',
	'follows_from',
	'continuation_of',
	'caused_by'
]);

export type ExtractedRelation = {
	targetId: string;
	relationType:
		| 'mentions'
		| 'depends_on'
		| 'refines'
		| 'contradicts'
		| 'related_to'
		| 'follows_from'
		| 'continuation_of'
		| 'caused_by';
};

function extractChatContent(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('Relation extraction response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('Relation extraction response has no choices');
	}
	const message = (choices[0] as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('Relation extraction response has no message');
	}
	const content = (message as { content?: unknown }).content;
	if (typeof content !== 'string') {
		throw new Error('Relation extraction message content must be a string');
	}
	return content;
}

function parseRelations(content: string): ExtractedRelation[] {
	const parsed = JSON.parse(content) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('Relation extraction output must be a JSON array');
	}

	return parsed
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const targetId =
				typeof (entry as { targetId?: unknown }).targetId === 'string'
					? (entry as { targetId: string }).targetId.trim()
					: '';
			const relationType =
				typeof (entry as { relationType?: unknown }).relationType === 'string'
					? (entry as { relationType: string }).relationType
					: '';
			if (!targetId || !ALLOWED_RELATION_TYPES.has(relationType)) return null;
			return {
				targetId,
				relationType: relationType as ExtractedRelation['relationType']
			};
		})
		.filter((value): value is ExtractedRelation => value !== null);
}

/** Load the N most recently captured thoughts for this user (temporal session context). */
async function loadTemporalNeighbors(
	userId: string,
	thoughtId: string,
	limit: number
): Promise<Array<{ id: string; normalizedText: string }>> {
	return getDb()
		.select({ id: thought.id, normalizedText: thought.normalizedText })
		.from(thought)
		.where(eq(thought.userId, userId))
		.orderBy(desc(thought.createdAt), desc(thought.id))
		.limit(limit + 1) // +1 to account for the current thought which we filter out
		.then((rows) => rows.filter((r) => r.id !== thoughtId).slice(0, limit));
}

export async function extractRelations(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
}): Promise<ExtractedRelation[]> {
	// Semantic neighbors (conceptually related)
	const semanticNeighbors = await searchThoughts({
		userId: input.userId,
		query: input.normalizedText,
		topK: 8
	});

	// Temporal neighbors (recently captured — session continuity)
	const temporalNeighbors = await loadTemporalNeighbors(input.userId, input.thoughtId, 5);

	// Merge and deduplicate, excluding the current thought
	const seen = new Set<string>([input.thoughtId]);
	const candidates: Array<{ id: string; normalizedText: string }> = [];

	// Semantic neighbors first (higher priority), then temporal
	for (const n of semanticNeighbors) {
		if (!seen.has(n.id)) {
			seen.add(n.id);
			candidates.push({ id: n.id, normalizedText: n.normalizedText });
		}
	}
	for (const n of temporalNeighbors) {
		if (!seen.has(n.id)) {
			seen.add(n.id);
			candidates.push({ id: n.id, normalizedText: n.normalizedText });
		}
	}

	if (candidates.length === 0) return [];

	const prompt = [
		'Return ONLY JSON.',
		'Given a source thought and candidate thought ids, return a JSON array of relations from source to candidates.',
		'Allowed relation types:',
		'  mentions         — source explicitly references candidate',
		'  depends_on       — source requires candidate to be true/done first',
		'  refines          — source sharpens, elaborates, or adds detail to candidate',
		'  contradicts      — source conflicts with or negates candidate',
		'  related_to       — same topic, theme, or subject matter (use this liberally)',
		'  follows_from     — source is a natural next step after candidate (temporal/sequential)',
		'  continuation_of  — source directly continues candidate (same thread or context)',
		'  caused_by        — source was caused by candidate',
		'Guidelines:',
		'  - Use related_to for any two thoughts that share the same topic, subject, or domain.',
		'  - Use refines when the source adds more specificity to a more general candidate.',
		'  - Use continuation_of when both thoughts are clearly part of the same ongoing context.',
		'  - Do NOT require explicit cross-references; topical similarity is enough for related_to.',
		'Use this schema exactly: [{"targetId":"<candidate-id>","relationType":"related_to"}].',
		'Return an empty array only when there is genuinely no meaningful connection.',
		`Source thought (${input.thoughtId}): ${input.normalizedText}`,
		'Candidates:',
		...candidates.map((c) => `${c.id}: ${c.normalizedText}`)
	].join('\n');

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You extract thought-to-thought relations including topical, semantic, and contextual connections — not only explicit cross-references. When two thoughts share the same subject, prefer related_to over returning an empty array.'
		},
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});

	return parseRelations(extractChatContent(response));
}
