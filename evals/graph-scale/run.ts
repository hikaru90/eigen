import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { logEval, runEval, withEvalDb } from '../harness/eval-context';
import { parseGraphScaleCli } from './cli';
import { collectGraphScaleMetrics } from './graph-metrics';
import { measureGraphScaleCaptureProbe } from './measure-capture';
import { measureGraphScaleConsolidation } from './measure-consolidation';
import { measureGraphScaleQaSet } from './measure-qa';
import { writeGraphScaleReport } from './report';
import { seedGraphScaleCorpus } from './seed-corpus-runner';
import { ensureGraphScaleOperatorReady, GRAPH_SCALE_OPERATOR_USER_ID } from './ensure-operator';
import type { GraphScalePoint, GraphScaleReport } from './types';

async function main(): Promise<void> {
	const cli = parseGraphScaleCli(process.argv.slice(2));
	const runId = randomUUID();
	const startedAt = new Date().toISOString();

	await ensureGraphScaleOperatorReady();

	logEval(
		`graph-scale run ${runId}: sizes=${cli.sizes.join(',')} tracks=${[...cli.tracks].join(',')}`
	);

	const points: GraphScalePoint[] = [];

	for (const n of cli.sizes) {
		logEval(`graph-scale: === corpus size N=${n} ===`);

		const seeded = await seedGraphScaleCorpus({
			runId,
			n,
			billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
			seedConcurrency: cli.seedConcurrency
		});

		const graph = await withEvalDb(
			seeded.userId,
			(db) => collectGraphScaleMetrics(seeded.userId, db),
			{ billingUserId: GRAPH_SCALE_OPERATOR_USER_ID }
		);

		const point: GraphScalePoint = {
			nThoughts: n,
			graph,
			captureProbe: null,
			qaFixedSet: null,
			consolidation: null,
			seedWallMs: seeded.wallMs
		};

		if (cli.tracks.has('capture')) {
			const groupId = `${runId}-n${n}-capture`;
			logEval(`graph-scale: track A capture probe (groupId=${groupId})`);
			point.captureProbe = await measureGraphScaleCaptureProbe({
				userId: seeded.userId,
				billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
				groupId
			});
			logEval(
				`graph-scale: capture probe ${point.captureProbe.credits} credits, ${point.captureProbe.wallMs}ms`
			);
		}

		if (cli.tracks.has('qa')) {
			const groupId = `${runId}-n${n}-qa`;
			logEval(`graph-scale: track B Q&A set (groupId=${groupId})`);
			point.qaFixedSet = await measureGraphScaleQaSet({
				userId: seeded.userId,
				billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
				groupId
			});
			logEval(
				`graph-scale: Q&A ${point.qaFixedSet.creditsTotal} credits total, p95 ${point.qaFixedSet.p95Ms}ms`
			);
		}

		if (cli.tracks.has('consolidation')) {
			const groupId = `${runId}-n${n}-consolidation`;
			logEval(`graph-scale: track C consolidation (groupId=${groupId})`);
			point.consolidation = await measureGraphScaleConsolidation({
				userId: seeded.userId,
				billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
				groupId
			});
			logEval(
				`graph-scale: consolidation ${point.consolidation.credits} credits, ` +
					`${point.consolidation.communitiesSummarized} communities summarized`
			);
		}

		points.push(point);
	}

	const report: GraphScaleReport = {
		runId,
		startedAt,
		finishedAt: new Date().toISOString(),
		operatorUserId: GRAPH_SCALE_OPERATOR_USER_ID,
		sizes: cli.sizes,
		tracks: [...cli.tracks],
		points
	};

	writeGraphScaleReport(report, cli.outputPath);
	logEval(`graph-scale: report written to ${cli.outputPath}`);
}

void runEval(main);
