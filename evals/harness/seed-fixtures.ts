/**
 * Seed retrieval eval fixtures into the dev DB.
 *
 * Idempotent: maps stable string ids (t_NNN) to thought UUIDs via `metadata.evalId`,
 * so reruns update existing rows instead of duplicating them.
 *
 * Embeddings are cached in `evals/datasets/retrieval/embeddings.cache.json` keyed by
 * normalized text, so repeat runs do not burn LLM tokens unless the corpus changes.
 *
 * Run with: `npm run eval:seed`.
 */
import { eq } from 'drizzle-orm';
import { thought, thoughtRelation } from '$lib/server/db/brain.schema';
import { user } from '$lib/server/db/auth.schema';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { upsertThoughtNode, upsertThoughtRelation } from '$lib/server/graph/falkor';
import type { AppDatabase } from '$lib/server/db';
import { logEval, runEval, startEvalHeartbeat, withEvalDb } from './eval-context';
import {
	loadCorpus,
	loadRelations,
	loadEmbeddingCache,
	saveEmbeddingCache,
	type CorpusThought,
	type EmbeddingCache,
	type RelationEdge
} from './dataset';
import { EVAL_RETRIEVAL_USER_ID } from './eval-config';

const EVAL_USER_EMAIL = 'eval-retrieval@local.eval';
const EVAL_USER_NAME = 'Eval Runner (Retrieval)';

function deterministicNormalize(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ');
}

async function ensureUser(db: AppDatabase): Promise<void> {
	const existing = await db.select().from(user).where(eq(user.id, EVAL_RETRIEVAL_USER_ID));
	if (existing.length > 0) return;
	await db.insert(user).values({
		id: EVAL_RETRIEVAL_USER_ID,
		name: EVAL_USER_NAME,
		email: EVAL_USER_EMAIL,
		emailVerified: true,
		onboardingCompleted: true
	});
	logEval(`created user row ${EVAL_RETRIEVAL_USER_ID}`);
}

type StoredThoughtRow = {
	id: string;
	rawText: string;
	normalizedText: string;
	category: string;
	metadata: Record<string, unknown>;
};

async function loadExistingThoughts(db: AppDatabase): Promise<Map<string, StoredThoughtRow>> {
	const rows = await db
		.select({
			id: thought.id,
			rawText: thought.rawText,
			normalizedText: thought.normalizedText,
			category: thought.category,
			metadata: thought.metadata
		})
		.from(thought)
		.where(eq(thought.userId, EVAL_RETRIEVAL_USER_ID));
	const byEvalId = new Map<string, StoredThoughtRow>();
	for (const row of rows) {
		const meta = (row.metadata as Record<string, unknown>) ?? {};
		const evalId = typeof meta.evalId === 'string' ? meta.evalId : null;
		if (!evalId) continue;
		byEvalId.set(evalId, {
			id: row.id,
			rawText: row.rawText,
			normalizedText: row.normalizedText,
			category: row.category,
			metadata: meta
		});
	}
	return byEvalId;
}

async function getOrCreateEmbedding(
	cache: EmbeddingCache,
	normalizedText: string
): Promise<{ vector: number[]; cached: boolean }> {
	const cached = cache[normalizedText];
	if (cached) {
		return { vector: cached, cached: true };
	}
	const vector = await createThoughtEmbedding(EVAL_RETRIEVAL_USER_ID, normalizedText);
	cache[normalizedText] = vector;
	return { vector, cached: false };
}

