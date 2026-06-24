import { composeAnswer } from '$lib/server/qa/compose-answer';
import { runWithTrace } from '$lib/server/activity/trace-context';
import { withEvalDb } from '../harness/eval-context';
import { aggregateActivityCostByGroupId } from './aggregate-cost';
import type { GraphScaleQaResult } from './types';

/** Fixed queries that exercise retrieval across eval fixture themes — independent of corpus size. */
export const GRAPH_SCALE_QA_QUERIES = [
	'What do I know about sourdough or baking?',
	'Who is Marcus?',
	'What climbing or bouldering have I noted?',
	'What is Eigen or EigenMesh?',
	'What books am I reading or have I finished?'
] as const;

function percentile95(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
	return sorted[Math.max(0, idx)] ?? 0;
}

export async function measureGraphScaleQaSet(input: {
	userId: string;
	billingUserId: string;
	groupId: string;
	questions?: readonly string[];
}): Promise<GraphScaleQaResult> {
	const questions = input.questions ?? GRAPH_SCALE_QA_QUERIES;
	const perQuery: GraphScaleQaResult['perQuery'] = [];
	const wallSamples: number[] = [];

	for (const question of questions) {
		const queryGroupId = `${input.groupId}:${perQuery.length}`;
		const startedAt = Date.now();

		await withEvalDb(
			input.userId,
			() =>
				runWithTrace(queryGroupId, () =>
					composeAnswer({
						userId: input.userId,
						question
					})
				),
			{ billingUserId: input.billingUserId }
		);

		const wallMs = Date.now() - startedAt;
		wallSamples.push(wallMs);

		const cost = await withEvalDb(input.userId, (db) =>
			aggregateActivityCostByGroupId(db, input.userId, queryGroupId)
		);

		perQuery.push({
			question,
			wallMs,
			usd: cost.totalUsd,
			credits: cost.totalCredits
		});
	}

	let usdSum = 0;
	let creditsSum = 0;
	for (const row of perQuery) {
		usdSum += Number(row.usd);
		creditsSum += row.credits;
	}

	const queryCount = perQuery.length;
	const usdTotal = usdSum.toFixed(6);
	const usdPerQuery = queryCount > 0 ? (usdSum / queryCount).toFixed(6) : '0.000000';

	return {
		usdTotal,
		creditsTotal: creditsSum,
		usdPerQuery,
		creditsPerQuery: queryCount > 0 ? creditsSum / queryCount : 0,
		p95Ms: percentile95(wallSamples),
		queryCount,
		perQuery,
		groupId: input.groupId
	};
}
