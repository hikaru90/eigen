import { desc, eq, sql } from 'drizzle-orm';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { getDb } from '$lib/server/db';
import { thought, userOntology, LEGACY_CAPTURE_CATEGORY_KEYS, type ThoughtCategory } from '$lib/server/db/schema';
import {
	emptyOntologyProfile,
	parseOntologyProfileJson,
	isThoughtCategory,
	ONTOLOGY_PROFILE_VERSION,
	type OntologyProfileV1
} from './types';
import { extractChatContent, userMessage } from './llm-json';

function parseOntologyEvalOutput(content: string): OntologyProfileV1 {
	const parsed = JSON.parse(content.trim()) as unknown;
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Ontology evaluation output must be a JSON object');
	}
	const o = parsed as Record<string, unknown>;
	const categoryGuidance: Partial<Record<ThoughtCategory, string>> = {};
	const rawCg = o.categoryGuidance;
	if (rawCg && typeof rawCg === 'object') {
		for (const key of LEGACY_CAPTURE_CATEGORY_KEYS) {
			const v = (rawCg as Record<string, unknown>)[key];
			if (typeof v === 'string' && v.trim().length > 0) {
				categoryGuidance[key] = v.trim().slice(0, 2000);
			}
		}
	}
	const summary = typeof o.summary === 'string' ? o.summary.trim().slice(0, 4000) : undefined;
	return {
		version: ONTOLOGY_PROFILE_VERSION,
		categoryGuidance,
		...(summary ? { summary } : {})
	};
}

async function refreshUserOntologyProfileFromRecentThoughts(input: {
	userId: string;
	evaluatedUpToThoughtCount: number;
	onBeforeEval?: () => void;
}): Promise<void> {
	const { userId, evaluatedUpToThoughtCount, onBeforeEval } = input;

	const [ontoRow] = await getDb()
		.select({ profile: userOntology.profile })
		.from(userOntology)
		.where(eq(userOntology.userId, userId))
		.limit(1);

	const recent = await getDb()
		.select({
			normalizedText: thought.normalizedText,
			category: thought.category
		})
		.from(thought)
		.where(eq(thought.userId, userId))
		.orderBy(desc(thought.createdAt), desc(thought.id))
		.limit(20);

	const lines = recent.map((r, i) => {
		const cat = typeof r.category === 'string' && isThoughtCategory(r.category) ? r.category : 'thought';
		return `${i + 1}. [${cat}] ${r.normalizedText}`;
	});

	const priorProfile = ontoRow?.profile
		? parseOntologyProfileJson(ontoRow.profile)
		: emptyOntologyProfile();

	const priorJson = JSON.stringify({
		version: priorProfile.version,
		categoryGuidance: priorProfile.categoryGuidance,
		summary: priorProfile.summary ?? null
	});

	const prompt = [
		'Return ONLY JSON with keys: version (number 1), categoryGuidance (object), summary (string, optional).',
		'categoryGuidance must use only these keys (omit unused): thought, task, idea, reference, date, person.',
		'Each value is a short string (<= 2000 chars) describing how this user tends to use that category.',
		'summary is an optional <=4000 char overview of labeling habits.',
		'Prior profile (refine, do not contradict obvious facts unless correcting drift):',
		priorJson,
		'Recent labeled thoughts (most recent first):',
		lines.join('\n') || '(none)'
	].join('\n');

	onBeforeEval?.();

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: 'You maintain a compact ontology guidance document for a thought classifier. JSON only.'
		},
		userMessage(prompt)
	];

	const response = await llmChatCompletion({
		userId,
		messages,
		temperature: 0
	});

	const profile = parseOntologyEvalOutput(extractChatContent(response));

	await getDb()
		.insert(userOntology)
		.values({
			userId,
			profile: profile as unknown as Record<string, unknown>,
			evaluatedUpToThoughtCount
		})
		.onConflictDoUpdate({
			target: userOntology.userId,
			set: {
				profile: profile as unknown as Record<string, unknown>,
				evaluatedUpToThoughtCount,
				updatedAt: new Date()
			}
		});
}

/**
 * After a new thought is committed: every 10th thought for the user, refresh stored ontology guidance.
 * Failures are swallowed (logged); the thought row is already durable.
 */
export async function maybeRefreshUserOntology(input: {
	userId: string;
	thoughtCountAfterInsert: number;
	onBeforeEval?: () => void;
}): Promise<void> {
	const { userId, thoughtCountAfterInsert: count, onBeforeEval } = input;
	if (count <= 0 || count % 10 !== 0) return;

	const [ontoRow] = await getDb()
		.select({
			profile: userOntology.profile,
			evaluatedUpToThoughtCount: userOntology.evaluatedUpToThoughtCount
		})
		.from(userOntology)
		.where(eq(userOntology.userId, userId))
		.limit(1);

	const cursor = ontoRow?.evaluatedUpToThoughtCount ?? 0;
	if (count <= cursor) return;

	try {
		await refreshUserOntologyProfileFromRecentThoughts({
			userId,
			evaluatedUpToThoughtCount: count,
			onBeforeEval
		});
	} catch (err) {
		console.error('ontology refresh failed after capture', {
			userId,
			thoughtCount: count,
			message: err instanceof Error ? err.message : String(err)
		});
	}
}

/**
 * Runs the same LLM refresh as the periodic capture hook, using the current total thought count as
 * `evaluatedUpToThoughtCount`. Propagates errors (unlike {@link maybeRefreshUserOntology}).
 */
export async function recomputeUserOntologyProfileForUser(
	userId: string,
	options?: { onBeforeEval?: () => void }
): Promise<void> {
	const [countRow] = await getDb()
		.select({ n: sql<number>`count(*)::int` })
		.from(thought)
		.where(eq(thought.userId, userId));
	const thoughtCount = Number(countRow?.n ?? 0);

	await refreshUserOntologyProfileFromRecentThoughts({
		userId,
		evaluatedUpToThoughtCount: thoughtCount,
		onBeforeEval: options?.onBeforeEval
	});
}
