/**
 * Corpus seeder — agent-first.
 *
 * Seeds the unified eval corpus (evals/datasets/corpus.yaml) by calling
 * captureThought() for every thought not already present in the DB.
 *
 * Design:
 *   - Uses a single stable seeder user (EVAL_CORPUS_USER_ID) so the corpus
 *     persists across runs and can be reused by analysis-only mode.
 *   - Idempotent: skips thoughts whose evalId already exists in the DB with
 *     the same rawText.  Hard-fails if a thought's text has changed
 *     (staleness guard — delete the DB user to force a full re-seed).
 *   - Writes a seed manifest (evals/datasets/seed-manifest.json) mapping
 *     evalId → UUID for downstream phases that need the UUIDs.
 *   - After ingest, wires the explicit relation edges from relations.yaml via
 *     upsertThoughtRelation so the retrieval ablation has graph signal.
 *   - Hard fails on any error — no silent skips (guardrail compliance).
 *
 * Called from evals/run.ts in `full` mode. Not meant to be run standalone,
 * but can be via: vite-node --config evals/vite.config.ts evals/harness/seed-corpus.ts
 */
import { eq } from 'drizzle-orm';
import { thought, thoughtRelation } from '$lib/server/db/brain.schema';
import { user } from '$lib/server/db/auth.schema';
import { captureThought } from '$lib/server/capture/service';
import { upsertThoughtRelation } from '$lib/server/graph/falkor';
import type { AppDatabase } from '$lib/server/db';
import { logEval, runEval, startEvalHeartbeat, withEvalDb } from './eval-context';
import {
	loadCorpus,
	loadRelations,
	loadSeedManifest,
	saveSeedManifest,
	type CorpusThought,
	type SeedManifest
} from './dataset';

// ── Config ────────────────────────────────────────────────────────────────────

export const EVAL_CORPUS_USER_ID = 'eval-runner-corpus';
const EVAL_CORPUS_EMAIL = 'eval-corpus@local.eval';
const EVAL_CORPUS_NAME = 'Eval Runner (Corpus)';

// Concurrency cap for ingest: high enough to overlap LLM RTTs, low enough
// not to overwhelm the DB connection pool or rate-limit the LLM gateway.
const INGEST_CONCURRENCY = 4;

// ── User setup ────────────────────────────────────────────────────────────────

async function ensureCorpusUser(db: AppDatabase): Promise<void> {
	const existing = await db.select().from(user).where(eq(user.id, EVAL_CORPUS_USER_ID));
	if (existing.length > 0) return;
	await db.insert(user).values({
		id: EVAL_CORPUS_USER_ID,
		name: EVAL_CORPUS_NAME,
		email: EVAL_CORPUS_EMAIL,
		emailVerified: true,
		onboardingCompleted: true
	});
	logEval(`created corpus user ${EVAL_CORPUS_USER_ID}`);
}

// ── Existing thought lookup ───────────────────────────────────────────────────

type ExistingRow = {
	id: string;
	rawText: string;
	createdAt: Date;
};

async function loadExistingByEvalId(db: AppDatabase): Promise<Map<string, ExistingRow>> {
	const rows = await db
		.select({
			id: thought.id,
			rawText: thought.rawText,
			createdAt: thought.createdAt,
			metadata: thought.metadata
		})
		.from(thought)
		.where(eq(thought.userId, EVAL_CORPUS_USER_ID));

	const byEvalId = new Map<string, ExistingRow>();
	for (const row of rows) {
		const meta = (row.metadata as Record<string, unknown>) ?? {};
		const evalId = typeof meta.evalId === 'string' ? meta.evalId : null;
		if (!evalId) continue;
		byEvalId.set(evalId, {
			id: row.id,
			rawText: row.rawText,
			createdAt: row.createdAt
		});
	}
	return byEvalId;
}

// ── Ingest ────────────────────────────────────────────────────────────────────

/**
 * Ingest thoughts through captureThought().
 * Returns a manifest mapping evalId → UUID for every thought in the corpus.
 * Hard-fails if any thought's rawText has changed since the last seed
 * (caller must delete the corpus user to force a full re-seed).
 */
