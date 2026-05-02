import { and, eq } from 'drizzle-orm';
import { activityCallLog, captureSession, thought, type ThoughtCategory } from '$lib/server/db/schema';
import { db } from '$lib/server/db';
import { priceCall } from '$lib/server/pricing';

/** Explicit MVP pricing unit until model providers are wired. */
const CAPTURE_BASE_COST_USD = 0.0005;

export function deterministicNormalize(raw: string): {
	normalized: string;
	category: ThoughtCategory;
	metadata: Record<string, unknown>;
} {
	const normalized = raw.trim().replace(/\s+/g, ' ');
	let category: ThoughtCategory = 'thought';
	if (/\b(todo|task)\b/i.test(raw)) category = 'task';
	else if (/\bidea\b/i.test(raw)) category = 'idea';
	else if (/\b(reference|ref|link)\b/i.test(raw)) category = 'reference';
	return {
		normalized,
		category,
		metadata: { pipeline: 'deterministic_mvp' }
	};
}

async function logCaptureActivity(userId: string, operation: 'capture_submit' | 'capture_edit') {
	const priced = priceCall(CAPTURE_BASE_COST_USD);
	await db.insert(activityCallLog).values({
		userId,
		provider: 'mvp_stub',
		operation,
		baseCostUsd: priced.baseCostUsd,
		markupUsd: priced.markupUsd,
		totalCostUsd: priced.totalCostUsd,
		markupRate: priced.markupRate
	});
}

export async function captureThought(userId: string, rawInput: string) {
	await logCaptureActivity(userId, 'capture_submit');
	const { normalized, category, metadata } = deterministicNormalize(rawInput);

	const [sessionRow] = await db
		.insert(captureSession)
		.values({
			userId,
			status: 'accepted',
			rawInput,
			normalizedPreview: normalized,
			category,
			metadataPreview: metadata,
			revisionCount: 0
		})
		.returning();

	const embedding = new Array<number>(1536).fill(0);

	const [stored] = await db.transaction(async (tx) => {
		const [t] = await tx
			.insert(thought)
			.values({
				userId,
				rawText: rawInput,
				normalizedText: normalized,
				category,
				metadata: {
					...metadata,
					captureSessionId: sessionRow.id
				},
				embedding
			})
			.returning();
		return [t];
	});

	return stored;
}

export async function editStoredThought(
	userId: string,
	thoughtId: string,
	editRequest: string
) {
	await logCaptureActivity(userId, 'capture_edit');

	const [existing] = await db
		.select()
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) return { ok: false as const, reason: 'not_found' as const };

	// MVP deterministic "natural language edit": append instruction, then normalize.
	const editedRaw = `${existing.rawText}\n\nEdit request: ${editRequest.trim()}`;
	const { normalized, category, metadata } = deterministicNormalize(editedRaw);

	const [updated] = await db
		.update(thought)
		.set({
			rawText: editedRaw,
			normalizedText: normalized,
			category,
			metadata: {
				...(existing.metadata as Record<string, unknown>),
				...metadata,
				lastEditRequest: editRequest.trim()
			},
			updatedAt: new Date()
		})
		.where(eq(thought.id, thoughtId))
		.returning();

	return { ok: true as const, thought: updated! };
}
