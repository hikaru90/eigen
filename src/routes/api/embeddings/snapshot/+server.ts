import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought, canonicalEntity } from '$lib/server/db/schema';

/**
 * Maximum number of items (thoughts + entities) returned per request.
 * Keeps the browser download bounded: 800 items × 1536 floats × 4 bytes ≈ 4.9 MB.
 */
const ITEM_CAP = 800;

export type EmbeddingSnapshotItem = {
	id: string;
	kind: 'Thought' | 'Entity';
	label: string;
	subtype: string;
	embedding: number[];
};

export type EmbeddingSnapshotResponse = {
	items: EmbeddingSnapshotItem[];
};

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const db = getDb();

	// Fetch thought embeddings — only rows where embedding has been computed
	const thoughts = await db
		.select({
			id: thought.id,
			rawText: thought.rawText,
			category: thought.category,
			embedding: thought.embedding
		})
		.from(thought)
		.where(and(eq(thought.userId, user.id), isNotNull(thought.embedding)))
		.orderBy(thought.createdAt)
		.limit(ITEM_CAP);

	// Fetch entity embeddings — only rows where embedding has been computed
	const entities = await db
		.select({
			id: canonicalEntity.id,
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType,
			embedding: canonicalEntity.embedding
		})
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, user.id), isNotNull(canonicalEntity.embedding)))
		.orderBy(canonicalEntity.createdAt)
		.limit(ITEM_CAP);

	// Build combined list, respecting the item cap across both sources.
	// Thoughts are prioritised; entities fill remaining capacity.
	const thoughtItems: EmbeddingSnapshotItem[] = thoughts.map((t) => ({
		id: t.id,
		kind: 'Thought' as const,
		label: t.rawText.slice(0, 120),
		subtype: t.category,
		// drizzle returns vector columns as number[] when pgvector extension is active
		embedding: t.embedding as unknown as number[]
	}));

	const remaining = ITEM_CAP - thoughtItems.length;
	const entityItems: EmbeddingSnapshotItem[] = entities.slice(0, remaining).map((e) => ({
		id: e.id,
		kind: 'Entity' as const,
		label: e.label,
		subtype: e.entityType,
		embedding: e.embedding as unknown as number[]
	}));

	const items = [...thoughtItems, ...entityItems];

	// Hard validation: every item must have a non-empty 1536-dim embedding
	for (const item of items) {
		if (!Array.isArray(item.embedding) || item.embedding.length !== 1536) {
			// This should never happen given the isNotNull filter + validated ingest,
			// but the failure policy requires a hard error rather than silently skipping.
			error(
				500,
				`Item ${item.id} has an invalid embedding (length=${Array.isArray(item.embedding) ? item.embedding.length : typeof item.embedding}). This is a data integrity error.`
			);
		}
	}

	return json({ items } satisfies EmbeddingSnapshotResponse);
};
