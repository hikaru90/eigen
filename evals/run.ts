/**
 * Unified eval runner — single entry point for all evaluation phases.
 *
 * Usage:
 *   npm run eval              # full mode: seed + all phases
 *   npm run eval:quick        # analysis-only mode, golden subset only
 *   npm run eval:full         # explicit full mode
 *
 * Flags:
 *   --mode full | analysis-only   (default: full)
 *   --subset golden               (only run layer-checks on the 10 golden thoughts;
 *                                  other phases still use the full corpus)
 *   --skip-sweep                  (skip the 11-point weight sweep in retrieval ablation;
 *                                  still runs single-preset tests)
 *
 * Phases (in order):
 *   1. seed          (full mode only) — ingest corpus through captureThought()
 *   2. layer-checks  — entity/relation P/R/F1, embedding similarity, community detection
 *   3. retrieval     — weight-sweep ablation and single-preset tests
 *   4. answer-qa     — synthesis probes + full 48-case QA eval
 *   5. fidelity      (full mode only) — raw→normalized fidelity judge
 *
 * Hard-fails on any phase error (exit code 1). No silent catch-and-continue.
 * Writes a single unified report: evals/reports/eval-{timestamp}.json
 *                          and:  evals/reports/eval-latest.json
 */
import { runEval, logEval, startEvalHeartbeat } from './harness/eval-context';
import { seedCorpus, EVAL_CORPUS_USER_ID } from './harness/seed-corpus';
import { runLayerChecks } from './harness/phases/layer-checks';
import { runRetrievalAblation } from './harness/phases/retrieval-ablation';
import { runAnswerQa } from './harness/phases/answer-qa';
import { runIngestFidelity } from './harness/phases/ingest-fidelity';
import { loadSeedManifest } from './harness/dataset';
import { writeReport } from './harness/report';

// ── CLI args ──────────────────────────────────────────────────────────────────

type Mode = 'full' | 'analysis-only';

function parseArgs(): { mode: Mode; skipSweep: boolean } {
	const args = process.argv.slice(2);

	let mode: Mode = 'full';
	const modeIdx = args.indexOf('--mode');
	if (modeIdx !== -1) {
		const val = args[modeIdx + 1];
		if (val !== 'full' && val !== 'analysis-only') {
			throw new Error(
				`[eval] --mode must be 'full' or 'analysis-only', got: ${val}`
			);
		}
		mode = val;
	}

	const skipSweep = args.includes('--skip-sweep');

	return { mode, skipSweep };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const { mode, skipSweep } = parseArgs();
	const stopHeartbeat = startEvalHeartbeat('eval:run');

	logEval(`=== Unified eval runner (mode=${mode}${skipSweep ? ' skip-sweep' : ''}) ===`);

	try {
		// ── Phase 1: Seed ─────────────────────────────────────────────────────
		let manifest = loadSeedManifest();

		if (mode === 'full') {
			logEval('--- Phase 1: seed corpus ---');
			manifest = await seedCorpus();
			logEval(`seed complete: ${Object.keys(manifest).length} thoughts in manifest`);
		} else {
			if (Object.keys(manifest).length === 0) {
				throw new Error(
					'[eval] analysis-only mode requires a seed manifest from a prior full run. ' +
						'Run with --mode full first.'
				);
			}
			logEval(
				`analysis-only: using existing manifest (${Object.keys(manifest).length} entries, user=${EVAL_CORPUS_USER_ID})`
			);
		}

		// ── Phase 2: Layer checks ─────────────────────────────────────────────
		logEval('--- Phase 2: layer checks ---');
		const layerChecks = await runLayerChecks(manifest);
		logEval(
			`layer checks: entity F1=${layerChecks.entities.summary.f1.toFixed(3)} ` +
				`relation F1=${layerChecks.relations.summary.f1.toFixed(3)} ` +
				`embedding avg=${layerChecks.embedding.metrics.avgSimilarity.toFixed(3)}`
		);

		// ── Phase 3: Retrieval ablation ───────────────────────────────────────
		logEval('--- Phase 3: retrieval ablation ---');
		const retrieval = await runRetrievalAblation(manifest, { skipFullSweep: skipSweep });
		const hybridEntry = retrieval.headlineComparison.find((r) => r.label === 'hybrid');
		if (hybridEntry) {
			logEval(
				`retrieval: best hybrid NDCG@10=${hybridEntry.overall.ndcgAt10.toFixed(3)} ` +
					`Recall@10=${hybridEntry.overall.recallAt10.toFixed(3)} MRR=${hybridEntry.overall.mrr.toFixed(3)}`
			);
		}

		// ── Phase 4: Answer QA ────────────────────────────────────────────────
		logEval('--- Phase 4: answer QA ---');
		const answerQa = await runAnswerQa();
		logEval(
			`answer QA: probes=${answerQa.probes.passed}/${answerQa.probes.total} ` +
				`full=${answerQa.full.passed}/${answerQa.full.total} ` +
				`mean_score=${answerQa.full.summary.weightedScore.mean.toFixed(2)}`
		);

		// ── Phase 5: Ingest fidelity (full mode only) ─────────────────────────
		let fidelity = null;
		if (mode === 'full') {
			logEval('--- Phase 5: ingest fidelity ---');
			fidelity = await runIngestFidelity(manifest);
			logEval(
				`fidelity: ${fidelity.passed}/${fidelity.total} faithful (mean_score=${fidelity.meanScore.toFixed(1)})`
			);
		}

		// ── Report ────────────────────────────────────────────────────────────
		const { reportPath, latestPath } = writeReport('eval', {
			generatedAt: new Date().toISOString(),
			mode,
			corpusUserId: EVAL_CORPUS_USER_ID,
			manifestSize: Object.keys(manifest).length,
			layerChecks,
			retrieval,
			answerQa,
			fidelity
		});

		logEval(`=== Eval complete ===`);
		logEval(`report: ${reportPath}`);
		logEval(`latest: ${latestPath}`);

		// Print headline summary
		console.log('\n──────────────────────────────────────────────────');
		console.log('EVAL SUMMARY');
		console.log('──────────────────────────────────────────────────');
		console.log(`Mode:         ${mode}`);
		console.log(`Corpus:       ${Object.keys(manifest).length} thoughts`);
		console.log(
			`Entity F1:    ${layerChecks.entities.summary.f1.toFixed(3)} ` +
				`(P=${layerChecks.entities.summary.precision.toFixed(3)} R=${layerChecks.entities.summary.recall.toFixed(3)})`
		);
		console.log(
			`Relation F1:  ${layerChecks.relations.summary.f1.toFixed(3)} ` +
				`(P=${layerChecks.relations.summary.precision.toFixed(3)} R=${layerChecks.relations.summary.recall.toFixed(3)})`
		);
		if (hybridEntry) {
			console.log(
				`Retrieval:    NDCG@10=${hybridEntry.overall.ndcgAt10.toFixed(3)} ` +
					`MRR=${hybridEntry.overall.mrr.toFixed(3)} (hybrid)`
			);
		}
		console.log(
			`Answer QA:    ${answerQa.full.passed}/${answerQa.full.total} pass ` +
				`(mean score=${answerQa.full.summary.weightedScore.mean.toFixed(2)})`
		);
		if (fidelity) {
			console.log(
				`Fidelity:     ${fidelity.passed}/${fidelity.total} faithful ` +
					`(mean score=${fidelity.meanScore.toFixed(1)}/5)`
			);
		}
		console.log('──────────────────────────────────────────────────');
	} finally {
		stopHeartbeat();
	}
}

void runEval(main);