async function upsertThoughts(
	db: AppDatabase,
	corpus: CorpusThought[],
	cache: EmbeddingCache
): Promise<{ idMap: Map<string, string>; embeddingsMissed: number }> {
	const existing = await loadExistingThoughts(db);
	const idMap = new Map<string, string>();
	let embeddingsMissed = 0;
	let inserted = 0;
	let updated = 0;
	let unchanged = 0;

	for (const item of corpus) {
		const normalized = deterministicNormalize(item.rawText);
		const lexical = computeLexicalText(normalized);
		const existingRow = existing.get(item.id);
		const matches =
			existingRow &&
			existingRow.rawText === item.rawText &&
			existingRow.normalizedText === normalized &&
			existingRow.category === item.category;

		if (matches && existingRow) {
			idMap.set(item.id, existingRow.id);
			unchanged += 1;
			continue;
		}

		const { vector, cached } = await getOrCreateEmbedding(cache, normalized);
		if (!cached) embeddingsMissed += 1;

		if (existingRow) {
			await db
				.update(thought)
				.set({
					rawText: item.rawText,
					normalizedText: normalized,
					lexicalText: lexical,
					category: item.category,
					metadata: { evalId: item.id, source: 'eval-fixture' },
					embedding: vector,
					updatedAt: new Date()
				})
				.where(eq(thought.id, existingRow.id));
			idMap.set(item.id, existingRow.id);
			updated += 1;
		} else {
			const [row] = await db
				.insert(thought)
				.values({
					userId: EVAL_RETRIEVAL_USER_ID,
					rawText: item.rawText,
					normalizedText: normalized,
					lexicalText: lexical,
					category: item.category,
					metadata: { evalId: item.id, source: 'eval-fixture' },
					embedding: vector
				})
				.returning({ id: thought.id });
			idMap.set(item.id, row.id);
			inserted += 1;
		}

		const processed = inserted + updated + unchanged;
		if (processed % 10 === 0 || processed === corpus.length) {
			logEval(`seed thoughts progress ${processed}/${corpus.length}`);
		}
	}

	logEval(
		`thoughts: inserted=${inserted} updated=${updated} unchanged=${unchanged} embeddings_missed=${embeddingsMissed}`
	);
	return { idMap, embeddingsMissed };
}

async function replaceRelations(
	db: AppDatabase,
	relations: RelationEdge[],
	idMap: Map<string, string>
): Promise<Array<{ sourceThoughtId: string; targetThoughtId: string; relationType: string }>> {
	await db.delete(thoughtRelation).where(eq(thoughtRelation.userId, EVAL_RETRIEVAL_USER_ID));
	if (relations.length === 0) return [];

	const rows = relations.map((r) => {
		const sourceId = idMap.get(r.source);
		const targetId = idMap.get(r.target);
		if (!sourceId || !targetId) {
			throw new Error(
				`[eval] relation references unknown thought id: source=${r.source} target=${r.target}`
			);
		}
		return {
			userId: EVAL_RETRIEVAL_USER_ID,
			sourceThoughtId: sourceId,
			targetThoughtId: targetId,
			relationType: r.type
		};
	});
	await db.insert(thoughtRelation).values(rows);
	logEval(`relations: inserted=${rows.length}`);
	return rows;
}

async function syncGraph(
	corpus: CorpusThought[],
	relations: Array<{ sourceThoughtId: string; targetThoughtId: string; relationType: string }>,
	idMap: Map<string, string>
): Promise<void> {
	let syncedNodes = 0;
	for (const item of corpus) {
		const thoughtId = idMap.get(item.id);
		if (!thoughtId) {
			throw new Error(`[eval] graph sync missing mapped thought id for ${item.id}`);
		}
		const normalized = deterministicNormalize(item.rawText);
		const lexical = computeLexicalText(normalized);
		await upsertThoughtNode({
			id: thoughtId,
			userId: EVAL_RETRIEVAL_USER_ID,
			rawText: item.rawText,
			normalizedText: normalized,
			lexicalText: lexical,
			category: item.category
		});
		syncedNodes += 1;
	}
	logEval(`graph nodes: upserted=${syncedNodes}`);

	let syncedEdges = 0;
	for (const relation of relations) {
		await upsertThoughtRelation({
			userId: EVAL_RETRIEVAL_USER_ID,
			sourceId: relation.sourceThoughtId,
			targetId: relation.targetThoughtId,
			relationType: relation.relationType
		});
		syncedEdges += 1;
	}
	logEval(`graph edges: upserted=${syncedEdges}`);
}

async function main(): Promise<void> {
	const stopHeartbeat = startEvalHeartbeat('eval:seed');
	try {
		const corpus = loadCorpus();
		const relations = loadRelations();
		const cache = loadEmbeddingCache();
		logEval(
			`seed start: corpus=${corpus.thoughts.length} relations=${relations.relations.length} cache=${Object.keys(cache).length}`
		);

		await withEvalDb(EVAL_RETRIEVAL_USER_ID, async (db) => {
			await ensureUser(db);
			const { idMap, embeddingsMissed } = await upsertThoughts(db, corpus.thoughts, cache);
			const relationRows = await replaceRelations(db, relations.relations, idMap);
			await syncGraph(corpus.thoughts, relationRows, idMap);
			if (embeddingsMissed > 0) {
				saveEmbeddingCache(cache);
				logEval(`saved ${Object.keys(cache).length} embeddings to cache`);
			}
		});
		logEval('seed complete');
	} finally {
		stopHeartbeat();
	}
}

void runEval(main);