async function seedThoughts(
	db: AppDatabase,
	thoughts: CorpusThought[],
	existingManifest: SeedManifest
): Promise<SeedManifest> {
	const existing = await loadExistingByEvalId(db);
	const manifest: SeedManifest = { ...existingManifest };

	let skipped = 0;
	let ingested = 0;

	// Split into unchanged (skip) and to-ingest
	const toIngest: CorpusThought[] = [];
	for (const item of thoughts) {
		const row = existing.get(item.id);
		if (row) {
			if (row.rawText !== item.rawText) {
				throw new Error(
					`[eval] corpus thought ${item.id} rawText has changed since last seed. ` +
						`Delete the corpus user (id=${EVAL_CORPUS_USER_ID}) from the DB to force a full re-seed.\n` +
						`  DB:      ${row.rawText.slice(0, 80)}\n` +
						`  Corpus:  ${item.rawText.slice(0, 80)}`
				);
			}
			manifest[item.id] = row.id;
			skipped += 1;
			continue;
		}
		toIngest.push(item);
	}

	logEval(`seed thoughts: ${skipped} already seeded, ${toIngest.length} to ingest`);

	if (toIngest.length === 0) {
		return manifest;
	}

	// Ingest with concurrency cap
	const slots = Array.from({ length: INGEST_CONCURRENCY }, () => Promise.resolve());
	const results: Promise<{ evalId: string; uuid: string }>[] = [];
	let slotIdx = 0;

	for (let i = 0; i < toIngest.length; i++) {
		const item = toIngest[i];
		const idx = i;
		const slot = slotIdx % INGEST_CONCURRENCY;
		slotIdx++;

		const p = slots[slot].then(async () => {
			const stored = await captureThought(EVAL_CORPUS_USER_ID, item.rawText, {
				onProgress: () => {}
			});
			logEval(
				`ingest ${idx + 1}/${toIngest.length}: ${item.id} → ${stored.id} (category=${stored.category})`
			);
			return { evalId: item.id, uuid: stored.id };
		});
		slots[slot] = p.then(() => undefined);
		results.push(p);
	}

	const settled = await Promise.all(results);
	for (const { evalId, uuid } of settled) {
		manifest[evalId] = uuid;
		ingested += 1;
	}

	logEval(`seed thoughts complete: ingested=${ingested} skipped=${skipped}`);
	return manifest;
}

// ── Relation wiring ───────────────────────────────────────────────────────────

/**
 * Wire explicit relation edges from relations.yaml into the DB and graph.
 * Uses upsertThoughtRelation so it is idempotent.
 */
async function wireRelations(manifest: SeedManifest): Promise<void> {
	const { relations } = loadRelations();
	logEval(`wiring ${relations.length} relation edges`);

	let wired = 0;
	const errors: string[] = [];

	for (const edge of relations) {
		const sourceId = manifest[edge.source];
		const targetId = manifest[edge.target];

		if (!sourceId) {
			errors.push(`missing manifest entry for source ${edge.source}`);
			continue;
		}
		if (!targetId) {
			errors.push(`missing manifest entry for target ${edge.target}`);
			continue;
		}

		await upsertThoughtRelation({
			userId: EVAL_CORPUS_USER_ID,
			sourceId,
			targetId,
			relationType: edge.type
		});
		wired += 1;
	}

	if (errors.length > 0) {
		throw new Error(
			`[eval] relation wiring failed — ${errors.length} missing manifest entries:\n` +
				errors.map((e) => `  ${e}`).join('\n')
		);
	}

	logEval(`relation wiring complete: ${wired} edges upserted`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function seedCorpus(): Promise<SeedManifest> {
	const stopHeartbeat = startEvalHeartbeat('eval:seed-corpus');
	try {
		const corpus = loadCorpus();
		const existingManifest = loadSeedManifest();
		logEval(
			`corpus: ${corpus.thoughts.length} thoughts | ` +
				`existing manifest: ${Object.keys(existingManifest).length} entries`
		);

		const manifest = await withEvalDb(EVAL_CORPUS_USER_ID, async (db) => {
			await ensureCorpusUser(db);
			return await seedThoughts(db, corpus.thoughts, existingManifest);
		});

		// Wire relations after all thoughts are in the DB.
		// Relations use UUIDs from the manifest, not evalIds.
		await wireRelations(manifest);

		saveSeedManifest(manifest);
		logEval(`seed manifest saved: ${Object.keys(manifest).length} entries`);

		return manifest;
	} finally {
		stopHeartbeat();
	}
}

// Run directly if invoked as a standalone script
if (process.argv[1]?.endsWith('seed-corpus.ts')) {
	void runEval(seedCorpus);
}
