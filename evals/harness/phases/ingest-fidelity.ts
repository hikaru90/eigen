/**
 * Phase: ingest-fidelity
 *
 * Judges whether each stored normalizedText faithfully represents the original
 * rawText that was submitted to captureThought().
 *
 * Operates against all corpus thoughts in the seed manifest.
 * Uses judgeCaptureFidelity (LLM-as-judge, 1–5 scale, faithful = score >= 4).
 */
import { eq } from 'drizzle-orm';
import { thought } from '$lib/server/db/brain.schema';
import { logEval, withEvalDb } from '../eval-context';
import { EVAL_CORPUS_USER_ID } from '../seed-corpus';
import { loadCorpus, type SeedManifest } from '../dataset';
import { judgeCaptureFidelity, type FidelityVerdict } from '../capture-fidelity';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FidelityRecord = {
	evalId: string;
	rawText: string;
	normalizedText: string;
	categoryAssigned: string;
} & FidelityVerdict;

export type IngestFidelityResult = {
	total: number;
	passed: number;
	rate: number;
	meanScore: number;
	perThought: FidelityRecord[];
};

// ── Main phase function ───────────────────────────────────────────────────────

export async function runIngestFidelity(manifest: SeedManifest): Promise<IngestFidelityResult> {
	logEval('ingest-fidelity phase start');

	const corpus = loadCorpus();
	const evalIds = corpus.thoughts.map((t) => t.id);

	// Resolve UUIDs from manifest
	const entries: Array<{ evalId: string; uuid: string; rawText: string }> = [];
	for (const t of corpus.thoughts) {
		const uuid = manifest[t.id];
		if (!uuid) {
			throw new Error(
				`[eval] ingest-fidelity: no manifest entry for ${t.id}. ` +
					`Run in full mode to seed the corpus first.`
			);
		}
		entries.push({ evalId: t.id, uuid, rawText: t.rawText });
	}

	logEval(`fidelity check: ${entries.length} corpus thoughts`);

	// Load stored normalizedText and category from DB
	const dbRows = await withEvalDb(EVAL_CORPUS_USER_ID, async (db) => {
		return await db
			.select({
				id: thought.id,
				normalizedText: thought.normalizedText,
				category: thought.category
			})
			.from(thought)
			.where(eq(thought.userId, EVAL_CORPUS_USER_ID));
	});

	const byUuid = new Map(dbRows.map((r) => [r.id, r]));

	// Run fidelity judgements in parallel (batches of 8 to avoid LLM rate limits)
	const BATCH_SIZE = 8;
	const records: FidelityRecord[] = [];

	for (let i = 0; i < entries.length; i += BATCH_SIZE) {
		const batch = entries.slice(i, i + BATCH_SIZE);
		const batchResults = await Promise.all(
			batch.map(async ({ evalId, uuid, rawText }) => {
				const row = byUuid.get(uuid);
				if (!row) {
					throw new Error(
						`[eval] ingest-fidelity: thought UUID ${uuid} (evalId=${evalId}) not found in DB`
					);
				}

				const verdict = await judgeCaptureFidelity({
					rawText,
					normalizedText: row.normalizedText,
					category: row.category
				});

				logEval(
					`fidelity: ${evalId} score=${verdict.score} faithful=${verdict.faithful}`
				);

				return {
					evalId,
					rawText,
					normalizedText: row.normalizedText,
					categoryAssigned: row.category,
					...verdict
				};
			})
		);
		records.push(...batchResults);
		if (i + BATCH_SIZE < entries.length) {
			logEval(`fidelity progress: ${records.length}/${entries.length}`);
		}
	}

	const passed = records.filter((r) => r.faithful).length;
	const meanScore = records.length > 0
		? records.reduce((a, r) => a + r.score, 0) / records.length
		: 0;

	logEval(
		`ingest-fidelity phase complete: ${passed}/${records.length} faithful (mean_score=${meanScore.toFixed(1)})`
	);

	return {
		total: records.length,
		passed,
		rate: records.length > 0 ? passed / records.length : 0,
		meanScore,
		perThought: records
	};
}
